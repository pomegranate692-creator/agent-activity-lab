#!/usr/bin/env node
/*
 * observe-test.mjs  Browser test of AUTOMATIC mode: the dashboard is open and idle; Claude Code hook payloads arrive through the
 * real intake (POST /api/hook); the page must pick the task up by itself, show the agents, finish, and keep it in History.
 *   node tools/observe-test.mjs
 * Payloads are the recorded real session (shared/fixtures/real-hook-session-subagent.jsonl) sent through the real hook path.
 * This proves the dashboard behaviour. It is NOT a live Claude Code run (tools/live-observe-check.mjs does that).
 */
import puppeteer from 'puppeteer-core'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-obstest-')); process.env.AGENT_LAB_HOME = home; process.env.AGENT_LAB_OPEN_CMD = '["true"]';
const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lab-obstest-ws-'))); fs.writeFileSync(path.join(ws, 'notes.txt'), 'one\ntwo\nthree\n'); fs.writeFileSync(path.join(ws, 'result.txt'), '3\n');
const rows = fs.readFileSync(path.join(ROOT, 'shared/fixtures/real-hook-session-subagent.jsonl'), 'utf8').replaceAll('/WORKSPACE', ws).trim().split('\n').map((l) => JSON.parse(l));
const { SessionManager } = await import('../server/sessions.mjs'); const { startLab, loadToken } = await import('../server/lab-server.mjs');
const token = loadToken(home); const lab = await startLab({ port: 0, manager: new SessionManager({ home }), token, quiet: true }); const base = `http://127.0.0.1:${lab.port}`;
const hook = (p) => fetch(base + '/api/hook', { method: 'POST', headers: { 'x-lab-token': token, 'content-type': 'application/json' }, body: JSON.stringify(p) });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--hide-scrollbars'], defaultViewport: { width: 1360, height: 860 } });
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; if (process.env.VERBOSE) console.log('  ok', m); }; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await browser.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(base + '/app/index.html', { waitUntil: 'load' }); await sleep(1200);
const txt = (sel) => page.evaluate((s) => (document.querySelector(s) || {}).innerText || '', sel);

/* idle: honest about what it is waiting for */
ok(/no Claude Code activity has arrived yet/i.test(await txt('.ap-cchip')), 'idle chip says no Claude Code activity yet (hooks not installed / not used)');
ok(await page.evaluate(() => document.querySelectorAll('.lw-node').length === 0), 'nothing is drawn while idle (no scripted demo behind a live service)');
ok(await page.evaluate(() => document.querySelector('.ap-follow').getAttribute('aria-pressed') === 'true'), 'following live is on by default');
ok(lab.feedClients.size === 1, 'the page holds the live feed connection');
ok(/Connected\s*· local service/.test(await txt('.ap-cmode')), 'the page says it is connected: ' + await txt('.ap-cmode'));
{ const st = await (await fetch(base + '/api/status', { headers: { 'x-lab-token': token } })).json(); ok(st.pages.length === 1 && st.pages[0].visible === true && st.pages[0].build === st.build && st.pages[0].browser === 'Chrome', 'the service lists this page as connected and visible, on the current code: ' + JSON.stringify(st.pages[0])); }
/* the connection is cut (as after a network hiccup or a service restart): the page must come back by itself and say so meanwhile */
for (const c of lab.feedClients) c.destroy(); await sleep(150);
let back = false; for (let i = 0; i < 40 && !back; i++) { await sleep(150); back = lab.feedClients.size === 1; } ok(back, 'after the live connection was cut, the page reconnected by itself');
await sleep(400); ok(/Connected\s*· local service/.test(await txt('.ap-cmode')), 'and shows Connected again');

