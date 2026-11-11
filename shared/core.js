/*
 * AgentCore: event model, reducer, player and sources for the agent-activity prototypes.
 * Plain script (no modules) so every prototype also works when opened straight from disk.
 *
 * Event shape (all events): { t: ms since task start, type: string, ...fields }
 *   task_started     { task: {id,title,goal} }
 *   agent_spawned    { agentId, name, label, role, parentId, dependsOn: [] }
 *   work_delegated   { fromId, toId, workId, description }
 *   tool_called      { agentId, tool, input, durationMs, callId? }
 *   agent_started    { agentId }                           (optional: a queued agent begins working, e.g. a subagent at the moment it is really created)
 *   agent_said       { agentId, text }                     (optional: short commentary from the agent; shown in recent actions and the Tool stream)
 *   tool_returned    { agentId, callId, durationMs, ok }   (optional: sets the measured duration/outcome on the matching tool_called; adds no log line)
 *   message_sent     { fromId, toId, text }
 *   agent_blocked    { agentId, reason, needs }
 *   agent_unblocked  { agentId, by }
 *   agent_failed     { agentId, error }
 *   agent_retry      { agentId, attempt }
 *   output_produced  { agentId, outputId, name, kind }
 *   agent_completed  { agentId }
 *   task_finished    { status, outputIds, summary }
 *
 * Agent states: queued | waiting | working | blocked | failed | done
 *   waiting = spawned but a dependency is not done yet
 *   queued  = ready (dependencies done) but has not started
 *
 * Honesty rule: every state object carries `source` ("simulated" | "live-hook" |
 * "transcript" | "self-reported") and a sourceNote. The shared chrome shows it as a badge
 * that prototypes cannot remove.
 */
