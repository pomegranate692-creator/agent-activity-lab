#!/usr/bin/env node
/*
 * capture.mjs  Record a REAL running prototype to mp4 + gif + poster png.
 *
 *   node tools/capture.mjs prototypes/00-template [--fps 15] [--w 1280] [--h 800]
 *        [--select code@9800,test@11800] [--speed 1] [--out previews] [--name 00-template]
 *
 * How it works: opens the prototype in headless Chrome with ?capture=1 (the shared chrome then waits
 * for us), steps the scenario clock deterministically (__agentlab.step), screenshots every frame, and
 * encodes with ffmpeg. The pixels are the actual page, not a mock-up.
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from '../shared/adapter-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const args = process.argv.slice(2);
const target = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
if (!target) { console.error('usage: node tools/capture.mjs prototypes/<dir> [--fps 15] [--w 1280] [--h 800] [--select id@ms,...]'); process.exit(1); }
const fps = Number(opt('fps', 15)), W = Number(opt('w', 1280)), H = Number(opt('h', 800)), speed = Number(opt('speed', 1));
const outDir = path.resolve(ROOT, opt('out', 'previews'));
const selects = (opt('select', '') || '').split(',').filter(Boolean).map((s) => { const [id, t] = s.split('@'); return { id, t: Number(t), done: false }; });
const tabs = (opt('tab', '') || '').split(',').filter(Boolean).map((s) => { const [label, t] = s.split('@'); return { label: label.replace(/_/g, ' '), t: Number(t), done: false }; }); // click a .ap-tab (unified app) by label at scene time
const rel = path.relative(ROOT, path.resolve(ROOT, target));
const name = opt('name', path.basename(rel));
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg'; } catch {}
  try { return execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim(); } catch {}
  throw new Error('ffmpeg not found. Install ffmpeg or `pip install imageio-ffmpeg`, or set FFMPEG=/path/to/ffmpeg');
}
const ffmpeg = findFfmpeg();
fs.mkdirSync(outDir, { recursive: true });
const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'agentlab-frames-'));
const { port, close } = await startServer({ port: 0, root: ROOT, quiet: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb'], defaultViewport: { width: W, height: H, deviceScaleFactor: 1 } });
let ok = false;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/${rel}/index.html?capture=1&autoplay=0`, { waitUntil: 'load' });
  await page.waitForFunction('window.__agentlab && window.__agentlab.player', { timeout: 15000 });
  const duration = await page.evaluate(() => window.__agentlab.player.duration);
  await page.evaluate((sp) => { window.__agentlab.setSpeed(sp); window.__agentlab.play(); }, speed);
  const dt = 1000 / fps; const total = Math.ceil(duration / speed / dt) + Math.round(fps * 1.5);
  console.log(`capturing ${name}: ${total} frames @ ${fps}fps (scenario ${(duration / 1000).toFixed(1)}s at ${speed}x)`);
  let posterAt = -1;
  for (let f = 0; f < total; f++) {
    const sceneT = await page.evaluate((d) => { window.__agentlab.step(d); return window.__agentlab.player.t; }, dt);
    for (const tb of tabs) if (!tb.done && sceneT >= tb.t) { tb.done = true; await page.evaluate((l) => { const el = [...document.querySelectorAll('.ap-tab')].find((x) => x.textContent === l); if (el) el.click(); }, tb.label); await page.evaluate((d) => window.__agentlab.step(d), 1); }
    for (const s of selects) if (!s.done && sceneT >= s.t) { s.done = true; await page.evaluate((id) => window.__agentlab.select(id), s.id); await page.evaluate((d) => window.__agentlab.step(d), 1); }
    await page.screenshot({ path: path.join(frames, `f${String(f).padStart(5, '0')}.png`), type: 'png' });
    if (posterAt < 0 && sceneT >= 12000) { posterAt = f; fs.copyFileSync(path.join(frames, `f${String(f).padStart(5, '0')}.png`), path.join(outDir, `${name}.png`)); }
  }
  if (errors.length) { console.error('PAGE ERRORS:\n' + errors.slice(0, 8).join('\n')); }
  const mp4 = path.join(outDir, `${name}.mp4`), gif = path.join(outDir, `${name}.gif`);
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(frames, 'f%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-movflags', '+faststart', mp4]);
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(frames, 'f%05d.png'), '-vf', `fps=10,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, gif]);
  console.log(`wrote ${path.relative(ROOT, mp4)} (${(fs.statSync(mp4).size / 1024).toFixed(0)} KB), ${path.relative(ROOT, gif)} (${(fs.statSync(gif).size / 1024).toFixed(0)} KB), ${name}.png`);
  ok = errors.length === 0;
} finally { await browser.close(); await close(); fs.rmSync(frames, { recursive: true, force: true }); }
process.exit(ok ? 0 : 2);
