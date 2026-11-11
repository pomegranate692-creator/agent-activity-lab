// Exercises the Claude Code hook mapper with SYNTHETIC payloads. This proves the mapping logic,
// not that a real Claude Code session produces exactly these payloads.
import { createHookMapper } from './adapter-server.mjs';
import assert from 'node:assert/strict';

const map = createHookMapper();
const all = [];
const feed = (p) => { const evs = map(p); all.push(...evs); return evs; };

feed({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: 'Fix the flaky login test' });
feed({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Read', tool_input: { file_path: 'tests/login.spec.ts' } });
feed({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Task', tool_input: { subagent_type: 'Explore', description: 'Find login flows' } });
feed({ hook_event_name: 'SubagentStart', session_id: 's1', agent_id: 'a-42', agent_type: 'Researcher' });
feed({ hook_event_name: 'PreToolUse', session_id: 's1', agent_id: 'a-42', tool_name: 'Grep', tool_input: { pattern: 'login' } });
feed({ hook_event_name: 'Notification', session_id: 's1', message: 'Claude needs your permission to use Bash' });
feed({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Bash', tool_input: { command: 'npm test' } });
feed({ hook_event_name: 'PostToolUseFailure', session_id: 's1', tool_name: 'Bash', error: '2 tests failed' });
feed({ hook_event_name: 'SubagentStop', session_id: 's1', agent_id: 'a-42' });
// Pre/Post pairing by tool_use_id gives a measured duration (synthetic payloads)
feed({ hook_event_name: 'PreToolUse', session_id: 's1', tool_use_id: 'tu1', tool_name: 'Read', tool_input: { file_path: 'a.ts' } });
await new Promise((r) => setTimeout(r, 40));
const ret = feed({ hook_event_name: 'PostToolUse', session_id: 's1', tool_use_id: 'tu1', tool_name: 'Read', tool_response: {} });
assert.equal(ret.length, 1); assert.equal(ret[0].type, 'tool_returned'); assert.equal(ret[0].callId, 'tu1'); assert.ok(ret[0].durationMs >= 30 && ret[0].ok === true);
feed({ hook_event_name: 'PreToolUse', session_id: 's1', tool_use_id: 'tu2', tool_name: 'Bash', tool_input: { command: 'false' } });
const bad = feed({ hook_event_name: 'PostToolUseFailure', session_id: 's1', tool_use_id: 'tu2', tool_name: 'Bash', error: 'exit 1' });
assert.ok(bad.some((e) => e.type === 'tool_returned' && e.ok === false) && bad.some((e) => e.type === 'agent_failed'));
feed({ hook_event_name: 'PostToolUse', session_id: 's1', tool_use_id: 'never-seen', tool_name: 'Read' }); // unmatched Post must not throw or emit
feed({ hook_event_name: 'Stop', session_id: 's1' });

const types = all.map((e) => e.type);
assert.equal(types[0], 'task_started'); assert.ok(types.includes('agent_spawned')); assert.ok(types.includes('work_delegated'));
assert.ok(types.includes('agent_blocked')); assert.ok(types.includes('agent_unblocked')); assert.ok(types.includes('agent_failed'));
assert.ok(types.includes('agent_completed')); assert.equal(types[types.length - 1], 'task_finished');
const main = all.find((e) => e.type === 'agent_spawned' && e.agentId === 'main'); assert.ok(main);
assert.equal(all.filter((e) => e.type === 'task_started').length, 1);
console.log('hook mapper OK: ' + all.length + ' events ->', [...new Set(types)].join(', '));
