#!/usr/bin/env node
/* test-webview.mjs  GET /api/web (the Living Web drawing for the pane inside the Claude app), checked with the REAL recorded interactive session
 * (shared/fixtures/real-interactive-background-agents.jsonl) sent through the real hook intake of an isolated service. */
import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import vm from 'node:vm'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-webtest-')); process.env.AGENT_LAB_HOME = home; process.env.AGENT_LAB_OPEN_CMD = '["true"]';
const rows = fs.readFileSync(path.join(ROOT, 'shared/fixtures/real-interactive-background-agents.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const { SessionManager } = await import('./sessions.mjs'); const { startLab, loadToken } = await import('./lab-server.mjs');
const token = loadToken(home); const lab = await startLab({ port: 0, manager: new SessionManager({ home }), token, quiet: true }); const base = `http://127.0.0.1:${lab.port}`;
const H = { 'x-lab-token': token, 'content-type': 'application/json' }; let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const web = async (q = '') => (await fetch(base + '/api/web' + q, { headers: H })).json(); const sid = rows[0].session_id;

ok((await fetch(base + '/api/web')).status === 401, 'no token: refused');
let r = await web('?session=' + sid);
ok(r.ok && r.found === false && r.status === 'idle' && r.agents.length === 0 && /waiting for Claude Code/i.test(r.alt), 'before any task: an idle hub, no agents, nothing invented');
ok(/<svg[^>]*class="lw"/.test(r.svg) && !/<script|onload=|onclick=/i.test(r.svg), 'the drawing is one SVG with no script');

for (const p of rows.slice(0, 31)) await fetch(base + '/api/hook', { method: 'POST', headers: H, body: JSON.stringify(p) });
r = await web('?session=' + sid + '&w=680&h=600');
ok(r.found && r.status === 'running' && r.agents.length === 3, 'mid-task: the task of this session, three real agents: ' + r.agents.map((a) => a.name).join(', '));
ok(r.agents.filter((a) => a.main).length === 1 && r.agents.find((a) => a.main).text === 'Coordinating agents', 'Claude Code is the hub and is coordinating');
ok((r.svg.match(/class="lw-strand"/g) || []).length === 2 && (r.svg.match(/class="lw-n lw-ring/g) || []).length === 2 && (r.svg.match(/class="lw-n lw-hub/g) || []).length === 1, 'one hub, two subagent nodes, two strands');
ok(r.agents.every((a) => !/\/Users\//.test(a.text)), 'no long file paths in the activity text: ' + r.agents.map((a) => a.text).join(' | '));
ok(/animation:/.test(r.svg) && !/animation:/.test((await web('?session=' + sid + '&reduced=1')).svg), 'animated by default; reduced=1 removes every animation');
const rev1 = r.rev; ok((await web('?session=' + sid)).rev === rev1, 'rev is stable while nothing happens');
for (const p of rows.slice(31)) await fetch(base + '/api/hook', { method: 'POST', headers: H, body: JSON.stringify(p) });
r = await web('?session=' + sid);
ok(r.status === 'succeeded' && r.rev !== rev1 && r.agents.every((a) => a.state === 'done' && a.tone === 'mint'), 'finished: every agent resolved to done (mint)');
{ const subs = r.agents.filter((a) => !a.main);
  ok(subs.map((a) => a.name).sort().join(' | ') === 'Review server code structure | Review test-observer.mjs weak spots', 'each subagent is named by the job it was given: ' + subs.map((a) => a.name).join(' | '));
  ok(subs.every((a) => /^general-purpose/.test(a.type)) && r.agents.find((a) => a.main).name === 'Claude Code', 'the agent type is kept beside it (' + subs.map((a) => a.type).join(', ') + '); the hub is still Claude Code');
  ok(/>Review server<\/text>/.test(r.svg) && />code structure<\/text>/.test(r.svg) && !/>general-purpose/.test(r.svg), 'the node shows the job, not the generic type'); }
{ const { promptTitle } = await import('../shared/adapter-server.mjs');
  ok(promptTitle('<pasted_content id="7ed7">\nAgent Activity Lab is now functioning inside Claude.\nMore text\n</pasted_content id="7ed7">') === 'Agent Activity Lab is now functioning inside Claude.', 'a pasted prompt gets its first real line as the task title, not the wrapper tag');
  ok(promptTitle('**IMPORTANT: use this image**') === 'IMPORTANT: use this image' && promptTitle('fix where a < b and c > d') === 'fix where a < b and c > d', 'markdown marks are dropped; ordinary < and > are kept'); }
ok((await web('?session=someone-else')).found === false, 'another Claude Code session does not see this task');
ok((await web()).id === r.id, 'without a session id: the newest task');

/* many agents stay inside the limits of the pane (an SVG of at most 131072 characters) and inside the picture */
const sb = { console }; sb.window = sb; vm.createContext(sb); for (const f of ['core.js', 'livingweb.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'shared', f), 'utf8'), sb);
for (const count of [1, 4, 9, 30, 60]) {
  const S = sb.AgentCore.initialState({}); let t = 0; const ev = (e) => sb.AgentCore.applyEvent(S, { t: (t += 100), ...e });
  ev({ type: 'task_started', task: { id: 'x', title: 'Many agents' } }); ev({ type: 'agent_spawned', agentId: 'main', name: 'Claude Code' }); ev({ type: 'agent_started', agentId: 'main' });
  for (let i = 0; i < count; i++) { ev({ type: 'agent_spawned', agentId: 'a' + i, name: 'general-purpose ' + i, parentId: 'main' }); ev({ type: 'tool_called', agentId: 'a' + i, tool: 'Read', input: '/Users/USER/some/long/path/file' + i + '.mjs' }); }
  const out = sb.LivingWeb.render(S, { w: 680, h: 600, now: 5000 }), L = out.layout;
  ok(out.svg.length < 131072, count + ' subagents: SVG is ' + out.svg.length + ' characters');
  ok(Object.values(L.nodes).every((q) => q.x - q.r >= -1 && q.x + q.r <= 681 && q.y - q.r >= -1 && q.y + q.r <= 601), count + ' subagents: every node is inside the picture');
  const ids = Object.keys(L.nodes); let clash = 0; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const a = L.nodes[ids[i]], b = L.nodes[ids[j]]; if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r - 0.5) clash++; }
  ok(clash === 0, count + ' subagents: no two nodes overlap');
}
console.log('webview tests OK (' + n + ' checks)'); process.exit(0);
