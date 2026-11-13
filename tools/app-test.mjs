#!/usr/bin/env node
/*
 * app-test.mjs  Regression test for the main app (app/index.html) in headless Chrome.
 *   node tools/app-test.mjs
 * A. Demo mode (opened from disk, simulated scenario): tabs, Needs You, selection by click and keyboard, stress run, reduced motion.
 * B. Live flow against the local service with the TEST STUB engine (NOT a real Claude Code run): New task dialog, typing (spaces!),
 *    Run, live updates, Output tab (answer, files, denials), History, Stop, Retry, honest badges.
 */
import puppeteer from 'puppeteer-core'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-apptest-')); process.env.AGENT_LAB_HOME = home; process.env.AGENT_LAB_CLAUDE_BIN = path.join(ROOT, 'server/test/fake-claude.mjs'); fs.chmodSync(process.env.AGENT_LAB_CLAUDE_BIN, 0o755);
const { SessionManager } = await import('../server/sessions.mjs'); const { startLab, loadToken } = await import('../server/lab-server.mjs');
const lab = await startLab({ port: 0, manager: new SessionManager({ home }), token: loadToken(home), quiet: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--hide-scrollbars'], defaultViewport: { width: 1360, height: 860 } });
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; }; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(url) { const p = await browser.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); await p.goto(url, { waitUntil: 'load' }); await sleep(1200); return { p, errs }; }
const tabs = (p) => p.evaluate(() => [...document.querySelectorAll('.ap-tab')].filter((t) => getComputedStyle(t).display !== 'none').map((t) => t.textContent + (t.getAttribute('aria-selected') === 'true' ? '*' : '')));
const tab = (p, name) => p.evaluate((nm) => [...document.querySelectorAll('.ap-tab')].find((t) => t.textContent === nm).click(), name);

/* ---- A. demo mode ---- */
let { p, errs } = await open('file://' + ROOT + '/app/index.html?t=12000&autoplay=0');
ok(JSON.stringify(await tabs(p)) === JSON.stringify(['Web*', 'Activity']), 'demo views are Web and Activity (Output hidden)');
ok(await p.evaluate(() => /DEMO MODE/.test(document.body.innerText) && document.querySelector('.ac-badge').innerText === 'SIMULATED'), 'demo mode banner and SIMULATED badge');
ok(await p.evaluate(() => !document.querySelector('.ap-cprimary')), 'no Run button in demo mode');
ok(await p.evaluate(() => document.querySelectorAll('.ap-pill').length === 2), 'Needs You lists the blocked and the failed agent');
await p.evaluate(() => document.querySelector('.ap-pill-blocked').click()); await sleep(300); ok(await p.evaluate(() => /Coder/.test(document.querySelector('.ac-inspector').innerText)), 'Needs-You pill selects the agent');
await p.evaluate(() => document.querySelector('.lw-node[data-id="test"]').focus()); await p.keyboard.press('Enter'); await sleep(300); ok(await p.evaluate(() => /Tester/.test(document.querySelector('.ac-inspector').innerText)), 'keyboard Enter on a card selects it');
ok(await p.evaluate(() => document.querySelectorAll('.lw-art .lw-strand').length >= 5 && !!document.querySelector('.lw-art .lw-hub')), 'the web draws the hub and a strand to every subagent');
await tab(p, 'Activity'); await sleep(300); ok(await p.evaluate(() => document.querySelectorAll('.ts-row').length > 5), 'Tool stream has rows');
ok(errs.length === 0, 'demo page errors: ' + errs.join('|')); await p.close();
({ p, errs } = await open('file://' + ROOT + '/app/index.html?scenario=stress&t=11000&autoplay=0')); ok(await p.evaluate(() => Object.keys(window.__agentlab.state().agents).length === 30 && document.querySelectorAll('.lw-node').length === 30 && (() => { const w = document.querySelector('.lw-wrap').getBoundingClientRect(); return [...document.querySelectorAll('.lw-node')].every((b) => { const r = b.getBoundingClientRect(); return r.left >= w.left - 1 && r.right <= w.right + 1 && r.top >= w.top - 1 && r.bottom <= w.bottom + 1; }); })()), 'stress run: all 30 agents are drawn as nodes and fit inside the view'); ok(errs.length === 0, 'stress errors: ' + errs.join('|')); await p.close();
({ p, errs } = await open('file://' + ROOT + '/app/index.html?reduced=1&speed=4')); await sleep(2500); ok(await p.evaluate(() => window.__agentlab.state().t > 3000), 'reduced motion: clock advances'); ok(errs.length === 0, 'reduced-motion errors'); await p.close();

