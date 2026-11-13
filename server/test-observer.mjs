// Tests for AUTOMATIC observation of ordinary Claude Code sessions through hooks (no dashboard-run task involved).
// Input is the payload sequence of a REAL Claude Code 2.1.263 session with a subagent (shared/fixtures/real-hook-session-subagent.jsonl).
// Proves: hook intake + auth, session per prompt, subagent/tool/output mapping, live feed, history persistence, file confinement,
// stale/interrupted handling, restart recovery, window-open rules, the hook forwarder (slimming, impostor check, off switch, autostart).
// Does NOT prove: that an interactive session installed via settings.json behaves the same (checked separately by hand).
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import assert from 'node:assert/strict'; import http from 'node:http'; import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const root = path.resolve(here, '..');
const mk = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const home = mk('lab-obs-'); const ws = fs.realpathSync(mk('lab-obs-ws-')); const openLog = path.join(home, 'opened.log');
const stubOpen = path.join(home, 'open-stub.sh'); fs.writeFileSync(stubOpen, `#!/bin/sh\necho "$1" >> "${openLog}"\n`, { mode: 0o755 });
process.env.AGENT_LAB_HOME = home; process.env.AGENT_LAB_OPEN_SETTLE_MS = '0'; process.env.AGENT_LAB_OPEN_CMD = JSON.stringify([stubOpen, '{url}']);
fs.writeFileSync(path.join(ws, 'notes.txt'), 'First note line.\nSecond note line.\nThird note line.\n'); fs.writeFileSync(path.join(ws, 'result.txt'), '3\n'); fs.writeFileSync(path.join(ws, 'secret.txt'), 'NOT WRITTEN BY CLAUDE\n');
const fixture = fs.readFileSync(path.join(root, 'shared/fixtures/real-hook-session-subagent.jsonl'), 'utf8').replaceAll('/WORKSPACE', ws).trim().split('\n').map((l) => JSON.parse(l));
const { SessionManager } = await import('./sessions.mjs'); const { startLab, loadToken } = await import('./lab-server.mjs');
const manager = new SessionManager({ home }); const token = loadToken(home);
const lab = await startLab({ port: 0, manager, token, quiet: true }); const base = `http://127.0.0.1:${lab.port}`;
const H = { 'x-lab-token': token, 'content-type': 'application/json' };
const api = async (p, o = {}) => { const r = await fetch(base + p, { ...o, headers: { ...H, ...(o.headers || {}) } }); let b = null; try { b = await r.json(); } catch {} return { s: r.status, b }; };
const hook = (p) => api('/api/hook', { method: 'POST', body: JSON.stringify(p) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; if (process.env.VERBOSE) console.log('  ok', m); };
const openCount = () => { try { return fs.readFileSync(openLog, 'utf8').trim().split('\n').filter(Boolean).length; } catch { return 0; } };

/* ---- intake security ---- */
ok((await fetch(base + '/api/hook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status === 401, 'hook without token -> 401');
ok((await fetch(base + '/api/hook', { method: 'POST', headers: { 'x-lab-token': token, 'content-type': 'text/plain' }, body: '{}' })).status === 415, 'hook must be JSON');
ok((await hook({ hello: 1 })).s === 400, 'non-hook payload -> 400');
ok((await hook({ hook_event_name: 'PreToolUse', session_id: 'x' })).s === 400, 'bad session id -> 400');
const hl = await (await fetch(base + '/api/hello')).json(); ok(hl.lab === 'agent-activity-lab' && /^[0-9a-f]{64}$/.test(hl.proof) && hl.proof !== token, 'hello gives a proof, never the token');
ok(await new Promise((res) => http.get({ hostname: '127.0.0.1', port: lab.port, path: '/api/hello', headers: { host: 'evil.example' } }, (q) => { q.resume(); res(q.statusCode === 421); })), 'hello honours the Host allowlist');

/* ---- live feed: a dashboard window is "connected" ---- */
const feed = []; const feedReq = http.get(base + `/s/${token}/feed?v=viewer1&vis=1&foc=1`, (res) => { res.setEncoding('utf8'); let buf = ''; res.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const f = buf.slice(0, i); buf = buf.slice(i + 2); if (f.startsWith('data: ')) feed.push(JSON.parse(f.slice(6))); } }); });
await sleep(150); ok(feed[0] && feed[0].type === 'sessions', 'feed opens with a snapshot'); ok(lab.feedClients.size === 1, 'viewer counted');

/* ---- an ordinary Claude Code session, observed ---- */
const sessionEvents = []; let sid = null; let sseReq = null;
for (const p of fixture) {
  const r = await hook(p); ok(r.s === 200, 'hook accepted: ' + p.hook_event_name);
  if (p.hook_event_name === 'UserPromptSubmit') {
    sid = r.b.id; ok(!!sid, 'a task exists after the first prompt');
    const m = (await api('/api/sessions/' + sid)).b; ok(m.origin === 'observed' && m.status === 'running' && m.engine === 'claude-code' && m.title.startsWith('Create notes.txt'), 'observed task is running with the prompt as title');
    // per-session live stream while running
    sseReq = http.get(base + `/s/${token}/${sid}/events`, (res) => { res.setEncoding('utf8'); let buf = ''; res.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const f = buf.slice(0, i); buf = buf.slice(i + 2); if (f.startsWith('data: ')) sessionEvents.push(JSON.parse(f.slice(6))); } }); }); await sleep(100);
    ok(sessionEvents[0] && sessionEvents[0].source === 'claude-code-observed' && /does not control/.test(sessionEvents[0].sourceNote), 'live stream is labelled observed, not run by the dashboard');
  }
}
await sleep(150);
const m = (await api('/api/sessions/' + sid)).b;
ok(m.status === 'succeeded' && m.stats.toolCalls === 6 && m.stats.subagents === 1, `finished: ${m.status} ${JSON.stringify(m.stats)}`);
ok(/^Done\. Created/.test(m.resultText), 'final answer is Claude\'s own last message (Stop hook)');
ok(m.stats.durationMs >= 0 && m.endedAt >= m.startedAt, 'timing recorded');
const evs = (await api(`/api/sessions/${sid}/events`)).b.events;
const spawned = evs.filter((e) => e.type === 'agent_spawned'); ok(spawned.length === 2 && spawned[1].parentId === 'main' && spawned[1].name === 'general-purpose', 'main + exactly one real subagent branching from main');
ok(evs.filter((e) => e.type === 'tool_called' && e.agentId === spawned[1].agentId).length === 2, 'subagent tool calls attributed to the subagent');
ok(evs.at(-1).type === 'task_finished' && evs.at(-1).status === 'succeeded', 'ends with task_finished');
ok(sessionEvents.filter((e) => e.type === 'task_finished').length === 1 && sessionEvents.some((e) => e.type === '__end'), 'the live stream carried every event and the end marker');
ok(sessionEvents.filter((e) => e.type === 'tool_called').length === 6, 'live stream has all 6 tool calls');
const fm = feed.filter((f) => f.type === 'session' && f.meta.id === sid); ok(fm.length >= 2 && fm[0].meta.status === 'running' && fm.at(-1).meta.status === 'succeeded', 'feed announced the task start and its finish');
// persisted to history like any other session
const listed = (await api('/api/sessions')).b.sessions; ok(listed.some((x) => x.id === sid && x.origin === 'observed'), 'observed task is in History');
ok(fs.existsSync(path.join(home, 'sessions', sid, 'events.jsonl')) && fs.existsSync(path.join(home, 'sessions', sid, 'meta.json')), 'saved on disk');
ok(!fs.existsSync(path.join(home, 'sessions', sid, 'raw.jsonl')), 'raw hook payloads (prompts, file contents) are not stored');
const saved = await new Promise((res) => { const out = []; const q = http.get(base + `/s/${token}/${sid}/events`, (r) => { r.setEncoding('utf8'); let b = ''; r.on('data', (d) => { b += d; }); setTimeout(() => { q.destroy(); res(b); }, 250); }); }); ok(/claude-code-observed-saved/.test(saved), 'finished task replays as SAVED · observed');

