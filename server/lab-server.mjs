#!/usr/bin/env node
/*
 * lab-server.mjs  Local command center for Agent Activity Lab.
 *
 *   node server/lab-server.mjs [--port 7777]
 *   open http://127.0.0.1:7777/app/index.html
 *
 * Serves the dashboard AND runs real Claude Code tasks (see sessions.mjs). Single user, local only.
 *
 * Security model (this is a code-execution surface, so it is strict):
 *  - Listens on 127.0.0.1 only. Requests whose Host header is not 127.0.0.1:PORT or localhost:PORT are refused (DNS rebinding).
 *  - No CORS headers are sent, so other websites cannot read responses or drive the API from a browser.
 *  - Every /api call needs the secret token (header X-Lab-Token). The token is created once in ~/.agent-activity-lab/token (0600).
 *    The dashboard gets it from GET /api/bootstrap, which answers only to a same-origin browser request (Sec-Fetch-Site: same-origin).
 *    curl users read the token file.
 *  - POSTs must be application/json. Prompts are sent to Claude Code on stdin, never through a shell.
 *  - Tasks run only in a fresh folder under the approved workspace root, with a tool allowlist, a deny list and a budget cap.
 *  - Generated files are served as text/plain or as downloads, never as HTML, so they cannot run script in this origin.
 *  - Dotfiles are never served.
 *  GitHub Pages cannot reach this service and is not meant to: it stays the public SIMULATED demo.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { startServer } from '../shared/adapter-server.mjs';
import { SessionManager, POLICIES, HOME } from './sessions.mjs';
import { loadConfig, isDisabled, proof } from '../shared/labconfig.mjs';
import { createCompanion } from './companion.mjs';
import { buildStamp } from '../shared/labconfig.mjs';
import { webView } from './webview.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };

export function loadToken(home = HOME) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 }); const f = path.join(home, 'token');
  try { const t = fs.readFileSync(f, 'utf8').trim(); if (/^[0-9a-f]{64}$/.test(t)) return t; } catch {}
  const t = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(f, t + '\n', { mode: 0o600 }); return t;
}
const same = (a, b) => { const A = Buffer.from(String(a)), B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); };

export async function startLab({ port = 7777, manager, token, quiet = false, autostarted = false } = {}) {
  let realPort = port; const feedClients = new Set();
  const build = buildStamp(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')); const startedAt = Date.now();
  const log = (m) => { if (!quiet) console.log(new Date().toISOString() + ' ' + m); };
  const pages = () => [...feedClients].map((c) => ({ ...(c.__lab || {}) }));
  const visibleCount = () => [...feedClients].filter((c) => c.__lab && c.__lab.visible).length;
  let probeCache = null, probeAt = 0, probing = null; // the claude CLI check must never delay a dashboard page from connecting
  const probeSoon = () => { if (!probing && Date.now() - probeAt > 60000) probing = manager.probe().then((c) => { probeCache = c; probeAt = Date.now(); }).catch(() => {}).finally(() => { probing = null; }); return probing; };
  let pageErrors = 0;
  const getConfig = () => { const c = loadConfig(manager.home); return { ...c, openWindow: c.openWindow && !isDisabled(manager.home) }; };
  const companion = createCompanion({ url: () => `http://127.0.0.1:${realPort}/app/index.html`, getConfig, viewerCount: visibleCount, totalCount: () => feedClients.size, focusedCount: () => [...feedClients].filter((c) => c.__lab && c.__lab.visible && c.__lab.focused).length, log: (m) => log('[window] ' + m) });
  manager.observer.onActivity((kind, meta) => { if (kind === 'task') companion.activity('a task started in Claude Code', meta && meta.claudeSessionId); }); // not on SessionStart: a window that pops up while you are still typing would take your keystrokes
  manager.onFeed((meta) => { for (const c of feedClients) { try { c.write('data: ' + JSON.stringify({ type: 'session', meta }) + '\n\n'); } catch {} } });
  const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(obj)); return true; };
  const readJson = (req, limit = 70000) => new Promise((resolve, reject) => { let b = ''; req.on('data', (d) => { b += d; if (b.length > limit) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); } }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(Object.assign(new Error('invalid JSON'), { status: 400 })); } }); });
  const authed = (req) => same(req.headers['x-lab-token'] || '', token);

  const handler = async (req, res, url, p) => {
    /* ---- SSE for one session: /s/<token>/<id>/events (token in the path because EventSource cannot send headers) ---- */
    let m = p.match(/^\/s\/([0-9a-f]{64})\/([0-9a-f-]{36})\/events$/);
    if (m) {
      if (!same(m[1], token)) return send(res, 403, { error: 'forbidden' });
      const meta = manager.meta(m[2]); if (!meta) return send(res, 404, { error: 'no such session' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
      const w = (o) => res.write('data: ' + JSON.stringify(o) + '\n\n');
      const live = meta.status === 'running';
      const obs = meta.origin === 'observed'; const source = meta.engine === 'test-stub' ? 'test-stub' : obs ? (live ? 'claude-code-observed' : 'claude-code-observed-saved') : live ? 'claude-code' : 'claude-code-saved';
      w({ type: 'meta', source, sourceNote: meta.engine === 'test-stub' ? 'A TEST STUB produced these events. No real Claude Code ran.' : obs ? `Observed from your own Claude Code session ${String(meta.claudeSessionId).slice(0, 8)} through hooks (${live ? 'running' : meta.status}). The dashboard watches; it does not control this session.` : `Events mapped from the Claude Code stream of session ${meta.id.slice(0, 8)} (${live ? 'running' : meta.status}).` });
      (manager.events(m[2]) || []).forEach(w);
      const unsub = live ? manager.subscribe(m[2], (e) => { if (e.type === '__end') { w({ type: '__end', status: e.status }); } else w(e); }) : null;
      req.on('close', () => { if (unsub) unsub(); }); return true;
    }
    m = p.match(/^\/s\/([0-9a-f]{64})\/feed$/);
    if (m) { // live feed of session changes for the dashboard (new Claude Code tasks appear without polling)
      if (!same(m[1], token)) return send(res, 403, { error: 'forbidden' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
      res.write('retry: 1000\n\ndata: ' + JSON.stringify({ type: 'sessions', build, sessions: manager.list().slice(0, 100) }) + '\n\n'); // retry: reconnect fast after a service restart
      res.__lab = { id: String(url.searchParams.get('v') || '').slice(0, 40), visible: url.searchParams.has('v') && url.searchParams.get('vis') !== '0', focused: url.searchParams.get('foc') === '1', since: Date.now(), build: String(url.searchParams.get('b') || '').slice(0, 12) || null, browser: /Chrome\//.test(req.headers['user-agent'] || '') ? 'Chrome' : /Safari\//.test(req.headers['user-agent'] || '') ? 'Safari' : /Firefox\//.test(req.headers['user-agent'] || '') ? 'Firefox' : 'other' }; // a page that does not report visibility (an old page left open from before this feature) is treated as not visible
      if (res.__lab.visible && res.__lab.id && companion.recentlyOpened()) for (const c of feedClients) if (c.__lab && c.__lab.since < companion.lastOpenAt()) { try { c.write('data: {"type":"close"}\n\n'); } catch {} } // the window we just opened replaces every older dashboard page (they close themselves where the browser allows it)
      feedClients.add(res); const hb = setInterval(() => { try { res.write('data: {"type":"hb"}\n\n'); } catch {} }, 15000); hb.unref(); // a real message (not a comment) so the page can tell a dead connection from a quiet one
      log(`[page] connected ${res.__lab.id || '(old page, no id)'} ${res.__lab.visible ? 'visible' : 'hidden'} ${res.__lab.browser}; ${feedClients.size} page(s) connected`);
      req.on('close', () => { clearInterval(hb); feedClients.delete(res); log(`[page] disconnected ${res.__lab.id || '(old page)'}; ${feedClients.size} page(s) connected`); }); return true;
    }
    if (req.method === 'POST' && !p.startsWith('/api/') && ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) return send(res, 403, { error: 'cross-site POST refused' }); // event bus endpoints are for local processes and this page only
    if (!p.startsWith('/api/')) return false;
    if (p === '/api/hello' && req.method === 'GET') return send(res, 200, { lab: 'agent-activity-lab', proof: proof(token) }); // lets the hook forwarder confirm who is listening BEFORE it sends the token
    if (p === '/api/bootstrap') {
      if (req.headers['sec-fetch-site'] !== 'same-origin') return send(res, 403, { error: 'bootstrap only answers same-origin browser requests' });
      if (!probeCache) await Promise.race([probeSoon(), new Promise((r) => setTimeout(r, 1500))]); else probeSoon();
      const claude = probeCache || { found: true, version: null, loggedIn: true, pending: true, detail: 'Still checking the Claude Code CLI.' };
      return send(res, 200, { token, build, claude, engine: manager.engine, recordFullOutput: manager.recordFullOutput, workspaceRoot: manager.cfg.workspaceRoot, policies: Object.fromEntries(Object.entries(POLICIES).map(([k, v]) => [k, { label: v.label, text: v.text, allow: v.allow }])), limits: { maxBudgetUsd: manager.cfg.maxBudgetUsd, timeoutMin: Math.round(manager.cfg.timeoutMs / 60000), oneTaskAtATime: true }, observer: manager.observer.status(), settings: getConfig() });
    }
    if (!authed(req)) return send(res, 401, { error: 'missing or wrong X-Lab-Token' });
    if (req.method === 'POST' && !/^application\/json/i.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'POST requires application/json' });
    try {
      if (p === '/api/hook' && req.method === 'POST') { // Claude Code hook payloads from tools/hook-forward.mjs
        const b = await readJson(req, 8 * 1024 * 1024); const r = manager.observer.ingest(b); return send(res, r.ok ? 200 : 400, r);
      }
      if (p === '/api/viewer' && req.method === 'POST') { // the dashboard page reports whether it can be seen (document.visibilityState)
        const b = await readJson(req, 2000); let known = false; for (const c of feedClients) if (c.__lab && b && c.__lab.id && c.__lab.id === String(b.id || '')) { known = true; const was = c.__lab.visible; c.__lab.visible = b.visible !== false; c.__lab.focused = b.focused === true; if (was !== c.__lab.visible) log(`[page] ${c.__lab.id} is now ${c.__lab.visible ? 'visible' : 'hidden'}`); } return send(res, 200, { ok: true, known });
      }
      if (p === '/api/page-error' && req.method === 'POST') { // a script error in a dashboard page: written to the log so `lab.mjs doctor` can show it
        const b = await readJson(req, 4000); if (pageErrors++ < 200) log('[page-error] ' + String((b && b.id) || '?').slice(0, 20) + ' ' + String((b && b.message) || '').replace(/\s+/g, ' ').slice(0, 400)); return send(res, 200, { ok: true });
      }
      if (p === '/api/status' && req.method === 'GET') return send(res, 200, { observer: manager.observer.status(), build, startedAt, viewers: feedClients.size, visibleViewers: visibleCount(), pages: pages(), pageErrors, running: manager.runningAll().length, windowsOpened: companion.count() });
      if (p === '/api/web' && req.method === 'GET') { const q = url.searchParams; return send(res, 200, webView(ROOT, manager, { session: q.get('session') || '', w: q.get('w'), h: q.get('h'), reduced: q.get('reduced') === '1' })); } // the Living Web drawing for the pane inside the Claude app
      if (p === '/api/claude' && req.method === 'GET') return send(res, 200, await manager.probe());
      if (p === '/api/sessions' && req.method === 'GET') return send(res, 200, { sessions: manager.list() });
      if (p === '/api/sessions' && req.method === 'POST') {
        const b = await readJson(req);
        if (b.confirm !== true) return send(res, 400, { error: 'confirm:true is required: the person pressing Run has read the policy.' });
        const c = await manager.probe();
        if (!c.found) return send(res, 503, { error: c.detail, code: 'claude_missing' });
        if (!c.loggedIn) return send(res, 503, { error: c.detail, code: 'not_signed_in' });
        return send(res, 201, manager.create({ prompt: b.prompt, policy: b.policy || 'workspace' }));
      }
      m = p.match(/^\/api\/sessions\/([0-9a-f-]{36})(?:\/(\w+))?$/);
      if (m) {
        const id = m[1], act = m[2]; const meta = manager.meta(id); if (!meta) return send(res, 404, { error: 'no such session' });
        if (!act && req.method === 'GET') return send(res, 200, meta);
        if (act === 'events' && req.method === 'GET') return send(res, 200, { events: manager.events(id) || [] });
        if (act === 'files' && req.method === 'GET') return send(res, 200, { files: manager.files(id) || [] });
        if (meta.origin === 'observed' && ['stop', 'retry', 'followup'].includes(act)) return send(res, 409, { error: 'This task is observed from your own Claude Code session. The dashboard does not control it; use Claude Code itself to stop, retry or approve.' });
        if (act === 'stop' && req.method === 'POST') return manager.stop(id) ? send(res, 200, { stopping: true }) : send(res, 409, { error: 'session is not running' });
        if (act === 'retry' && req.method === 'POST') {
          const b = await readJson(req); if (b.confirm !== true) return send(res, 400, { error: 'confirm:true is required' });
          const c = await manager.probe(); if (!c.found || !c.loggedIn) return send(res, 503, { error: c.detail, code: c.found ? 'not_signed_in' : 'claude_missing' });
          return send(res, 201, manager.create({ prompt: meta.prompt, policy: meta.policy, retryOf: id, approve: Array.isArray(b.approve) ? b.approve.slice(0, 5) : [] }));
        }
        if (act === 'followup' && req.method === 'POST') {
          const b = await readJson(req); if (b.confirm !== true) return send(res, 400, { error: 'confirm:true is required' });
          const c = await manager.probe(); if (!c.found || !c.loggedIn) return send(res, 503, { error: c.detail, code: c.found ? 'not_signed_in' : 'claude_missing' });
          return send(res, 201, manager.followUp(id, { kind: b.kind, agentId: typeof b.agentId === 'string' ? b.agentId : null, rules: Array.isArray(b.rules) ? b.rules.filter((x) => typeof x === 'string') : [] }));
        }
        if (act === 'file' && req.method === 'GET') {
          const f = manager.readFile(id, url.searchParams.get('path') || ''); if (!f) return send(res, 404, { error: 'no such file' });
          if (f.tooLarge) return send(res, 413, { error: 'file is larger than 2 MB; open it from the workspace folder', size: f.size });
          const dl = url.searchParams.get('download') === '1';
          res.writeHead(200, { 'Content-Type': dl ? 'application/octet-stream' : 'text/plain; charset=utf-8', 'Content-Disposition': (dl ? 'attachment' : 'inline') + '; filename="' + f.name.replace(/[^\w.\-]/g, '_') + '"', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'no-store' });
          res.end(f.data); return true;
        }
      }
      return send(res, 404, { error: 'unknown endpoint' });
    } catch (e) { return send(res, e.status || 500, { error: e.message || 'error' }); }
  };

  const srv = await startServer({ port, quiet: true, handler, cors: null, allowedHosts: () => [`127.0.0.1:${realPort}`, `localhost:${realPort}`] });
  realPort = srv.port;
  probeSoon();
  if (!quiet && manager.recordFullOutput) console.log('NOTE: full Claude output recording is ON (debug). Tasks run from the dashboard save raw.jsonl in ' + manager.sessDir + '. Turn off: node tools/lab.mjs record-output off');
  if (!quiet) console.log(new Date().toISOString() + ` service started (pid ${process.pid}, code ${build})\nAgent Activity Lab command center: http://127.0.0.1:${realPort}/app/index.html\nEngine: ${manager.engine === 'test-stub' ? 'TEST STUB (AGENT_LAB_CLAUDE_BIN set)' : 'Claude Code CLI "' + manager.cfg.claudeBin + '"'}   Workspaces: ${manager.cfg.workspaceRoot}   Token file: ${path.join(manager.home, 'token')}`);
  return { ...srv, port: realPort, companion, feedClients, close: () => { for (const c of feedClients) { try { c.end(); } catch {} } feedClients.clear(); const done = srv.close(); try { srv.srv.closeAllConnections(); } catch {} return done; } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const cfg = {}; if (opt('workspace-root')) cfg.workspaceRoot = path.resolve(opt('workspace-root')); if (opt('budget')) cfg.maxBudgetUsd = Number(opt('budget')); if (opt('model')) cfg.model = opt('model');
  const lc = loadConfig(HOME);
  const manager = new SessionManager({ config: cfg, staleMinutes: lc.staleMinutes });
  const token = loadToken(manager.home);
  const lab = await startLab({ port: Number(opt('port', lc.port)), manager, token, autostarted: args.includes('--autostarted') });
  const pidFile = path.join(manager.home, 'server.pid'); fs.writeFileSync(pidFile, String(process.pid) + '\n', { mode: 0o600 });
  const sweep = setInterval(() => manager.observer.sweep(), 30000); sweep.unref();
  const bye = () => { try { if (fs.readFileSync(pidFile, 'utf8').trim() === String(process.pid)) fs.unlinkSync(pidFile); } catch {} process.exit(0); };
  process.on('SIGTERM', bye); process.on('SIGINT', bye);
}
