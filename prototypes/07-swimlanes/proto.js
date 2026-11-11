/* 07 Swimlanes: a live timeline with one lane per agent.
 *
 * Everything drawn is derived from events that have already been applied (never the future):
 *  - the shared reducer state (ctx.state()) for names, states, progress, finish
 *  - a small timeline model (M) folded from the played events. update() feeds it incrementally;
 *    after a seek/replay (onReset) it is rebuilt from the already-played events (t <= state.t).
 * Layout (lanes, collapse, time axis) is computed from that model, not from the scenario ids.
 */
AgentChrome.mount({
  id: '07', name: 'Swimlanes', tagline: 'A live timeline: one lane per agent. Bars grow as work happens.',
  create: function (stage, ctx) {
    'use strict';
    var U = ctx.core.util;
    var GUT = 156, PAD = 14, HEAD = 60, MINLANE = 30, MAXLANE = 46, MIN_SPAN = 20000, MAX_SPAN = 120000;
    var INK = '#1F2528', TEAL = '#1F8A7A', AMBER = '#B7790A', RUST = '#B5472F', SLATE = '#56636A', MIST = '#B7BCB8', BG = '#EAE8E1', DKTEAL = '#0f5d52';
    var SVGNS = 'http://www.w3.org/2000/svg';

    /* ------------------------------------------------------------- timeline model */
    var M = newModel();
    function newModel() { return { agents: {}, order: [], done: {}, handoffs: [], msgs: [], outs: [], task: null, finished: null, lastT: 0 }; }

    function depsMet(a) { for (var i = 0; i < a.deps.length; i++) if (!M.done[a.deps[i]]) return false; return true; }
    function openSeg(a, t, k, extra) { var sg = { k: k, t0: t, t1: null }; for (var p in extra) sg[p] = extra[p]; a.segs.push(sg); return sg; }
    function closeSeg(a, t) { var sg = a.segs[a.segs.length - 1]; if (sg && sg.t1 == null) sg.t1 = t; }
    function startWork(a, t) { closeSeg(a, t); a.phase = 'working'; if (a.startedAt == null) a.startedAt = t; openSeg(a, t, 'work', { attempt: a.attempt, tools: [] }); }
    function curSeg(a) { var sg = a.segs[a.segs.length - 1]; return sg && sg.t1 == null ? sg : null; }

    function ingest(ev) {
      var t = ev.t, a, f, to, i;
      M.lastT = Math.max(M.lastT, t);
      switch (ev.type) {
        case 'task_started': M.task = ev.task; break;
        case 'agent_spawned':
          a = { id: ev.agentId, name: ev.name || ev.agentId, label: ev.label || (ev.name || ev.agentId).slice(0, 5).toUpperCase(), parentId: ev.parentId || null,
            deps: ev.dependsOn || [], segs: [], phase: 'queued', attempt: 1, spawnAt: t, startedAt: null, endAt: null, markers: [], work: null };
          M.agents[a.id] = a; M.order.push(a.id);
          a.phase = depsMet(a) ? 'queued' : 'waiting';
          openSeg(a, t, a.phase === 'waiting' ? 'wait' : 'queue', {});
          if (a.parentId && M.agents[a.parentId]) M.handoffs.push({ from: a.parentId, to: a.id, t: t, spawn: true, text: 'spawned' });
          break;
        case 'work_delegated':
          f = M.agents[ev.fromId]; to = M.agents[ev.toId];
          if (f && to) {
            var dup = false;
            for (i = M.handoffs.length - 1; i >= 0 && !dup; i--) { var h = M.handoffs[i]; if (t - h.t > 60) break; if (h.from === ev.fromId && h.to === ev.toId) { dup = true; h.text = ev.description || h.text; h.spawn = false; } }
            if (!dup) M.handoffs.push({ from: ev.fromId, to: ev.toId, t: t, text: ev.description || 'delegated' });
          }
          if (to) to.work = ev.description || to.work;
          if (f && (f.phase === 'queued' || f.phase === 'waiting') && depsMet(f)) startWork(f, t);
          break;
        case 'tool_called':
          a = M.agents[ev.agentId]; if (!a) break;
          if (a.phase === 'queued' || a.phase === 'waiting' || a.phase === 'failed') startWork(a, t);
          if (a.phase === 'working') { var sg = curSeg(a); if (sg) sg.tools.push({ t: t, tool: ev.tool, input: ev.input || '', dur: ev.durationMs || 0 }); }
          break;
        case 'message_sent': M.msgs.push({ from: ev.fromId, to: ev.toId, text: ev.text, t: t }); break;
        case 'agent_blocked':
          a = M.agents[ev.agentId]; if (!a) break;
          closeSeg(a, t); a.phase = 'blocked'; openSeg(a, t, 'block', { reason: ev.reason || 'blocked', needs: ev.needs || '' }); break;
        case 'agent_unblocked':
          a = M.agents[ev.agentId]; if (!a) break;
          closeSeg(a, t); a.phase = 'working'; openSeg(a, t, 'work', { attempt: a.attempt, tools: [], by: ev.by || '' }); break;
        case 'agent_failed':
          a = M.agents[ev.agentId]; if (!a) break;
          var cs = curSeg(a); if (cs && cs.k === 'work') cs.failed = true;
          closeSeg(a, t); a.phase = 'failed'; a.markers.push({ t: t, error: ev.error || 'failed' });
          openSeg(a, t, 'fail', { error: ev.error || 'failed' }); break;
        case 'agent_retry':
          a = M.agents[ev.agentId]; if (!a) break;
          a.attempt = ev.attempt || (a.attempt + 1); startWork(a, t); break;
        case 'output_produced': M.outs.push({ agentId: ev.agentId, id: ev.outputId, name: ev.name, kind: ev.kind || 'doc', t: t }); break;
        case 'agent_completed':
          a = M.agents[ev.agentId]; if (!a) break;
          closeSeg(a, t); a.phase = 'done'; a.endAt = t; M.done[a.id] = true;
          for (i = 0; i < M.order.length; i++) { var o = M.agents[M.order[i]]; if (o.phase === 'waiting' && depsMet(o)) { closeSeg(o, t); o.phase = 'queued'; openSeg(o, t, 'queue', {}); } }
          break;
        case 'task_finished': M.finished = { t: t, status: ev.status, summary: ev.summary, outputIds: ev.outputIds || [] }; break;
      }
    }

    /** Rebuild the model after a seek/replay/reset from events that are already in the past (t <= state.t). */
    function rebuild(s) {
      M = newModel();
      var lab = window.__agentlab, evs = (lab && lab.player && lab.player.events) || [];
      for (var i = 0; i < evs.length; i++) if (evs[i].t <= s.t) ingest(evs[i]);
      laneY = {}; snapNext = true; userToggle = userToggle || {};
    }

    /* ------------------------------------------------------------- DOM */
    function el(tag, cls, parent, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; }
    function esc(x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function fx(n) { return Math.round(n * 10) / 10; }

    stage.setAttribute('role', 'group');
    var root = el('div', 'sw', stage);
    var head = el('div', 'sw-head', root);
    var prog = el('div', 'sw-prog', head);
    var progTop = el('div', 'sw-prog-top', prog, 'TASK · 0%');
    var progBar = el('span', 'sw-prog-bar', prog); var progFill = el('span', 'sw-prog-fill', progBar);
    var progTitle = el('div', 'sw-prog-title', prog, '');
    var axis = document.createElementNS(SVGNS, 'svg'); axis.setAttribute('class', 'sw-axis'); axis.setAttribute('height', HEAD); head.appendChild(axis);
    var body = el('div', 'sw-body', root);
    var inner = el('div', 'sw-inner', body);
    var labels = el('div', 'sw-labels', inner);
    var plot = document.createElementNS(SVGNS, 'svg'); plot.setAttribute('class', 'sw-plot'); inner.appendChild(plot);
    var empty = el('div', 'sw-empty', inner, 'Waiting for the first agent…');
    var strip = el('div', 'sw-strip', root);
    var tip = el('div', 'sw-tip', stage);

    /* legend of the encodings that the shared footer legend does not cover */
    var leg = el('div', 'sw-leg', strip);
    leg.innerHTML =
      '<span><svg width="30" height="14"><path d="M2 3C14 3 14 11 26 11" stroke="' + SLATE + '" stroke-width="1.3" fill="none"/><circle cx="26" cy="11" r="2.3" fill="' + SLATE + '"/></svg>handoff</span>' +
      '<span><svg width="30" height="14"><path d="M2 11C14 11 14 3 24 3" stroke="' + TEAL + '" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="0.1 4" fill="none"/><path d="M28 3l-5-3v6z" fill="' + TEAL + '"/></svg>message</span>' +
      '<span><svg width="12" height="14"><path d="M1 1h6l4 4v8H1z" fill="' + BG + '" stroke="' + DKTEAL + '" stroke-width="1.3"/></svg>output</span>' +
      '<span><svg width="30" height="14"><defs><pattern id="sw-hatch-l" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="' + AMBER + '"/><line x1="0" y1="0" x2="0" y2="6" stroke="' + BG + '" stroke-width="1.5"/></pattern></defs><rect x="1" y="2" width="28" height="10" fill="url(#sw-hatch-l)"/></svg>blocked</span>' +
      '<span><svg width="30" height="14"><rect x="1" y="2" width="22" height="10" fill="' + RUST + '"/><circle cx="23" cy="7" r="5.5" fill="' + RUST + '" stroke="' + BG + '" stroke-width="1.5"/><path d="M21 5l4 4M25 5l-4 4" stroke="' + BG + '" stroke-width="1.3"/></svg>failed</span>' +
      '<span><svg width="30" height="14"><path d="M2 7H28" stroke="' + SLATE + '" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 5"/></svg>waiting</span>';
    var tools = el('div', 'sw-tools', strip);
    var btnOut = el('button', 'sw-tool', tools, '−'); btnOut.type = 'button'; btnOut.title = 'Zoom out the time axis (-)'; btnOut.setAttribute('aria-label', 'Zoom out');
    var btnIn = el('button', 'sw-tool', tools, '+'); btnIn.type = 'button'; btnIn.title = 'Zoom in the time axis (+). Ctrl/Cmd + wheel also zooms; drag the lanes to pan; click or drag the time axis to scrub.'; btnIn.setAttribute('aria-label', 'Zoom in');
    var btnFollow = el('button', 'sw-tool on', tools, 'FOLLOW NOW'); btnFollow.type = 'button'; btnFollow.title = 'Keep NOW in view and fit the run (F)';

    /* ------------------------------------------------------------- view state */
    var hoverTip = null, mouse = null;
    var mode = 'follow';               // 'follow' (auto scroll/zoom) | 'manual'
    var man = { start: 0, span: MIN_SPAN };
    var dv = { start: 0, span: MIN_SPAN, init: false };   // displayed (eased) view
    var laneY = {}, laneEls = {}, laneSeq = '', userToggle = {};
    var geo = { W: 600, laneH: 40, bodyH: 400, lanes: [], vis: {}, total: 0, tgtStart: 0, tgtSpan: MIN_SPAN };
    var snapNext = false, hits = [], lastUserScroll = 0, pendingScrollTo = null, scrubbing = false, drag = null;

    function reduced() { return ctx.reducedMotion(); }
    function isLive() { var l = window.__agentlab; return !!(l && l.player && l.player.live); }
    function isPlaying() { var l = window.__agentlab; return !!(l && l.player && l.player.playing); }
    function nowOf(s) {
      if (M.finished) return M.finished.t;
      var t = Math.max(s.t, M.lastT);   // a live adapter can run ahead of the local clock
      if (reduced() && isPlaying()) t = Math.max(Math.floor(t / 1000) * 1000, M.lastT);   // reduced motion: NOW advances in 1 s steps
      return t;
    }

    /* ------------------------------------------------------------- lanes */
    function computeLanes(bodyH) {
      var kids = {}, roots = [], i;
      M.order.forEach(function (id) { var a = M.agents[id]; if (a.parentId && M.agents[a.parentId]) (kids[a.parentId] = kids[a.parentId] || []).push(id); else roots.push(id); });
      var full = [], info = {};
      roots.forEach(function (r) { (function walk(id, depth, parent) {
        var k = kids[id] || [], rec = { id: id, depth: depth, parent: parent, kids: k, nDesc: 0, allDone: true };
        info[id] = rec; full.push(rec);
        k.forEach(function (c) { walk(c, depth + 1, id); rec.nDesc += 1 + info[c].nDesc; if (!(M.agents[c].phase === 'done' && info[c].allDone)) rec.allDone = false; });
      })(r, 0, null); });
      function collapsible(r) { return r.kids.length > 0 && M.agents[r.id].phase === 'done' && r.allDone; }
      var collapsed = {};
      full.forEach(function (r) { if (r.kids.length && userToggle[r.id] === false) collapsed[r.id] = true; });
      function visible() { var out = []; (function emit(ids) { ids.forEach(function (id) { out.push(info[id]); if (!collapsed[id]) emit(info[id].kids); }); })(roots); return out; }
      var vis = visible();
      if (vis.length * MINLANE > bodyH) {
        var cands = full.filter(function (r) { return collapsible(r) && userToggle[r.id] === undefined; }).sort(function (a, b) { return (M.agents[a.id].endAt || 0) - (M.agents[b.id].endAt || 0); });
        for (i = 0; i < cands.length && vis.length * MINLANE > bodyH; i++) { if (vis.indexOf(info[cands[i].id]) < 0) continue; collapsed[cands[i].id] = true; vis = visible(); }
      }
      var visSet = {}; vis.forEach(function (r, idx) { visSet[r.id] = idx; });
      return { full: full, info: info, vis: vis, visSet: visSet, collapsed: collapsed, collapsible: collapsible };
    }
    function rowOf(id) { while (id && geo.L.visSet[id] === undefined) { var a = M.agents[id]; id = a ? a.parentId : null; } return id; }

    /* ------------------------------------------------------------- label column (persistent, keyboard reachable) */
    function ensureLane(id) {
      if (laneEls[id]) return laneEls[id];
      var a = M.agents[id];
      var box = el('div', 'sw-lane', labels);
      var tog = el('button', 'sw-tog', box, ''); tog.type = 'button';
      var gap = el('span', 'sw-tog-gap', box);
      var nm = el('button', 'sw-name', box); nm.type = 'button';
      var dot = el('span', 'ac-ins-dot', nm); var lab = el('span', 'sw-l', nm, a.label);
      nm.onclick = function () { ctx.select(id); };
      // Space is a global play/pause key in the shared chrome; on a lane it must select instead.
      nm.addEventListener('keydown', function (e) { if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); ctx.select(id); } });
      tog.addEventListener('keydown', function (e) { if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); tog.click(); } });
      tog.onclick = function (e) { e.stopPropagation(); var c = !!geo.L.collapsed[id]; userToggle[id] = c; render(); };
      laneEls[id] = { box: box, nm: nm, dot: dot, lab: lab, tog: tog, gap: gap, key: '' };
      return laneEls[id];
    }
    function layoutLabels() {
      var L = geo.L, seq = L.vis.map(function (r) { return r.id; }).join(',');
      Object.keys(laneEls).forEach(function (id) { var on = L.visSet[id] !== undefined; laneEls[id].box.classList.toggle('hidden', !on); });
      L.vis.forEach(function (r) {
        var e = ensureLane(r.id), a = M.agents[r.id], y = laneY[r.id];
        e.box.style.height = geo.laneH + 'px'; e.box.style.transform = 'translateY(' + fx(y) + 'px)';
        var cls = 'sw-lane' + (r.depth ? ' child' : '') + (ctx.selected() === r.id ? ' sel' : '');
        if (e.box.className !== cls) e.box.className = cls;
        e.nm.style.paddingLeft = (r.depth * 12) + 'px';
        var dc = 'ac-ins-dot ac-st-' + a.phase; if (e.dot.className !== dc) e.dot.className = dc;
        var cl = !!L.collapsed[r.id];
        var key = [a.phase, a.label, cl ? 1 : 0, r.kids.length, r.nDesc].join('|');
        if (key !== e.key) {
          e.key = key;
          e.nm.setAttribute('aria-label', a.name + ', ' + a.phase + (a.phase === 'blocked' ? ': ' + (lastBlock(a) || '') : ''));
          e.nm.title = a.name + ' · ' + a.phase;
          e.lab.textContent = a.label;
          e.tog.style.display = r.kids.length ? '' : 'none'; e.gap.style.display = r.kids.length ? 'none' : '';
          e.tog.textContent = cl ? '▸' + r.nDesc : '▾'; e.tog.className = 'sw-tog' + (cl ? ' on' : '');
          e.tog.setAttribute('aria-label', (cl ? 'Expand ' : 'Collapse ') + r.nDesc + ' subagents of ' + a.name); e.tog.title = (cl ? 'Show ' : 'Hide ') + r.nDesc + ' subagent lane' + (r.nDesc === 1 ? '' : 's');
        }
      });
      if (seq !== laneSeq) { laneSeq = seq; L.vis.forEach(function (r) { labels.appendChild(laneEls[r.id].box); }); }
    }
    function lastBlock(a) { for (var i = a.segs.length - 1; i >= 0; i--) if (a.segs[i].k === 'block') return a.segs[i].reason; return ''; }

    /* ------------------------------------------------------------- time axis */
    function viewTargets(now) {
      if (mode === 'manual') return { start: man.start, span: man.span };
      var fit = Math.max(MIN_SPAN, now * 1.12 + 1000);
      if (fit <= MAX_SPAN) return { start: 0, span: fit };
      return { start: now + MAX_SPAN * 0.1 - MAX_SPAN, span: MAX_SPAN };
    }
    function X(t) { return (t - dv.start) / dv.span * geo.W; }
    function T(x) { return dv.start + x / geo.W * dv.span; }
    function tickStep(span, W) {
      var steps = [250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 1800000];
      for (var i = 0; i < steps.length; i++) if (steps[i] / span * W >= 78) return steps[i];
      return steps[steps.length - 1];
    }
    function tickLabel(t, step) {
      if (t >= 120000 || step >= 60000) { var m = Math.floor(t / 60000), s = Math.round((t % 60000) / 1000); return m + ':' + (s < 10 ? '0' : '') + s; }
      return (step < 1000 ? (t / 1000).toFixed(2).replace(/0$/, '') : (t / 1000).toString()) + 's';
    }

    /* ------------------------------------------------------------- drawing helpers */
    function txt(x, y, str, o) {
      o = o || {};
      return '<text x="' + fx(x) + '" y="' + fx(y) + '" font-size="' + (o.size || 11) + '" fill="' + (o.fill || INK) + '"' + (o.anchor ? ' text-anchor="' + o.anchor + '"' : '') +
        (o.weight ? ' font-weight="' + o.weight + '"' : '') + (o.ls ? ' letter-spacing="' + o.ls + '"' : '') + (o.op ? ' opacity="' + o.op + '"' : '') + ' pointer-events="none">' + esc(str) + '</text>';
    }
    function fit(str, px, cw) { var n = Math.floor(px / (cw || 6.5)); if (n <= 0) return ''; return str.length <= n ? str : (n > 2 ? str.slice(0, n - 1) + '…' : ''); }
    function pill(x, y, w, h, fill, text, tfill) { return '<rect x="' + fx(x) + '" y="' + fx(y) + '" width="' + fx(w) + '" height="' + h + '" rx="' + h / 2 + '" fill="' + fill + '"/>' + txt(x + w / 2, y + h / 2 + 4, text, { size: 11, fill: tfill, anchor: 'middle', ls: '.4', weight: 700 }); }
    function bez(x1, y1, c1x, c1y, c2x, c2y, x2, y2, n) { var pts = []; for (var i = 0; i <= n; i++) { var u = i / n, v = 1 - u; pts.push([v * v * v * x1 + 3 * v * v * u * c1x + 3 * v * u * u * c2x + u * u * u * x2, v * v * v * y1 + 3 * v * v * u * c1y + 3 * v * u * u * c2y + u * u * u * y2]); } return pts; }
    function fmtT(ms) { return (ms / 1000).toFixed(1) + 's'; }
    function dur(ms) { return ms < 950 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1) + ' s'; }
    function tipOf(cls, title, lines) { return { cls: cls || '', title: title, lines: lines || [] }; }

    /* ------------------------------------------------------------- render */
    function render() {
      var s = ctx.state(), now = nowOf(s), L, i;
      var bodyH0 = body.clientHeight || 400;
      L = computeLanes(bodyH0); geo.L = L;
      var n = Math.max(1, L.vis.length);
      var laneH = U.clamp(bodyH0 / n, MINLANE, MAXLANE); geo.laneH = laneH; geo.bodyH = bodyH0;
      var total = Math.max(bodyH0, Math.ceil(L.vis.length * laneH)); geo.total = total;
      inner.style.height = total + 'px';
      var bodyW = body.clientWidth || 800; var W = Math.max(200, bodyW - GUT - PAD); geo.W = W;
      var snap = reduced() || snapNext; snapNext = false;
      /* lane targets */
      L.vis.forEach(function (r, idx) {
        var ty = idx * laneH;
        if (laneY[r.id] === undefined) { var pr = r.parent && laneY[r.parent] !== undefined ? laneY[r.parent] : ty; laneY[r.id] = snap ? ty : pr; }
        if (snap) laneY[r.id] = ty;
        r.ty = ty;
      });
      Object.keys(laneY).forEach(function (id) { if (L.visSet[id] === undefined) delete laneY[id]; });
      /* view target */
      var vt = viewTargets(now); geo.tgtStart = vt.start; geo.tgtSpan = vt.span;
      if (!dv.init || snap) { dv.start = vt.start; dv.span = vt.span; dv.init = true; }

      var yc = function (id) { return laneY[id] + laneH / 2; };
      var barH = Math.round(U.clamp(laneH * 0.42, 14, 20));
      var sel = ctx.selected(), selected = sel, P = [];
      hits = [];
      var PW = W + PAD;
      plot.setAttribute('width', PW); plot.setAttribute('height', total); axis.setAttribute('width', PW);
      empty.style.display = L.vis.length ? 'none' : '';

      /* defs */
      P.push('<defs><pattern id="sw-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="' + AMBER + '"/><line x1="0" y1="0" x2="0" y2="7" stroke="' + BG + '" stroke-width="1.6"/></pattern></defs>');
      /* rows */
      L.vis.forEach(function (r) {
        var y0 = laneY[r.id];
        if (sel === r.id) P.push('<rect x="0" y="' + fx(y0) + '" width="' + PW + '" height="' + fx(laneH) + '" fill="' + TEAL + '" opacity=".10"/>');
        P.push('<line x1="0" x2="' + PW + '" y1="' + fx(y0 + laneH) + '" y2="' + fx(y0 + laneH) + '" stroke="' + MIST + '" stroke-opacity=".6"/>');
      });
      /* time grid */
      var step = tickStep(dv.span, W), t0 = Math.ceil(dv.start / step) * step, ticks = [];
      for (var tt = t0; X(tt) <= PW; tt += step) { var tx = X(tt); if (tx >= 0) { ticks.push([tx, tt]); P.push('<line x1="' + fx(tx) + '" x2="' + fx(tx) + '" y1="0" y2="' + total + '" stroke="' + MIST + '" stroke-opacity=".5"/>'); } }

      /* dependency threads for the selected agent (both directions) */
      if (sel && M.agents[sel] && L.visSet[rowOf(sel)] !== undefined) {
        var sa = M.agents[sel];
        var dep = function (fromId, toId, tAt) {
          var fr = rowOf(fromId), tr = rowOf(toId); if (!fr || !tr || fr === tr) return;
          var x = X(tAt); if (x < -4 || x > PW + 4) return;
          P.push('<path d="M' + fx(x) + ' ' + fx(yc(fr)) + 'V' + fx(yc(tr)) + '" stroke="' + SLATE + '" stroke-width="1.6" stroke-dasharray="2 3" fill="none"/>');
          P.push('<circle cx="' + fx(x) + '" cy="' + fx(yc(tr)) + '" r="3" fill="none" stroke="' + SLATE + '" stroke-width="1.4"/>');
          hits.push({ kind: 'curve', pr: 3, pts: [[x, yc(fr)], [x, yc(tr)]], id: toId, tip: tipOf('', 'DEPENDENCY', [M.agents[toId].label + ' waits for ' + M.agents[fromId].label]) });
        };
        sa.deps.forEach(function (d) { var da = M.agents[d]; if (da) dep(d, sel, da.endAt != null ? da.endAt : now); });
        M.order.forEach(function (id) { var o = M.agents[id]; if (o.deps.indexOf(sel) >= 0) dep(sel, id, sa.endAt != null ? sa.endAt : now); });
      }

      /* segments */
      L.vis.forEach(function (r) {
        var a = M.agents[r.id], y = yc(r.id), by = y - barH / 2;
        a.segs.forEach(function (sg) {
          var xa = X(sg.t0), xb = X(sg.t1 == null ? now : sg.t1);
          if (xb < -4 || xa > PW + 4) return;
          var ca = Math.max(xa, -3), cb = Math.min(xb, PW + 3);
          if (sg.k === 'wait' || sg.k === 'queue') {
            if (cb - ca < 1) return;
            var dn = a.deps.map(function (d) { return M.agents[d] ? M.agents[d].label : d; });
            P.push('<path d="M' + fx(ca) + ' ' + fx(y) + 'H' + fx(cb) + '" stroke="' + (sg.k === 'wait' ? SLATE : MIST) + '" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 5" fill="none"/>');
            if (sg.k === 'wait' && cb - ca > 70 && laneH >= 34) P.push(txt(Math.max(ca, 0) + 4, by - 1, fit('waits for ' + dn.join(', '), cb - Math.max(ca, 0) - 8, 5.9), { size: 10, fill: SLATE }));
            hits.push({ kind: 'box', pr: 5, x: ca, y: y - 6, w: cb - ca, h: 12, id: a.id, tip: tipOf('', a.label + ' · ' + (sg.k === 'wait' ? 'WAITING' : 'READY, NOT STARTED'), [sg.k === 'wait' ? 'Waiting for ' + dn.join(', ') + '.' : 'Dependencies are done; work has not started.', fmtT(sg.t0) + ' → ' + (sg.t1 == null ? 'now' : fmtT(sg.t1))]) });
          } else if (sg.k === 'work') {
            var w = Math.max(cb - ca, 3);
            var fill = sg.failed ? RUST : (a.phase === 'done' ? INK : TEAL);
            P.push('<rect x="' + fx(ca) + '" y="' + fx(by) + '" width="' + fx(w) + '" height="' + barH + '" rx="2" fill="' + fill + '"/>');
            var tl = sg.tools, k;
            if (sg.attempt > 1 && w > 26) P.push(txt(ca + 4, by + barH / 2 + 3.8, '#' + sg.attempt, { size: 10.5, fill: '#fff', weight: 700 }));
            for (k = 0; k < tl.length; k++) {
              var tl0 = tl[k], tx0 = X(tl0.t), nx = k + 1 < tl.length ? X(tl[k + 1].t) : (sg.t1 == null ? X(now) : X(sg.t1));
              if (tx0 > PW || nx < 0) continue;
              var te = Math.min(X(tl0.t + tl0.dur), nx, X(now));
              if (te > tx0) P.push('<rect x="' + fx(Math.max(tx0, 0)) + '" y="' + fx(by + barH - 3) + '" width="' + fx(Math.max(te - Math.max(tx0, 0), 1.5)) + '" height="3" fill="#fff" opacity=".5"/>');
              if (tx0 > ca + 3) P.push('<line x1="' + fx(tx0) + '" x2="' + fx(tx0) + '" y1="' + fx(by + 2) + '" y2="' + fx(by + barH - 2) + '" stroke="#fff" stroke-opacity=".65"/>');
              var lx = Math.max(tx0, ca) + (sg.attempt > 1 && k === 0 ? 24 : 4);
              var label = fit(tl0.tool, nx - lx - 4, 6.4);
              if (label && tx0 > -1) P.push(txt(lx, by + barH / 2 + 3.8, label, { size: 10.5, fill: '#fff' }));
              hits.push({ kind: 'box', pr: 4, x: Math.max(tx0, 0), y: by, w: Math.max(Math.min(X(tl0.t + tl0.dur), nx) - tx0, 6), h: barH, id: a.id,
                tip: tipOf('', a.label + ' · TOOL', [tl0.tool + (tl0.input ? ' · ' + tl0.input : ''), 'called at ' + fmtT(tl0.t) + (tl0.dur ? ' · ' + dur(tl0.dur) : '')]) });
            }
            hits.push({ kind: 'box', pr: 5, x: ca, y: by, w: w, h: barH, id: a.id, tip: tipOf(sg.failed ? 't-fail' : '', a.label + ' · ' + (sg.failed ? 'FAILED ATTEMPT ' + sg.attempt : sg.t1 == null && a.phase === 'working' ? 'WORKING' : 'WORKED'),
              [(a.work ? a.work : a.name), fmtT(sg.t0) + ' → ' + (sg.t1 == null ? 'now' : fmtT(sg.t1)) + (sg.attempt > 1 ? ' · attempt ' + sg.attempt : '')]) });
          } else if (sg.k === 'block') {
            var wb = Math.max(cb - ca, 3);
            P.push('<rect x="' + fx(ca) + '" y="' + fx(by) + '" width="' + fx(wb) + '" height="' + barH + '" rx="2" fill="url(#sw-hatch)" stroke="' + AMBER + '"/>');
            hits.push({ kind: 'box', pr: 5, x: ca, y: by, w: wb, h: barH, id: a.id, tip: tipOf('t-block', a.label + ' · BLOCKED', [sg.reason + (sg.needs ? ' (needs ' + sg.needs + ')' : ''), fmtT(sg.t0) + ' → ' + (sg.t1 == null ? 'now' : fmtT(sg.t1))]) });
          } else if (sg.k === 'fail') {
            if (cb - ca < 1) return;
            P.push('<path d="M' + fx(ca) + ' ' + fx(y) + 'H' + fx(cb) + '" stroke="' + RUST + '" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 5" fill="none"/>');
            hits.push({ kind: 'box', pr: 5, x: ca, y: y - 6, w: cb - ca, h: 12, id: a.id, tip: tipOf('t-fail', a.label + ' · FAILED, NOT RETRIED YET', [sg.error]) });
          }
        });
      });

      /* collapsed subagent summary: one thin stripe on the parent lane covering the span of its hidden lanes */
      Object.keys(L.collapsed).forEach(function (pid) {
        if (L.visSet[pid] === undefined) return;
        var r = L.info[pid], lo = Infinity, hi = -Infinity, cnt = 0;
        (function walk(id) { L.info[id].kids.forEach(function (c) { var a = M.agents[c]; cnt++; lo = Math.min(lo, a.spawnAt); hi = Math.max(hi, a.endAt == null ? now : a.endAt); walk(c); }); })(pid);
        if (!cnt) return;
        var xa = Math.max(X(lo), -3), xb = Math.min(X(hi), PW + 3); if (xb - xa < 1) return;
        var yy = yc(pid) + barH / 2 + 3;
        P.push('<rect x="' + fx(xa) + '" y="' + fx(yy) + '" width="' + fx(xb - xa) + '" height="3" rx="1.5" fill="' + SLATE + '" opacity=".55"/>');
        hits.push({ kind: 'box', pr: 6, x: xa, y: yy - 3, w: xb - xa, h: 9, id: pid, tip: tipOf('', M.agents[pid].label + ' · ' + cnt + ' SUBAGENTS', ['Collapsed. Span of their work, ' + fmtT(lo) + ' → ' + fmtT(hi) + '. Use the arrow to expand.']) });
      });

      /* handoffs (delegation) */
      var touching = function (a, b) { return !sel || a === sel || b === sel; };
      M.handoffs.forEach(function (h) {
        var fr = rowOf(h.from), tr = rowOf(h.to); if (!fr || !tr || fr === tr) return;
        var x = X(h.t); if (x < -14 || x > PW + 4) return;
        var y1 = yc(fr), y2 = yc(tr), on = touching(h.from, h.to), op = on ? 1 : 0.22;
        P.push('<g opacity="' + op + '"><path d="M' + fx(x) + ' ' + fx(y1) + 'C' + fx(x + 5.3) + ' ' + fx(y1) + ' ' + fx(x + 5.3) + ' ' + fx(y2) + ' ' + fx(x + 10.7) + ' ' + fx(y2) + '" stroke="' + (sel && on ? INK : SLATE) + '" stroke-width="' + (sel && on ? 1.9 : 1.2) + '" fill="none"/>' +
          '<circle cx="' + fx(x) + '" cy="' + fx(y1) + '" r="2.6" fill="' + BG + '" stroke="' + SLATE + '" stroke-width="1.3"/><circle cx="' + fx(x + 10.7) + '" cy="' + fx(y2) + '" r="2.4" fill="' + SLATE + '"/></g>');
        if (on) hits.push({ kind: 'curve', pr: 3, pts: bez(x, y1, x + 5.3, y1, x + 5.3, y2, x + 10.7, y2, 12), id: h.to, tip: tipOf('', 'HANDOFF · ' + M.agents[h.from].label + ' → ' + M.agents[h.to].label, [h.text, fmtT(h.t)]) });
      });

      /* messages */
      var MW = 26;
      M.msgs.forEach(function (m) {
        var fr = rowOf(m.from), tr = rowOf(m.to); if (!fr || !tr || fr === tr) return;
        var x = X(m.t); if (x < -MW - 4 || x > PW + 4) return;
        var y1 = yc(fr), y2 = yc(tr), on = touching(m.from, m.to), op = on ? 1 : 0.22;
        P.push('<g opacity="' + op + '"><path d="M' + fx(x) + ' ' + fx(y1) + 'C' + fx(x + MW / 2) + ' ' + fx(y1) + ' ' + fx(x + MW / 2) + ' ' + fx(y2) + ' ' + fx(x + MW - 5) + ' ' + fx(y2) + '" stroke="' + TEAL + '" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="0.1 4.2" fill="none"/>' +
          '<path d="M' + fx(x + MW + 1) + ' ' + fx(y2) + 'l-7 -3.6v7.2z" fill="' + TEAL + '"/></g>');
        var recent = now - m.t >= 0 && now - m.t < 1600;
        if (on && (recent || (hoverTip && hoverTip.msg === m))) {
          var lw = Math.min(m.text.length * 6.4 + 12, 230), lxx = x + MW + 6; if (lxx + lw > PW - 2) lxx = Math.max(2, x - lw - 6);
          var ly = y2 - (y2 > y1 ? 0 : 0) - 8;
          P.push('<rect x="' + fx(lxx) + '" y="' + fx(ly) + '" width="' + fx(lw) + '" height="16" rx="8" fill="' + BG + '" stroke="' + TEAL + '"/>' + txt(lxx + 6, ly + 12, fit(m.text, lw - 10, 6.4), { size: 10.5, fill: DKTEAL }));
        }
        if (on) hits.push({ kind: 'curve', pr: 2, pts: bez(x, y1, x + MW / 2, y1, x + MW / 2, y2, x + MW - 5, y2, 12), id: m.from, msg: m, tip: tipOf('t-msg', 'MESSAGE · ' + M.agents[m.from].label + ' → ' + M.agents[m.to].label, [m.text, fmtT(m.t)]) });
      });

      /* result: line, threads from each contributing output */
      var rx = null;
      if (M.finished) rx = X(M.finished.t);

      /* outputs: page glyphs on the lane at the moment they appear */
      var lastGx = {}, glyphs = [];
      M.outs.slice().sort(function (a, b) { return a.t - b.t; }).forEach(function (o) {
        var row = rowOf(o.agentId); if (!row) return;
        var x = X(o.t); if (x < -8 || x > PW + 8) return;
        var gx = x; if (lastGx[row] !== undefined && gx < lastGx[row] + 14) gx = lastGx[row] + 14; lastGx[row] = gx;
        var y = yc(row), by = y - barH / 2;
        var gy = laneH >= 38 ? by - 9 : y - 6.5; gy = Math.max(gy, laneY[row] + 0.5);
        glyphs.push({ o: o, gx: gx, gy: gy, row: row });
      });
      var contrib = {}; if (M.finished) M.finished.outputIds.forEach(function (id) { contrib[id] = true; });
      glyphs.forEach(function (g) {
        if (rx != null && contrib[g.o.id] && rx > g.gx + 8)
          P.push('<path d="M' + fx(g.gx + 6) + ' ' + fx(g.gy + 6.5) + 'H' + fx(rx) + '" stroke="' + TEAL + '" stroke-width="1" stroke-opacity=".6" stroke-dasharray="2 3" fill="none"/><circle cx="' + fx(rx) + '" cy="' + fx(g.gy + 6.5) + '" r="2.6" fill="' + TEAL + '"/>');
      });
      if (rx != null) P.push('<line x1="' + fx(rx) + '" x2="' + fx(rx) + '" y1="0" y2="' + total + '" stroke="' + INK + '" stroke-width="2"/>');
      glyphs.forEach(function (g) {
        var a = M.agents[g.o.agentId];
        P.push('<g transform="translate(' + fx(g.gx - 5) + ' ' + fx(g.gy) + ')"><path d="M0.6 0.6h6.2l3.6 3.6v8.2H0.6z" fill="' + BG + '" stroke="' + DKTEAL + '" stroke-width="1.4" stroke-linejoin="round"/><path d="M6.8 0.6v3.6h3.6" fill="none" stroke="' + DKTEAL + '" stroke-width="1.2"/></g>');
        hits.push({ kind: 'box', pr: 1, x: g.gx - 7, y: g.gy - 1, w: 14, h: 15, id: g.o.agentId, tip: tipOf('', 'OUTPUT · ' + g.o.name, [g.o.kind + ' produced by ' + (a ? a.name : g.o.agentId), 'at ' + fmtT(g.o.t)]) });
      });

      /* failure markers and callouts for the current blocker / failure */
      L.vis.forEach(function (r) {
        var a = M.agents[r.id], y = yc(r.id);
        a.markers.forEach(function (mk) {
          var x = X(mk.t); if (x < -10 || x > PW + 10) return;
          P.push('<circle cx="' + fx(x) + '" cy="' + fx(y) + '" r="8" fill="' + RUST + '" stroke="' + BG + '" stroke-width="2"/><path d="M' + fx(x - 3) + ' ' + fx(y - 3) + 'l6 6M' + fx(x + 3) + ' ' + fx(y - 3) + 'l-6 6" stroke="' + BG + '" stroke-width="1.8" stroke-linecap="round"/>');
          hits.push({ kind: 'box', pr: 1, x: x - 9, y: y - 9, w: 18, h: 18, id: a.id, tip: tipOf('t-fail', a.label + ' · FAILED', [mk.error, 'at ' + fmtT(mk.t)]) });
        });
        var open = a.segs[a.segs.length - 1];
        if (open && open.t1 == null && (open.k === 'block' || open.k === 'fail')) {
          var isB = open.k === 'block', text = (isB ? open.reason : open.error).toUpperCase();
          var nx = X(isB ? now : open.t0) + (isB ? 10 : 14);
          var w = Math.min(text.length * 7.1 + 18, 250), px = nx; if (px + w > PW - 4) px = Math.max(PW - 4 - w, 2);
          var py = y - 9;
          P.push(pill(px, py, w, 18, isB ? AMBER : RUST, fit(text, w - 14, 7.1), isB ? INK : '#fff'));
          hits.push({ kind: 'box', pr: 1, x: px, y: py, w: w, h: 18, id: a.id, tip: tipOf(isB ? 't-block' : 't-fail', a.label + (isB ? ' · BLOCKED' : ' · FAILED'), [isB ? open.reason + (open.needs ? ' (needs ' + open.needs + ')' : '') : open.error, 'since ' + fmtT(open.t0)]) });
        }
      });

      /* NOW line (the result line replaces it when the run has finished) */
      var nowX = X(now);
      if (!M.finished && nowX >= -1 && nowX <= PW) P.push('<line x1="' + fx(nowX) + '" x2="' + fx(nowX) + '" y1="0" y2="' + total + '" stroke="' + INK + '" stroke-width="1.5" stroke-dasharray="4 4"/>');
      plot.innerHTML = P.join('');

      /* header axis */
      var A = [];
      A.push('<line x1="0" x2="' + PW + '" y1="59.5" y2="59.5" stroke="' + MIST + '" stroke-opacity=".6"/>');
      ticks.forEach(function (tk) {
        var tl = tickLabel(tk[1], step), ax = tk[0], anc = ax < 18 ? 'start' : 'middle';
        A.push('<line x1="' + fx(ax) + '" x2="' + fx(ax) + '" y1="52" y2="60" stroke="' + MIST + '"/>' + txt(ax, 46, tl, { size: 12, fill: SLATE, anchor: anc, ls: '1' }));
      });
      var tgt = M.finished ? M.finished.t : now, tgx = X(tgt);
      if (tgx >= -1 && tgx <= PW + 1) {
        var lw2 = M.finished ? 66 : 46, lx2 = U.clamp(tgx - lw2 / 2, 0, PW - lw2);
        A.push('<line x1="' + fx(tgx) + '" x2="' + fx(tgx) + '" y1="26" y2="60" stroke="' + INK + '" stroke-width="' + (M.finished ? 2 : 1.5) + '"' + (M.finished ? '' : ' stroke-dasharray="4 4"') + '/>');
        A.push(pill(lx2, 6, lw2, 20, INK, M.finished ? 'RESULT' : 'NOW', BG));
      } else {
        var right = tgx > PW;
        var cw = 70, cx2 = right ? PW - cw : 0;
        A.push(pill(cx2, 6, cw, 20, INK, right ? 'NOW ▸' : '◂ NOW', BG));
      }
      axis.innerHTML = A.join('');
      if (M.finished) hits.push({ kind: 'abs', tip: tipOf('', 'RESULT · ' + String(M.finished.status || '').toUpperCase(), [M.finished.summary || '', 'finished at ' + fmtT(M.finished.t) + ' · ' + M.finished.outputIds.length + ' outputs']) });

      /* progress cell */
      var pct = Math.round(s.progress * 100);
      progTop.textContent = (s.finished ? 'DONE' : 'TASK') + ' · ' + pct + '%'; progFill.style.width = pct + '%';
      var ttl = s.task ? s.task.title : 'Waiting for a task…'; if (progTitle.textContent !== ttl) { progTitle.textContent = ttl; prog.title = ttl + (s.task && s.task.goal ? ' — ' + s.task.goal : ''); }

      layoutLabels();
      btnFollow.classList.toggle('on', mode === 'follow');
      if (pendingScrollTo) { scrollLaneIntoView(pendingScrollTo); pendingScrollTo = null; }
      if (mouse && tip.style.display === 'block') hover(mouse.cx, mouse.cy, true);
    }

    function scrollLaneIntoView(id) {
      var r = geo.L.visSet[id]; if (r === undefined) return;
      var y = r * geo.laneH, h = geo.laneH, st = body.scrollTop, vh = body.clientHeight;
      var ns = st; if (y < st) ns = y; else if (y + h > st + vh) ns = y + h - vh;
      if (ns !== st) { body._prog = true; body.scrollTop = ns; }
    }

    /* ------------------------------------------------------------- interaction */
    function plotPoint(cx, cy) { var r = plot.getBoundingClientRect(); return { x: cx - r.left, y: cy - r.top }; }
    function curveDist(pts, x, y) { var best = 1e9; for (var i = 0; i < pts.length - 1; i++) { var ax = pts[i][0], ay = pts[i][1], bx = pts[i + 1][0], by = pts[i + 1][1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, u = l2 ? U.clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1) : 0, px = ax + u * dx, py = ay + u * dy, d = Math.hypot(x - px, y - py); if (d < best) best = d; } return best; }
    function pick(x, y) {
      var best = null, bs = 1e9;
      for (var i = 0; i < hits.length; i++) {
        var h = hits[i], d;
        if (h.kind === 'box') { if (x >= h.x - 2 && x <= h.x + h.w + 2 && y >= h.y - 2 && y <= h.y + h.h + 2) d = 0; else continue; }
        else if (h.kind === 'curve') { d = curveDist(h.pts, x, y); if (d > 6) continue; }
        else continue;
        var sc = h.pr * 100 + d; if (sc < bs) { bs = sc; best = h; }
      }
      return best;
    }
    function laneAt(y) { var idx = Math.floor(y / geo.laneH); var r = geo.L && geo.L.vis[idx]; return r ? r.id : null; }
    function showTip(t, cx, cy) {
      tip.className = 'sw-tip ' + (t.cls || ''); tip.innerHTML = '<b>' + esc(t.title) + '</b>' + t.lines.map(function (l, i) { return '<div class="' + (i ? 'm' : '') + '">' + esc(l) + '</div>'; }).join('');
      tip.style.display = 'block';
      var sr = stage.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
      var x = cx - sr.left + 14, y = cy - sr.top + 16; if (x + tw > sr.width - 6) x = cx - sr.left - tw - 14; if (y + th > sr.height - 6) y = cy - sr.top - th - 12;
      tip.style.left = Math.max(4, x) + 'px'; tip.style.top = Math.max(4, y) + 'px';
    }
    function hover(cx, cy, refresh) {
      var p = plotPoint(cx, cy), h = pick(p.x, p.y);
      hoverTip = h || null;
      plot.style.cursor = h ? 'pointer' : (drag ? 'grabbing' : 'grab');
      if (h) showTip(h.tip, cx, cy); else tip.style.display = 'none';
    }
    plot.addEventListener('pointermove', function (e) {
      mouse = { cx: e.clientX, cy: e.clientY };
      if (drag) {
        var dx = e.clientX - drag.x;
        if (!drag.moved && Math.abs(dx) > 4) { drag.moved = true; mode = 'manual'; man.start = dv.start; man.span = dv.span; tip.style.display = 'none'; }
        if (drag.moved) { man.start = drag.start - dx / geo.W * drag.span; man.span = drag.span; if (reduced()) { dv.start = man.start; dv.span = man.span; } render(); }
        return;
      }
      var hadTip = tip.style.display === 'block'; hover(e.clientX, e.clientY); if (hadTip !== (tip.style.display === 'block')) render();
    });
    plot.addEventListener('pointerleave', function () { mouse = null; hoverTip = null; tip.style.display = 'none'; });
    plot.addEventListener('pointerdown', function (e) { if (e.button !== 0) return; drag = { x: e.clientX, start: dv.start, span: dv.span, moved: false }; try { plot.setPointerCapture(e.pointerId); } catch (x) {} });
    plot.addEventListener('pointerup', function (e) {
      var d = drag; drag = null; try { plot.releasePointerCapture(e.pointerId); } catch (x) {}
      if (d && !d.moved) {
        var p = plotPoint(e.clientX, e.clientY), h = pick(p.x, p.y), id = h && h.id ? h.id : laneAt(p.y);
        if (id) ctx.select(id === ctx.selected() && !h ? null : id); else ctx.select(null);
      }
    });
    plot.addEventListener('wheel', function (e) {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomAt(plotPoint(e.clientX, e.clientY).x, Math.exp(e.deltaY * 0.0025)); }
      else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { e.preventDefault(); toManual(); man.start += (e.deltaX || e.deltaY) / geo.W * dv.span; if (reduced()) { dv.start = man.start; } render(); }
    }, { passive: false });
    body.addEventListener('scroll', function () { if (body._prog) { body._prog = false; return; } lastUserScroll = Date.now(); });

    function toManual() { if (mode !== 'manual') { mode = 'manual'; man.start = dv.start; man.span = dv.span; } }
    function zoomAt(px, factor) {
      toManual(); var tAt = T(px), ns = U.clamp(man.span * factor, 1500, 6 * 3600 * 1000);
      man.start = tAt - (px / geo.W) * ns; man.span = ns; if (reduced()) { dv.start = man.start; dv.span = ns; } render();
    }
    btnIn.onclick = function () { zoomAt(geo.W * 0.5, 1 / 1.4); };
    btnOut.onclick = function () { zoomAt(geo.W * 0.5, 1.4); };
    btnFollow.onclick = function () { mode = 'follow'; render(); };
    document.addEventListener('keydown', function (e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.key === '+' || e.key === '=') zoomAt(geo.W * 0.5, 1 / 1.4); else if (e.key === '-' || e.key === '_') zoomAt(geo.W * 0.5, 1.4);
      else if (e.key === 'f' || e.key === 'F') { mode = 'follow'; render(); }
    });

    /* scrub: click or drag the time axis to move the replay clock (not available on a live stream) */
    function scrubTo(cx) {
      var lab = window.__agentlab; if (!lab || !lab.player || lab.player.live) return;
      var x = cx - axis.getBoundingClientRect().left; var t = U.clamp(T(x), 0, lab.player.duration);
      lab.player.pause(); lab.player.seek(t);
    }
    axis.addEventListener('pointerdown', function (e) {
      if (isLive()) return;
      scrubbing = true; toManual(); try { axis.setPointerCapture(e.pointerId); } catch (x) {} scrubTo(e.clientX);
    });
    axis.addEventListener('pointermove', function (e) { if (scrubbing) scrubTo(e.clientX); });
    axis.addEventListener('pointerup', function (e) { if (!scrubbing) return; scrubbing = false; try { axis.releasePointerCapture(e.pointerId); } catch (x) {} mode = 'follow'; render(); });
    axis.title = 'Click or drag to scrub the replay clock';

    /* ------------------------------------------------------------- shared-chrome contract */
    function ease(dt) {
      var changed = false, k = 1 - Math.exp(-dt / 150);
      var ds = geo.tgtStart - dv.start, dp = geo.tgtSpan - dv.span;
      if (Math.abs(ds) > 0.5 || Math.abs(dp) > 0.5) { dv.start += ds * k; dv.span += dp * k; if (Math.abs(geo.tgtStart - dv.start) < 0.5) dv.start = geo.tgtStart; if (Math.abs(geo.tgtSpan - dv.span) < 0.5) dv.span = geo.tgtSpan; changed = true; }
      if (geo.L) geo.L.vis.forEach(function (r) { var d = r.ty - laneY[r.id]; if (Math.abs(d) > 0.3) { laneY[r.id] += d * k; changed = true; } else if (d) { laneY[r.id] = r.ty; changed = true; } });
      return changed;
    }
    return {
      update: function (s, events) {
        if (M.lastT > s.t + 1 && !events.length) rebuild(s);
        var spawned = null;
        for (var i = 0; i < events.length; i++) { ingest(events[i]); if (events[i].type === 'agent_spawned') spawned = events[i].agentId; }
        if (spawned && Date.now() - lastUserScroll > 4000) pendingScrollTo = spawned;
        render();
      },
      frame: function (dt) { if (reduced()) return; if (ease(dt)) render(); },
      onSelect: function (id) {
        if (id && rowOf(id) !== id) { var p = M.agents[id]; while (p && p.parentId) { if (geo.L.collapsed[p.parentId]) userToggle[p.parentId] = true; p = M.agents[p.parentId]; } }
        if (id) pendingScrollTo = id;
        render();
      },
      onReset: function (s) { rebuild(s); render(); },
      onMotionChange: function () { render(); },
      resize: function () { render(); }
    };
  }
});