/* ---- files: only what Claude wrote, only by recorded name ---- */
const files = (await api(`/api/sessions/${sid}/files`)).b.files.map((f) => f.path).sort(); ok(JSON.stringify(files) === JSON.stringify(['notes.txt', 'result.txt']), 'files = the two Write outputs: ' + files);
const rf = await fetch(base + `/api/sessions/${sid}/file?path=notes.txt`, { headers: { 'x-lab-token': token } }); ok(rf.status === 200 && /Second note line/.test(await rf.text()) && rf.headers.get('content-type').startsWith('text/plain'), 'recorded file readable as text/plain');
ok((await fetch(base + `/api/sessions/${sid}/file?path=secret.txt`, { headers: { 'x-lab-token': token } })).status === 404, 'a file in the folder that Claude did NOT write is not served');
ok((await fetch(base + `/api/sessions/${sid}/file?path=${encodeURIComponent('../../etc/passwd')}`, { headers: { 'x-lab-token': token } })).status === 404, 'path traversal refused');

/* ---- the dashboard does not pretend to control observed sessions ---- */
for (const act of ['stop', 'retry', 'followup']) { const r = await api(`/api/sessions/${sid}/${act}`, { method: 'POST', body: JSON.stringify({ confirm: true, kind: 'approve', rules: ['Bash(x:*)'] }) }); ok(r.s === 409 && /observed/.test(r.b.error), act + ' on an observed task -> 409'); }

