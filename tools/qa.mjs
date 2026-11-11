#!/usr/bin/env node
/*
 * qa.mjs  Uniform smoke test across every prototype (headless Chrome, real pages).
 *   node tools/qa.mjs            -> writes research/../qa/qa-results.json and final-frame pngs in qa/
 * Checks per prototype: page errors, final state (task finished), reduced-motion clock advance,
 * stress scenario errors + agent count, keyboard focusable agents, a final-frame screenshot.
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../shared/adapter-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outDir = path.join(ROOT, 'qa'); fs.mkdirSync(outDir, { recursive: true });
const protos = fs.readdirSync(path.join(ROOT, 'prototypes')).filter((d) => /^(0[1-9]|10)-/.test(d)).sort();
const { port, close } = await startServer({ port: 0, root: ROOT, quiet: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--hide-scrollbars'], defaultViewport: { width: 1280, height: 800 } });
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(name, query) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/prototypes/${name}/index.html?${query}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__agentlab && window.__agentlab.player', { timeout: 15000 });
  return { page, errors };
}

for (const name of protos) {
  const r = { name };
  try {
    // 1. normal run, stepped manually to the end
    let { page, errors } = await open(name, 'capture=1&autoplay=0');
    const dur = await page.evaluate(() => window.__agentlab.player.duration);
    await page.evaluate(() => { window.__agentlab.setSpeed(1); window.__agentlab.play(); });
    for (let i = 0; i < Math.ceil(dur / 100) + 20; i++) await page.evaluate(() => window.__agentlab.step(100));
    const fin = await page.evaluate(() => { const s = window.__agentlab.state(); return { t: s.t, counts: s.counts, finished: !!(s.finished || s.task && (s.task.status || s.task.finished)), taskStatus: s.task && s.task.status, keys: Object.keys(s).slice(0, 20) }; });
    r.final = fin;
    r.focusable = await page.evaluate(() => document.querySelectorAll('.ac-stage [tabindex]:not([tabindex="-1"]), .ac-stage button, .ac-stage [role=button]').length);
    await page.screenshot({ path: path.join(outDir, `${name}-final.png`) });
    r.errorsNormal = errors.slice(0, 3);
    await page.close();

    // 2. reduced motion (live clock, no capture mode): does time advance?
    ({ page, errors } = await open(name, 'reduced=1&speed=4'));
    const t0 = await page.evaluate(() => window.__agentlab.player.t);
    await sleep(2500);
    const t1 = await page.evaluate(() => window.__agentlab.player.t);
    r.reducedClock = { t0, t1, advanced: t1 > t0 + 500 };
    r.errorsReduced = errors.slice(0, 3);
    await page.close();

    // 3. same without reduced flag, for comparison
    ({ page, errors } = await open(name, 'speed=4'));
    const a0 = await page.evaluate(() => window.__agentlab.player.t);
    await sleep(2500);
    const a1 = await page.evaluate(() => window.__agentlab.player.t);
    r.normalClock = { t0: a0, t1: a1, advanced: a1 > a0 + 500 };
    await page.close();

    // 4. stress scenario, jump to the middle and the end
    ({ page, errors } = await open(name, 'scenario=stress&capture=1&autoplay=0'));
    const sd = await page.evaluate(() => window.__agentlab.player.duration);
    await page.evaluate(() => { window.__agentlab.setSpeed(1); window.__agentlab.play(); });
    for (let i = 0; i < Math.ceil(sd * 0.5 / 200); i++) await page.evaluate(() => window.__agentlab.step(200));
    await page.screenshot({ path: path.join(outDir, `${name}-stress-mid.png`) });
    r.stressAgents = await page.evaluate(() => Object.keys(window.__agentlab.state().agents).length);
    for (let i = 0; i < Math.ceil(sd * 0.55 / 200) + 10; i++) await page.evaluate(() => window.__agentlab.step(200));
    await page.screenshot({ path: path.join(outDir, `${name}-stress-end.png`) });
    r.errorsStress = errors.slice(0, 3);
    await page.close();
  } catch (e) { r.fatal = String(e); }
  console.log(JSON.stringify(r));
  results.push(r);
}
fs.writeFileSync(path.join(outDir, 'qa-results.json'), JSON.stringify(results, null, 2));
await browser.close(); await close();
