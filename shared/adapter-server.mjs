#!/usr/bin/env node
/*
 * adapter-server.mjs  (dependency-free)
 *
 *   node shared/adapter-server.mjs [--port 7777]
 *
 * - Serves the whole project folder, so prototypes open at
 *     http://127.0.0.1:7777/prototypes/<name>/index.html
 * - GET  /events          Server-Sent Events stream of AgentEvents (history is replayed on connect)
 * - POST /event           One AgentEvent or an array. Labelled source = "self-reported".
 * - POST /claude-hook     A Claude Code hook payload. Mapped to AgentEvents. Labelled source = "live-hook".
 * - POST /sim?speed=1     Plays shared/scenario.json through the bus. Labelled source = "simulated".
 * - POST /reset           Clears history and tells viewers to reset.
 * - GET  /status          Small JSON status.
 *
 * Point a prototype at it with  ?live=http://127.0.0.1:7777
 * Binds to 127.0.0.1 only. Nothing leaves your machine.
 *
 * HONESTY: the badge in the UI comes from the `meta` message this server sends. It only says LIVE when the
 * events arrived through /claude-hook. The /claude-hook mapping has been exercised with synthetic payloads
 * (see shared/test-hook-mapper.mjs) but not against a long real Claude Code session; treat it as a starting point.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp4': 'video/mp4', '.gif': 'image/gif', '.md': 'text/plain; charset=utf-8', '.jsonl': 'text/plain; charset=utf-8' };

/* ---------------- Claude Code hook -> AgentEvents ---------------- */
export function createHookMapper() {
  // Field names (session_id, hook_event_name, prompt, cwd, reason) were confirmed against REAL payloads
  // captured from a Claude Code 2.1.263 run (SessionStart, UserPromptSubmit, SessionEnd only).
  // Tool-level events (PreToolUse, PostToolUse, SubagentStart/Stop, PermissionRequest) are mapped from
  // the documented shape and have NOT been verified against a real long session.
  let S;
  const fresh = () => { S = { started: false, finished: false, t0: null, sub: 0, blocked: {}, spawned: {}, failed: {}, attempts: {}, calls: {} }; };
  fresh();
  const now = () => (S.t0 == null ? 0 : Date.now() - S.t0);
  const brief = (o) => { if (!o) return ''; if (typeof o === 'string') return o.slice(0, 80); const v = o.file_path || o.command || o.pattern || o.url || o.query || o.description || o.prompt || JSON.stringify(o); return String(v).slice(0, 80); };
  const ensureMain = (out, p) => {
    if (S.t0 == null) S.t0 = Date.now();
    if (!S.started) { S.started = true; out.push({ t: now(), type: 'task_started', task: { id: p.session_id || 'session', title: (p.prompt ? String(p.prompt).replace(/\s+/g, ' ').slice(0, 80) : 'Claude Code session'), goal: '' } }); }
    if (!S.spawned.main) { S.spawned.main = true; out.push({ t: now(), type: 'agent_spawned', agentId: 'main', name: 'Claude Code', label: 'MAIN', role: 'Main session', parentId: null, dependsOn: [] }); }
  };
  const agentOf = (p) => (p.agent_id ? String(p.agent_id) : 'main');
  const spawnSub = (out, p, name, desc) => {
    S.sub += 1; const id = (p.agent_id && String(p.agent_id)) || 'sub' + S.sub;
    if (!S.spawned[id]) { S.spawned[id] = true;
      out.push({ t: now(), type: 'agent_spawned', agentId: id, name: name || 'Subagent ' + S.sub, label: String(name || 'SUB' + S.sub).slice(0, 6).toUpperCase(), role: desc || 'Subagent', parentId: 'main', dependsOn: [] });
      out.push({ t: now(), type: 'work_delegated', fromId: 'main', toId: id, workId: 'w-' + id, description: desc || 'Subagent task' }); }
    return id;
  };
  const ret = (out, p, a, ok) => { const id = p.tool_use_id; if (id && S.calls[id] != null) { out.push({ t: now(), type: 'tool_returned', agentId: a, callId: id, durationMs: now() - S.calls[id], ok }); delete S.calls[id]; } };
  return function map(p) {
    const out = []; const ev = p.hook_event_name;
    if (ev === 'SessionStart') return out; // nothing to draw yet; the task starts at the first prompt
    if (ev === 'UserPromptSubmit' && S.finished) { fresh(); out.push({ __reset: true }); } // a new prompt after Stop is a new task
    if (ev === 'SessionEnd' && (!S.started || S.finished)) return out;
    ensureMain(out, p);
    const a = agentOf(p);
    if (S.blocked[a] && ['PreToolUse', 'PostToolUse', 'UserPromptSubmit'].includes(ev)) { S.blocked[a] = false; out.push({ t: now(), type: 'agent_unblocked', agentId: a, by: 'permission response' }); }
    switch (ev) {
      case 'UserPromptSubmit': break;
      case 'PreToolUse':
        if (S.failed[a]) { S.failed[a] = false; S.attempts[a] = (S.attempts[a] || 1) + 1; out.push({ t: now(), type: 'agent_retry', agentId: a, attempt: S.attempts[a] }); }
        if (p.tool_name === 'Task' || p.tool_name === 'Agent') { const ti = p.tool_input || {}; spawnSub(out, {}, ti.subagent_type || 'Subagent', ti.description || brief(ti)); }
        if (p.tool_use_id) S.calls[p.tool_use_id] = now();
        out.push({ t: now(), type: 'tool_called', agentId: a, tool: p.tool_name || 'tool', input: brief(p.tool_input), durationMs: 1000, callId: p.tool_use_id || undefined }); break;
      case 'PostToolUseFailure': ret(out, p, a, false); S.failed[a] = true; out.push({ t: now(), type: 'agent_failed', agentId: a, error: String(p.error || (p.tool_response && p.tool_response.error) || 'tool failed').slice(0, 120) }); break;
      case 'PostToolUse': ret(out, p, a, !(p.tool_response && (p.tool_response.is_error || p.tool_response.error))); if (p.tool_response && (p.tool_response.is_error || p.tool_response.error)) { S.failed[a] = true; out.push({ t: now(), type: 'agent_failed', agentId: a, error: String(p.tool_response.error || 'tool error').slice(0, 120) }); } break;
      case 'PermissionRequest': S.blocked[a] = true; out.push({ t: now(), type: 'agent_blocked', agentId: a, reason: ('Waiting for permission: ' + (p.tool_name || 'tool') + ' ' + brief(p.tool_input)).slice(0, 120), needs: 'human approval' }); break;
      case 'Notification': if (/permission|approve|confirm/i.test(p.message || '')) { S.blocked[a] = true; out.push({ t: now(), type: 'agent_blocked', agentId: a, reason: String(p.message).slice(0, 120), needs: 'human approval' }); } break;
      case 'SubagentStart': spawnSub(out, p, p.agent_type, p.agent_type); break;
      case 'SubagentStop': { const id = p.agent_id ? String(p.agent_id) : null; if (id && S.spawned[id]) out.push({ t: now(), type: 'agent_completed', agentId: id }); break; }
      case 'Stop': S.finished = true; out.push({ t: now(), type: 'agent_completed', agentId: 'main' }); out.push({ t: now(), type: 'task_finished', status: 'succeeded', outputIds: [], summary: 'Turn finished (Claude Code Stop hook)' }); break;
      case 'SessionEnd': S.finished = true; out.push({ t: now(), type: 'task_finished', status: 'ended', outputIds: [], summary: 'Session ended without a Stop (reason: ' + (p.reason || 'unknown') + ')' }); break;
    }
    return out;
  };
}