/* ---- a second prompt in the same Claude Code session is a new task; interrupted tasks are never "succeeded" ---- */
const S2 = 'aaaaaaaa-1111-2222-3333-444444444444';
const r1 = await hook({ hook_event_name: 'UserPromptSubmit', session_id: S2, cwd: ws, prompt_id: 'p1', prompt: 'first prompt' });
await hook({ hook_event_name: 'PreToolUse', session_id: S2, cwd: ws, prompt_id: 'p1', tool_name: 'Read', tool_input: { file_path: 'a' }, tool_use_id: 'tA' });
const r2 = await hook({ hook_event_name: 'UserPromptSubmit', session_id: S2, cwd: ws, prompt_id: 'p2', prompt: 'second prompt' });
ok(r1.b.id !== r2.b.id, 'new prompt = new task');
const first = (await api('/api/sessions/' + r1.b.id)).b; ok(first.status === 'ended' && /new prompt/.test(first.error), 'unfinished earlier task closed as ended with the reason: ' + first.status);
const fev = (await api(`/api/sessions/${r1.b.id}/events`)).b.events; ok(fev.at(-1).type === 'task_finished' && fev.at(-1).status === 'ended', 'its last event says ended, not succeeded');
ok((await api('/api/sessions/' + r2.b.id)).b.status === 'running', 'new task running');
// stale: silence closes it
const obs = manager.observer; const realNow = obs.now; obs.now = () => Date.now() + 3 * 3600e3; obs.sweep(); obs.now = realNow;
const stale = (await api('/api/sessions/' + r2.b.id)).b; ok(stale.status === 'ended' && /No hook events/.test(stale.error), 'silent task is closed by the sweep');
// joined mid-task, and ends of things never seen
const S3 = 'bbbbbbbb-1111-2222-3333-444444444444';
ok((await hook({ hook_event_name: 'Stop', session_id: S3, cwd: ws })).b.id === null, 'Stop for an unseen task creates nothing');
const j3 = await hook({ hook_event_name: 'PreToolUse', session_id: S3, cwd: ws, prompt_id: 'q', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'tB' });
const jm = (await api('/api/sessions/' + j3.b.id)).b; ok(/joined mid-task/.test(jm.title) && jm.status === 'running', 'activity from a turn that began earlier is picked up and labelled as joined');
// dashboard-run workspaces are ignored (already recorded by the runner)
const own = path.join(manager.cfg.workspaceRoot, 'some-id'); fs.mkdirSync(own, { recursive: true });
const ig = await hook({ hook_event_name: 'UserPromptSubmit', session_id: 'cccccccc-1111-2222-3333-444444444444', cwd: own, prompt: 'x' }); ok(ig.b.ignored, 'tasks run by the dashboard are not double-recorded');

