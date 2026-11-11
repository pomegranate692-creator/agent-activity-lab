// Regression test on a REAL Claude Code 2.1.263 stream-json run (the first successful run of the milestone task, redacted).
// Proves the mapper against the real init/assistant/user/result objects, including real-only objects (thinking_tokens,
// rate_limit_event, task_summary), relative "./file" tool paths, and the real result fields.
import fs from 'node:fs'; import assert from 'node:assert/strict'; import { createStreamMapper } from './stream-mapper.mjs';
const rows = fs.readFileSync(new URL('./fixtures/real-claude-run.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
let t = 0; const m = createStreamMapper({ now: () => (t += 100), workspace: '/private/var/folders/x/T/lab/workspaces/abc', title: 'real run', prompt: 'x' }); const ev = [...m.begin()];
for (const r of rows) ev.push(...m.map(r)); const c = (ty) => ev.filter((e) => e.type === ty).length;
assert.equal(ev[0].type, 'task_started'); assert.equal(ev.at(-1).type, 'task_finished'); assert.equal(ev.at(-1).status, 'succeeded', 'real result subtype success -> succeeded');
assert.equal(c('task_finished'), 1); assert.equal(c('tool_called'), 3); assert.equal(c('tool_returned'), 3); assert.ok(c('agent_said') >= 2, 'assistant commentary captured');
const names = ev.filter((e) => e.type === 'output_produced').map((e) => e.name); assert.deepEqual(names, ['analyze_csv.py', 'sample.csv'], 'relative ./paths are normalised: ' + names);
assert.equal(new Set(ev.at(-1).outputIds).size, ev.at(-1).outputIds.length, 'no duplicate outputs');
assert.ok(m.addFile('analyze_csv.py').length === 0 && m.addFile('new.txt').length === 1, 'files found on disk are not re-announced when a Write already announced them');
assert.ok(ev.every((e, i) => i === 0 || e.t >= ev[i - 1].t), 'timestamps monotonic');
assert.equal(m.stats().result.num_turns, 4); assert.deepEqual(m.stats().result.permission_denials, []);
console.log(`real-stream test OK: ${rows.length} real stream objects -> ${ev.length} events (${[...new Set(ev.map((e) => e.type))].join(', ')})`);

/* ---- second real run: Claude Code was DENIED two Bash actions (a blocked output redirection and an rm) ---- */
{
  const rows2 = fs.readFileSync(new URL('./fixtures/real-claude-run-denials.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  let t2 = 0; const m2 = createStreamMapper({ now: () => (t2 += 100), workspace: '/Users/x/.agent-activity-lab/workspaces/abc', title: 'real run 2', prompt: 'x' }); const e2 = [...m2.begin()];
  for (const r of rows2) e2.push(...m2.map(r)); const c2 = (ty) => e2.filter((e) => e.type === ty).length;
  assert.equal(c2('agent_blocked'), 2, 'both real denials (blocked redirection, denied rm) show as BLOCKED, not failed'); assert.equal(c2('agent_failed'), 0, 'a denial is not a failure');
  assert.ok(e2.filter((e) => e.type === 'agent_blocked').every((e) => /^Permission needed: Bash/.test(e.reason)), 'blocked reasons name the tool');
  assert.ok(c2('agent_unblocked') >= 1, 'agent moving on after a denial clears the blocked state');
  assert.equal(e2.at(-1).type, 'task_finished'); assert.match(e2.at(-1).summary, /2 actions were denied: Bash/, 'summary reports the structured permission_denials');
  assert.deepEqual(e2.filter((e) => e.type === 'output_produced').map((e) => e.name), ['analyze_csv.py', 'sample.csv']);
  assert.equal(m2.stats().result.permission_denials.length, 2);
  console.log(`real-stream test 2 OK: real run with denials -> ${c2('agent_blocked')} blocked, ${c2('agent_failed')} failed, summary mentions denials`);
}