/* ---------------- server ---------------- */
export function startServer({ port = 7777, root = ROOT, quiet = false, handler = null, cors = '*', allowedHosts = null, hostname = '127.0.0.1' } = {}) {
  const clients = new Set(); let history = []; let source = 'waiting'; let sourceNote = 'Connected to the adapter. No events have arrived yet; nothing is shown until they do.'; let mapper = createHookMapper(); let simTimers = [];
  const send = (res, obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');
  const broadcast = (obj) => clients.forEach((c) => send(c, obj));
  const setSource = (s, note) => { if (s !== source || note !== sourceNote) { source = s; sourceNote = note; broadcast({ type: 'meta', source, sourceNote }); } };
  const emit = (events) => { for (const e of events) { if (e.__reset) { history = []; broadcast({ type: 'reset' }); continue; } history.push(e); broadcast(e); } };
  const reset = () => { simTimers.forEach(clearTimeout); simTimers = []; history = []; mapper = createHookMapper(); broadcast({ type: 'reset' }); };
  const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve(null); } }); });

  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'); const p = decodeURIComponent(url.pathname);
    // execution mode (lab-server): only answer requests whose Host header is the local address (blocks DNS rebinding) and send no CORS headers
    if (allowedHosts && !allowedHosts().includes(String(req.headers.host || '').toLowerCase())) { res.writeHead(421); return res.end('misdirected request'); }
    if (cors) { res.setHeader('Access-Control-Allow-Origin', cors); res.setHeader('Access-Control-Allow-Headers', '*'); }
    if (req.method === 'OPTIONS') { res.writeHead(cors ? 204 : 403); return res.end(); }
    if (handler && (await handler(req, res, url, p))) return;
    if (allowedHosts && p.split('/').some((seg) => seg.startsWith('.'))) { res.writeHead(403); return res.end(); } // no dotfiles in execution mode
    if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (p === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      send(res, { type: 'meta', source, sourceNote }); history.forEach((e) => send(res, e)); clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (p === '/api/bootstrap' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"service":false}'); } // legacy adapter: no execution service here (the app shows demo mode)
    if (p === '/status') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ clients: clients.size, events: history.length, source, sourceNote })); }
    if (req.method === 'POST' && p === '/reset') { reset(); res.writeHead(200); return res.end('ok'); }
    if (req.method === 'POST' && p === '/event') {
      const b = await readBody(req); if (!b) { res.writeHead(400); return res.end('bad json'); }
      const arr = Array.isArray(b) ? b : [b]; const t0 = history.length ? 0 : Date.now();
      arr.forEach((e) => { if (e.t == null) e.t = Date.now() - (global.__t0 ||= Date.now()); });
      setSource('self-reported', 'Events submitted by an agent or script over POST /event. Not independently verified.'); emit(arr); res.writeHead(200); return res.end('ok');
    }
    if (req.method === 'POST' && p === '/claude-hook') {
      const b = await readBody(req); if (!b) { res.writeHead(400); return res.end('bad json'); }
      if (process.env.AGENT_HOOK_LOG) { try { fs.appendFileSync(process.env.AGENT_HOOK_LOG, JSON.stringify(b) + '\n'); } catch {} }
      setSource('live-hook', 'Events mapped from Claude Code hook payloads received on POST /claude-hook.'); emit(mapper(b)); res.writeHead(200); return res.end('{}');
    }
    if (req.method === 'POST' && p === '/replay') { // events from tools/transcript-to-events.mjs, badge says REPLAY · transcript
      const b = await readBody(req); if (!b || !Array.isArray(b.events)) { res.writeHead(400); return res.end('expected {events:[...], note}'); }
      const speed = Number(url.searchParams.get('speed') || 1) || 1; reset();
      setSource('transcript', b.note || 'Replayed from a recorded Claude Code transcript. This is a recording of real past activity, not live.');
      b.events.forEach((e) => simTimers.push(setTimeout(() => emit([e]), e.t / speed))); res.writeHead(200); return res.end('replaying ' + b.events.length + ' events');
    }
    if (req.method === 'POST' && p === '/sim') {
      const speed = Number(url.searchParams.get('speed') || 1) || 1; reset();
      const sc = JSON.parse(fs.readFileSync(path.join(root, 'shared', 'scenario.json'), 'utf8'));
      setSource('simulated', 'Scripted scenario played through the adapter. No real agents are running.');
      sc.events.forEach((e) => simTimers.push(setTimeout(() => emit([e]), e.t / speed))); res.writeHead(200); return res.end('playing ' + sc.events.length + ' simulated events');
    }
    // static
    let f = path.join(root, p === '/' ? 'index.html' : p); if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => srv.listen(port, hostname, () => { const real = srv.address().port; if (!quiet) console.log(`agent-activity-lab server on http://127.0.0.1:${real}  (events: /events, hooks: POST /claude-hook, demo: POST /sim)`); resolve({ srv, port: real, close: () => new Promise((r) => { simTimers.forEach(clearTimeout); clients.forEach((c) => c.end()); srv.close(r); }) }); }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--port'); startServer({ port: i > 0 ? Number(process.argv[i + 1]) : 7777 });
}
