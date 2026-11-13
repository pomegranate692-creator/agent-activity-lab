/*
 * sessions.mjs  Runs REAL Claude Code tasks as sessions and records them.
 *
 * A session = one `claude -p --output-format stream-json --verbose` process, started in its own empty workspace folder under the
 * approved workspace root, with the prompt sent on stdin (never on a shell command line; the process is started with an argument
 * array, no shell). Its stdout is mapped to dashboard events (stream-mapper.mjs), saved to disk and streamed to subscribers.
 *
 * Nothing here simulates success. If Claude Code is missing, not signed in, crashes or is stopped, the session says so.
 * The only way to run something else is AGENT_LAB_CLAUDE_BIN (used by the tests with a stub); such sessions are labelled
 * engine "test-stub" everywhere (badge: TEST STUB · NOT CLAUDE).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { createStreamMapper } from './stream-mapper.mjs';
import { Observer } from './observer.mjs';
import { loadConfig } from '../shared/labconfig.mjs';

export const HOME = process.env.AGENT_LAB_HOME || path.join(os.homedir(), '.agent-activity-lab');

export const POLICIES = {
  readonly: { label: 'Read only', allow: ['Read', 'Glob', 'Grep'], text: 'Claude Code may read and search files in its workspace. It cannot write files or run commands.' },
  workspace: {
    label: 'Workspace (read, write, run Python)', text: 'Claude Code may read, write and edit files in its own workspace folder, run Python and a few read-only shell commands, and use subagents. Python can run arbitrary code with your user permissions, so only run tasks you trust. Everything else (network, other commands, files outside the workspace) is denied and shown as blocked.',
    allow: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'MultiEdit', 'Task', 'Agent', 'Bash(python3:*)', 'Bash(python:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(wc:*)', 'Bash(sort:*)', 'Bash(mkdir:*)', 'Bash(pwd)', 'Bash(echo:*)', 'Bash(diff:*)'],
  },
};
const ALWAYS_DENY = ['Bash(rm:*)', 'Bash(sudo:*)', 'Bash(curl:*)', 'Bash(wget:*)', 'Bash(git push:*)', 'Bash(ssh:*)'];
const SYSTEM_NOTE = 'You are running inside Agent Activity Lab. Work only in the current directory (an empty workspace made for this task); put every file you create there. Use subagents only when the task has clearly independent parts. If an action is denied, say what you could not do instead of working around it.';

const j = (o) => JSON.stringify(o);
const cut = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));
const safeId = (id) => /^[0-9a-f-]{36}$/.test(String(id));

export class SessionManager {
  constructor(opts = {}) {
    this.home = opts.home || HOME;
    this.cfg = Object.assign({ workspaceRoot: path.join(this.home, 'workspaces'), claudeBin: process.env.AGENT_LAB_CLAUDE_BIN || 'claude', maxBudgetUsd: 2, timeoutMs: 15 * 60 * 1000, model: null }, opts.config || {});
    this.engine = process.env.AGENT_LAB_CLAUDE_BIN || opts.claudeBin ? 'test-stub' : 'claude-code';
    if (opts.claudeBin) this.cfg.claudeBin = opts.claudeBin;
    // Full Claude output (raw.jsonl) is OFF unless asked for: opts, config.json "recordFullOutput", or AGENT_LAB_RECORD_FULL_OUTPUT=1.
    this.recordFullOutput = typeof opts.recordFullOutput === 'boolean' ? opts.recordFullOutput : loadConfig(this.home).recordFullOutput;
    this.sessDir = path.join(this.home, 'sessions');
    fs.mkdirSync(this.sessDir, { recursive: true, mode: 0o700 }); fs.mkdirSync(this.cfg.workspaceRoot, { recursive: true, mode: 0o700 });
    this.active = new Map(); // id -> live session object (tasks THIS service runs)
    this.watch = new Map();  // id -> live record of a task OBSERVED through Claude Code hooks (see observer.mjs)
    this.feedFns = new Set();
    this.observer = new Observer(this, { staleMs: (opts.staleMinutes || 30) * 60 * 1000 });
    this.observer.recover();
  }
  /* ---------- feed: the dashboard hears about new / changed sessions without polling ---------- */
  onFeed(fn) { this.feedFns.add(fn); return () => this.feedFns.delete(fn); }
  notifyFeed(meta) { for (const fn of this.feedFns) { try { fn(meta); } catch {} } }
  isOwnWorkspace(cwd) { try { const r = fs.realpathSync(this.cfg.workspaceRoot); const c = fs.realpathSync(cwd); return c === r || c.startsWith(r + path.sep); } catch { return false; } }
  /** Files an observed task wrote (from its Write/Edit tool calls) that still exist. Nothing else in the project folder is exposed. */
  observedFiles(m) {
    const out = [];
    for (const name of [...new Set(m.outputs || [])]) { const f = path.resolve(m.workspace || '/', name); try { const st = fs.statSync(f); if (st.isFile()) out.push({ path: name, size: st.size, mtime: Math.round(st.mtimeMs) }); } catch {} }
    return out;
  }

  /* ---------- environment probe ---------- */
  probe() {
    const run = (args) => new Promise((resolve) => execFile(this.cfg.claudeBin, args, { timeout: 8000 }, (err, out) => resolve({ err, out: String(out || '') })));
    return Promise.all([run(['--version']), run(['auth', 'status'])]).then(([v, a]) => {
      if (v.err && v.err.code === 'ENOENT') return { found: false, version: null, loggedIn: false, detail: `Claude Code CLI "${this.cfg.claudeBin}" was not found on PATH.` };
      let loggedIn = false, method = null; try { const o = JSON.parse(a.out); loggedIn = !!o.loggedIn; method = o.authMethod || null; } catch {}
      return { found: true, version: v.out.trim() || null, loggedIn, authMethod: method, detail: loggedIn ? 'Signed in.' : 'Claude Code is not signed in. Run `claude auth login` in a terminal, then try again.' };
    });
  }

  /* ---------- queries ---------- */
  list() {
    return fs.readdirSync(this.sessDir).filter(safeId).map((id) => this.meta(id)).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
  }
  meta(id) { if (!safeId(id)) return null; if (this.active.has(id)) return this.active.get(id).meta; if (this.watch.has(id)) return this.watch.get(id).meta; try { return JSON.parse(fs.readFileSync(path.join(this.sessDir, id, 'meta.json'), 'utf8')); } catch { return null; } }
  events(id) {
    if (!safeId(id)) return null; if (this.active.has(id)) return this.active.get(id).events.slice(); if (this.watch.has(id)) return this.watch.get(id).events.slice();
    try { return fs.readFileSync(path.join(this.sessDir, id, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return null; }
  }
  files(id) { const m = this.meta(id); if (!m) return null; return m.origin === 'observed' ? this.observedFiles(m) : this.scan(m.workspace); }
  readFile(id, rel) {
    const m = this.meta(id); if (!m) return null;
    if (m.origin === 'observed') { // only files this task wrote, by recorded name
      const rec = new Set(m.outputs || []); const name = String(rel); if (!rec.has(name)) return null; let f; try { f = fs.realpathSync(path.resolve(m.workspace || '/', name)); const st = fs.statSync(f); if (!st.isFile()) return null; if (st.size > 2 * 1024 * 1024) return { tooLarge: true, size: st.size, name: path.basename(f) }; return { name: path.basename(f), size: st.size, data: fs.readFileSync(f) }; } catch { return null; }
    }
    const root = fs.realpathSync(m.workspace); let f;
    try { f = fs.realpathSync(path.resolve(root, String(rel))); } catch { return null; }
    if (!(f === root || f.startsWith(root + path.sep))) return null; const st = fs.statSync(f); if (!st.isFile()) return null;
    if (st.size > 2 * 1024 * 1024) return { tooLarge: true, size: st.size, name: path.basename(f) };
    return { name: path.basename(f), size: st.size, data: fs.readFileSync(f) };
  }
  scan(ws) {
    const out = []; const root = ws;
    (function walk(dir, depth) { if (depth > 6 || out.length >= 500) return; let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) { if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '__pycache__') continue; const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, depth + 1); else if (e.isFile()) { let st; try { st = fs.statSync(p); } catch { continue; } out.push({ path: path.relative(root, p), size: st.size, mtime: Math.round(st.mtimeMs) }); } } })(root, 0);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }
  subscribe(id, fn) {
    const s = this.active.get(id) || this.watch.get(id); if (!s) return null; s.subs.add(fn); return () => s.subs.delete(fn);
  }
  running() { return [...this.active.values()].filter((s) => s.meta.status === 'running').map((s) => s.meta); }
  runningAll() { return [...this.active.values(), ...this.watch.values()].map((s) => s.meta).filter((m) => m.status === 'running'); }

  /* ---------- follow-ups: per-agent retry and approval, by continuing the same conversation ---------- */
  agentStates(events) {
    const A = {};
    for (const e of events) {
      if (e.type === 'agent_spawned') A[e.agentId] = { id: e.agentId, name: e.name, role: e.role, state: 'queued', why: null };
      else if (A[e.agentId]) { const a = A[e.agentId];
        if (e.type === 'agent_started' || e.type === 'tool_called' || e.type === 'agent_unblocked' || e.type === 'agent_retry') { a.state = 'working'; a.why = null; }
        else if (e.type === 'agent_failed') { a.state = 'failed'; a.why = e.error; }
        else if (e.type === 'agent_blocked') { a.state = 'blocked'; a.why = e.reason; }
        else if (e.type === 'agent_completed') a.state = 'done'; }
    }
    return A;
  }
  followUp(parentId, { kind, agentId = null, rules = [] } = {}) {
    const parent = this.meta(parentId); if (!parent) throw Object.assign(new Error('No such session.'), { status: 404 });
    if (parent.origin === 'observed') throw Object.assign(new Error('This task was observed from your own Claude Code session. The dashboard does not control it; continue it in Claude Code.'), { status: 409 });
    const bad = (m, st = 400, code) => Object.assign(new Error(m), { status: st, code });
    if (parent.status === 'running') throw bad('The session is still running. Headless Claude Code cannot be changed mid-run; stop it or wait for it to finish.', 409);
    if (!parent.claudeSessionId) throw bad('This session has no Claude Code conversation id (it was recorded before the run produced one), so it cannot be continued. Use Retry to start a new run.', 409, 'no_session_id');
    if (!fs.existsSync(parent.workspace)) throw bad('The workspace of this session no longer exists.', 409);
    if (parent.engine !== this.engine) throw bad('This session was run by a different engine and cannot be continued here.', 409);
    const A = this.agentStates(this.events(parentId) || []);
    if (kind === 'retry-agent') {
      const a = A[agentId]; if (!a) throw bad('That agent is not part of the session.', 404);
      if (a.state !== 'failed') throw bad(`Only a failed agent can be retried; ${a.name} is ${a.state}.`);
      const why = String(a.why || 'an error').replace(/[\r\n]+/g, ' ').slice(0, 300);
      const prompt = `Part of the previous work did not succeed. The agent "${a.name}"${a.role ? ' (' + a.role + ')' : ''} failed with: "${why}". Redo only that part now, reusing everything that already succeeded, then make sure the overall task is complete.`;
      return this.create({ prompt, policy: parent.policy, resumeOf: parentId, followUp: { kind, agentId, agentName: a.name }, retryOf: parentId });
    }
    if (kind === 'approve') {
      if (!rules.length) throw bad('Choose at least one denied action to approve.');
      const denied = new Set((parent.denials || []).map((d) => d.rule)); const useRules = [];
      for (const r of rules.slice(0, 5)) { if (!denied.has(r)) throw bad(`"${r}" was not denied in this session, so it cannot be approved.`); useRules.push(r); }
      const prompt = `You were previously denied permission for: ${useRules.join(', ')}. Permission for exactly these is now granted. Retry only the denied action(s) and finish anything that depended on them, then make sure the overall task is complete.`;
      return this.create({ prompt, policy: parent.policy, resumeOf: parentId, followUp: { kind, rules: useRules }, extraAllow: useRules, retryOf: parentId });
    }
    throw bad('Unknown follow-up kind.');
  }

  /* ---------- create / run ---------- */
  create({ prompt, policy = 'workspace', retryOf = null, approve = [], resumeOf = null, followUp = null, extraAllow = [] } = {}) {
    prompt = typeof prompt === 'string' ? prompt.trim() : '';
    if (prompt.length < 3) throw Object.assign(new Error('The task is empty. Describe what you want done.'), { status: 400 });
    if (prompt.length > 8000) throw Object.assign(new Error('The task is longer than 8000 characters.'), { status: 400 });
    const pol = POLICIES[policy]; if (!pol) throw Object.assign(new Error('Unknown policy.'), { status: 400 });
    if (this.running().length) throw Object.assign(new Error('A task is already running. Stop it or wait for it to finish (one task at a time in this version).'), { status: 409 });
    let extra = [];
    if (approve.length) { // "approve and retry": only rules derived from the denials of the session being retried
      const prev = retryOf && this.meta(retryOf); const ok = new Set(prev ? (prev.denials || []).map((d) => d.rule) : []);
      for (const r of approve) { if (!ok.has(r)) throw Object.assign(new Error(`"${r}" was not denied in the session being retried, so it cannot be approved.`), { status: 400 }); extra.push(r); }
    }
    let resumeId = null; let parent = null; if (resumeOf) { parent = this.meta(resumeOf); resumeId = parent && parent.claudeSessionId; extra = extra.concat(extraAllow); }
    const id = crypto.randomUUID(); const dir = path.join(this.sessDir, id); const ws = parent ? parent.workspace : path.join(this.cfg.workspaceRoot, id);
    const rootReal = fs.realpathSync(this.cfg.workspaceRoot); fs.mkdirSync(ws, { recursive: true, mode: 0o700 });
    const wsReal = fs.realpathSync(ws); // Claude Code reports the resolved path (e.g. /private/tmp on macOS), so use it everywhere
    if (!wsReal.startsWith(rootReal + path.sep)) throw Object.assign(new Error('Workspace escaped the approved root.'), { status: 500 });
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const meta = { id, prompt, title: cut(prompt.replace(/\s+/g, ' '), 90), policy, approved: extra, resumeOf, followUp, status: 'running', fullOutput: this.recordFullOutput, engine: this.engine, createdAt: Date.now(), startedAt: Date.now(), endedAt: null, workspace: wsReal, retryOf, exitCode: null, error: null, resultText: null, denials: [], stats: { toolCalls: 0, subagents: 0, turns: null, costUsd: null, durationMs: null }, files: [], model: null };
    const s = { meta, events: [], subs: new Set(), child: null, buf: '', tail: '', stopRequested: false, timer: null, dir, resumeId, pre: parent ? new Map(this.scan(wsReal).map((f) => [f.path, f.mtime])) : null };
    s.mapper = createStreamMapper({ now: () => Date.now() - meta.startedAt, workspace: wsReal, title: meta.title, prompt });
    this.active.set(id, s); this.save(s); this.notifyFeed(meta);
    this.emit(s, s.mapper.begin());
    this.start(s, pol, extra, prompt);
    return meta;
  }

  start(s, pol, extra, prompt) {
    const allow = [...pol.allow, ...extra];
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default', '--allowedTools', allow.join(','), '--disallowedTools', ALWAYS_DENY.join(','), '--setting-sources', 'project,local', '--strict-mcp-config', '--max-budget-usd', String(this.cfg.maxBudgetUsd), '--append-system-prompt', SYSTEM_NOTE];
    if (this.cfg.model) args.push('--model', this.cfg.model);
    if (s.resumeId) args.push('--resume', s.resumeId); // continue the SAME Claude Code conversation (same workspace)
    let child;
    try { child = spawn(this.cfg.claudeBin, args, { cwd: s.meta.workspace, stdio: ['pipe', 'pipe', 'pipe'], env: process.env }); }
    catch (e) { return this.finish(s, 'failed', `Could not start Claude Code: ${e.message}`); }
    s.child = child;
    child.on('error', (e) => { this.finish(s, 'failed', e.code === 'ENOENT' ? `Claude Code CLI "${this.cfg.claudeBin}" was not found. Install Claude Code and run \`claude auth login\`.` : `Could not run Claude Code: ${e.message}`); });
    child.stdout.on('data', (d) => this.onStdout(s, d));
    child.stderr.on('data', (d) => { s.tail = (s.tail + d).slice(-4000); try { fs.appendFileSync(path.join(s.dir, 'stderr.log'), d); } catch {} });
    child.on('close', (code) => this.onExit(s, code));
    child.stdin.on('error', () => {}); child.stdin.end(prompt);
    s.timer = setTimeout(() => { s.timedOut = true; this.kill(s); }, this.cfg.timeoutMs);
  }

  onStdout(s, d) {
    s.buf += d; let i;
    while ((i = s.buf.indexOf('\n')) >= 0) {
      const line = s.buf.slice(0, i).trim(); s.buf = s.buf.slice(i + 1); if (!line) continue;
      if (s.meta.fullOutput) { try { fs.appendFileSync(path.join(s.dir, 'raw.jsonl'), line + '\n', { mode: 0o600 }); } catch {} } // debug only, off by default
      let obj; try { obj = JSON.parse(line); } catch { s.tail = (s.tail + '\n' + line).slice(-4000); continue; }
      if (obj.type === 'system' && obj.subtype === 'init') { s.meta.model = obj.model || null; this.save(s); }
      if (typeof obj.session_id === 'string' && /^[\w-]{8,80}$/.test(obj.session_id) && !s.meta.claudeSessionId) { s.meta.claudeSessionId = obj.session_id; this.save(s); } // needed to continue this conversation later (--resume)
      if (obj.type === 'result') this.announce(s); // announce files that exist on disk BEFORE the finish event
      this.emit(s, s.mapper.map(obj));
      if (obj.type === 'result') this.noteResult(s, obj);
    }
  }
  /** Announce files on disk that this session created or changed (files that already existed before a follow-up are not re-announced). */
  announce(s, files) { for (const f of files || this.scan(s.meta.workspace)) { if (s.pre && s.pre.get(f.path) === f.mtime) continue; this.emit(s, s.mapper.addFile(f.path)); } }
  noteResult(s, r) {
    const m = s.meta; m.resultText = r.result != null ? String(typeof r.result === 'string' ? r.result : JSON.stringify(r.result)).slice(0, 20000) : null;
    m.stats.turns = r.num_turns ?? null; m.stats.costUsd = r.total_cost_usd ?? null; m.stats.durationMs = r.duration_ms ?? null;
    m.denials = (Array.isArray(r.permission_denials) ? r.permission_denials : []).map((d) => ({ tool: d.tool_name, input: cut(j(d.tool_input || {}), 200), rule: d.tool_name === 'Bash' && d.tool_input && d.tool_input.command ? `Bash(${String(d.tool_input.command).trim().split(/\s+/)[0]}:*)` : d.tool_name }));
    s.gotResult = r;
  }
  onExit(s, code) {
    if (s.meta.status !== 'running') return; clearTimeout(s.timer);
    if (s.buf.trim()) { try { const o = JSON.parse(s.buf); if (o.type === 'result') this.announce(s); this.emit(s, s.mapper.map(o)); if (o.type === 'result') this.noteResult(s, o); } catch { s.tail += '\n' + s.buf; } s.buf = ''; }
    s.meta.exitCode = code;
    if (s.stopRequested) return this.finish(s, 'stopped', 'Stopped by you.');
    if (s.timedOut) return this.finish(s, 'failed', `Timed out after ${Math.round(this.cfg.timeoutMs / 60000)} minutes and was stopped.`);
    if (s.gotResult) { const bad = s.gotResult.is_error || (s.gotResult.subtype && s.gotResult.subtype !== 'success'); return this.finish(s, bad ? 'failed' : 'succeeded', null); }
    const t = (s.tail || '').trim();
    const msg = /authenticat|log ?in|oauth|credential|not signed|unauthori[sz]ed|401/i.test(t) ? 'Claude Code is not signed in or its login expired. Run `claude auth login` in a terminal, then retry. (Claude Code said: ' + cut(t.replace(/\s+/g, ' '), 200) + ')' : `Claude Code exited (code ${code}) without finishing the task.` + (t ? ' ' + cut(t.replace(/\s+/g, ' '), 300) : '');
    this.finish(s, 'failed', msg);
  }
  kill(s) { try { s.child && s.child.kill('SIGTERM'); } catch {} setTimeout(() => { try { s.child && s.child.kill('SIGKILL'); } catch {} }, 4000).unref(); }
  stop(id) { const s = this.active.get(id); if (!s || s.meta.status !== 'running') return false; s.stopRequested = true; this.kill(s); return true; }

  finish(s, status, message) {
    const m = s.meta; if (m.status !== 'running') return; clearTimeout(s.timer);
    const files = this.scan(m.workspace); // real files on disk; announce those no Write/Edit call announced
    this.announce(s, files);
    if (!s.mapper.stats().finished) this.emit(s, s.mapper.finishWithoutResult(status === 'stopped' ? 'stopped' : 'failed', message || 'ended'));
    else if (message && status !== 'succeeded') m.error = message;
    m.status = status; m.endedAt = Date.now(); m.files = files; if (message && status !== 'succeeded') m.error = message;
    const st = s.mapper.stats(); m.stats.toolCalls = st.toolCalls; m.stats.subagents = st.subagents; if (m.stats.durationMs == null) m.stats.durationMs = m.endedAt - m.startedAt;
    this.save(s); this.active.delete(m.id); this.notifyFeed(m);
    for (const fn of s.subs) { try { fn({ type: '__end', status }); } catch {} }
  }

  emit(s, evs) { for (const e of evs) { s.events.push(e); try { fs.appendFileSync(path.join(s.dir, 'events.jsonl'), j(e) + '\n'); } catch {} for (const fn of s.subs) { try { fn(e); } catch {} } } if (evs.length) { const st = s.mapper.stats(); s.meta.stats.toolCalls = st.toolCalls; s.meta.stats.subagents = st.subagents; } }
  save(s) { try { fs.writeFileSync(path.join(s.dir, 'meta.json'), j(s.meta, null, 2), { mode: 0o600 }); } catch {} }
}
