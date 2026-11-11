#!/usr/bin/env node
/*
 * transcript-to-events.mjs  Convert a REAL Claude Code session transcript (a .jsonl file under ~/.claude/projects)
 * into agent-activity-lab events, so a prototype can replay what actually happened.
 *
 *   node tools/transcript-to-events.mjs <transcript.jsonl> [--last 60] [--out replay.json] [--show-inputs]
 *   curl -X POST 'http://127.0.0.1:7777/replay?speed=4' -H 'content-type: application/json' -d @replay.json
 *
 * Honesty: the adapter labels this REPLAY · transcript. It is a recording of real past activity, not live.
 * Mapping (all from fields seen in real transcripts):
 *   assistant tool_use            -> tool_called (agent "main"; Agent/Task calls also spawn + delegate a subagent)
 *   user tool_result is_error     -> agent_failed (a later tool call from the same agent -> agent_retry)
 *   tool_result for Agent/Task    -> agent_completed for that subagent
 * Not derived (not recorded in transcripts): permission waits, messages between agents, outputs.
 * Idle gaps longer than 3 s are compressed to 1.5 s. Tool inputs are hidden unless --show-inputs
 * (they can hold paths, prompts and secrets); only tool names are shown by default.
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && ['--last', '--out'].includes(args[i - 1])));
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
if (!file) { console.error('usage: node tools/transcript-to-events.mjs <transcript.jsonl> [--last 60] [--out replay.json] [--show-inputs]'); process.exit(1); }
const last = Number(opt('last', 60)); const showInputs = args.includes('--show-inputs');

const rows = [];
for (const l of fs.readFileSync(file, 'utf8').split('\n')) { if (!l) continue; try { rows.push(JSON.parse(l)); } catch {} }

// 1. collect tool_use / tool_result pairs in order
const calls = []; const byId = {};
for (const d of rows) {
  const c = d.message && d.message.content; if (!Array.isArray(c) || !d.timestamp) continue;
  const ts = Date.parse(d.timestamp);
  for (const b of c) {
    if (b.type === 'tool_use') { const o = { id: b.id, name: b.name, input: b.input || {}, start: ts, end: null, error: null, sidechain: !!d.isSidechain }; calls.push(o); byId[b.id] = o; }
    else if (b.type === 'tool_result' && byId[b.tool_use_id]) { const o = byId[b.tool_use_id]; o.end = ts; if (b.is_error) { const t = Array.isArray(b.content) ? b.content.map((x) => x.text || '').join(' ') : String(b.content || ''); o.error = t.replace(/\s+/g, ' ').slice(0, 100) || 'tool error'; } }
  }
}
const picked = calls.slice(-last);
if (!picked.length) { console.error('no tool calls found'); process.exit(1); }

// 2. build events with a compressed timeline
const ev = []; let clock = 0; let prev = picked[0].start; const T = (ms) => { const gap = ms - prev; prev = Math.max(prev, ms); clock += gap > 3000 ? 1500 : Math.max(0, gap); return Math.round(clock); };
const brief = (c) => (showInputs ? String((c.input.file_path || c.input.command || c.input.pattern || c.input.description || c.input.query || c.input.url || '')).replace(/\s+/g, ' ').slice(0, 60) : '');
ev.push({ t: 0, type: 'task_started', task: { id: 'replay-' + file.split('/').pop().slice(0, 8), title: 'Replay of a recorded Claude Code session (' + picked.length + ' tool calls)', goal: 'Recorded, not live' } });
ev.push({ t: 0, type: 'agent_spawned', agentId: 'main', name: 'Claude Code', label: 'MAIN', role: 'Main session', parentId: null, dependsOn: [] });
const failed = {}; const attempts = {}; const subOf = {}; let subN = 0;
const pending = []; // completion events to place by time
for (const c of picked) {
  let agent = 'main';
  const isSub = c.name === 'Agent' || c.name === 'Task';
  if (failed[agent]) { failed[agent] = false; attempts[agent] = (attempts[agent] || 1) + 1; ev.push({ t: T(c.start), type: 'agent_retry', agentId: agent, attempt: attempts[agent] }); }
  if (isSub) {
    subN += 1; const id = 'sub' + subN; subOf[c.id] = id; const nm = String(c.input.subagent_type || 'Subagent');
    ev.push({ t: T(c.start), type: 'agent_spawned', agentId: id, name: nm, label: nm.slice(0, 6).toUpperCase(), role: showInputs ? String(c.input.description || '') : 'Subagent', parentId: 'main', dependsOn: [] });
    ev.push({ t: T(c.start), type: 'work_delegated', fromId: 'main', toId: id, workId: 'w-' + id, description: showInputs ? String(c.input.description || '') : 'Subagent task' });
  }
  const dur = c.end ? Math.min(Math.max(c.end - c.start, 300), 3000) : 1000;
  ev.push({ t: T(c.start), type: 'tool_called', agentId: isSub ? subOf[c.id] : agent, tool: c.name.replace(/^mcp__/, '').slice(0, 40), input: brief(c), durationMs: dur, callId: c.id });
  if (c.end) ev.push({ t: T(c.end), type: 'tool_returned', agentId: isSub ? subOf[c.id] : agent, callId: c.id, durationMs: c.end - c.start, ok: !c.error });
  if (c.error) { ev.push({ t: T(c.end || c.start), type: 'agent_failed', agentId: isSub ? subOf[c.id] : agent, error: showInputs ? c.error : 'Tool returned an error' }); if (!isSub) failed[agent] = true; }
  else if (isSub && c.end) ev.push({ t: T(c.end), type: 'agent_completed', agentId: subOf[c.id] });
}
const endT = ev[ev.length - 1].t + 800;
for (const id of Object.values(subOf)) if (!ev.some((e) => e.type === 'agent_completed' && e.agentId === id) && !ev.some((e) => e.type === 'agent_failed' && e.agentId === id)) ev.push({ t: endT, type: 'agent_completed', agentId: id });
ev.push({ t: endT, type: 'agent_completed', agentId: 'main' });
ev.push({ t: endT + 200, type: 'task_finished', status: 'ended', outputIds: [], summary: 'End of the recorded segment' });
ev.sort((a, b) => a.t - b.t);
const doc = { note: 'REPLAY of a real Claude Code transcript segment (' + picked.length + ' tool calls, idle gaps compressed). Permission waits, messages and outputs are not recorded in transcripts, so they are not shown.', events: ev };
const out = opt('out', null); if (out) fs.writeFileSync(out, JSON.stringify(doc)); else console.log(JSON.stringify(doc).slice(0, 400));
const counts = {}; ev.forEach((e) => (counts[e.type] = (counts[e.type] || 0) + 1));
console.error('events:', JSON.stringify(counts), ' duration', (ev[ev.length - 1].t / 1000).toFixed(1) + 's');
