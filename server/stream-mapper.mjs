/*
 * stream-mapper.mjs  Turns Claude Code's `--output-format stream-json --verbose` output into Agent Activity Lab events.
 *
 * Input objects (one JSON per stdout line of `claude -p`):
 *   {type:'system', subtype:'init', session_id, model, tools, cwd, ...}
 *   {type:'assistant', message:{content:[{type:'text'|'tool_use'|'thinking', ...}]}, parent_tool_use_id}
 *   {type:'user',      message:{content:[{type:'tool_result', tool_use_id, content, is_error}]}, parent_tool_use_id}
 *   {type:'result', subtype, is_error, result, duration_ms, num_turns, total_cost_usd, permission_denials}
 *
 * VERIFICATION STATUS (be precise about what is proven):
 *   - assistant/user message shapes (tool_use / tool_result, ids, is_error) are the same shapes found in REAL Claude Code
 *     transcripts, and are tested against lines taken from a real transcript (server/test-stream-mapper.mjs).
 *   - system/init and result objects, and parent_tool_use_id on subagent messages, are mapped from the documented
 *     stream-json format and have NOT yet been observed from a real run on this machine (the CLI was not signed in).
 *
 * Nothing is invented: a subagent exists only when the stream shows an Agent/Task tool call; a message between agents is only
 * emitted when a subagent returns its report; outputs come from successful Write/Edit calls (the service adds files found on disk).
 */

import path from 'node:path';

const SUB_TOOLS = new Set(['Task', 'Agent']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const PERM_RE = /permission|not allowed|requires? approval|haven't been granted|has not been granted|was denied|has been denied|denied by|not permitted|(was|were) blocked|may only write/i; // includes the REAL wordings seen: "Permission to use Bash with command ... has been denied." and "Output redirection to ... was blocked. For security, Claude Code may only write to files in the allowed working directories"

const flat = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && x.text) || '').join(' ') : c == null ? '' : JSON.stringify(c)).replace(/\s+/g, ' ').trim();
const cut = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));
const brief = (i) => { if (!i) return ''; if (typeof i === 'string') return cut(i, 80); return cut(i.file_path || i.command || i.pattern || i.url || i.query || i.description || i.path || JSON.stringify(i), 80); };
const kindOf = (p) => { const e = (String(p).split('.').pop() || '').toLowerCase(); return ({ py: 'code', js: 'code', ts: 'code', sh: 'code', html: 'code', css: 'code', md: 'doc', txt: 'doc', csv: 'data', json: 'data', tsv: 'data', png: 'image', jpg: 'image', svg: 'image' })[e] || 'file'; };

