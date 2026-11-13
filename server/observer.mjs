/*
 * observer.mjs  Turns Claude Code hook payloads (POST /api/hook, sent by tools/hook-forward.mjs) into saved, live "observed" sessions.
 *
 * The dashboard does NOT run these: you use Claude Code normally and this watches. Each prompt you submit becomes one task
 * (a lab session with origin "observed"); it is saved to the same history as dashboard-run tasks.
 *
 * Honesty rules:
 *  - Only hook payloads are used. Nothing is invented: agents exist because SubagentStart said so, tool calls come from PreToolUse.
 *  - Hooks carry no streaming text, so the cards show tools and statuses, not Claude's thinking.
 *  - A task whose end was never observed (Esc interrupt, terminal closed, dashboard restarted) is closed as "ended" with that
 *    reason; it is never reported as succeeded.
 *  - The dashboard cannot stop, retry or approve an observed session. It does not own that process.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createHookMapper, promptTitle } from '../shared/adapter-server.mjs';

const j = (o) => JSON.stringify(o);
const cut = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));
const KNOWN = new Set(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Notification', 'SubagentStart', 'SubagentStop', 'Stop', 'SessionEnd']);
const SID = /^[\w-]{8,80}$/;
// Claude Code reports a finished BACKGROUND task back to the model as a synthetic prompt; it is not something the person typed.
// Headless runs send <task-notification>; REAL interactive sessions send <agent-message from="<agent_id>"> [Subagent hand-back] ... for a background subagent's final report.
const NOTIF = /^\s*<(task-notification|agent-message)[\s>]/;

export class Observer {
  constructor(manager, { staleMs = 30 * 60 * 1000, now = Date.now } = {}) {
    this.m = manager; this.staleMs = staleMs; this.now = now;
    this.byClaude = new Map();            // claude session_id -> live record
    this.listeners = new Set();           // (kind, meta) activity callbacks (open the companion window)
    this.received = 0; this.lastEventAt = null; this.tasks = 0;
  }
  onActivity(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  status() { return { received: this.received, tasks: this.tasks, lastEventAt: this.lastEventAt, staleMinutes: Math.round(this.staleMs / 60000) }; }
  get(id) { for (const r of this.byClaude.values()) if (r.meta.id === id) return r; return null; }
  live() { return [...this.byClaude.values()].filter((r) => r.meta.status === 'running').map((r) => r.meta); }

  /** On start: tasks recorded as running by an earlier service process have no observer any more. */
  recover() {
    for (const id of fs.readdirSync(this.m.sessDir)) {
      const meta = this.m.meta(id); if (!meta || meta.origin !== 'observed' || meta.status !== 'running') continue;
      meta.status = 'ended'; meta.endedAt = this.now(); meta.error = 'The dashboard service restarted while this task was running, so its end was not observed.';
      meta.stats.durationMs = meta.endedAt - meta.startedAt;
      try { fs.appendFileSync(path.join(this.m.sessDir, id, 'events.jsonl'), j({ t: meta.stats.durationMs, type: 'agent_failed', agentId: 'main', error: 'End not observed (service restarted)' }) + '\n' + j({ t: meta.stats.durationMs, type: 'task_finished', status: 'ended', outputIds: [], summary: meta.error }) + '\n'); fs.writeFileSync(path.join(this.m.sessDir, id, 'meta.json'), j(meta, null, 2), { mode: 0o600 }); } catch {}
    }
  }

  /** Close tasks that have been silent for too long. */
  sweep() {
    const t = this.now();
    for (const [k, r] of this.byClaude) if (r.meta.status !== 'running' && t - (r.meta.endedAt || 0) > 3600e3) this.byClaude.delete(k); // forget finished tasks after an hour
    for (const r of this.byClaude.values()) if (r.meta.status === 'running' && t - r.lastAt > this.staleMs) this.end(r, 'No hook events for ' + Math.round(this.staleMs / 60000) + ' minutes. Claude Code was probably interrupted (Esc) or closed, so this task\'s end was not observed.');
  }

  start(p, joined) {
    const t = this.now(); const id = crypto.randomUUID(); const dir = path.join(this.m.sessDir, id); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const prompt = joined ? '' : String(p.prompt || '');
    const title = prompt ? promptTitle(prompt, 90) : cut('Claude Code in ' + path.basename(String(p.cwd || '').replace(/\/+$/, '')) + ' (joined mid-task)', 90);
    const meta = { id, prompt: prompt || title, title, policy: 'observed', approved: [], resumeOf: null, followUp: null, status: 'running', engine: 'claude-code', origin: 'observed', createdAt: t, startedAt: t, endedAt: null, workspace: String(p.cwd || ''), claudeSessionId: String(p.session_id), promptId: p.prompt_id ? String(p.prompt_id) : null, retryOf: null, exitCode: null, error: null, resultText: null, denials: [], stats: { toolCalls: 0, subagents: 0, turns: null, costUsd: null, durationMs: null }, files: [], outputs: [], model: null, lastEventAt: t };
    const r = { meta, events: [], subs: new Set(), dir, map: createHookMapper(), lastAt: t, lastSaved: 0, promptIds: new Set(p.prompt_id ? [String(p.prompt_id)] : []), agents: new Set() };
    this.byClaude.set(String(p.session_id), r); this.m.watch.set(id, r); this.tasks++;
    this.save(r); this.m.notifyFeed(meta); if (!joined) this.fire('task', meta); // only a prompt the person submitted brings the window up; activity picked up mid-task just appears in an open dashboard
    return r;
  }
  save(r) { r.lastSaved = this.now(); try { fs.writeFileSync(path.join(r.dir, 'meta.json'), j(r.meta, null, 2), { mode: 0o600 }); } catch {} }
  fire(kind, meta) { for (const fn of this.listeners) { try { fn(kind, meta); } catch {} } }

  emit(r, evs) {
    let changed = false;
    for (const e of evs) {
      if (e.__reset) continue;
      r.events.push(e); try { fs.appendFileSync(path.join(r.dir, 'events.jsonl'), j(e) + '\n'); } catch {}
      for (const fn of r.subs) { try { fn(e); } catch {} }
      if (e.type === 'tool_called') r.meta.stats.toolCalls++;
      else if (e.type === 'agent_spawned' && e.agentId !== 'main') { r.meta.stats.subagents++; r.agents.add(e.agentId); }
      else if (e.type === 'output_produced') r.meta.outputs.push(e.name);
      changed = true;
    }
    return changed;
  }

  end(r, message) { // close a task whose end was not observed
    if (r.meta.status !== 'running') return;
    const t = this.now() - r.meta.startedAt;
    const subs = new Set(r.events.filter((e) => e.type === 'agent_spawned' && e.agentId !== 'main').map((e) => e.agentId));
    for (const e of r.events) if (e.type === 'agent_completed' || e.type === 'agent_failed') subs.delete(e.agentId);
    this.emit(r, [...[...subs].map((id) => ({ t, type: 'agent_completed', agentId: id })), { t, type: 'agent_failed', agentId: 'main', error: cut(message, 120) }, { t, type: 'task_finished', status: 'ended', outputIds: r.meta.outputs.map((o) => 'file:' + o), summary: cut(message, 600) }]);
    this.finish(r, 'ended', message);
  }
  /** A finished task started again because a background agent reported back (synthetic <task-notification> prompt). */
  resume(r, reason) {
    const m = r.meta; if (m.status === 'running') return;
    m.status = 'running'; m.endedAt = null; m.error = null; m.stats.durationMs = null; r.lastAt = this.now(); m.lastEventAt = r.lastAt;
    this.m.watch.set(m.id, r); this.emit(r, [{ t: this.now() - m.startedAt, type: 'task_resumed', reason }]); this.save(r); this.m.notifyFeed(m);
  }
  finish(r, status, message) {
    const m = r.meta; if (m.status !== 'running') return;
    m.status = status; m.endedAt = this.now(); m.stats.durationMs = m.endedAt - m.startedAt; if (message && status !== 'succeeded') m.error = message;
    m.files = this.m.observedFiles(m);
    this.save(r); this.m.notifyFeed(m);
    for (const fn of r.subs) { try { fn({ type: '__end', status }); } catch {} }
    this.m.watch.delete(m.id);
  }

  ingest(p) {
    if (!p || typeof p !== 'object' || typeof p.hook_event_name !== 'string' || !KNOWN.has(p.hook_event_name)) return { ok: false, error: 'not a Claude Code hook payload' };
    if (!SID.test(String(p.session_id || ''))) return { ok: false, error: 'missing session_id' };
    const ev = p.hook_event_name; const sid = String(p.session_id);
    if (p.cwd && this.m.isOwnWorkspace(String(p.cwd))) return { ok: true, ignored: 'dashboard-run task' }; // those are already recorded by the runner
    this.received++; this.lastEventAt = this.now();
    if (ev === 'SessionStart') { this.fire('session', { sessionId: sid }); return { ok: true, id: null }; }
    let r = this.byClaude.get(sid);
    const notif = ev === 'UserPromptSubmit' && NOTIF.test(String(p.prompt || ''));
    if (ev === 'UserPromptSubmit' && !notif) {
      if (r && r.meta.status === 'running') this.end(r, 'A new prompt was submitted before this task\'s Stop event arrived (interrupted, or sent while Claude was working). Treated as a new task.');
      r = this.start(p, false);
    } else if (notif) { // not a new task: the same one, continuing
      if (!r) r = this.start(p, true);
      if (p.prompt_id) r.promptIds.add(String(p.prompt_id));
      if (r.meta.status !== 'running') this.resume(r, 'A background task reported back to Claude Code');
      r.lastAt = this.now(); return { ok: true, id: r.meta.id };
    } else if (!r || (r.meta.status !== 'running' && p.prompt_id && !r.promptIds.has(String(p.prompt_id)) && !(p.agent_id && r.agents.has(String(p.agent_id))))) {
      if (ev === 'Stop' || ev === 'SessionEnd' || ev === 'SubagentStop') return { ok: true, id: null }; // the end of something we never saw start
      r = this.start(p, true); // tool activity from a turn that began before the service was running
    }
    if (r.meta.status !== 'running') { // late events of a finished task: a background subagent that kept working after the main turn ended
      if (p.agent_id && r.agents.has(String(p.agent_id)) && ev !== 'Stop' && ev !== 'SessionEnd') { const evs = r.map(p); if (this.emit(r, evs)) { this.save(r); this.m.notifyFeed(r.meta); } return { ok: true, id: r.meta.id, late: true }; }
    }
    if (r.meta.status !== 'running') return { ok: true, id: r.meta.id, ignored: 'task already finished' };
    r.lastAt = this.now(); r.meta.lastEventAt = r.lastAt;
    if (p.prompt_id && !r.meta.promptId) r.meta.promptId = String(p.prompt_id);
    if (ev === 'Stop' && Array.isArray(p.background_tasks) && p.background_tasks.length) { // the turn ended but background work continues: not finished
      const lm = p.last_assistant_message; if (lm != null) r.meta.resultText = cut(typeof lm === 'string' ? lm : j(lm), 20000);
      this.emit(r, [{ t: this.now() - r.meta.startedAt, type: 'agent_said', agentId: 'main', text: 'Turn ended; ' + p.background_tasks.length + ' background task' + (p.background_tasks.length === 1 ? '' : 's') + ' still running. Waiting for them to report back.' }]); this.save(r); this.m.notifyFeed(r.meta); return { ok: true, id: r.meta.id, background: p.background_tasks.length };
    }
    const evs = r.map(p); const changed = this.emit(r, evs);
    if (r.events.length && !r.meta.model && p.model) r.meta.model = String(p.model);
    const fin = evs.find((e) => e.type === 'task_finished');
    if (fin) {
      if (ev === 'Stop') { const lm = p.last_assistant_message; if (lm != null) r.meta.resultText = cut(typeof lm === 'string' ? lm : j(lm), 20000); this.finish(r, 'succeeded', null); }
      else this.finish(r, 'ended', fin.summary);
    } else if (changed && this.now() - r.lastSaved > 1000) { this.save(r); this.m.notifyFeed(r.meta); }
    return { ok: true, id: r.meta.id };
  }
}
