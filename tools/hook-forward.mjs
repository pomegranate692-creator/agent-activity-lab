#!/usr/bin/env node
/*
 * hook-forward.mjs  Claude Code hook command: forwards each hook payload (stdin JSON) to the local Agent Activity Lab service.
 *
 *   node tools/hook-forward.mjs [--url http://127.0.0.1:47821] [--log /path/raw.jsonl] [--no-autostart]
 *
 * What it does, in order:
 *   1. Does nothing at all if ~/.agent-activity-lab/disabled exists (the off switch).
 *   2. Shrinks the payload: tool outputs and file contents are dropped, long strings cut. Only what the dashboard draws is sent.
 *   3. Asks the service who it is (GET /api/hello) and only sends the secret token (read from ~/.agent-activity-lab/token) to a
 *      listener that proves it knows that token. Another program on the port never receives the token or your prompts.
 *   4. If nothing is listening and this is SessionStart or UserPromptSubmit, starts the service in the background (unless
 *      autostart is off in config.json or --no-autostart) so you never run a server by hand.
 *
 * Safety: prints NOTHING and always exits 0, so it can never block, approve, deny or alter a Claude Code action (hook stdout and
 * exit codes are how hooks influence Claude Code). Gives up after about 2 s (4 s when it had to start the service).
 * --log additionally appends the RAW payload to a local file (off by default; payloads can contain prompts and file contents).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HOME, loadConfig, isDisabled, readToken, proof } from '../shared/labconfig.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const done = () => process.exit(0);
setTimeout(done, 5000).unref();
process.on('uncaughtException', done);

if (isDisabled(HOME)) { process.stdin.resume(); process.stdin.on('data', () => {}); process.stdin.on('end', done); process.stdin.on('error', done); }
else {
  const cfg = loadConfig(HOME);
  const base = new URL(opt('url', process.env.AGENT_LAB_URL || `http://127.0.0.1:${cfg.port}`));
  const logFile = opt('log', process.env.AGENT_LAB_LOG || '');
  let body = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { if (body.length < 12_000_000) body += d; });
  process.stdin.on('error', done);
  process.stdin.on('end', () => run().then(done, done));

  /* ---- shrink a payload to what the dashboard needs ---- */
  const cutStr = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
  const BULK = new Set(['content', 'new_string', 'old_string', 'new_source', 'edits']);
  function slimInput(v, depth = 0) {
    if (typeof v === 'string') return cutStr(v, 1200);
    if (Array.isArray(v)) return depth > 2 ? [] : v.slice(0, 20).map((x) => slimInput(x, depth + 1));
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = BULK.has(k) ? '[omitted ' + (typeof x === 'string' ? x.length + ' chars' : 'content') + ']' : slimInput(x, depth + 1); return o; }
    return v;
  }
  function slim(p) {
    const o = { ...p };
    if ('tool_input' in o) o.tool_input = slimInput(o.tool_input);
    if ('tool_response' in o) { const r = o.tool_response; o.tool_response = r && typeof r === 'object' ? { ...(r.is_error ? { is_error: true } : {}), ...(r.error ? { error: cutStr(String(r.error), 300) } : {}) } : {}; }
    for (const k of ['prompt', 'last_assistant_message', 'message', 'error']) if (typeof o[k] === 'string') o[k] = cutStr(o[k], k === 'last_assistant_message' ? 20000 : 4000);
    return o;
  }

  /* ---- tiny http helpers ---- */
  const call = (method, p, token, payload, timeout = 1500) => new Promise((resolve) => {
    const data = payload == null ? null : Buffer.from(JSON.stringify(payload));
    const req = http.request({ hostname: base.hostname, port: base.port, path: p, method, timeout, headers: { ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}), ...(token ? { 'x-lab-token': token } : {}) } }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (d) => { if (b.length < 20000) b += d; }); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, json: j }); });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); }); req.on('error', () => resolve(null)); req.end(data || undefined);
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /* problems only (never payload contents): ~/.agent-activity-lab/forwarder.log, read by `node tools/lab.mjs doctor` */
  const note = (m) => { try { const f = path.join(HOME, 'forwarder.log'); fs.mkdirSync(HOME, { recursive: true, mode: 0o700 }); try { if (fs.statSync(f).size > 100000) fs.truncateSync(f, 0); } catch {} fs.appendFileSync(f, new Date().toISOString() + ' ' + String(m).slice(0, 300) + '\n', { mode: 0o600 }); } catch {} };
  async function hello(token) { const r = await call('GET', '/api/hello', null, null, 700); return !!(r && r.status === 200 && r.json && r.json.lab === 'agent-activity-lab' && token && r.json.proof === proof(token)); }

  function startService() {
    const server = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'lab-server.mjs');
    try {
      fs.mkdirSync(HOME, { recursive: true, mode: 0o700 }); const logPath = path.join(HOME, 'server.log');
      try { if (fs.statSync(logPath).size > 1_000_000) fs.truncateSync(logPath, 0); } catch {}
      const fd = fs.openSync(logPath, 'a', 0o600);
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_PROJECT_DIR|CLAUDE_ENV_FILE)/i.test(k))); // do not leak this Claude Code session's env into the service's own claude runs
      const c = spawn(process.execPath, [server, '--port', String(base.port), '--autostarted'], { detached: true, stdio: ['ignore', fd, fd], env });
      c.on('error', () => {}); c.unref(); return true;
    } catch { return false; }
  }

  async function run() {
    if (!body.trim()) return;
    let payload; try { payload = JSON.parse(body); } catch { return; }
    if (logFile) { try { fs.appendFileSync(logFile, body.replace(/\n/g, ' ').trim() + '\n'); } catch {} }
    const ev = payload && payload.hook_event_name;
    let token = readToken(HOME);
    if (!(await hello(token))) {
      // nothing (trustworthy) is listening
      const canStart = !args.includes('--no-autostart') && cfg.autostart && process.env.AGENT_LAB_AUTOSTART !== '0' && ['SessionStart', 'UserPromptSubmit'].includes(ev);
      if (!canStart) { if (!cfg.autostart || args.includes('--no-autostart')) note(ev + ': no dashboard service is listening and autostart is off'); return; }
      if (!startService()) { note(ev + ': could not start the service'); return; }
      if (ev === 'SessionStart') return; // the service opens the dashboard itself when it was started by a hook; nothing to draw for SessionStart anyway
      for (let i = 0; i < 24; i++) { await sleep(150); token = readToken(HOME); if (await hello(token)) break; if (i === 23) { note(ev + ': started the service but it did not answer within 3.6 s; this prompt was not delivered'); return; } }
    }
    const r = await call('POST', '/api/hook', token, slim(payload), 2500);
    if (!r || r.status !== 200) note(ev + ': delivery failed (' + (r ? 'HTTP ' + r.status : 'no answer') + ')');
  }
}
