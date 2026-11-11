// End-to-end + security tests of the local command-center service using the TEST STUB (server/test/fake-claude.mjs).
// These prove the plumbing (spawn, stream mapping, persistence, files, stop, auth errors, security rules).
// They do NOT prove behaviour of the real Claude Code, which needs a signed-in CLI (see server/README.md).
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import assert from 'node:assert/strict';
import http from 'node:http'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const stub = path.join(here, 'test', 'fake-claude.mjs'); fs.chmodSync(stub, 0o755);
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-test-')); process.env.AGENT_LAB_HOME = home; process.env.AGENT_LAB_CLAUDE_BIN = stub;
const { SessionManager } = await import('./sessions.mjs'); const { startLab, loadToken } = await import('./lab-server.mjs');
const manager = new SessionManager({ home }); const token = loadToken(home);
const lab = await startLab({ port: 0, manager, token, quiet: true }); const base = `http://127.0.0.1:${lab.port}`;
const H = { 'x-lab-token': token, 'content-type': 'application/json' };
const api = async (p, o = {}) => { const r = await fetch(base + p, { ...o, headers: { ...H, ...(o.headers || {}) } }); let b = null; try { b = await r.json(); } catch {} return { s: r.status, b }; };
const raw = (opts, body) => new Promise((res, rej) => { const q = http.request({ hostname: '127.0.0.1', port: lab.port, ...opts }, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res({ s: r.statusCode, h: r.headers, d })); }); q.on('error', rej); q.end(body); });
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const waitDone = async (id) => { for (let i = 0; i < 100; i++) { const m = (await api('/api/sessions/' + id)).b; if (m.status !== 'running') return m; await new Promise((r) => setTimeout(r, 100)); } throw new Error('timeout'); };