/* a task starts in Claude Code: the page picks it up by itself */
const upTo = (name) => { const i = rows.findIndex((r) => r.hook_event_name === name); return i; };
for (const r of rows.slice(0, upTo('PreToolUse') + 1)) await hook(r); await sleep(1500);
ok(/LIVE · observing your Claude Code/.test(await txt('.ac-badge')), 'badge: LIVE · observing your Claude Code (no click needed): ' + await txt('.ac-badge'));
ok(await page.evaluate(() => document.querySelectorAll('.lw-node').length === 1 && /Claude Code/.test(document.querySelector('.lw-node').innerText)), 'the main agent card appeared');
ok(/Claude Code · Running · Create notes\.txt/.test(await txt('.ap-cchip')), 'command bar shows the observed task running');
ok(await page.evaluate(() => [...document.querySelectorAll('.ap-cbtn')].every((b) => !/^(Stop|Retry)$/.test(b.textContent) || b.hidden)), 'no Stop/Retry for a task the dashboard does not own');
ok(!/BLOCKED|FAILED/.test(await txt('.ap-need')) || /Nothing/.test(await txt('.ap-need')), 'Needs You is quiet');

/* the rest of the session: subagent appears and branches from main */
let seenSub = false; for (const r of rows.slice(upTo('PreToolUse') + 1)) { await hook(r); if (r.hook_event_name === 'SubagentStart') { await sleep(900); seenSub = await page.evaluate(() => document.querySelectorAll('.lw-node').length === 2); } }
ok(seenSub, 'a subagent card appeared the moment SubagentStart arrived');
await sleep(1500);
ok(/Succeeded/.test(await txt('.ap-cchip')), 'chip shows Succeeded: ' + await txt('.ap-cchip'));
ok(/SAVED · observed Claude Code session/.test(await txt('.ac-badge')), 'badge switches from LIVE to SAVED · observed when the task ends: ' + await txt('.ac-badge'));
const names = await page.evaluate(() => [...document.querySelectorAll('.lw-node')].map((c) => c.innerText.replace(/\s+/g, ' ')));
ok(names.length === 2 && names.some((t) => /general-purpose/.test(t)), 'two cards: main + general-purpose');
ok(await page.evaluate(() => !!document.querySelector('.lw-art .lw-strand')), 'connection between parent and subagent is drawn');
await page.evaluate(() => [...document.querySelectorAll('.ap-tab')].find((t) => t.textContent === 'Activity').click()); await sleep(400);
ok(await page.evaluate(() => document.querySelectorAll('.ts-row').length >= 6), 'Tool stream lists the 6 real tool calls');
await page.evaluate(() => [...document.querySelectorAll('.ap-tab')].find((t) => t.textContent === 'Output').click()); await sleep(600);
const out = await txt('.rs-wrap'); ok(/Observed · your Claude Code session/.test(out) && /notes\.txt/.test(out) && /result\.txt/.test(out) && /Done\. Created/.test(out), 'Output shows the final answer and the two files Claude wrote');
ok(!/Approve selected/.test(out), 'no approve controls for an observed task');
await page.evaluate(() => document.querySelector('.rs-fb').click()); await sleep(500); ok(/one\ntwo\nthree/.test(await txt('.rs-prev')), 'file preview works');
await page.evaluate(() => [...document.querySelectorAll('.ap-tab')].find((t) => t.textContent === 'Web').click()); await sleep(300);
await page.evaluate(() => document.querySelectorAll('.lw-node')[1].click()); await sleep(400);
ok(/watches only/.test(await txt('.ap-ctl')), 'inspector explains that observed tasks are controlled in Claude Code');

