#!/usr/bin/env node
/*
 * hooks-install.mjs  Add (or remove) the Agent Activity Lab hooks in a Claude Code settings file.
 *
 *   node tools/hooks-install.mjs                       # DRY RUN: shows exactly what would change. Writes nothing.
 *   node tools/hooks-install.mjs --apply               # writes the change (a timestamped .bak copy is made first)
 *   node tools/hooks-install.mjs --remove --apply      # removes only the entries this tool added
 *
 * Options:
 *   --scope user|project|local   user = ~/.claude/settings.json (every session)   [default: project]
 *                                project = <cwd>/.claude/settings.json, local = <cwd>/.claude/settings.local.json
 *   --file <path>                explicit settings file (overrides --scope)
 *   --url <url>                  adapter URL (default http://127.0.0.1:7777)
 *   --log <file>                 also keep a raw local copy of every payload (for tools/hook-coverage.mjs)
 *
 * Existing hooks are preserved. Our entries are recognised by "hook-forward.mjs" in the command, so re-running is
 * idempotent. This tool never runs unless YOU run it; the project does not modify your settings on its own.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const here = path.dirname(fileURLToPath(import.meta.url));
const forward = path.join(here, 'hook-forward.mjs');
const scope = opt('scope', 'project');
const file = opt('file', scope === 'user' ? path.join(os.homedir(), '.claude', 'settings.json') : path.join(process.cwd(), '.claude', scope === 'local' ? 'settings.local.json' : 'settings.json'));
const MARK = 'hook-forward.mjs';
const q = (s) => `"${s.replace(/"/g, '\\"')}"`;
const cmd = `node ${q(forward)}${opt('url') ? ' --url ' + q(opt('url')) : ''}${opt('log') ? ' --log ' + q(path.resolve(opt('log'))) : ''}`;
// event names confirmed present in Claude Code 2.1.263's binary; tool events take a matcher
const EVENTS = { SessionStart: 0, UserPromptSubmit: 0, PreToolUse: 1, PostToolUse: 1, PostToolUseFailure: 1, PermissionRequest: 1, Notification: 0, SubagentStart: 0, SubagentStop: 0, Stop: 0, SessionEnd: 0 };

let cur = {}; let existed = fs.existsSync(file);
if (existed) { try { cur = JSON.parse(fs.readFileSync(file, 'utf8') || '{}'); } catch (e) { console.error(`Cannot parse ${file}: ${e.message}\nFix or move it, nothing was changed.`); process.exit(1); } }
const next = JSON.parse(JSON.stringify(cur)); next.hooks = next.hooks || {};
const ours = (g) => (g.hooks || []).some((h) => typeof h.command === 'string' && h.command.includes(MARK));
let added = 0, removed = 0;
for (const [ev, tool] of Object.entries(EVENTS)) {
  const groups = (next.hooks[ev] || []).filter((g) => { if (ours(g)) { removed++; return false; } return true; });
  if (!flag('remove')) { groups.push({ ...(tool ? { matcher: '*' } : {}), hooks: [{ type: 'command', command: cmd }] }); added++; }
  if (groups.length) next.hooks[ev] = groups; else delete next.hooks[ev];
}
if (!Object.keys(next.hooks).length) delete next.hooks;

const before = JSON.stringify(cur, null, 2), after = JSON.stringify(next, null, 2);
console.log(`Settings file: ${file}${existed ? '' : '  (does not exist yet; would be created)'}`);
console.log(flag('remove') ? `Would remove ${removed} Agent Activity Lab hook entr${removed === 1 ? 'y' : 'ies'}.` : `Would set ${added} hook entries (replacing any earlier Agent Activity Lab entries). Command:\n  ${cmd}`);
if (before === after) { console.log('No change needed.'); process.exit(0); }
if (!flag('apply')) { console.log('\nDRY RUN. Nothing written. Resulting "hooks" block:\n' + JSON.stringify(next.hooks || {}, null, 2) + '\n\nRe-run with --apply to write it.'); process.exit(0); }
fs.mkdirSync(path.dirname(file), { recursive: true });
if (existed) fs.copyFileSync(file, `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.writeFileSync(file, after + '\n');
console.log(`Written. ${existed ? 'Backup saved next to it.' : ''}\nStart a NEW Claude Code session (hooks load at session start), run: node shared/adapter-server.mjs , then open app/index.html?live=http://127.0.0.1:7777`);