export function createStreamMapper({ now = () => 0, workspace = '', title = 'Task', prompt = '' } = {}) {
  const S = { calls: {}, subs: {}, subOrder: [], failed: {}, attempts: {}, blocked: {}, outputs: [], seenOutputs: new Set(), toolCalls: 0, finished: false, started: false, result: null };
  const prefixes = new Set(); const addPrefix = (w) => { if (!w) return; w = String(w).replace(/\/+$/, ''); prefixes.add(w); prefixes.add(w.replace(/^\/private(?=\/)/, '')); if (!w.startsWith('/private/')) prefixes.add('/private' + w); };
  addPrefix(workspace);
  // Real Claude Code writes relative paths like "./analyze_csv.py", and may report the workspace as /private/var/... or /var/...: normalise all of them
  const rel = (p) => { p = String(p || ''); if (!p) return ''; for (const w of prefixes) if (p === w) return ''; for (const w of prefixes) if (p.startsWith(w + '/')) return path.posix.normalize(p.slice(w.length + 1)); return p.startsWith('/') ? p : path.posix.normalize(p); };

  function begin() {
    if (S.started) return [];
    S.started = true;
    return [
      { t: now(), type: 'task_started', task: { id: 'session', title: cut(title.replace(/\s+/g, ' '), 90), goal: cut(prompt.replace(/\s+/g, ' '), 300) } },
      { t: now(), type: 'agent_spawned', agentId: 'main', name: 'Claude Code', label: 'MAIN', role: 'Main agent', parentId: null, dependsOn: [] },
      { t: now(), type: 'agent_started', agentId: 'main' },
    ];
  }
  function spawnSub(out, id, name, desc) {
    if (S.subs[id]) return;
    S.subs[id] = { name: name || 'Subagent', done: false }; S.subOrder.push(id);
    const label = String(name || 'SUB').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() || 'SUB';
    out.push({ t: now(), type: 'agent_spawned', agentId: id, name: name || 'Subagent', label, role: cut(desc || 'Subagent', 80), parentId: 'main', dependsOn: [] });
    out.push({ t: now(), type: 'work_delegated', fromId: 'main', toId: id, workId: 'w-' + id, description: cut(desc || 'Subagent task', 120) });
    out.push({ t: now(), type: 'agent_started', agentId: id });
  }
  const ownerOf = (obj, out) => { const p = obj.parent_tool_use_id; if (!p) return 'main'; if (!S.subs[p]) spawnSub(out, p, 'Subagent', 'Subagent (seen in the stream before its Agent call)'); return p; };

  function onAssistant(obj, out) {
    const a = ownerOf(obj, out); const blocks = (obj.message && obj.message.content) || [];
    for (const b of Array.isArray(blocks) ? blocks : []) {
      if (b.type === 'text' && b.text && b.text.trim()) out.push({ t: now(), type: 'agent_said', agentId: a, text: cut(b.text.replace(/\s+/g, ' ').trim(), 220) });
      else if (b.type === 'tool_use') {
        if (S.failed[a]) { S.failed[a] = false; S.attempts[a] = (S.attempts[a] || 1) + 1; out.push({ t: now(), type: 'agent_retry', agentId: a, attempt: S.attempts[a] }); }
        if (S.blocked[a]) { S.blocked[a] = false; out.push({ t: now(), type: 'agent_unblocked', agentId: a, by: 'agent continued without the denied action' }); }
        const input = b.input || {};
        if (SUB_TOOLS.has(b.name)) spawnSub(out, b.id, input.subagent_type || input.description || 'Subagent', input.description || input.prompt || '');
        S.toolCalls++; S.calls[b.id] = { t: now(), agent: a, name: b.name, input };
        out.push({ t: now(), type: 'tool_called', agentId: a, tool: b.name, input: brief(input), durationMs: 1000, callId: b.id });
      }
    }
  }

  function onUser(obj, out) {
    const blocks = (obj.message && obj.message.content) || [];
    for (const b of Array.isArray(blocks) ? blocks : []) {
      if (b.type !== 'tool_result') continue;
      const c = S.calls[b.tool_use_id]; const err = !!b.is_error; const text = flat(b.content);
      const a = c ? c.agent : 'main';
      if (c) { out.push({ t: now(), type: 'tool_returned', agentId: a, callId: b.tool_use_id, durationMs: now() - c.t, ok: !err }); }
      if (c && SUB_TOOLS.has(c.name) && S.subs[b.tool_use_id] && !S.subs[b.tool_use_id].done) {
        const sid = b.tool_use_id; S.subs[sid].done = true;
        if (text) out.push({ t: now(), type: 'message_sent', fromId: sid, toId: 'main', text: cut('Report: ' + text, 160) });
        out.push(err ? { t: now(), type: 'agent_failed', agentId: sid, error: cut(text || 'subagent failed', 120) } : { t: now(), type: 'agent_completed', agentId: sid });
        continue;
      }
      if (err) {
        if (PERM_RE.test(text)) { S.blocked[a] = true; out.push({ t: now(), type: 'agent_blocked', agentId: a, reason: cut('Permission needed: ' + (c ? c.name + ' ' + brief(c.input) : 'a tool'), 120), needs: 'human approval (denied in headless mode)' }); }
        else { S.failed[a] = true; out.push({ t: now(), type: 'agent_failed', agentId: a, error: cut(text || 'tool error', 120) }); }
      } else if (c && WRITE_TOOLS.has(c.name)) {
        const fp = rel(c.input.file_path || c.input.notebook_path || c.input.path);
        if (fp && !S.seenOutputs.has(fp)) { S.seenOutputs.add(fp); S.outputs.push('file:' + fp); out.push({ t: now(), type: 'output_produced', agentId: a, outputId: 'file:' + fp, name: fp, kind: kindOf(fp) }); }
      }
    }
  }

  /** Called by the service for files found on disk that no Write/Edit call announced (e.g. created by a script). */
  function addFile(fp) { if (S.seenOutputs.has(fp)) return []; S.seenOutputs.add(fp); S.outputs.push('file:' + fp); return [{ t: now(), type: 'output_produced', agentId: 'main', outputId: 'file:' + fp, name: fp, kind: kindOf(fp) }]; }

  function closeOpen(out, reason) { for (const id of S.subOrder) if (!S.subs[id].done) { S.subs[id].done = true; out.push({ t: now(), type: 'agent_completed', agentId: id }); } }

  function map(obj) {
    const out = begin();
    if (!obj || typeof obj !== 'object') return out;
    if (obj.type === 'system' && obj.subtype === 'init' && obj.cwd) addPrefix(obj.cwd); // the CLI reports its own working directory
    if (obj.type === 'assistant') onAssistant(obj, out);
    else if (obj.type === 'user') onUser(obj, out);
    else if (obj.type === 'result') {
      S.result = obj; const bad = obj.is_error || (obj.subtype && obj.subtype !== 'success');
      closeOpen(out);
      const denials = Array.isArray(obj.permission_denials) ? obj.permission_denials : [];
      const text = flat(obj.result);
      let summary = bad ? (text || 'Claude Code ended with ' + (obj.subtype || 'an error')) : (text || 'Done');
      if (denials.length) summary += ' (' + denials.length + ' action' + (denials.length === 1 ? ' was' : 's were') + ' denied: ' + [...new Set(denials.map((d) => d.tool_name))].join(', ') + ')';
      if (bad) out.push({ t: now(), type: 'agent_failed', agentId: 'main', error: cut(text || obj.subtype || 'error', 120) });
      else out.push({ t: now(), type: 'agent_completed', agentId: 'main' });
      out.push({ t: now(), type: 'task_finished', status: bad ? 'failed' : 'succeeded', outputIds: S.outputs.slice(), summary: cut(summary, 600) });
      S.finished = true;
    }
    return out;
  }

  /** The process ended without a `result` object (crash, auth failure, stop, timeout). */
  function finishWithoutResult(status, message) {
    if (S.finished) return []; const out = begin(); closeOpen(out); S.finished = true;
    if (status === 'stopped') out.push({ t: now(), type: 'agent_completed', agentId: 'main' });
    else out.push({ t: now(), type: 'agent_failed', agentId: 'main', error: cut(message, 160) });
    out.push({ t: now(), type: 'task_finished', status, outputIds: S.outputs.slice(), summary: cut(message, 600) });
    return out;
  }

  return { begin, map, addFile, finishWithoutResult, stats: () => ({ toolCalls: S.toolCalls, subagents: S.subOrder.length, result: S.result, finished: S.finished }) };
}
