/*
 * webview.mjs  The Living Web as data, for the pane inside the Claude app (mod/ in this project).
 *
 * The pane cannot run this project's page, so the service draws the picture for it: the saved real events of a task are reduced with the
 * same shared/core.js the page uses and drawn with the same shared/livingweb.js. Nothing is invented and nothing new is stored.
 *
 *   GET /api/web?session=<claude session id>&w=&h=&reduced=1      (needs X-Lab-Token, like every other /api route)
 *   -> { ok, found, id, status, title, rev, svg, alt, agents: [{ name, state, tone, text, main }], total }
 *
 * `session` picks the newest task of that Claude Code session. Without it: the newest running task, else the newest task.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

let box = null;
function load(root) { // both files are plain browser scripts that hang themselves on `window`
  if (box) return box;
  const sb = { console }; sb.window = sb; vm.createContext(sb);
  for (const f of ['core.js', 'livingweb.js']) vm.runInContext(fs.readFileSync(path.join(root, 'shared', f), 'utf8'), sb, { filename: f });
  if (!sb.AgentCore || !sb.LivingWeb) throw new Error('shared/core.js or shared/livingweb.js did not load');
  return (box = sb);
}

const cache = new Map(); // task id -> { n, S }
function stateOf(sb, manager, m) {
  const evs = manager.events(m.id) || [], hit = cache.get(m.id);
  if (hit && hit.n === evs.length) return hit.S;
  const S = sb.AgentCore.initialState({ source: 'claude-code-observed' });
  for (const e of evs) sb.AgentCore.applyEvent(S, e);
  if (cache.size > 40) cache.clear();
  cache.set(m.id, { n: evs.length, S });
  return S;
}

export function pickTask(list, session) { // `list` is newest first
  if (session) return list.find((m) => m.claudeSessionId === session && m.status === 'running') || list.find((m) => m.claudeSessionId === session) || null;
  return list.find((m) => m.status === 'running') || list[0] || null;
}

export function webView(root, manager, { session = '', w = 640, h = 520, reduced = false, now = Date.now() } = {}) {
  const sb = load(root);
  w = Math.max(240, Math.min(2400, Number(w) || 640)); h = Math.max(240, Math.min(2400, Number(h) || 520));
  const m = pickTask(manager.list(), session);
  const S = m ? stateOf(sb, manager, m) : sb.AgentCore.initialState({ source: 'waiting' });
  const t = m && m.status === 'running' ? Math.max(S.t, now - m.startedAt) : S.t;
  const r = sb.LivingWeb.render(S, { w, h, inset: { l: 4, r: 4, t: 4, b: 4 }, now, t, reduced: !!reduced });
  const alt = (/aria-label="([^"]*)"/.exec(r.svg) || [])[1] || 'Agent activity';
  return { ok: true, found: !!m, id: m ? m.id : null, status: m ? m.status : 'idle', title: m ? m.title : '', rev: m ? m.id + ':' + (manager.events(m.id) || []).length + ':' + m.status : 'idle',
    svg: r.svg, alt: alt.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'), total: r.summary.total,
    agents: r.summary.agents.map((a) => ({ name: a.name, type: a.type, state: a.state, tone: a.tone, text: a.text, main: a.main })) };
}
