#!/usr/bin/env node
/*
 * milestone-check.mjs  The first-milestone workflow, executed for real against the actual Claude Code CLI.
 *
 *   node tools/milestone-check.mjs [--keep]
 *
 * 1. starts the local service (own temp data dir, real `claude`, no stub), 2. refuses with exact instructions if the CLI is not signed in,
 * 3. submits "Create a simple Python script that analyzes a CSV file and summarizes the results.",
 * 4. waits for the real session to finish, 5. checks the saved event stream for real tool calls,
 * 6. finds the generated .py, RUNS it on a sample CSV and checks it printed a summary, 7. checks the session is in the saved history.
 * Uses your Claude login and bills your usage (budget capped at $2). Exit code 0 only if every step truly succeeded.
 */
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const keep = process.argv.includes('--keep');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-milestone-')); process.env.AGENT_LAB_HOME = home; delete process.env.AGENT_LAB_CLAUDE_BIN;
const { SessionManager } = await import('../server/sessions.mjs'); const { startLab, loadToken } = await import('../server/lab-server.mjs');
const manager = new SessionManager({ home }); const token = loadToken(home);
const step = (n, m) => console.log(`[${n}] ${m}`); const fail = (m) => { console.error('\nMILESTONE NOT MET: ' + m); process.exit(1); };
const probe = await manager.probe();
step(1, `Claude Code: ${probe.found ? probe.version : 'NOT FOUND'}, signed in: ${probe.loggedIn}`);
if (!probe.found) fail(probe.detail); if (!probe.loggedIn) fail('Claude Code is not signed in. Run `claude auth login` in a terminal, then run this again. (Nothing was started; no simulation is substituted.)');
const lab = await startLab({ port: 0, manager, token, quiet: true }); const base = `http://127.0.0.1:${lab.port}`; const H = { 'x-lab-token': token, 'content-type': 'application/json' };
const api = async (p, o = {}) => { const r = await fetch(base + p, { ...o, headers: H }); return { s: r.status, b: await r.json().catch(() => ({})) }; };
const prompt = 'Create a simple Python script that analyzes a CSV file and summarizes the results.';
const c = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ prompt, policy: 'workspace', confirm: true }) }); if (c.s !== 201) fail(`service refused the task (${c.s}): ${c.b.error}`);
step(2, `real session ${c.b.id.slice(0, 8)} started, engine ${c.b.engine}`); if (c.b.engine !== 'claude-code') fail('engine is not claude-code');
let m; for (let i = 0; i < 1500; i++) { m = (await api('/api/sessions/' + c.b.id)).b; if (m.status !== 'running') break; if (i % 20 === 0) process.stdout.write(`    running… ${m.stats.toolCalls} tool calls\n`); await new Promise((r) => setTimeout(r, 1000)); }
step(3, `finished: ${m.status} in ${Math.round((m.stats.durationMs || 0) / 1000)}s, ${m.stats.toolCalls} tool calls, ${m.stats.subagents} subagents, cost ${m.stats.costUsd == null ? 'n/a' : '$' + m.stats.costUsd}`); if (m.status !== 'succeeded') fail(`session ${m.status}: ${m.error || m.resultText || ''}`);
const ev = (await api(`/api/sessions/${c.b.id}/events`)).b.events; const calls = ev.filter((e) => e.type === 'tool_called'); step(4, `event stream: ${ev.length} events; tools used: ${[...new Set(calls.map((e) => e.tool))].join(', ') || 'none'}`);
if (!calls.length) fail('no tool calls were recorded'); if (!ev.some((e) => e.type === 'task_finished' && e.status === 'succeeded')) fail('no task_finished event');
const files = (await api(`/api/sessions/${c.b.id}/files`)).b.files; const py = files.find((f) => f.path.endsWith('.py')); step(5, `files: ${files.map((f) => f.path).join(', ') || 'none'}`); if (!py) fail('no .py file was generated');
const csv = path.join(home, 'sample.csv'); fs.writeFileSync(csv, 'name,age,score\nAda,36,91.5\nGrace,45,88\nLinus,29,79.25\nMargaret,52,95\n');
let outp; try { outp = execFileSync('python3', [path.join(m.workspace, py.path), csv], { encoding: 'utf8', timeout: 30000, cwd: m.workspace }); } catch (e) { fail('the generated script failed on a sample CSV: ' + (e.stderr || e.message)); }
step(6, `generated ${py.path} ran on a sample CSV and printed:\n${outp.split('\n').slice(0, 12).map((l) => '      ' + l).join('\n')}`); if (!outp.trim()) fail('the generated script printed nothing');
const hist = (await api('/api/sessions')).b.sessions; step(7, `saved in history: ${hist.some((s) => s.id === c.b.id)} (${path.join(home, 'sessions', c.b.id)})`); if (!hist.some((s) => s.id === c.b.id)) fail('session missing from history');
console.log('\nMILESTONE MET: a real Claude Code session ran, its tool use was recorded, the generated script works, and the session is saved.' + (keep ? `\nData kept in ${home}` : '')); await lab.close(); if (!keep) fs.rmSync(home, { recursive: true, force: true }); process.exit(0);
