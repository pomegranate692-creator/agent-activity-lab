// Feeds REAL Claude Code message lines (assistant/user with tool_use / tool_result) from a local transcript through the mapper.
// Proves the message-level mapping on real shapes. It does NOT prove system/init, result, or parent_tool_use_id on a real run
// (transcripts do not contain those). Skips quietly if no transcript is available. Prints counts only, never content.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import assert from 'node:assert/strict';
import { createStreamMapper } from './stream-mapper.mjs';
const base = path.join(os.homedir(), '.claude', 'projects'); let file = process.argv[2] || null;
if (!file && fs.existsSync(base)) { const all = []; for (const d of fs.readdirSync(base)) { const dir = path.join(base, d); if (!fs.statSync(dir).isDirectory()) continue; for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) { const p = path.join(dir, f); all.push([fs.statSync(p).size, p]); } } all.sort((a, b) => b[0] - a[0]); file = all.length ? all[Math.min(2, all.length - 1)][1] : null; }
if (!file) { console.log('stream mapper real-shape test: SKIPPED (no transcript found)'); process.exit(0); }
let t = 0; const m = createStreamMapper({ now: () => (t += 10), title: 'real-shape test' }); const ev = [...m.begin()];
let uses = 0, results = 0, errors = 0, lines = 0; const ids = new Set();
for (const l of fs.readFileSync(file, 'utf8').split('\n')) { if (!l) continue; let d; try { d = JSON.parse(l); } catch { continue; } if (d.type !== 'assistant' && d.type !== 'user') continue; if (d.isSidechain) continue; const c = d.message && d.message.content; if (!Array.isArray(c)) continue;
  for (const b of c) { if (b.type === 'tool_use') { uses++; ids.add(b.id); } if (b.type === 'tool_result' && ids.has(b.tool_use_id)) { results++; if (b.is_error) errors++; } } lines++;
  ev.push(...m.map({ type: d.type, message: d.message, parent_tool_use_id: null })); }
const count = (t) => ev.filter((e) => e.type === t).length;
assert.equal(count('tool_called'), uses, 'one tool_called per tool_use'); assert.equal(count('tool_returned'), results, 'one tool_returned per matched tool_result');
assert.equal(count('agent_failed') + count('agent_blocked'), errors, 'every tool error becomes a failed or blocked event');
assert.ok(ev.every((e, i) => i === 0 || e.t >= ev[i - 1].t), 'timestamps never go backwards');
const subs = count('agent_spawned') - 1;
console.log(`stream mapper real-shape test OK: ${lines} real message lines, ${uses} tool calls, ${results} results (${errors} errors -> ${count('agent_failed')} failed + ${count('agent_blocked')} blocked), ${subs} subagents seen, ${count('agent_said')} commentary notes, ${count('output_produced')} outputs`);