/* ---- security ---- */
ok((await raw({ path: '/api/sessions', headers: { host: '127.0.0.1:' + lab.port } })).s === 401, 'no token -> 401');
ok((await raw({ path: '/api/sessions', headers: { host: 'evil.example:' + lab.port, 'x-lab-token': token } })).s === 421, 'wrong Host (DNS rebinding) -> 421');
ok((await raw({ path: '/api/bootstrap', headers: { host: '127.0.0.1:' + lab.port } })).s === 403, 'bootstrap without same-origin -> 403');
ok((await raw({ path: '/api/bootstrap', headers: { host: '127.0.0.1:' + lab.port, 'sec-fetch-site': 'cross-site' } })).s === 403, 'bootstrap cross-site -> 403');
const bs = await raw({ path: '/api/bootstrap', headers: { host: '127.0.0.1:' + lab.port, 'sec-fetch-site': 'same-origin' } }); ok(bs.s === 200 && JSON.parse(bs.d).token === token, 'bootstrap same-origin -> token');
ok(!('access-control-allow-origin' in bs.h), 'no CORS header is sent');
ok((await raw({ path: '/api/sessions', method: 'POST', headers: { host: '127.0.0.1:' + lab.port, 'x-lab-token': token, 'content-type': 'text/plain' } }, '{}')).s === 415, 'POST must be JSON');
ok((await raw({ path: '/event', method: 'POST', headers: { host: '127.0.0.1:' + lab.port, 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' } }, '{}')).s === 403, 'cross-site POST to the event bus refused');
ok((await raw({ path: '/.git/config', headers: { host: '127.0.0.1:' + lab.port } })).s === 403, 'dotfiles never served');
ok((await api('/api/sessions', { method: 'POST', body: JSON.stringify({ prompt: 'x', confirm: true }) })).s === 400, 'too-short prompt rejected');
ok((await api('/api/sessions', { method: 'POST', body: JSON.stringify({ prompt: 'do a thing' }) })).b.error.includes('confirm'), 'confirm required');
ok((await api('/api/sessions', { method: 'POST', body: JSON.stringify({ prompt: 'do a thing', policy: 'root', confirm: true }) })).s === 400, 'unknown policy rejected');

/* ---- a full successful run (stub) ---- */
const c = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ prompt: 'Create a simple Python script that analyzes a CSV file and summarizes the results.', policy: 'workspace', confirm: true }) });
ok(c.s === 201 && c.b.engine === 'test-stub', 'session created and labelled test-stub');
ok((await api('/api/sessions', { method: 'POST', body: JSON.stringify({ prompt: 'second task', confirm: true }) })).s === 409, 'second concurrent task -> 409');
const done = await waitDone(c.b.id);
ok(done.status === 'succeeded', 'succeeded: ' + done.status + ' ' + (done.error || ''));
const ev = (await api(`/api/sessions/${c.b.id}/events`)).b.events; const types = new Set(ev.map((e) => e.type));
for (const t of ['task_started', 'agent_spawned', 'agent_started', 'work_delegated', 'tool_called', 'tool_returned', 'agent_said', 'agent_blocked', 'agent_unblocked', 'agent_failed', 'agent_retry', 'message_sent', 'output_produced', 'agent_completed', 'task_finished']) ok(types.has(t), 'event type present: ' + t);
const sub = ev.find((e) => e.type === 'agent_spawned' && e.agentId === 'toolu_sub1'); ok(sub && sub.parentId === 'main' && sub.name === 'data-inspector', 'subagent comes from the Agent tool call, parent is main');
ok(ev.some((e) => e.type === 'tool_called' && e.agentId === 'toolu_sub1' && e.tool === 'Read'), 'subagent tool call attributed to the subagent (parent_tool_use_id)');
ok(ev.some((e) => e.type === 'agent_blocked' && e.agentId === 'toolu_sub1' && /WebFetch/.test(e.reason)), 'permission denial shown as blocked');
ok(ev.some((e) => e.type === 'message_sent' && e.fromId === 'toolu_sub1' && e.toId === 'main'), 'subagent report is a message to main');
ok(ev.findIndex((e) => e.type === 'task_finished') === ev.length - 1, 'task_finished is last');
ok(ev.filter((e) => e.type === 'task_finished').length === 1, 'exactly one task_finished');
const fin = ev.find((e) => e.type === 'task_finished'); ok(fin.status === 'succeeded' && fin.outputIds.includes('file:analyze_csv.py') && fin.outputIds.includes('file:summary.txt'), 'outputs include a Write-announced file and a file found on disk');
ok(done.denials.length === 1 && done.denials[0].rule === 'WebFetch', 'denials recorded with an approvable rule');
ok(done.stats.toolCalls === 8 && done.stats.subagents === 1 && done.stats.costUsd === 0.0123, 'stats recorded');
ok(fin.outputIds.every((o) => !o.includes('/')) , 'outputs are workspace-relative (no absolute paths)');
const files = (await api(`/api/sessions/${c.b.id}/files`)).b.files.map((f) => f.path); ok(files.includes('analyze_csv.py') && files.includes('sample.csv') && files.includes('summary.txt'), 'files listed');
const fr = await raw({ path: `/api/sessions/${c.b.id}/file?path=analyze_csv.py`, headers: { host: '127.0.0.1:' + lab.port, 'x-lab-token': token } }); ok(fr.s === 200 && /text\/plain/.test(fr.h['content-type']) && /import csv/.test(fr.d) && /sandbox/.test(fr.h['content-security-policy']), 'file served as sandboxed text/plain');
ok((await raw({ path: `/api/sessions/${c.b.id}/file?path=../../token`, headers: { host: '127.0.0.1:' + lab.port, 'x-lab-token': token } })).s === 404, 'path traversal -> 404');
ok((await raw({ path: `/api/sessions/${c.b.id}/file?path=/etc/hosts`, headers: { host: '127.0.0.1:' + lab.port, 'x-lab-token': token } })).s === 404, 'absolute path outside workspace -> 404');
ok(fs.existsSync(path.join(home, 'sessions', c.b.id, 'events.jsonl')) && fs.existsSync(path.join(home, 'sessions', c.b.id, 'raw.jsonl')), 'history persisted (events + raw)');
ok((await api('/api/sessions')).b.sessions[0].id === c.b.id, 'session appears in history');
// the SSE endpoint replays history for a finished session with the SAVED label (test stub keeps its own label)
const sse = await new Promise((res) => { const q = http.get({ hostname: '127.0.0.1', port: lab.port, path: `/s/${token}/${c.b.id}/events`, headers: { host: '127.0.0.1:' + lab.port } }, (r) => { let d = ''; r.on('data', (x) => { d += x; if (d.includes('task_finished')) { q.destroy(); res(d); } }); }); setTimeout(() => res(''), 3000); });
ok(/"source":"test-stub"/.test(sse) && /task_finished/.test(sse), 'SSE replays a finished session with an honest source label');
ok((await raw({ path: `/s/${'0'.repeat(64)}/${c.b.id}/events`, headers: { host: '127.0.0.1:' + lab.port } })).s === 403, 'SSE with wrong token -> 403');

/* ---- approve and retry: only rules that were really denied ---- */
ok((await api(`/api/sessions/${c.b.id}/retry`, { method: 'POST', body: JSON.stringify({ confirm: true, approve: ['Bash(rm:*)'] }) })).s === 400, 'cannot approve a rule that was not denied');
const r2 = await api(`/api/sessions/${c.b.id}/retry`, { method: 'POST', body: JSON.stringify({ confirm: true, approve: ['WebFetch'] }) }); ok(r2.s === 201 && r2.b.retryOf === c.b.id && r2.b.approved[0] === 'WebFetch', 'approve-and-retry creates a linked session');
await waitDone(r2.b.id);


/* ---- per-agent follow-ups: continue the SAME Claude conversation in the SAME workspace ---- */
const fu = (id, body) => api(`/api/sessions/${id}/followup`, { method: 'POST', body: JSON.stringify(body) });
ok((await fu(c.b.id, { kind: 'approve', rules: ['WebFetch'] })).b.error.includes('confirm'), 'follow-up needs confirm');
ok((await fu(c.b.id, { kind: 'approve', rules: ['Bash(rm:*)'], confirm: true })).s === 400, 'follow-up cannot approve a rule that was not denied');
ok((await fu(c.b.id, { kind: 'approve', rules: [], confirm: true })).s === 400, 'follow-up approve needs at least one rule');
ok((await fu(c.b.id, { kind: 'retry-agent', agentId: 'toolu_sub1', confirm: true })).s === 400, 'cannot retry an agent that did not fail');
ok((await fu(c.b.id, { kind: 'retry-agent', agentId: 'nope', confirm: true })).s === 404, 'unknown agent -> 404');
ok((await fu(c.b.id, { kind: 'rm-rf', confirm: true })).s === 400, 'unknown follow-up kind -> 400');
const ap = await fu(c.b.id, { kind: 'approve', rules: ['WebFetch'], confirm: true }); ok(ap.s === 201 && ap.b.resumeOf === c.b.id && ap.b.workspace === done.workspace && ap.b.followUp.kind === 'approve', 'approve follow-up reuses the workspace and links to its parent');
ok((await fu(c.b.id, { kind: 'approve', rules: ['WebFetch'], confirm: true })).s === 409, 'a second task while one runs -> 409');
const apd = await waitDone(ap.b.id); ok(apd.status === 'succeeded', 'approve follow-up finished');
const rargs = JSON.parse(fs.readFileSync(path.join(done.workspace, 'resume-args.txt'), 'utf8'));
ok(rargs.args.includes('--resume') && rargs.args[rargs.args.indexOf('--resume') + 1] === 'stub-session', 'CLI was started with --resume <the original conversation id>');
ok(rargs.args[rargs.args.indexOf('--allowedTools') + 1].split(',').includes('WebFetch'), 'the approved rule (and only it) was added to the allowlist');
ok(/WebFetch/.test(rargs.prompt) && /only the denied/i.test(rargs.prompt), 'the follow-up prompt names the approved action');
const apev = (await api(`/api/sessions/${ap.b.id}/events`)).b.events; const announced = apev.filter((e) => e.type === 'output_produced').map((e) => e.name);
ok(announced.includes('followup-note.txt') && !announced.includes('analyze_csv.py'), 'only files this follow-up created are announced as its outputs: ' + announced.join());
const fs1 = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ prompt: 'FAIL_SUB please', confirm: true }) }); const fsd = await waitDone(fs1.b.id);
const fev = (await api(`/api/sessions/${fs1.b.id}/events`)).b.events; ok(fev.some((e) => e.type === 'agent_failed' && e.agentId === 'toolu_subF'), 'subagent failure is shown on the subagent');
const rt = await fu(fs1.b.id, { kind: 'retry-agent', agentId: 'toolu_subF', confirm: true }); ok(rt.s === 201 && rt.b.followUp.agentName === 'flaky-worker', 'retry-agent starts a linked follow-up');
const rtd = await waitDone(rt.b.id); const ra2 = JSON.parse(fs.readFileSync(path.join(fsd.workspace, 'resume-args.txt'), 'utf8')); ok(rtd.status === 'succeeded' && /flaky-worker/.test(ra2.prompt) && /could not be completed/.test(ra2.prompt), 'retry prompt is built by the server from the recorded failure');
ok((await fu(fs1.b.id, { kind: 'retry-agent', agentId: 'toolu_subF', confirm: true })).s === 201, 'a failed agent of a finished session can be retried again');
await new Promise((r) => setTimeout(r, 1500));