/* ---- REAL session with a BACKGROUND subagent: Stop #1 arrives while it still runs (background_tasks non-empty), subagent events keep coming, then a synthetic <task-notification> prompt starts the final turn ---- */
fs.writeFileSync(path.join(ws, 'analyze.py'), 'print(1)\n'); fs.writeFileSync(path.join(ws, 'sample.csv'), 'a,b\n');
const bg = fs.readFileSync(path.join(root, 'shared/fixtures/real-hook-session-background-subagent.jsonl'), 'utf8').replaceAll('/WORKSPACE', ws).trim().split('\n').map((l) => JSON.parse(l));
let bgId = null, stopSeen = 0, afterStop1 = null;
for (const p of bg) { const r = await hook(p); if (p.hook_event_name === 'UserPromptSubmit' && !bgId) bgId = r.b.id; if (p.hook_event_name === 'Stop' && ++stopSeen === 1) afterStop1 = (await api('/api/sessions/' + bgId)).b; }
ok(afterStop1.status === 'running' && afterStop1.stats.subagents === 1, 'Stop with a running background subagent does NOT finish the task (background_tasks is non-empty): ' + afterStop1.status);
const bgs = (await api('/api/sessions')).b.sessions.filter((x) => x.claudeSessionId === bg[0].session_id); ok(bgs.length === 1, 'the <task-notification> prompt did not create a second task: ' + bgs.length);
const bgm = (await api('/api/sessions/' + bgId)).b; ok(bgm.status === 'succeeded' && bgm.stats.toolCalls === 5 && bgm.stats.subagents === 1 && /^Output of/.test(bgm.resultText), `background run finished once, with every tool call: ${bgm.status} ${JSON.stringify(bgm.stats)}`);
const bge = (await api(`/api/sessions/${bgId}/events`)).b.events; const bsub = bge.find((e) => e.type === 'agent_spawned' && e.agentId !== 'main');
ok(bge.filter((e) => e.type === 'tool_called' && e.agentId === bsub.agentId).length === 2 && bge.some((e) => e.type === 'agent_said' && /background task/.test(e.text)), 'subagent tool calls that arrived AFTER the first Stop are attributed to it; the pause is stated honestly');
ok(bge.filter((e) => e.type === 'task_finished').length === 1, 'exactly one task_finished');
/* REAL genuine INTERACTIVE Claude Code session (TUI in a pty, user-level hooks, started from the home directory), two background subagents.
   It exposed two things headless runs never showed: background agents report back as <agent-message from="..."> prompts, and an internal
   helper fires SubagentStop with no SubagentStart and an empty agent_type. */
