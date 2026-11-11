// Regression test: feeds payloads captured from a REAL Claude Code 2.1.263 run (SessionStart, UserPromptSubmit,
// SessionEnd after an auth failure) through the mapper. Only these three event kinds are real; see adapter-server.mjs.
import fs from 'node:fs'; import { createHookMapper } from './adapter-server.mjs';
const m = createHookMapper(); const ev = [];
for (const l of fs.readFileSync(new URL('./fixtures/real-hook-payloads.jsonl', import.meta.url), 'utf8').trim().split('\n')) ev.push(...m(JSON.parse(l)));
const fail = (msg) => { console.error('FAIL:', msg, JSON.stringify(ev)); process.exit(1); };
const ts = ev.find((e) => e.type === 'task_started'); if (!ts || !/^Do these steps in order/.test(ts.task.title)) fail('task title should come from the prompt');
if (ev[0].t > 50) fail('clock should start at the first event');
const tf = ev.find((e) => e.type === 'task_finished'); if (!tf || tf.status !== 'ended') fail('SessionEnd without Stop must not be reported as succeeded');
console.log('real-payload test OK:', ev.map((e) => e.type).join(', '));