/* ---- stop ---- */
const sl = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ prompt: 'SLOW task please', confirm: true }) }); await new Promise((r) => setTimeout(r, 600));
ok((await api(`/api/sessions/${sl.b.id}/stop`, { method: 'POST', body: '{}' })).s === 200, 'stop accepted'); const st = await waitDone(sl.b.id);
ok(st.status === 'stopped', 'stopped session status: ' + st.status); const sev = (await api(`/api/sessions/${sl.b.id}/events`)).b.events; ok(sev[sev.length - 1].type === 'task_finished' && sev[sev.length - 1].status === 'stopped', 'stop ends with task_finished stopped');
ok((await api(`/api/sessions/${sl.b.id}/stop`, { method: 'POST', body: '{}' })).s === 409, 'stopping a finished session -> 409');

/* ---- genuine failure: Claude Code reports an auth failure ---- */
const af = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ prompt: 'FAIL_AUTH please', confirm: true }) }); const afd = await waitDone(af.b.id);
ok(afd.status === 'failed' && /not signed in/i.test(afd.error), 'auth failure shown as failed with the exact fix: ' + afd.error);
const aev = (await api(`/api/sessions/${af.b.id}/events`)).b.events; ok(aev.some((e) => e.type === 'agent_failed' && e.agentId === 'main') && aev.at(-1).type === 'task_finished' && aev.at(-1).status === 'failed', 'failure is visible in the event stream, never reported as success');

/* ---- not signed in at probe time: the API refuses to start a run ---- */
process.env.STUB_LOGGED_OUT = '1'; const lo = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ prompt: 'anything', confirm: true }) }); delete process.env.STUB_LOGGED_OUT;
ok(lo.s === 503 && lo.b.code === 'not_signed_in', 'signed-out CLI -> 503 not_signed_in with instructions');
console.log(`server e2e OK: ${n} checks (TEST STUB; not a real Claude Code run)`); await lab.close(); fs.rmSync(home, { recursive: true, force: true }); process.exit(0);