const ia = fs.readFileSync(path.join(root, 'shared/fixtures/real-interactive-background-agents.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
let iaId = null, iaStops = 0, iaMid = []; for (const p of ia) { const r = await hook(p); if (p.hook_event_name === 'UserPromptSubmit' && !iaId) iaId = r.b.id; if (p.hook_event_name === 'Stop') { iaStops++; iaMid.push((await api('/api/sessions/' + iaId)).b.status); } }
ok(iaStops === 3 && iaMid[0] === 'running' && iaMid[1] === 'running' && iaMid[2] === 'succeeded', 'interactive: the first two Stops (background agents still running) do not finish the task; the third does: ' + iaMid.join(','));
const iaAll = (await api('/api/sessions')).b.sessions.filter((x) => x.claudeSessionId === ia[0].session_id); ok(iaAll.length === 1, 'interactive: the two <agent-message> hand-back prompts did not create extra tasks: ' + iaAll.length);
const iam = (await api('/api/sessions/' + iaId)).b; ok(iam.status === 'succeeded' && iam.stats.subagents === 2 && !/agent-message/.test(iam.title) && /^Do a thorough read-only review/.test(iam.title), 'interactive: one succeeded task, exactly 2 subagents, title is the real prompt: ' + JSON.stringify(iam.stats) + ' ' + iam.title.slice(0, 40));
const iae = (await api(`/api/sessions/${iaId}/events`)).b.events; const iasp = iae.filter((e) => e.type === 'agent_spawned' && e.agentId !== 'main');
ok(iasp.length === 2 && iasp.every((e) => /general-purpose/.test(e.name) && !/not observed/.test(e.name)) && iasp.map((e) => e.agentId).sort().join() === 'a1bb7939b6eacc2c1,adc30b177b11f4779', 'interactive: no phantom agents from the internal helper SubagentStops');
ok(iae.filter((e) => e.type === 'task_finished').length === 1 && !iae.some((e) => e.type === 'task_resumed' && false) && iae.filter((e) => e.type === 'agent_completed' && e.agentId !== 'main').length === 2, 'interactive: one task_finished, both subagents completed once');
ok(iae.filter((e) => e.type === 'message_sent').length === 2 && iae.filter((e) => e.type === 'tool_called' && e.agentId === 'a1bb7939b6eacc2c1').length > 5, 'interactive: each subagent report is shown and its own tool calls are attributed to it');
// SYNTHETIC fallbacks (not from a real session): a finished task whose subagent keeps reporting, and a notification that arrives after Stop
const S4 = '44444444-1111-2222-3333-444444444444'; const base4 = { session_id: S4, cwd: ws, prompt_id: 'x1' };
const t4 = await hook({ ...base4, hook_event_name: 'UserPromptSubmit', prompt: 'synthetic bg' }); await hook({ ...base4, hook_event_name: 'SubagentStart', agent_id: 'sa1', agent_type: 'Explore' }); await hook({ ...base4, hook_event_name: 'Stop', background_tasks: [], last_assistant_message: 'early' });
ok((await api('/api/sessions/' + t4.b.id)).b.status === 'succeeded', 'synthetic: Stop without background_tasks finishes');
const before4 = (await api(`/api/sessions/${t4.b.id}/events`)).b.events.length; const late = await hook({ ...base4, hook_event_name: 'PreToolUse', agent_id: 'sa1', agent_type: 'Explore', tool_name: 'Grep', tool_input: { pattern: 'x' }, tool_use_id: 'late1' });
ok(late.b.late && (await api(`/api/sessions/${t4.b.id}/events`)).b.events.length > before4 && (await api('/api/sessions/' + t4.b.id)).b.status === 'succeeded', 'synthetic: late subagent events are appended without reopening or inventing a new task');
await hook({ ...base4, hook_event_name: 'UserPromptSubmit', prompt_id: 'x2', prompt: '<task-notification>\n<task-id>sa1</task-id>' });
const res4 = (await api('/api/sessions/' + t4.b.id)).b; ok(res4.status === 'running' && (await api('/api/sessions')).b.sessions.filter((x) => x.claudeSessionId === S4).length === 1, 'synthetic: a notification after Stop resumes the same task (not a new one)');
ok((await api(`/api/sessions/${t4.b.id}/events`)).b.events.some((e) => e.type === 'task_resumed'), 'a task_resumed event records it');
await hook({ ...base4, prompt_id: 'x2', hook_event_name: 'Stop', background_tasks: [], last_assistant_message: 'final' }); const fin4 = (await api('/api/sessions/' + t4.b.id)).b; ok(fin4.status === 'succeeded' && fin4.resultText === 'final', 'synthetic: finishes again with the final answer');

/* ---- restart: tasks that were running have no observer any more ---- */
const m2 = new SessionManager({ home }); const rj = m2.meta(j3.b.id); ok(rj.status === 'ended' && /restarted/.test(rj.error), 'after a restart, an unfinished observed task is closed honestly');

/* ---- window rules ---- */
ok(openCount() === 0, 'no window was opened while a dashboard page had focus (the person was looking at it)');
const st1 = (await api('/api/status')).b; ok(st1.viewers === 1 && st1.visibleViewers === 1 && st1.pages[0].id === 'viewer1' && st1.pages[0].focused === true && /^[0-9a-f]{12}$/.test(st1.build), 'status lists the connected page (id, visible, focused) and the code version');
// the page reports that it lost focus and can no longer be seen (minimised / covered / other desktop)
const vr = await api('/api/viewer', { method: 'POST', body: JSON.stringify({ id: 'viewer1', visible: false, focused: false }) }); const st2 = (await api('/api/status')).b; ok(vr.b.known === true && st2.viewers === 1 && st2.visibleViewers === 0, 'the page reported hidden: 1 connected, 0 visible');
ok((await api('/api/viewer', { method: 'POST', body: JSON.stringify({ id: 'nobody', visible: true }) })).b.known === false, 'a page the service does not know is told so (it then reconnects)');
await hook({ hook_event_name: 'SessionStart', session_id: 'eeeeeeee-1111-2222-3333-444444444444', cwd: ws, source: 'startup' }); await sleep(300);
ok(openCount() === 0, 'starting Claude Code alone opens nothing (a window must not appear while the person is typing)');
await hook({ hook_event_name: 'UserPromptSubmit', session_id: 'eeeeeeee-1111-2222-3333-444444444444', cwd: ws, prompt_id: 'h1', prompt: 'first task of a new Claude Code session' }); for (let i = 0; i < 20 && !openCount(); i++) await sleep(100);
ok(openCount() === 1, 'the first task of a Claude Code session brings the dashboard up, even though an older page was connected (stub): ' + openCount());
const feedBefore = feed.length; const f2 = http.get(base + `/s/${token}/feed?v=viewer2&vis=1&foc=1`, () => {}); await sleep(200);
ok(feed.slice(feedBefore).some((f) => f.type === 'close'), 'the older page is told to close once the new window connects');
const oldPage = http.get(base + `/s/${token}/feed`, () => {}); await sleep(150); const st3 = (await api('/api/status')).b; ok(st3.viewers === 3 && st3.visibleViewers === 1, 'a page that reports no visibility (left open from an older version) is not counted as visible: ' + JSON.stringify([st3.viewers, st3.visibleViewers]));
await hook({ hook_event_name: 'Stop', session_id: 'eeeeeeee-1111-2222-3333-444444444444', cwd: ws, prompt_id: 'h1', last_assistant_message: 'ok' });
await api('/api/viewer', { method: 'POST', body: JSON.stringify({ id: 'viewer2', visible: true, focused: false }) });
await hook({ hook_event_name: 'UserPromptSubmit', session_id: 'eeeeeeee-1111-2222-3333-444444444444', cwd: ws, prompt_id: 'h2', prompt: 'second task, same session' }); await sleep(300);
ok(openCount() === 1, 'a later task of the same session does not open another window while a page is connected');
await hook({ hook_event_name: 'Stop', session_id: 'eeeeeeee-1111-2222-3333-444444444444', cwd: ws, prompt_id: 'h2', last_assistant_message: 'ok' });
f2.destroy(); oldPage.destroy(); feedReq.destroy(); await sleep(200); ok(lab.feedClients.size === 0, 'all pages gone');
await hook({ hook_event_name: 'UserPromptSubmit', session_id: 'eeeeeeee-1111-2222-3333-444444444444', cwd: ws, prompt_id: 'h3', prompt: 'third task, window was closed' }); await sleep(300);
ok(openCount() === 1, 'debounced: no second window within 30 s of the last one');
lab.companion.reset(); fs.writeFileSync(openLog, '');
await hook({ hook_event_name: 'Stop', session_id: 'eeeeeeee-1111-2222-3333-444444444444', cwd: ws, prompt_id: 'h3', last_assistant_message: 'ok' });
await hook({ hook_event_name: 'UserPromptSubmit', session_id: 'dddddddd-1111-2222-3333-444444444444', cwd: ws, prompt_id: 'd1', prompt: 'no dashboard open' }); for (let i = 0; i < 20 && !openCount(); i++) await sleep(100);
ok(openCount() === 1, 'a task with no dashboard open opens the window (stub): ' + openCount());
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ openWindow: false })); lab.companion.reset(); lab.companion.activity('x', 'k1'); ok(openCount() === 1, 'openWindow:false is honoured');
fs.unlinkSync(path.join(home, 'config.json'));
fs.writeFileSync(path.join(home, 'disabled'), 'x'); ok(lab.companion.activity('x', 'k2') === false, 'the disabled file stops window opening'); fs.unlinkSync(path.join(home, 'disabled'));

