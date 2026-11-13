/*
 * labconfig.mjs  Settings shared by the local service, the hook forwarder and the lab CLI. Dependency-free.
 *
 * Everything lives in ~/.agent-activity-lab (override with AGENT_LAB_HOME):
 *   config.json   optional, e.g. {"port": 47821, "autostart": true, "openWindow": true, "staleMinutes": 30, "recordFullOutput": false}
 *                 recordFullOutput (default OFF): also keep the full Claude Code output stream (raw.jsonl: prompts, file contents,
 *                 tool output) of tasks the dashboard runs, for debugging. Turn on with `node tools/lab.mjs record-output on`
 *                 or AGENT_LAB_RECORD_FULL_OUTPUT=1. Activity metadata (events.jsonl, meta.json) is always kept; History needs only that.
 *   token         secret for the local API (0600), created by the service
 *   disabled      if this file exists the hook forwarder does NOTHING (no forwarding, no autostart, no window)
 *   server.pid    pid of the running service (written by the service, used by `node tools/lab.mjs stop`)
 *   server.log    output of an auto-started service
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const HOME = process.env.AGENT_LAB_HOME || path.join(os.homedir(), '.agent-activity-lab');
export const DEFAULTS = Object.freeze({ port: 47821, autostart: true, openWindow: true, staleMinutes: 30, recordFullOutput: false });

export function loadConfig(home = HOME) {
  const cfg = { ...DEFAULTS };
  try {
    const j = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
    if (Number.isInteger(j.port) && j.port >= 1024 && j.port < 65536) cfg.port = j.port;
    if (typeof j.autostart === 'boolean') cfg.autostart = j.autostart;
    if (typeof j.openWindow === 'boolean') cfg.openWindow = j.openWindow;
    if (Number.isFinite(j.staleMinutes) && j.staleMinutes >= 1) cfg.staleMinutes = j.staleMinutes;
    if (typeof j.recordFullOutput === 'boolean') cfg.recordFullOutput = j.recordFullOutput;
  } catch {}
  if (process.env.AGENT_LAB_RECORD_FULL_OUTPUT === '1') cfg.recordFullOutput = true;
  return cfg;
}
/** Change one setting in config.json, keeping every other key (file 0600, folder 0700). */
export function setConfigValue(key, value, home = HOME) {
  let j = {}; try { j = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')); } catch {}
  j[key] = value; fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const f = path.join(home, 'config.json'); fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n', { mode: 0o600 }); fs.chmodSync(f, 0o600);
}
/** A stamp of the code on disk (dashboard page + service). The service reports the stamp it STARTED with; a page reloads itself when
 *  the service's stamp differs from the one it was loaded with, and `lab.mjs doctor` compares the running service against the files. */
export function buildStamp(root) {
  const h = crypto.createHash('sha256');
  for (const dir of ['app', 'app/cards', 'shared', 'server']) {
    let names = []; try { names = fs.readdirSync(path.join(root, dir)).filter((n) => /\.(js|mjs|css|html)$/.test(n) && !/^test-/.test(n)).sort(); } catch {}
    for (const n of names) { try { const st = fs.statSync(path.join(root, dir, n)); h.update(dir + '/' + n + ':' + st.size + ':' + Math.round(st.mtimeMs) + ';'); } catch {} }
  }
  return h.digest('hex').slice(0, 12);
}
export const isDisabled = (home = HOME) => fs.existsSync(path.join(home, 'disabled'));
export function readToken(home = HOME) { try { const t = fs.readFileSync(path.join(home, 'token'), 'utf8').trim(); return /^[0-9a-f]{64}$/.test(t) ? t : null; } catch { return null; } }
/** Proof that a listener knows the token without revealing it: the hook forwarder only sends the token to a service that can compute this. */
export const proof = (token) => crypto.createHmac('sha256', token).update('agent-activity-lab hello').digest('hex');