/* two tasks at once: the second shows as a chip and does not hijack the view */
const A = 'a0a0a0a0-1111-2222-3333-444444444444', B = 'b0b0b0b0-1111-2222-3333-444444444444';
await hook({ hook_event_name: 'UserPromptSubmit', session_id: A, cwd: ws, prompt_id: 'pa', prompt: 'First parallel task' }); await sleep(1500);
ok(/First parallel task/.test(await txt('.ap-cchip')), 'a new task started in Claude Code is followed automatically (the previous one had finished)');
await hook({ hook_event_name: 'UserPromptSubmit', session_id: B, cwd: ws, prompt_id: 'pb', prompt: 'Second parallel task' }); await sleep(1200);
ok(/First parallel task/.test(await txt('.ap-cchip')), 'a second running task does not hijack the view');
ok(/Second parallel task/.test(await txt('.ap-live')), 'but it shows as a running chip');
await page.evaluate(() => document.querySelector('.ap-lv').click()); await sleep(1000);
ok(/Second parallel task/.test(await txt('.ap-cchip')), 'clicking the chip switches to it');
await hook({ hook_event_name: 'Stop', session_id: A, cwd: ws, prompt_id: 'pa', last_assistant_message: 'ok' }); await hook({ hook_event_name: 'Stop', session_id: B, cwd: ws, prompt_id: 'pb', last_assistant_message: 'done b' }); await sleep(800);

/* History: observed tasks are listed; choosing a finished one pauses auto-follow */
await page.evaluate(() => [...document.querySelectorAll('.ap-cbtn')].find((b) => b.textContent === 'History').click()); await sleep(600);
const hist = await txt('.ap-hist'); ok(/Claude Code \(observed\)/.test(hist) && /Create notes\.txt/.test(hist) && /First parallel task/.test(hist), 'History lists the observed tasks');
await page.evaluate(() => [...document.querySelectorAll('.ap-hi')].find((b) => /Create notes/.test(b.innerText)).click()); await sleep(1000);
ok(/Create notes\.txt/.test(await txt('.ap-cchip')) && /SAVED · observed/.test(await txt('.ac-badge')), 'opening a past task shows it as SAVED');
ok(await page.evaluate(() => document.querySelector('.ap-follow').getAttribute('aria-pressed') === 'false'), 'opening a past task pauses auto-follow');
await hook({ hook_event_name: 'UserPromptSubmit', session_id: A, cwd: ws, prompt_id: 'pc', prompt: 'Third task while paused' }); await sleep(1200);
ok(/Create notes\.txt/.test(await txt('.ap-cchip')), 'with auto-follow paused a new task does not take over the screen');
await page.evaluate(() => document.querySelector('.ap-follow').click()); await sleep(1200);
ok(/Third task while paused/.test(await txt('.ap-cchip')), 'turning auto-follow back on jumps to the running task');
/* a finished task resumes when a background agent reports back: the page goes live again, then settles again */
await hook({ hook_event_name: 'Stop', session_id: A, cwd: ws, prompt_id: 'pc', last_assistant_message: 'first part', background_tasks: [] }); await sleep(1500);
ok(/Succeeded/.test(await txt('.ap-cchip')) && /SAVED/.test(await txt('.ac-badge')), 'task finished and settled as SAVED');
await hook({ hook_event_name: 'UserPromptSubmit', session_id: A, cwd: ws, prompt_id: 'pd', prompt: '<task-notification>\n<task-id>x</task-id>' }); await sleep(1500);
ok(/Running/.test(await txt('.ap-cchip')) && /LIVE · observing/.test(await txt('.ac-badge')), 'a background agent reporting back puts the same task live again: ' + await txt('.ap-cchip'));
await hook({ hook_event_name: 'Stop', session_id: A, cwd: ws, prompt_id: 'pd', last_assistant_message: 'second part', background_tasks: [] }); await sleep(1500);
ok(/Succeeded/.test(await txt('.ap-cchip')) && /SAVED/.test(await txt('.ac-badge')), 'and settles again when it really finishes');
{ const real = errs.filter((e) => !/ERR_INCOMPLETE_CHUNKED_ENCODING/.test(e)); ok(real.length === 0, 'page errors (the cut connection above is expected and excluded): ' + real.join(' | ')); }
await page.screenshot({ path: path.join(ROOT, 'docs/review/automatic-mode.png') });
await browser.close(); await lab.close();
console.log(`observe-test OK (${n} checks)`); process.exit(0);
