#!/usr/bin/env node
/*
 * hook-coverage.mjs  Tell me what a RAW hook log proves, and what is still assumed.
 *
 *   node tools/hook-coverage.mjs <raw.jsonl> [--fixture shared/fixtures/real-hook-payloads.jsonl]
 *
 * Input: a file of raw hook payloads (one JSON per line) from `AGENT_HOOK_LOG=<file> node shared/adapter-server.mjs`
 * or `hook-forward.mjs --log <file>`. For every hook event the mapper handles it reports whether real payloads were seen,
 * which of the fields the mapper relies on were actually present, and fields the mapper never reads. It also runs the
 * log through the mapper to flag anything that would mis-render (unmatched tool calls, no task_finished, unknown agents).
 * --fixture writes a sanitised copy (paths, prompts and tool inputs redacted) you can commit as a regression fixture.
 */
import fs from 'node:fs';
import { createHookMapper } from '../shared/adapter-server.mjs';

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--fixture');
const fixtureOut = args.includes('--fixture') ? args[args.indexOf('--fixture') + 1] : null;
if (!file) { console.error('usage: node tools/hook-coverage.mjs <raw.jsonl> [--fixture out.jsonl]'); process.exit(1); }
const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// fields the mapper depends on, per event (kept in step with shared/adapter-server.mjs)
const NEEDS = {
  SessionStart: [], UserPromptSubmit: ['session_id', 'prompt'], PreToolUse: ['tool_name', 'tool_input', 'tool_use_id'],
  PostToolUse: ['tool_name', 'tool_use_id', 'tool_response'], PostToolUseFailure: ['tool_use_id', 'error'], PermissionRequest: ['tool_name', 'tool_input'],
  Notification: ['message'], SubagentStart: ['agent_id', 'agent_type'], SubagentStop: ['agent_id'], Stop: [], SessionEnd: ['reason'],
};
const by = {}; for (const r of rows) (by[r.hook_event_name || '(none)'] ||= []).push(r);
console.log(`${rows.length} payloads in ${file}\n`);
console.log('event'.padEnd(20) + 'seen'.padEnd(7) + 'status'.padEnd(26) + 'details');
let verified = 0, total = Object.keys(NEEDS).length;
for (const [ev, need] of Object.entries(NEEDS)) {
  const list = by[ev] || [];
  if (!list.length) { console.log(ev.padEnd(20) + '0'.padEnd(7) + 'NOT SEEN (unverified)'.padEnd(26) + 'assumed from documentation'); continue; }
  const missing = need.filter((f) => !list.some((r) => r[f] !== undefined));
  const status = missing.length ? 'seen, FIELDS MISSING' : 'verified by real payloads'; if (!missing.length) verified++;
  console.log(ev.padEnd(20) + String(list.length).padEnd(7) + status.padEnd(26) + (missing.length ? 'mapper expects but never saw: ' + missing.join(', ') : 'all expected fields present'));
}
const unknown = Object.keys(by).filter((e) => !(e in NEEDS));
if (unknown.length) console.log('\nEvents in the log the mapper ignores: ' + unknown.map((e) => `${e} (${by[e].length})`).join(', '));
const read = new Set(['hook_event_name', 'session_id', 'agent_id', 'agent_type', 'prompt', 'tool_name', 'tool_input', 'tool_use_id', 'tool_response', 'error', 'message', 'reason']);
const extra = {}; for (const r of rows) for (const k of Object.keys(r)) if (!read.has(k)) extra[k] = (extra[k] || 0) + 1;
if (Object.keys(extra).length) console.log('Fields present but not used by the mapper: ' + Object.entries(extra).map(([k, n]) => `${k}(${n})`).join(', '));

// mapping health
const m = createHookMapper(); const ev = []; for (const r of rows) ev.push(...m(r));
const open = new Set(), problems = [];
for (const e of ev) { if (e.type === 'tool_called' && e.callId) open.add(e.callId); if (e.type === 'tool_returned') open.delete(e.callId); }
if (open.size) problems.push(`${open.size} tool call(s) never returned (no matching PostToolUse/PostToolUseFailure by tool_use_id) - normal only if the session was cut off`);
const spawned = new Set(ev.filter((e) => e.type === 'agent_spawned').map((e) => e.agentId));
const stray = new Set(ev.filter((e) => e.agentId && !spawned.has(e.agentId)).map((e) => e.agentId)); if (stray.size) problems.push(`events for agents that were never spawned: ${[...stray].join(', ')}`);
if (!ev.some((e) => e.type === 'task_started')) problems.push('no task_started produced');
if (!ev.some((e) => e.type === 'task_finished')) problems.push('no task_finished produced (no Stop/SessionEnd in the log)');
console.log(`\nMapper output: ${ev.length} events (${[...new Set(ev.map((e) => e.type))].join(', ')})`);
console.log(problems.length ? 'Mapping problems:\n - ' + problems.join('\n - ') : 'Mapping health: no problems detected.');
console.log(`\nVerified event kinds: ${verified} of ${total}. Anything NOT SEEN above must still be described as unverified.`);

if (fixtureOut) {
  const san = rows.map((r) => { const o = { ...r };
    if (o.transcript_path) o.transcript_path = '<redacted>'; if (o.cwd) o.cwd = '<project>'; if (typeof o.prompt === 'string') o.prompt = '<prompt redacted>';
    if (o.tool_input) o.tool_input = Object.fromEntries(Object.keys(o.tool_input).map((k) => [k, '<redacted>']));
    if (o.tool_response && typeof o.tool_response === 'object') o.tool_response = Object.fromEntries(Object.keys(o.tool_response).map((k) => [k, typeof o.tool_response[k] === 'boolean' ? o.tool_response[k] : '<redacted>']));
    if (typeof o.error === 'string') o.error = '<error redacted>'; if (typeof o.message === 'string') o.message = o.message.replace(/\S+\/\S+/g, '<path>');
    return JSON.stringify(o); });
  fs.writeFileSync(fixtureOut, san.join('\n') + '\n'); console.log(`Sanitised fixture written to ${fixtureOut} (review it before committing).`);
}
