// Regression test: a REAL Claude Code 2.1.263 session (prompt -> Write -> Bash -> Agent tool -> subagent Read/Bash -> Write -> Stop),
// captured through hooks and redacted. Asserts the mapper draws exactly what happened: ONE subagent (not one per Agent tool call
// plus one per SubagentStart), tool calls attributed to the right agent, real durations, outputs, report and final summary.
import fs from 'node:fs'; import assert from 'node:assert/strict'; import { createHookMapper } from './adapter-server.mjs';
const rows = fs.readFileSync(new URL('./fixtures/real-hook-session-subagent.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const map = createHookMapper(); const ev = []; for (const r of rows) ev.push(...map(r));
const T = (t) => ev.filter((e) => e.type === t);
const spawned = T('agent_spawned'); assert.deepEqual(spawned.map((e) => e.agentId), ['main', 'a441192f789e61d55'], 'exactly main + the one real subagent');
const sub = spawned[1]; assert.equal(sub.parentId, 'main'); assert.equal(sub.name, 'general-purpose'); assert.match(sub.role, /Count lines in notes\.txt/, 'role comes from the Agent call description');
assert.equal(T('work_delegated').length, 1);
const calls = T('tool_called'); assert.equal(calls.length, 6, '4 on main + 2 in the subagent');
const bySub = calls.filter((c) => c.agentId === sub.agentId).map((c) => c.tool); assert.deepEqual(bySub, ['Read', 'Bash'], 'subagent tool calls attributed to the subagent');
const main = calls.filter((c) => c.agentId === 'main').map((c) => c.tool); assert.deepEqual(main, ['Write', 'Bash', 'Agent', 'Write']);
const rets = T('tool_returned'); assert.equal(rets.length, calls.length, 'every call has a measured return'); assert.ok(rets.some((r) => r.durationMs === 13368), 'uses the duration_ms Claude Code reports');
assert.deepEqual(T('output_produced').map((o) => o.name), ['notes.txt', 'result.txt'], 'workspace-relative output names'); 
const msg = T('message_sent'); assert.equal(msg.length, 1); assert.equal(msg[0].fromId, sub.agentId); assert.equal(msg[0].toId, 'main'); assert.match(msg[0].text, /Report: 3/);
assert.equal(T('agent_completed').filter((e) => e.agentId === sub.agentId).length, 1, 'subagent completed once');
const fin = T('task_finished'); assert.equal(fin.length, 1); assert.equal(fin[0].status, 'succeeded'); assert.match(fin[0].summary, /^Done\. Created/); assert.equal(fin[0].outputIds.length, 2);
assert.equal(T('task_started')[0].task.title.startsWith('Create notes.txt'), true);
assert.equal(ev.filter((e) => e.type === 'task_finished' || e.type === 'task_started').length, 2);
assert.equal(ev.at(-1).type, 'task_finished', 'SessionEnd after Stop adds nothing');
console.log('real hook session OK:', ev.length, 'events from', rows.length, 'real payloads');
