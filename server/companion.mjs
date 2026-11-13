/*
 * companion.mjs  Opens the dashboard in its own window when Claude Code activity arrives and no dashboard is open.
 *
 * The rule, kept deliberately simple:
 *   - The FIRST task of each Claude Code session brings the dashboard to the front (a new window; older dashboard pages close themselves),
 *     unless a dashboard page has keyboard focus at that moment (you are already looking at it).
 *   - Later tasks of the same session open a window only if no dashboard page is connected at all (you closed it).
 *   - At most one window per 30 s. Nothing opens when Claude Code merely starts: only when you submit a task.
 * "Connected" = the page holds the live feed connection (/s/<token>/feed); pages report visibility and focus themselves. Turn it off with {"openWindow": false} in ~/.agent-activity-lab/config.json or by creating the `disabled` file.
 *
 * macOS: a dedicated app-style Chrome window (no tabs, no address bar):  open -na "Google Chrome" --args --app=<url>
 * (-n matters: without it `open` ignores --args when Chrome is already running). Without Chrome it opens your default browser.
 * Tests and other setups can set AGENT_LAB_OPEN_CMD to a JSON array, e.g. ["/path/to/script","{url}"].
 */
import fs from 'node:fs';
import { spawn } from 'node:child_process';

export function openCommand(url, { platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  if (env.AGENT_LAB_OPEN_CMD) { try { const a = JSON.parse(env.AGENT_LAB_OPEN_CMD); if (Array.isArray(a) && a.length && a.every((x) => typeof x === 'string')) return a.map((x) => x.replace('{url}', url)); } catch {} return null; }
  if (platform === 'darwin') return exists('/Applications/Google Chrome.app') ? ['open', '-na', 'Google Chrome', '--args', '--app=' + url, '--window-size=1320,880'] : ['open', url];
  if (platform === 'linux') return ['xdg-open', url];
  return null;
}

export function createCompanion({ url, getConfig, viewerCount, totalCount = () => 0, focusedCount = () => 0, now = Date.now, debounceMs = 30000, settleMs = Number(process.env.AGENT_LAB_OPEN_SETTLE_MS ?? 4000), spawnFn = spawn, log = () => {} } = {}) {
  let last = -Infinity; let opened = 0; const bootAt = now(); let pending = null; const seen = new Set();
  const open = () => {
    const cmd = openCommand(typeof url === 'function' ? url() : url); if (!cmd) { log('no way to open a window on this system'); return false; }
    try { const c = spawnFn(cmd[0], cmd.slice(1), { stdio: 'ignore', detached: true }); c.on && c.on('error', (e) => log('open failed: ' + e.message)); c.unref && c.unref(); opened++; return true; } catch (e) { log('open failed: ' + e.message); return false; }
  };
  return {
    /** Called when Claude Code activity arrives. Returns true if a window was opened. */
    activity(kind, key) {
      if (!getConfig().openWindow) return false;
      if (now() - bootAt < settleMs) { // just (re)started: a dashboard window that was already open needs a moment to reconnect before we decide none exists
        if (!pending) { pending = setTimeout(() => { pending = null; this.activity(kind, key); }, settleMs - (now() - bootAt) + 50); pending.unref && pending.unref(); }
        return false;
      }
      const first = !!key && !seen.has(key); // the first task of this Claude Code session
      if (focusedCount() > 0) { if (key) seen.add(key); return false; } // the person is looking at a dashboard right now
      if (!first && totalCount() > 0) return false; // this session already brought the dashboard up; a window that is still open (even hidden) is left alone
      if (now() - last < debounceMs) return false;
      if (key) seen.add(key); last = now(); log('opening the dashboard window (' + kind + (totalCount() > 0 ? '; ' + totalCount() + ' older dashboard page(s) will be replaced' : '') + ')'); return open();
    },
    open, count: () => opened, recentlyOpened: (ms = 20000) => now() - last < ms, lastOpenAt: () => last, reset() { last = -Infinity; seen.clear(); },
  };
}
