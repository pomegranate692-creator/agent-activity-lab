// Privacy tests: full Claude output (raw.jsonl) is OFF by default, opt-in works and is visible, activity metadata and History
// keep working, existing recordings are never touched, and the legacy demo adapter only answers this machine. TEST STUB only.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import assert from 'node:assert/strict';
import http from 'node:http'; import crypto from 'node:crypto'; import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const root = path.resolve(here, '..');
const stub = path.join(here, 'test', 'fake-claude.mjs'); fs.chmodSync(stub, 0o755); process.env.AGENT_LAB_CLAUDE_BIN = stub;
const { SessionManager } = await import('./sessions.mjs'); const { startLab, loadToken } = await import('./lab-server.mjs');
const { loadConfig } = await import('../shared/labconfig.mjs'); const { startServer } = await import('../shared/adapter-server.mjs');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const req = (port, opts, body) => new Promise((res, rej) => { const q = http.request({ hostname: '127.0.0.1', port, ...opts }, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res({ s: r.statusCode, h: r.headers, d })); }); q.on('error', rej); if (body) q.write(body); q.end(); });

async function runOne(home, prompt) {
  const manager = new SessionManager({ home }); const token = loadToken(home);
  const lab = await startLab({ port: 0, manager, token, quiet: true }); const base = `http://127.0.0.1:${lab.port}`;
  const H = { 'x-lab-token': token, 'content-type': 'application/json' };
  const c = await (await fetch(base + '/api/sessions', { method: 'POST', headers: H, body: JSON.stringify({ prompt, confirm: true, policy: 'workspace' }) })).json();
  let m; for (let i = 0; i < 100; i++) { m = await (await fetch(base + '/api/sessions/' + c.id, { headers: H })).json(); if (m.status !== 'running') break; await new Promise((r) => setTimeout(r, 100)); }
  const list = await (await fetch(base + '/api/sessions', { headers: H })).json();
  const boot = await req(lab.port, { path: '/api/bootstrap', headers: { host: '127.0.0.1:' + lab.port, 'sec-fetch-site': 'same-origin' } });
  await lab.close(); return { id: c.id, meta: m, list, boot: JSON.parse(boot.d), dir: path.join(home, 'sessions', c.id) };
}
const listIds = (l) => (Array.isArray(l) ? l : l.sessions || []).map((x) => x.id);

