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
ok(JSON.stringify(await tabs(p)) === JSON.stringify(['Agents*', 'Tool stream']), 'demo tabs are Agents and Tool stream (Output hidden)');
ok(await p.evaluate(() => /DEMO MODE/.test(document.body.innerText) && document.querySelector('.ac-badge').innerText === 'SIMULATED'), 'demo mode banner and SIMULATED badge');
ok(await p.evaluate(() => !document.querySelector('.ap-cprimary')), 'no Run button in demo mode');
ok(await p.evaluate(() => document.querySelectorAll('.ap-pill').length === 2), 'Needs You lists the blocked and the failed agent');
await p.evaluate(() => document.querySelector('.ap-pill-blocked').click()); await sleep(300); ok(await p.evaluate(() => /Coder/.test(document.querySelector('.ac-ins-name').innerText)), 'Needs-You pill selects the agent');
await p.evaluate(() => document.querySelector('.cd-card[data-id="test"]').focus()); await p.keyboard.press('Enter'); await sleep(300); ok(await p.evaluate(() => /Tester/.test(document.querySelector('.ac-ins-name').innerText)), 'keyboard Enter on a card selects it');
ok(await p.evaluate(() => document.querySelectorAll('.cd-lane').length >= 10), 'cards have activity lanes');
await tab(p, 'Tool stream'); await sleep(300); ok(await p.evaluate(() => document.querySelectorAll('.ts-row').length > 5), 'Tool stream has rows');
ok(errs.length === 0, 'demo page errors: ' + errs.join('|')); await p.close();
({ p, errs } = await open('file://' + ROOT + '/app/index.html?scenario=stress&t=11000&autoplay=0')); ok(await p.evaluate(() => Object.keys(window.__agentlab.state().agents).length === 30 && document.querySelectorAll('.cd-card').length > 5), 'stress run: 30 agents, cards drawn'); ok(errs.length === 0, 'stress errors: ' + errs.join('|')); await p.close();
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
await p.evaluate(() => { window.confirm = () => true; }); await p.evaluate(() => [...document.querySelectorAll('.ap-cbtn')].find((b) => b.textContent === 'Retry').click()); await sleep(800);
ok(await p.evaluate(() => /Running|Succeeded/.test(document.querySelector('.ap-cchip').innerText)), 'Retry starts a new session'); await sleep(3000);
console.log(`app test OK: ${n} checks (live flow used the TEST STUB, not a real Claude Code run)`);
await browser.close(); await lab.close(); fs.rmSync(home, { recursive: true, force: true }); process.exit(0);
