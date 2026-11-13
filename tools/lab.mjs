#!/usr/bin/env node
/*
 * lab.mjs  Small control panel for the Agent Activity Lab background service.
 *
 *   node tools/lab.mjs status    is the service running, is the forwarder enabled, how much Claude Code activity has arrived
 *   node tools/lab.mjs start     start the service in the background (normally a Claude Code hook does this for you)
 *   node tools/lab.mjs stop      stop it
 *   node tools/lab.mjs open      open the dashboard window now
 *   node tools/lab.mjs disable   create ~/.agent-activity-lab/disabled: hooks forward nothing, nothing autostarts or opens
 *   node tools/lab.mjs enable    remove that file
 *   node tools/lab.mjs doctor    check every step: hooks in settings.json, node, service, forwarder log, dashboard windows
 *   node tools/lab.mjs record-output on|off   keep the FULL Claude output of dashboard runs for debugging (off by default; restart applies it)
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HOME, loadConfig, isDisabled, readToken, proof, buildStamp, setConfigValue } from '../shared/labconfig.mjs';
import { openCommand } from '../server/companion.mjs';

const cmd = process.argv[2] || 'status';
const cfg = loadConfig(HOME); const base = `http://127.0.0.1:${cfg.port}`;
const get = (p, token) => new Promise((resolve) => { const r = http.get(base + p, { timeout: 1500, headers: token ? { 'x-lab-token': token } : {} }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(b) }); } catch { resolve({ status: res.statusCode, json: null }); } }); }); r.on('error', () => resolve(null)); r.on('timeout', () => { r.destroy(); resolve(null); }); });
const running = async () => { const t = readToken(HOME); const h = await get('/api/hello'); return !!(h && h.json && t && h.json.proof === proof(t)); };
const pidFile = path.join(HOME, 'server.pid');

const recLine = () => console.log('  full Claude output recording: ' + (cfg.recordFullOutput ? 'ON (debug; dashboard runs save raw.jsonl locally)' : 'off (default)'));
if (cmd === 'record-output') {
  const v = process.argv[3];
  if (v !== 'on' && v !== 'off') { console.log('usage: node tools/lab.mjs record-output on|off'); process.exit(1); }
  setConfigValue('recordFullOutput', v === 'on', HOME);
  console.log(v === 'on' ? 'Full Claude output recording is ON for tasks run from the dashboard (raw.jsonl, stays on this Mac). Restart the service to apply: node tools/lab.mjs stop' : 'Full Claude output recording is off. Existing recordings were not touched. Restart the service to apply: node tools/lab.mjs stop');
  process.exit(0);
} else if (cmd === 'status') {
  recLine();
  const up = await running();
  console.log(`Forwarder:  ${isDisabled(HOME) ? 'DISABLED (file ' + path.join(HOME, 'disabled') + ' exists)' : 'enabled'}`);
  console.log(`Service:    ${up ? 'running at ' + base + '/app/index.html' : 'not running'}   (autostart ${cfg.autostart ? 'on' : 'off'}, open window ${cfg.openWindow ? 'on' : 'off'}, port ${cfg.port})`);
  if (up) { const s = await get('/api/status', readToken(HOME)); if (s && s.json) console.log(`Activity:   ${s.json.observer.received} hook events received, ${s.json.observer.tasks} tasks observed${s.json.observer.lastEventAt ? ', last ' + Math.round((Date.now() - s.json.observer.lastEventAt) / 1000) + ' s ago' : ''}; ${s.json.viewers} dashboard window(s) connected; ${s.json.running} running now`); }
} else if (cmd === 'start') {
  if (await running()) console.log('Already running: ' + base + '/app/index.html');
  else { fs.mkdirSync(HOME, { recursive: true, mode: 0o700 }); const fd = fs.openSync(path.join(HOME, 'server.log'), 'a', 0o600); const c = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'lab-server.mjs'), '--port', String(cfg.port)], { detached: true, stdio: ['ignore', fd, fd] }); c.unref(); for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 150)); if (await running()) { console.log('Started: ' + base + '/app/index.html'); process.exit(0); } } console.log('Did not come up in 4 s; see ' + path.join(HOME, 'server.log')); process.exit(1); }
} else if (cmd === 'stop') {
  if (!(await running())) { console.log('Not running.'); process.exit(0); }
  let pid = 0; try { pid = Number(fs.readFileSync(pidFile, 'utf8').trim()); } catch {}
  if (!pid) { console.log('No pid file; stop the process on port ' + cfg.port + ' yourself.'); process.exit(1); }
  process.kill(pid, 'SIGTERM'); console.log('Stopped (pid ' + pid + ').');
} else if (cmd === 'open') {
  const c = openCommand(base + '/app/index.html'); if (!c) { console.log('No way to open a window on this system.'); process.exit(1); }
  if (!(await running())) { console.log('The service is not running; run: node tools/lab.mjs start'); process.exit(1); }
  spawn(c[0], c.slice(1), { stdio: 'ignore', detached: true }).unref(); console.log('Opened ' + base + '/app/index.html');
} else if (cmd === 'disable') { fs.mkdirSync(HOME, { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(HOME, 'disabled'), 'Agent Activity Lab hooks are paused while this file exists. Delete it (or run: node tools/lab.mjs enable) to resume.\n'); console.log('Disabled. Hooks forward nothing until you run: node tools/lab.mjs enable');
} else if (cmd === 'enable') { try { fs.unlinkSync(path.join(HOME, 'disabled')); console.log('Enabled.'); } catch { console.log('Was not disabled.'); }
} else if (cmd === 'doctor') {
  let bad = 0; const line = (good, m, hint) => { if (!good) bad++; console.log((good ? '  ok    ' : '  FAIL  ') + m + (!good && hint ? '\n          -> ' + hint : '')); };
  const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Notification', 'SubagentStart', 'SubagentStop', 'Stop', 'SessionEnd'];
  console.log('1. Claude Code hooks (~/.claude/settings.json)');
  const sf = path.join(os.homedir(), '.claude', 'settings.json'); let st = null; try { st = JSON.parse(fs.readFileSync(sf, 'utf8')); } catch (e) { line(false, 'cannot read ' + sf + ': ' + e.message); }
  if (st) {
    const missing = []; const scripts = new Set();
    for (const ev of EVENTS) { const cmds = ((st.hooks || {})[ev] || []).flatMap((g) => (g.hooks || []).map((h) => String(h.command || ''))).filter((c) => /hook-forward\.mjs/.test(c)); if (!cmds.length) missing.push(ev); for (const c of cmds) { const m = c.match(/"([^"]*hook-forward\.mjs)"/) || c.match(/(\S*hook-forward\.mjs)/); if (m) scripts.add(m[1]); } }
    line(!missing.length, missing.length ? 'hooks missing for: ' + missing.join(', ') : 'all ' + EVENTS.length + ' hook events call the forwarder', 'node tools/hooks-install.mjs --scope user   (shows the change first)');
    for (const sc of scripts) { line(path.isAbsolute(sc), 'forwarder path is absolute (works from any directory): ' + sc, 'reinstall the hooks'); line(fs.existsSync(sc), 'forwarder file exists', 'the project moved? reinstall the hooks'); }
    line(st.disableAllHooks !== true, 'hooks are not switched off in settings (disableAllHooks)');
  }
  console.log('2. node (hooks run `node <forwarder>` through your shell)');
  try { const n = execFileSync('/bin/sh', ['-c', 'command -v node && node --version'], { encoding: 'utf8', timeout: 5000 }).trim().split('\n'); line(true, 'node found: ' + n.join('  ')); } catch { line(false, 'node is not on PATH for a plain /bin/sh', 'Claude Code launched without your shell profile (nvm) cannot run the hook; start it from a Terminal, or reinstall the hooks after installing node system-wide'); }
  console.log('3. Forwarder and switches');
  line(!isDisabled(HOME), isDisabled(HOME) ? 'DISABLED by ' + path.join(HOME, 'disabled') : 'forwarder enabled', 'node tools/lab.mjs enable');
  line(!!readToken(HOME), 'token file present', 'it is created when the service first starts');
  const fl = path.join(HOME, 'forwarder.log'); let ft = ''; try { ft = fs.readFileSync(fl, 'utf8').trim().split('\n').slice(-5).join('\n          '); } catch {}
  console.log(ft ? '  note  forwarder problems (last lines of forwarder.log):\n          ' + ft : '  ok    forwarder.log has no problems recorded');
  console.log('4. Service');
  const up = await running(); line(up, up ? 'service answers at ' + base : 'service is not running on port ' + cfg.port, 'it starts by itself at the next prompt, or: node tools/lab.mjs start');
  if (up) {
    const sj = (await get('/api/status', readToken(HOME))).json || {};
    const o = sj.observer || {}; console.log('  info  ' + (o.received || 0) + ' hook events received, ' + (o.tasks || 0) + ' tasks observed' + (o.lastEventAt ? ', last ' + Math.round((Date.now() - o.lastEventAt) / 1000) + ' s ago' : ''));
    const disk = buildStamp(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
    line(!sj.build || sj.build === disk, sj.build === disk ? 'the running service has the current code (' + disk + ')' : 'the running service was started with OLDER code (' + sj.build + ', files are now ' + disk + ')', 'node tools/lab.mjs stop   (it starts again by itself at your next prompt)');
    console.log('  info  dashboard pages connected right now: ' + sj.viewers + ' (' + sj.visibleViewers + ' visible, ' + (sj.viewers - sj.visibleViewers) + ' hidden); windows opened by the service since it started: ' + sj.windowsOpened);
    for (const pg of sj.pages || []) console.log('          - ' + (pg.id || 'old page') + ': ' + (pg.browser || '?') + ', ' + (pg.visible ? (pg.focused ? 'visible and focused' : 'visible') : 'hidden') + ', connected ' + Math.round((Date.now() - pg.since) / 1000) + ' s ago' + (pg.build && pg.build !== sj.build ? ', OLD page code (it reloads itself)' : ''));
    if (!sj.viewers) console.log('          (none. A page that is open but not listed here shows "NOT connected" in its top bar. A dashboard opens by itself at your next task.)');
    if (sj.viewers > 2) console.log('  note  ' + sj.viewers + ' dashboard pages are open. Browsers allow 6 connections per site; close the extras.');
    if (sj.pageErrors) console.log('  note  ' + sj.pageErrors + ' script error(s) reported by dashboard pages: grep page-error ' + path.join(HOME, 'server.log'));
  }
  console.log('5. Where you see it');
  const modDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mod', 'agent-activity-lab');
  line(fs.existsSync(path.join(modDir, 'hooks', 'register.tsx')), 'pane for the Claude app is in ' + modDir + ' (shows the web beside the chat once the mod is turned on in Claude Code)', 'the mod folder is missing');
  console.log('  info  separate browser window on each first task: ' + (cfg.openWindow ? 'ON' : 'off') + '   (' + (cfg.openWindow ? 'turn off' : 'turn on') + ': set "openWindow": ' + (cfg.openWindow ? 'false' : 'true') + ' in ' + path.join(HOME, 'config.json') + ')');
  console.log('  info  open the full dashboard yourself at any time: node tools/lab.mjs open');
  console.log('  info  full Claude output recording: ' + (cfg.recordFullOutput ? 'ON (debug; turn off: node tools/lab.mjs record-output off)' : 'off (default)'));
  console.log(bad ? '\n' + bad + ' problem(s) found.' : '\nAll checks passed.'); process.exit(bad ? 1 : 0);
} else { console.log('usage: node tools/lab.mjs status|start|stop|open|disable|enable|doctor|record-output on|off'); process.exit(1); }