// 1. default: no full output, metadata + History intact
const h1 = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-priv-'));
ok(loadConfig(h1).recordFullOutput === false, 'recordFullOutput defaults to false');
const r1 = await runOne(h1, 'Create a simple Python script that analyzes a CSV file and summarizes the results.');
ok(r1.meta.status === 'succeeded', 'default run finishes');
ok(!fs.existsSync(path.join(r1.dir, 'raw.jsonl')), 'default run saves NO raw.jsonl (full Claude output)');
const ev = fs.readFileSync(path.join(r1.dir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const types = new Set(ev.map((e) => e.type));
ok(ev.length > 3 && [...types].some((t) => /tool/.test(t)) && [...types].some((t) => /agent|task/.test(t)), 'activity metadata kept: agent/task + tool events (' + [...types].join(',') + ')');
ok(ev.every((e) => typeof e.t === 'number'), 'every event keeps its timing');
ok(JSON.parse(fs.readFileSync(path.join(r1.dir, 'meta.json'))).fullOutput === false, 'session marked fullOutput:false');
ok(listIds(r1.list).includes(r1.id), 'History lists the default-mode session');
ok(r1.boot.recordFullOutput === false, 'dashboard bootstrap reports recording off (no badge)');

// 2. pre-existing recordings are never touched
const old = path.join(h1, 'sessions', '11111111-2222-3333-4444-555555555555'); fs.mkdirSync(old, { recursive: true });
fs.copyFileSync(path.join(r1.dir, 'meta.json'), path.join(old, 'meta.json')); fs.copyFileSync(path.join(r1.dir, 'events.jsonl'), path.join(old, 'events.jsonl'));
const om = JSON.parse(fs.readFileSync(path.join(old, 'meta.json'))); om.id = path.basename(old); om.fullOutput = undefined; fs.writeFileSync(path.join(old, 'meta.json'), JSON.stringify(om));
fs.writeFileSync(path.join(old, 'raw.jsonl'), '{"type":"system","note":"an older recording"}\n'); const before = sha(path.join(old, 'raw.jsonl'));
const r2 = await runOne(h1, 'Create a simple Python script that analyzes a CSV file and summarizes the results.');
ok(fs.existsSync(path.join(old, 'raw.jsonl')) && sha(path.join(old, 'raw.jsonl')) === before, 'existing raw.jsonl left byte for byte');
ok(listIds(r2.list).includes(path.basename(old)) && listIds(r2.list).includes(r1.id), 'older sessions still in History');

// 3. opt-in via config.json (the lab CLI writes it, keeping other keys)
const h3 = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-priv-')); fs.writeFileSync(path.join(h3, 'config.json'), JSON.stringify({ openWindow: false, staleMinutes: 45 }));
execFileSync(process.execPath, [path.join(root, 'tools', 'lab.mjs'), 'record-output', 'on'], { env: { ...process.env, AGENT_LAB_HOME: h3 } });
const cj = JSON.parse(fs.readFileSync(path.join(h3, 'config.json'))); ok(cj.recordFullOutput === true && cj.openWindow === false && cj.staleMinutes === 45, 'record-output on sets the flag and keeps other settings');
ok((fs.statSync(path.join(h3, 'config.json')).mode & 0o777) === 0o600, 'config.json is private (0600)');
ok(/ON \(debug/.test(execFileSync(process.execPath, [path.join(root, 'tools', 'lab.mjs'), 'status'], { env: { ...process.env, AGENT_LAB_HOME: h3 }, encoding: 'utf8' })), 'lab status says recording is ON');
const r3 = await runOne(h3, 'Create a simple Python script that analyzes a CSV file and summarizes the results.');
const rawf = path.join(r3.dir, 'raw.jsonl');
ok(fs.existsSync(rawf) && fs.readFileSync(rawf, 'utf8').trim().split('\n').every((l) => { try { JSON.parse(l); return true; } catch { return false; } }), 'opt-in run records the full output as JSON lines');
ok((fs.statSync(rawf).mode & 0o777) === 0o600 && (fs.statSync(r3.dir).mode & 0o777) === 0o700, 'recording is private (file 0600, folder 0700)');
ok(r3.meta.fullOutput === true && r3.boot.recordFullOutput === true, 'session marked fullOutput:true and dashboard told to show the badge');
ok(fs.readFileSync(path.join(r3.dir, 'events.jsonl'), 'utf8').trim().split('\n').length === fs.readFileSync(path.join(r1.dir, 'events.jsonl'), 'utf8').trim().split('\n').length, 'same activity events with or without full output');
execFileSync(process.execPath, [path.join(root, 'tools', 'lab.mjs'), 'record-output', 'off'], { env: { ...process.env, AGENT_LAB_HOME: h3 } });
ok(loadConfig(h3).recordFullOutput === false && fs.existsSync(rawf), 'record-output off turns it off and keeps the existing recording');

// 4. opt-in via environment
process.env.AGENT_LAB_RECORD_FULL_OUTPUT = '1'; ok(loadConfig(h1).recordFullOutput === true, 'AGENT_LAB_RECORD_FULL_OUTPUT=1 turns it on'); delete process.env.AGENT_LAB_RECORD_FULL_OUTPUT;

// 5. dashboard page shows the badge only when on
const rp = fs.readFileSync(path.join(root, 'app', 'runpanel.js'), 'utf8'); ok(/recordingBadge\(j\)/.test(rp) && /if \(!j \|\| !j\.recordFullOutput/.test(rp), 'dashboard badge is wired to the bootstrap flag');

// 6. legacy demo adapter: this machine only
const a = await startServer({ port: 0, quiet: true }); const P = a.port || a.srv.address().port; const host = '127.0.0.1:' + P;
ok((await req(P, { path: '/status', headers: { host: 'evil.example:' + P } })).s === 421, 'adapter: foreign Host (DNS rebinding) -> 421');
const st = await req(P, { path: '/status', headers: { host, origin: 'https://evil.example' } }); ok(st.s === 200 && !st.h['access-control-allow-origin'], 'adapter: no CORS header, other sites cannot read it');
ok((await req(P, { path: '/event', method: 'POST', headers: { host, origin: 'https://evil.example', 'content-type': 'text/plain' } }, '{}')).s === 403, 'adapter: POST from another origin -> 403');
ok((await req(P, { path: '/claude-hook', method: 'POST', headers: { host, 'sec-fetch-site': 'cross-site' } }, '{}')).s === 403, 'adapter: cross-site browser POST -> 403');
ok((await req(P, { path: '/event', method: 'POST', headers: { host, origin: 'http://' + host } }, '{"type":"agent_spawned","agentId":"x"}')).s === 200, 'adapter: same-origin page POST still works');
ok((await req(P, { path: '/claude-hook', method: 'POST', headers: { host } }, '{"hook_event_name":"SessionStart"}')).s === 200, 'adapter: local process (no Origin) can still post hooks');
ok((await req(P, { path: '/prototypes/09-card-tree/index.html', headers: { host } })).s === 200, 'adapter: prototypes still served');
ok((await req(P, { path: '/.git/config', headers: { host } })).s === 403, 'adapter: dotfiles refused');
ok((await req(P, { path: '/status', headers: { host: 'localhost:' + P } })).s === 200, 'adapter: localhost Host accepted');
a.close ? await a.close() : a.srv.close();
const b = await startServer({ port: 0, quiet: true, cors: 'https://demo.example' }); const Q = b.port || b.srv.address().port;
const sb = await req(Q, { path: '/status', headers: { host: '127.0.0.1:' + Q, origin: 'https://demo.example' } }); ok(sb.h['access-control-allow-origin'] === 'https://demo.example', 'adapter: --allow-origin opens exactly one origin, never *');
b.close ? await b.close() : b.srv.close();
console.log(`privacy tests OK (${n} checks)`); process.exit(0);