/* ---- the hook forwarder ---- */
// NOTE: async spawn on purpose: the service under test runs in THIS process, so a blocking spawnSync would starve it
const runFwd = (args, payload, env = process.env) => new Promise((res) => { const c = spawn(process.execPath, [path.join(root, 'tools/hook-forward.mjs'), ...args], { env }); let so = '', se = ''; c.stdout.on('data', (d) => (so += d)); c.stderr.on('data', (d) => (se += d)); c.on('close', (status) => res({ status, stdout: so, stderr: se })); c.stdin.end(JSON.stringify(payload)); });
const fwd = (payload, env = {}, extra = []) => runFwd(['--url', base, ...extra], payload, { ...process.env, ...env });
const SF = 'eeeeeeee-1111-2222-3333-444444444444'; const big = 'x'.repeat(5000);
let r = await fwd({ hook_event_name: 'UserPromptSubmit', session_id: SF, cwd: ws, prompt: 'via forwarder' }); ok(r.status === 0 && r.stdout === '' && r.stderr === '', 'forwarder exits 0 and prints nothing');
await sleep(150); const viaF = (await api('/api/sessions')).b.sessions.find((x) => x.claudeSessionId === SF); ok(viaF && viaF.title === 'via forwarder', 'forwarder delivered the payload (token read from file, proof checked)');
await fwd({ hook_event_name: 'PostToolUse', session_id: SF, cwd: ws, tool_name: 'Write', tool_use_id: 't1', tool_input: { file_path: path.join(ws, 'notes.txt'), content: big }, tool_response: { type: 'create', content: big, filePath: 'x' } });
await fwd({ hook_event_name: 'PreToolUse', session_id: SF, cwd: ws, tool_name: 'Write', tool_use_id: 't1', tool_input: { file_path: path.join(ws, 'notes.txt'), content: big } }); await sleep(150);
ok(JSON.stringify((await api(`/api/sessions/${viaF.id}/events`)).b.events).length < 4000, 'file contents never reach the service (slimmed by the forwarder)');
// impostor: something else on the port must never receive the token or the payload
const seen = []; const imp = http.createServer((q, s) => { seen.push({ url: q.url, token: q.headers['x-lab-token'] }); s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ lab: 'agent-activity-lab', proof: 'f'.repeat(64) })); }); await new Promise((res) => imp.listen(0, '127.0.0.1', res));
await runFwd(['--url', 'http://127.0.0.1:' + imp.address().port, '--no-autostart'], { hook_event_name: 'UserPromptSubmit', session_id: SF, prompt: 'secret prompt' });
ok(seen.length === 1 && seen[0].url === '/api/hello' && !seen[0].token, 'an impostor on the port only ever saw an unauthenticated hello; no token, no prompt'); imp.close();
// off switch
fs.writeFileSync(path.join(home, 'disabled'), 'x'); const before = (await api('/api/sessions')).b.sessions.length;
await fwd({ hook_event_name: 'UserPromptSubmit', session_id: 'ffffffff-1111-2222-3333-444444444444', cwd: ws, prompt: 'should not arrive' }); await sleep(150); fs.unlinkSync(path.join(home, 'disabled'));
ok((await api('/api/sessions')).b.sessions.length === before, 'with the disabled file the forwarder delivers nothing');
// service down + autostart off -> silent no-op, still exit 0
r = await runFwd(['--url', 'http://127.0.0.1:1', '--no-autostart'], { hook_event_name: 'UserPromptSubmit', session_id: SF, prompt: 'x' }); ok(r.status === 0 && r.stdout === '', 'service down: forwarder is a silent no-op');
await lab.close();