/* ---- B. live flow with the stub ---- */
({ p, errs } = await open(`http://127.0.0.1:${lab.port}/app/index.html`));
ok(await p.evaluate(() => !!document.querySelector('.ap-cprimary') && /TEST STUB/.test(document.querySelector('.ap-cmode').innerText)), 'service detected, engine shown as TEST STUB');
ok(JSON.stringify(await tabs(p)) === JSON.stringify(['Agents*', 'Output']) || (await tabs(p)).includes('Output'), 'Output tab appears with the service');
await p.click('.ap-cprimary'); await sleep(300); ok(await p.evaluate(() => document.querySelector('dialog').open), 'New task dialog opens');
await p.type('.ap-ta', 'Create a simple Python script that analyzes a CSV file and summarizes the results.'); ok(await p.evaluate(() => document.querySelector('.ap-ta').value.includes('a simple Python')), 'spaces can be typed in the task box');
await p.click('dialog button[type=submit]'); await sleep(900);
ok(await p.evaluate(() => document.querySelector('.ac-badge').innerText === 'TEST STUB · NOT CLAUDE'), 'badge says TEST STUB while running a stub session');
await sleep(3000); const chip = await p.evaluate(() => document.querySelector('.ap-cchip').innerText); ok(/^Succeeded/.test(chip), 'session succeeded: ' + chip);
ok(await p.evaluate(() => Object.keys(window.__agentlab.state().agents).length === 2), 'two agents: main and the real subagent');
await tab(p, 'Output'); await sleep(900); ok(await p.evaluate(() => [...document.querySelectorAll('.rs-fb:not(.rs-dl)')].map((x) => x.textContent).sort().join() === 'analyze_csv.py,sample.csv,summary.txt'), 'Output lists the generated files');
ok(await p.evaluate(() => document.querySelectorAll('.rs-den').length === 1), 'Output lists the denied action');
await p.evaluate(() => [...document.querySelectorAll('.rs-fb:not(.rs-dl)')].find((x) => x.textContent === 'analyze_csv.py').click()); await sleep(500); ok(await p.evaluate(() => /import csv/.test(document.querySelector('.rs-prev').innerText)), 'file preview shows the generated script');
await p.evaluate(() => [...document.querySelectorAll('.ap-cbtn')].find((b) => b.textContent === 'History').click()); await sleep(600); ok(await p.evaluate(() => document.querySelectorAll('.ap-hi').length === 1), 'History lists the saved session');
await p.evaluate(() => document.querySelector('.ap-hi').click()); await sleep(900); ok(await p.evaluate(() => /TEST STUB/.test(document.querySelector('.ac-badge').innerText) && Object.keys(window.__agentlab.state().agents).length === 2), 'reopening a saved session restores it with an honest badge');
ok(errs.length === 0, 'live flow page errors: ' + errs.join('|'));
/* selection sync between the Agents view and the Tool stream (shared selection) */
await tab(p, 'Web'); await sleep(400);
ok(await p.evaluate(() => !!document.querySelector('.lw-node[data-id="toolu_sub1"]') && !document.querySelector('.lw-node.sel')), 'the subagent has its own node in the web and nothing is selected yet');
await tab(p, 'Activity'); await sleep(400); await p.evaluate(() => document.querySelector('.ts-row[data-agent="toolu_sub1"]').click()); await sleep(400);
ok(await p.evaluate(() => /data-inspector/.test(document.querySelector('.ac-inspector').innerText)), 'clicking a Tool stream row selects that agent in the shared inspector');
await tab(p, 'Web'); await sleep(600); ok(await p.evaluate(() => document.querySelector('.lw-node[data-id="toolu_sub1"]')?.classList.contains('sel')), 'the same agent is highlighted in the web');
await p.evaluate(() => document.querySelector('.lw-node[data-id="main"]').click()); await sleep(300); await tab(p, 'Activity'); await sleep(500);
ok(await p.evaluate(() => document.querySelector('.ts-list').classList.contains('has-sel') && [...document.querySelectorAll('.ts-row.sel')].every((r) => r.dataset.agent === 'main') && document.querySelectorAll('.ts-row.sel').length > 0), 'selecting a card highlights that agent\'s rows in the Tool stream');
await p.evaluate(() => [...document.querySelectorAll('.ts-chip')].find((c) => /^Only /.test(c.textContent)).click()); await sleep(300);
ok(await p.evaluate(() => [...document.querySelectorAll('.ts-row')].every((r) => r.dataset.agent === 'main')), '"Only <agent>" filters the Tool stream to the selected agent');
await p.keyboard.press('Escape'); await sleep(200);
/* Output: approve a denied action and continue the same conversation */
await tab(p, 'Output'); await sleep(700); await p.evaluate(() => document.querySelector('.rs-den input').click());
await p.evaluate(() => [...document.querySelectorAll('.ap-cbtn')].find((b) => /Approve selected and continue/.test(b.textContent)).click()); await sleep(400);
ok(await p.evaluate(() => document.querySelector('.ap-cdlg')?.open && /WebFetch/.test(document.querySelector('.ap-cdlg').innerText)), 'approve asks for confirmation and names the exact rule');
await p.evaluate(() => [...document.querySelectorAll('.ap-cdlg button')].find((b) => b.textContent === 'Approve and continue').click()); await sleep(1200);
ok(await p.evaluate(() => /Running|Succeeded/.test(document.querySelector('.ap-cchip').innerText)), 'approve-and-continue started a linked session'); await sleep(2500);
/* per-agent retry: a task whose subagent fails */
await p.click('.ap-cprimary'); await sleep(300); await p.type('.ap-ta', 'FAIL_SUB please run the flaky part'); await p.click('dialog[aria-label="New task"] button[type=submit]'); await sleep(3500);
await tab(p, 'Web'); await sleep(500); await p.evaluate(() => document.querySelector('.lw-node[data-id="toolu_subF"]').click()); await sleep(400);
ok(await p.evaluate(() => /flaky-worker/.test(document.querySelector('.ac-inspector').innerText) && !![...document.querySelectorAll('.ap-ctl .ap-cbtn')].find((b) => /Retry this agent/.test(b.textContent))), 'the failed subagent offers Retry in the inspector');
await p.evaluate(() => [...document.querySelectorAll('.ap-ctl .ap-cbtn')].find((b) => /Retry this agent/.test(b.textContent)).click()); await sleep(400);
ok(await p.evaluate(() => /same conversation/.test(document.querySelector('.ap-cdlg').innerText)), 'retry explains what it will do before running');
await p.evaluate(() => [...document.querySelectorAll('.ap-cdlg button')].find((b) => b.textContent === 'Retry').click()); await sleep(1500);
ok(await p.evaluate(() => /Running|Succeeded/.test(document.querySelector('.ap-cchip').innerText)), 'per-agent retry started a linked session'); await sleep(2500);
await p.evaluate(() => { window.__agentlab.select('main'); }); await sleep(300);
ok(await p.evaluate(() => /No actions/.test(document.querySelector('.ap-ctl')?.innerText || '')), 'agents that did not fail or get blocked offer no retry or approval');
await p.evaluate(() => { window.confirm = () => true; }); await p.evaluate(() => [...document.querySelectorAll('.ap-cbtn')].find((b) => b.textContent === 'Retry').click()); await sleep(800);
ok(await p.evaluate(() => /Running|Succeeded/.test(document.querySelector('.ap-cchip').innerText)), 'Retry starts a new session'); await sleep(3000);
ok((await fetch(`http://127.0.0.1:${lab.port}/api/sessions`, { headers: { 'x-lab-token': loadToken(home) } }).then((r) => r.json())).sessions.length >= 5, 'every run, retry and follow-up is saved in history');
console.log(`app test OK: ${n} checks (live flow used the TEST STUB, not a real Claude Code run)`);
await browser.close(); await lab.close(); fs.rmSync(home, { recursive: true, force: true }); process.exit(0);
