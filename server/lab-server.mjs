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

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };

export function loadToken(home = HOME) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 }); const f = path.join(home, 'token');
  try { const t = fs.readFileSync(f, 'utf8').trim(); if (/^[0-9a-f]{64}$/.test(t)) return t; } catch {}
  const t = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(f, t + '\n', { mode: 0o600 }); return t;
}
const same = (a, b) => { const A = Buffer.from(String(a)), B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); };

export async function startLab({ port = 7777, manager, token, quiet = false } = {}) {
  let realPort = port;
  const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(obj)); return true; };
  const readJson = (req) => new Promise((resolve, reject) => { let b = ''; req.on('data', (d) => { b += d; if (b.length > 70000) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); } }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(Object.assign(new Error('invalid JSON'), { status: 400 })); } }); });
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
      const source = meta.engine === 'test-stub' ? 'test-stub' : live ? 'claude-code' : 'claude-code-saved';
      w({ type: 'meta', source, sourceNote: meta.engine === 'test-stub' ? 'A TEST STUB produced these events. No real Claude Code ran.' : `Events mapped from the Claude Code stream of session ${meta.id.slice(0, 8)} (${live ? 'running' : meta.status}).` });
      (manager.events(m[2]) || []).forEach(w);
      const unsub = live ? manager.subscribe(m[2], (e) => { if (e.type === '__end') { w({ type: '__end', status: e.status }); } else w(e); }) : null;
      req.on('close', () => { if (unsub) unsub(); }); return true;
    }
    if (req.method === 'POST' && !p.startsWith('/api/') && ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) return send(res, 403, { error: 'cross-site POST refused' }); // event bus endpoints are for local processes and this page only
    if (!p.startsWith('/api/')) return false;
    if (p === '/api/bootstrap') {
      if (req.headers['sec-fetch-site'] !== 'same-origin') return send(res, 403, { error: 'bootstrap only answers same-origin browser requests' });
      const claude = await manager.probe();
      return send(res, 200, { token, claude, engine: manager.engine, workspaceRoot: manager.cfg.workspaceRoot, policies: Object.fromEntries(Object.entries(POLICIES).map(([k, v]) => [k, { label: v.label, text: v.text, allow: v.allow }])), limits: { maxBudgetUsd: manager.cfg.maxBudgetUsd, timeoutMin: Math.round(manager.cfg.timeoutMs / 60000), oneTaskAtATime: true } });
    }
    if (!authed(req)) return send(res, 401, { error: 'missing or wrong X-Lab-Token' });
    if (req.method === 'POST' && !/^application\/json/i.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'POST requires application/json' });
    try {
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
  if (!quiet) console.log(`Agent Activity Lab command center: http://127.0.0.1:${realPort}/app/index.html\nEngine: ${manager.engine === 'test-stub' ? 'TEST STUB (AGENT_LAB_CLAUDE_BIN set)' : 'Claude Code CLI "' + manager.cfg.claudeBin + '"'}   Workspaces: ${manager.cfg.workspaceRoot}   Token file: ${path.join(manager.home, 'token')}`);
  return { ...srv, port: realPort };
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const cfg = {}; if (opt('workspace-root')) cfg.workspaceRoot = path.resolve(opt('workspace-root')); if (opt('budget')) cfg.maxBudgetUsd = Number(opt('budget')); if (opt('model')) cfg.model = opt('model');
  const manager = new SessionManager({ config: cfg });
  const token = loadToken(manager.home);
  await startLab({ port: Number(opt('port', 7777)), manager, token });
}