/* ---- AUTOSTART: nothing running; a SessionStart hook brings the service up by itself, then prompts are observed ---- */
const free = await new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const home2 = mk('lab-auto-'); fs.writeFileSync(path.join(home2, 'config.json'), JSON.stringify({ port: free })); const openLog2 = path.join(home2, 'opened.log');
const stub2 = path.join(home2, 'open.sh'); fs.writeFileSync(stub2, `#!/bin/sh\necho "$1" >> "${openLog2}"\n`, { mode: 0o755 });
const env2 = { ...process.env, AGENT_LAB_HOME: home2, AGENT_LAB_OPEN_CMD: JSON.stringify([stub2, '{url}']), CLAUDECODE: '1', CLAUDE_CODE_SSE_PORT: '123' };
const t0 = Date.now(); r = spawnSync(process.execPath, [path.join(root, 'tools/hook-forward.mjs')], { input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'a1a1a1a1-1111-2222-3333-444444444444', cwd: ws, source: 'startup' }), env: env2, encoding: 'utf8', timeout: 8000 });
ok(r.status === 0 && r.stdout === '' && Date.now() - t0 < 1500, 'SessionStart hook returns quickly even when it had to start the service (' + (Date.now() - t0) + ' ms)');
let up = false; for (let i = 0; i < 40 && !up; i++) { await sleep(150); try { up = (await fetch(`http://127.0.0.1:${free}/api/hello`)).ok; } catch {} }
ok(up, 'service was started in the background by the hook'); await sleep(300);
ok(!fs.existsSync(openLog2), 'the auto-started service opens no window until a task is submitted');
const tok2 = fs.readFileSync(path.join(home2, 'token'), 'utf8').trim(); ok(fs.statSync(path.join(home2, 'token')).mode & 0o077 ? false : true, 'token file is owner-only');
r = spawnSync(process.execPath, [path.join(root, 'tools/hook-forward.mjs')], { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'a1a1a1a1-1111-2222-3333-444444444444', cwd: ws, prompt: 'task after autostart' }), env: env2, encoding: 'utf8', timeout: 8000 });
const l2 = await (await fetch(`http://127.0.0.1:${free}/api/sessions`, { headers: { 'x-lab-token': tok2 } })).json(); ok(l2.sessions.length === 1 && l2.sessions[0].title === 'task after autostart', 'the first prompt after autostart is observed');
for (let i = 0; i < 60 && !fs.existsSync(openLog2); i++) await sleep(100);
ok(fs.existsSync(openLog2) && fs.readFileSync(openLog2, 'utf8').includes(`http://127.0.0.1:${free}/app/index.html`), 'that first task opened the dashboard window (stub opener; after the 4 s start-up grace)');
ok(!/CLAUDECODE|CLAUDE_CODE_SSE/.test(fs.readFileSync(path.join(home2, 'server.pid'), 'utf8')), 'pid file holds only a pid');
const stop = spawnSync(process.execPath, [path.join(root, 'tools/lab.mjs'), 'stop'], { env: env2, encoding: 'utf8' }); ok(/Stopped/.test(stop.stdout), 'lab stop: ' + stop.stdout.trim());
await sleep(300); let still = true; try { await fetch(`http://127.0.0.1:${free}/api/hello`); } catch { still = false; } ok(!still, 'service is down after stop');
/* ---- companion rules with a fake clock ---- */
{ const { createCompanion } = await import('./companion.mjs'); let t = 1000, pagesN = 0; const spawned = []; const fake = (c, a) => { spawned.push([c, ...a]); return { on() {}, unref() {} }; };
  const co = createCompanion({ url: 'http://x/app', getConfig: () => ({ openWindow: true }), viewerCount: () => pagesN, totalCount: () => pagesN, now: () => t, settleMs: 4000, spawnFn: fake });
  ok(co.activity('a') === false && spawned.length === 0, 'right after a (re)start no window is opened yet'); t += 3000; pagesN = 1; await sleep(4200); // the timer fires, but the old window has reconnected
  ok(spawned.length === 0, 'the existing window reconnected during the grace period: nothing opened');
  pagesN = 0; t += 10000; ok(co.activity('b') === true && spawned.length === 1, 'with no window connected after the grace period, one is opened'); t += 5000; ok(co.activity('c') === false, 'and not again within 30 s'); }
{ const { createCompanion } = await import('./companion.mjs'); let t = 1000, visible = 0, total = 0, focused = 0; const spawned = []; const fake = (c, a) => { spawned.push([c, ...a]); return { on() {}, unref() {} }; };
  const co = createCompanion({ url: 'http://x/app', getConfig: () => ({ openWindow: true }), viewerCount: () => visible, totalCount: () => total, focusedCount: () => focused, now: () => t, settleMs: 0, spawnFn: fake });
  visible = 1; total = 1; ok(co.activity('task', 'sess-A') === true && spawned.length === 1, 'first task of a session: the dashboard is brought up even if a page is visible somewhere (it may be behind other windows)');
  t += 60000; ok(co.activity('task', 'sess-A') === false, 'later tasks of that session leave a connected page alone');
  t += 60000; visible = 0; ok(co.activity('task', 'sess-A') === false, 'also when the person has hidden or minimised it');
  t += 60000; total = 0; ok(co.activity('task', 'sess-A') === true && spawned.length === 2, 'but if no page is connected at all (closed) it reopens');
  t += 60000; visible = 1; total = 1; focused = 1; ok(co.activity('task', 'sess-B') === false && spawned.length === 2, 'a new session does not open a window while a dashboard page has focus');
  t += 60000; focused = 0; ok(co.activity('task', 'sess-B') === false, 'and that counted as this session having its dashboard');
  t += 60000; ok(co.activity('task', 'sess-C') === true && spawned.length === 3, 'the next new session brings it up again');
  t += 5000; ok(co.activity('task', 'sess-D') === false, 'never more than one window per 30 s'); t += 60000; ok(co.activity('task', 'sess-D') === true, 'a session that was held back by that limit still gets its window at its next task'); }
console.log(`observer tests OK (${n} checks)`);
process.exit(0);