(function (global) {
  'use strict';

  var STATES = ['working', 'waiting', 'blocked', 'failed', 'done', 'queued'];
  var COLORS = {
    bg: '#EAE8E1', ink: '#1F2528', mist: '#B7BCB8', slate: '#56636A', acc: '#1F8A7A', amber: '#B7790A', rust: '#B5472F',
    working: '#1F8A7A', done: '#1F2528', blocked: '#B7790A', failed: '#B5472F', waiting: '#1F2528', queued: '#B7BCB8'
  };

  function initialState(meta) {
    return {
      t: 0, task: null, finished: false, finishedInfo: null,
      source: (meta && meta.source) || 'simulated', sourceNote: (meta && meta.sourceNote) || '',
      plannedTotal: meta && meta.agents ? meta.agents.length : 0,
      agents: {}, order: [],
      delegations: [], dependencies: [], messages: [], outputs: [], log: [],
      counts: { working: 0, waiting: 0, blocked: 0, failed: 0, done: 0, queued: 0 }, progress: 0
    };
  }

  function depsMet(s, a) {
    for (var i = 0; i < a.dependsOn.length; i++) {
      var d = s.agents[a.dependsOn[i]];
      if (!d || d.state !== 'done') return false;
    }
    return true;
  }

  function pushRecent(a, t, text, kind) {
    a.recent.push({ t: t, text: text, kind: kind || 'info' });
    if (a.recent.length > 12) a.recent.shift();
  }

  function logLine(s, t, text, agentId, kind) { s.log.push({ t: t, text: text, agentId: agentId || null, kind: kind || 'info' }); if (s.log.length > 200) s.log.shift(); }

  function recount(s) {
    var c = { working: 0, waiting: 0, blocked: 0, failed: 0, done: 0, queued: 0 };
    for (var i = 0; i < s.order.length; i++) c[s.agents[s.order[i]].state]++;
    s.counts = c;
    var total = Math.max(s.plannedTotal || 0, s.order.length) || 1;
    s.progress = s.finished ? 1 : c.done / total;
  }

  /** Apply one event to a state object (mutates and returns it). */
  function applyEvent(s, ev) {
    var t = ev.t; var a, f, to;
    s.t = Math.max(s.t, t);
    switch (ev.type) {
      case 'task_started':
        s.task = ev.task; s.finished = false; logLine(s, t, 'Task started: ' + ev.task.title, null, 'task'); break;
      case 'agent_spawned':
        a = { id: ev.agentId, name: ev.name || ev.agentId, label: ev.label || (ev.name || ev.agentId).slice(0, 5).toUpperCase(), role: ev.role || '',
          parentId: ev.parentId || null, dependsOn: ev.dependsOn || [], state: 'queued', tool: null, toolInput: null, attempt: 1,
          error: null, blockedReason: null, needs: null, work: null, outputs: [], children: [], recent: [], spawnedAt: t, startedAt: null, endedAt: null };
        s.agents[a.id] = a; s.order.push(a.id);
        if (a.parentId && s.agents[a.parentId]) { s.agents[a.parentId].children.push(a.id); s.delegations.push({ from: a.parentId, to: a.id, t: t, spawn: true }); }
        for (var i = 0; i < a.dependsOn.length; i++) s.dependencies.push({ from: a.dependsOn[i], to: a.id });
        a.state = depsMet(s, a) ? 'queued' : 'waiting';
        pushRecent(a, t, 'Spawned' + (a.parentId ? ' by ' + (s.agents[a.parentId] ? s.agents[a.parentId].name : a.parentId) : ''), 'spawn');
        logLine(s, t, a.name + ' spawned', a.id, 'spawn');
        break;
      case 'work_delegated':
        f = s.agents[ev.fromId]; to = s.agents[ev.toId];
        s.delegations.push({ from: ev.fromId, to: ev.toId, t: t, description: ev.description, work: true });
        if (to) { to.work = ev.description || to.work; pushRecent(to, t, 'Assigned: ' + (ev.description || 'work'), 'delegate'); }
        if (f) { if (f.state === 'queued' || f.state === 'waiting') { if (depsMet(s, f)) { f.state = 'working'; f.startedAt = f.startedAt || t; } } pushRecent(f, t, 'Delegated to ' + (to ? to.name : ev.toId), 'delegate'); }
        logLine(s, t, (f ? f.name : ev.fromId) + ' delegated to ' + (to ? to.name : ev.toId) + (ev.description ? ': ' + ev.description : ''), ev.fromId, 'delegate');
        break;
      case 'tool_called':
        a = s.agents[ev.agentId]; if (!a) break;
        if (a.state === 'queued' || a.state === 'waiting' || a.state === 'failed') { a.state = 'working'; a.startedAt = a.startedAt || t; }
        a.tool = ev.tool; a.toolInput = ev.input || null; a.toolAt = t; a.toolDuration = ev.durationMs || 0;
        pushRecent(a, t, 'Called ' + ev.tool + (ev.input ? ' (' + ev.input + ')' : ''), 'tool');
        logLine(s, t, a.name + ' called ' + ev.tool + (ev.input ? ' · ' + ev.input : ''), a.id, 'tool');
        if (ev.callId) s.log[s.log.length - 1].callId = ev.callId;
        break;
      case 'agent_started':
        a = s.agents[ev.agentId]; if (!a) break;
        if (a.state === 'queued' || a.state === 'waiting') { a.state = 'working'; a.startedAt = a.startedAt || t; }
        break;
      case 'agent_said':
        a = s.agents[ev.agentId]; if (!a) break;
        pushRecent(a, t, 'Said: ' + ev.text, 'note'); logLine(s, t, a.name + ' said: ' + ev.text, a.id, 'note'); break;
      case 'tool_returned':
        for (var q = s.log.length - 1; q >= 0; q--) if (ev.callId && s.log[q].callId === ev.callId) { s.log[q].durationMs = ev.durationMs; s.log[q].ok = ev.ok !== false; break; }
        a = s.agents[ev.agentId]; if (a && a.tool && ev.durationMs != null) a.toolDuration = ev.durationMs;
        break;
      case 'message_sent':
        s.messages.push({ from: ev.fromId, to: ev.toId, text: ev.text, t: t });
        f = s.agents[ev.fromId]; to = s.agents[ev.toId];
        if (f) pushRecent(f, t, 'Told ' + (to ? to.name : ev.toId) + ': ' + ev.text, 'message');
        if (to) pushRecent(to, t, (f ? f.name : ev.fromId) + ' said: ' + ev.text, 'message');
        logLine(s, t, (f ? f.name : ev.fromId) + ' → ' + (to ? to.name : ev.toId) + ': ' + ev.text, ev.fromId, 'message');
        break;
      case 'agent_blocked':
        a = s.agents[ev.agentId]; if (!a) break;
        a.state = 'blocked'; a.blockedReason = ev.reason; a.needs = ev.needs || null;
        pushRecent(a, t, 'Blocked: ' + ev.reason, 'blocked'); logLine(s, t, a.name + ' blocked: ' + ev.reason, a.id, 'blocked'); break;
      case 'agent_unblocked':
        a = s.agents[ev.agentId]; if (!a) break;
        a.state = 'working'; a.blockedReason = null; a.needs = null;
        pushRecent(a, t, 'Unblocked' + (ev.by ? ' by ' + ev.by : ''), 'unblocked'); logLine(s, t, a.name + ' unblocked' + (ev.by ? ' by ' + ev.by : ''), a.id, 'unblocked'); break;
      case 'agent_failed':
        a = s.agents[ev.agentId]; if (!a) break;
        a.state = 'failed'; a.error = ev.error;
        pushRecent(a, t, 'Failed: ' + ev.error, 'failed'); logLine(s, t, a.name + ' failed: ' + ev.error, a.id, 'failed'); break;
      case 'agent_retry':
        a = s.agents[ev.agentId]; if (!a) break;
        a.state = 'working'; a.attempt = ev.attempt || (a.attempt + 1); a.error = null;
        pushRecent(a, t, 'Retry, attempt ' + a.attempt, 'retry'); logLine(s, t, a.name + ' retry (attempt ' + a.attempt + ')', a.id, 'retry'); break;
      case 'output_produced':
        a = s.agents[ev.agentId];
        s.outputs.push({ id: ev.outputId, name: ev.name, kind: ev.kind || 'doc', agentId: ev.agentId, t: t });
        if (a) { a.outputs.push(ev.outputId); pushRecent(a, t, 'Produced ' + ev.name, 'output'); }
        logLine(s, t, (a ? a.name : ev.agentId) + ' produced ' + ev.name, ev.agentId, 'output'); break;
      case 'agent_completed':
        a = s.agents[ev.agentId]; if (!a) break;
        a.state = 'done'; a.endedAt = t; a.tool = null;
        pushRecent(a, t, 'Completed', 'done'); logLine(s, t, a.name + ' completed', a.id, 'done');
        for (var k = 0; k < s.order.length; k++) { var o = s.agents[s.order[k]]; if (o.state === 'waiting' && depsMet(s, o)) o.state = 'queued'; }
        break;
      case 'task_finished':
        s.finished = true; s.finishedInfo = { status: ev.status, summary: ev.summary, outputIds: ev.outputIds || [] };
        logLine(s, t, 'Task finished (' + ev.status + '): ' + (ev.summary || ''), null, 'task'); break;
    }
    recount(s);
    return s;
  }

  /** Recompute the full state at time t (used for seek, replay, scrub). */
  function stateAt(events, meta, t) {
    var s = initialState(meta);
    for (var i = 0; i < events.length && events[i].t <= t; i++) applyEvent(s, events[i]);
    s.t = t; return s;
  }

  /* ------------------------------------------------------------------ Player */
  function Player(opts) {
    this.events = opts.events || []; this.meta = opts.meta || {}; this.live = !!opts.live;
    this.duration = opts.duration || (this.meta.durationMs || (this.events.length ? this.events[this.events.length - 1].t + 1200 : 0));
    this.speed = 1; this.t = 0; this.playing = false; this.idx = 0; this.manual = false;
    this.state = initialState(this.meta); this.onUpdate = opts.onUpdate || function () {}; this.onEvent = opts.onEvent || function () {}; this.onReset = opts.onReset || function () {};
    this._last = 0; var self = this; this._raf = function (now) { self._loop(now); };
    this.liveStart = performance.now();
  }
  Player.prototype.play = function () { if (this.t >= this.duration && !this.live) this.seek(0); this.playing = true; this._last = 0; if (!this.manual) requestAnimationFrame(this._raf); this.onUpdate(this.state, [], 0); };
  Player.prototype.pause = function () { this.playing = false; this.onUpdate(this.state, [], 0); };
  Player.prototype.toggle = function () { this.playing ? this.pause() : this.play(); };
  Player.prototype.setSpeed = function (x) { this.speed = x; this.onUpdate(this.state, [], 0); };
  Player.prototype.replay = function () { this.seek(0); this.play(); };
  Player.prototype.seek = function (ms) {
    ms = Math.max(0, Math.min(ms, this.duration));
    this.state = stateAt(this.events, this.meta, ms); this.t = ms;
    this.idx = 0; while (this.idx < this.events.length && this.events[this.idx].t <= ms) this.idx++;
    this.onReset(this.state); this.onUpdate(this.state, [], 0);
  };
  Player.prototype.pushLive = function (ev) {
    if (ev.t == null) ev.t = performance.now() - this.liveStart;
    this.events.push(ev); applyEvent(this.state, ev); this.t = Math.max(this.t, ev.t); this.duration = Math.max(this.duration, this.t + 1000);
    this.onEvent(ev, this.state); this.onUpdate(this.state, [ev], 0);
  };
  /** Advance by dtMs of wall time (scaled by speed). Returns events applied. */
  Player.prototype.step = function (dtMs) {
    var applied = [];
    if (this.live) { this.t = performance.now() - this.liveStart; this.state.t = this.t; this.onUpdate(this.state, [], dtMs); return applied; }
    if (!this.playing) { this.onUpdate(this.state, [], 0); return applied; }
    var nt = this.t + dtMs * this.speed; if (nt > this.duration) nt = this.duration;
    while (this.idx < this.events.length && this.events[this.idx].t <= nt) { var ev = this.events[this.idx++]; applyEvent(this.state, ev); applied.push(ev); this.onEvent(ev, this.state); }
    this.t = nt; this.state.t = nt;
    if (nt >= this.duration) this.playing = false;
    this.onUpdate(this.state, applied, dtMs * this.speed);
    return applied;
  };
  Player.prototype._loop = function (now) {
    if (this.manual) return;
    if (!this._last) this._last = now; var dt = Math.min(now - this._last, 100); this._last = now;
    this.step(dt);
    if (this.playing || this.live) requestAnimationFrame(this._raf);
  };

  /* ------------------------------------------------------------------ Sources */
  var Sources = {
    simulated: function (scenario) { return { events: scenario.events.slice(), meta: scenario.meta, live: false }; },
    /** Parse JSONL text of AgentEvents. Missing t values are filled sequentially (500ms apart). */
    jsonl: function (text, meta) {
      var events = [], t = 0;
      text.split(/\r?\n/).forEach(function (line) { line = line.trim(); if (!line) return; try { var e = JSON.parse(line); if (e.t == null) { e.t = t; t += 500; } else t = e.t; events.push(e); } catch (x) {} });
      events.sort(function (a, b) { return a.t - b.t; });
      return { events: events, meta: Object.assign({ source: 'transcript', sourceNote: 'Replayed from a JSONL event log.' }, meta || {}), live: false };
    },
    /** Live SSE stream from shared/adapter-server.mjs (GET /events). Returns {close}. */
    live: function (baseUrl, player, onStatus) {
      var es = new EventSource(baseUrl.replace(/\/$/, '') + '/events');
      es.onopen = function () { onStatus && onStatus('connected'); };
      es.onerror = function () { onStatus && onStatus('disconnected'); };
      es.onmessage = function (m) { try { var ev = JSON.parse(m.data); if (ev.type === 'meta') { player.state.source = ev.source; player.state.sourceNote = ev.sourceNote || ''; player.meta = Object.assign({}, player.meta, { source: ev.source, sourceNote: ev.sourceNote }); player.onUpdate(player.state, [], 0); return; } if (ev.type === 'reset') { player.state = initialState(player.meta); player.events = []; player.liveStart = performance.now(); player.onReset(player.state); player.onUpdate(player.state, [], 0); return; } player.pushLive(ev); } catch (x) {} };
      return { close: function () { es.close(); } };
    }
  };

  function reducedMotion() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function params() { var o = {}; (location.search || '').replace(/^\?/, '').split('&').forEach(function (kv) { if (!kv) return; var p = kv.split('='); o[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); }); return o; }

  /** Helpers prototypes can share. */
  var util = {
    clamp: function (v, a, b) { return Math.max(a, Math.min(b, v)); },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    ease: function (t) { t = util.clamp(t, 0, 1); return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; },
    stateColor: function (st) { return COLORS[st] || COLORS.mist; },
    stateWord: function (a) { return a.state === 'blocked' ? 'blocked: ' + (a.blockedReason || '') : a.state === 'failed' ? 'failed: ' + (a.error || '') : a.state; },
    topLevel: function (s) { return s.order.filter(function (id) { return s.agents[id].parentId === 'orch' || (s.agents[id].parentId == null && id !== 'orch'); }); },
    fmtTime: function (ms) { var s = ms / 1000; return s.toFixed(1) + 's'; },
    svgEl: function (name, attrs, parent) { var el = document.createElementNS('http://www.w3.org/2000/svg', name); if (attrs) for (var k in attrs) el.setAttribute(k, attrs[k]); if (parent) parent.appendChild(el); return el; }
  };

  global.AgentCore = { STATES: STATES, COLORS: COLORS, initialState: initialState, applyEvent: applyEvent, stateAt: stateAt, Player: Player, Sources: Sources, reducedMotion: reducedMotion, params: params, util: util, version: '0.1.0' };
})(window);
