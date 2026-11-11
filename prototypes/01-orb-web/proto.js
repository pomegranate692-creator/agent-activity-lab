/* 01 Orb Web
 * The task is the hub (progress ring). Main agents sit on spokes; subagents hang further out on their
 * parent's thread. Everything is derived from `state` (ctx.state()); positions are computed, not hard-coded.
 * Time-based visuals (thread draw-out, beads, ripples, snap/mend) are driven by state.t (scenario clock),
 * so scrubbing, pausing and deterministic capture all show the same picture. Only position easing and the
 * progress ring use wall-clock smoothing, and both snap instantly under reduced motion.
 */
AgentChrome.mount({
  id: '01', name: 'Orb Web', tagline: 'Task hub, delegation threads, dependency arcs, message beads',
  create: function (stage, ctx) {
    var U = ctx.core.util, clamp = U.clamp, ease = U.ease;
    var E = function (n, a, p) { return U.svgEl(n, a, p); };
    var RAD = Math.PI / 180;

    stage.setAttribute('role', 'group'); // children are focusable buttons, so not an "img"
    var svg = E('svg', { 'class': 'ow', preserveAspectRatio: 'xMidYMid meet' }, stage);
    var gBg = E('g', {}, svg), gRings = E('g', {}, svg), gDeps = E('g', {}, svg), gThreads = E('g', {}, svg), gMsgs = E('g', {}, svg),
      gFx = E('g', {}, svg), gHubBack = E('g', {}, svg), gNodes = E('g', {}, svg), gOuts = E('g', {}, svg), gLabels = E('g', {}, svg), gKey = E('g', { 'class': 'key' }, svg);
    var bgRect = E('rect', { fill: 'transparent' }, gBg);
    bgRect.addEventListener('click', function () { ctx.select(null); });

    /* ------------------------------------------------------------------ view + layout state */
    var V = { w: 960, h: 640, cx: 480, cy: 320, Rx: 340, Ry: 250 };
    var L = { hubId: null, kids: {}, T: {}, D: 1, mains: [], dense: false, sc: 1, hubR: 46 };
    var P = {};            // id -> { x, y, tx, ty, ang, depth }
    var A = {}, DEP = {}, MSG = [], OUT = {}; // element pools
    var hover = null, dirty = true, snap = true, lastStateT = -1, settled = false;
    var shownProg = 0, relAng = 90, finishPulseT = null;

    function resize(sz) {
      var r = stage.getBoundingClientRect(); var w = (sz && sz.w) || r.width || 960, h = (sz && sz.h) || r.height || 640;
      V.w = w; V.h = h; svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h); bgRect.setAttribute('width', w); bgRect.setAttribute('height', h);
      V.cx = w / 2; V.cy = h / 2 + 4;
      V.Rx = Math.max(200, w / 2 - 92); V.Ry = Math.max(150, h / 2 - 66);
      buildKey(); dirty = true; snap = true;
    }

    /* ------------------------------------------------------------------ layout from state */
    function layout(s) {
      var kids = {}, roots = [];
      s.order.forEach(function (id) {
        var a = s.agents[id];
        if (a.parentId && s.agents[a.parentId]) (kids[a.parentId] = kids[a.parentId] || []).push(id); else roots.push(id);
      });
      L.kids = kids; L.hubId = roots.length === 1 ? roots[0] : null;
      var mains = L.hubId ? (kids[L.hubId] || []) : roots; L.mains = mains;
      var n = s.order.length; L.dense = n > 16; L.sc = n > 22 ? 0.62 : n > 16 ? 0.74 : n > 12 ? 0.9 : 1;
      L.hubR = Math.min(46 * (L.dense ? 0.82 : 1), V.Ry * 0.3);

      var leaves = {}, W = {};
      (function lv(ids) { ids.forEach(function (id) { var k = kids[id]; if (!k || !k.length) leaves[id] = 1; else { lv(k); var t = 0; k.forEach(function (c) { t += leaves[c]; }); leaves[id] = t; } W[id] = Math.pow(leaves[id], 0.7); }); })(mains);
      var T = {}, D = 1;
      function assign(id, a0, a1, d) {
        var ang = (a0 + a1) / 2; T[id] = { ang: ang, depth: d }; if (d > D) D = d;
        var k = kids[id]; if (!k || !k.length) return;
        var span = Math.min(a1 - a0, 34 + 24 * k.length), s0 = ang - span / 2, tw = 0, cur = s0;
        k.forEach(function (c) { tw += W[c]; });
        k.forEach(function (c) { var sw = span * W[c] / tw; assign(c, cur, cur + sw, d + 1); cur += sw; });
      }
      var tot = 0; mains.forEach(function (id) { tot += W[id]; });
      if (mains.length) {
        var unit = 360 / tot, cur = -90 - unit * W[mains[0]] / 2;
        mains.forEach(function (id) { var sw = unit * W[id]; assign(id, cur, cur + sw, 1); cur += sw; });
      }
      L.T = T; L.D = D;
      function rf(d) { return D === 1 ? 0.72 : 0.54 + 0.46 * (d - 1) / (D - 1); }
      L.rf = rf;
      if (L.hubId) P[L.hubId] = { x: V.cx, y: V.cy, tx: V.cx, ty: V.cy, ang: 0, depth: 0 };
      var minX = L.hubR + 64;
      Object.keys(T).forEach(function (id) {
        var t = T[id], r = rf(t.depth), rx = Math.max(V.Rx * r, minX + (t.depth - 1) * 70), ry = Math.max(V.Ry * r, L.hubR + 52 + (t.depth - 1) * 50);
        var tx = V.cx + rx * Math.cos(t.ang * RAD), ty = V.cy + ry * Math.sin(t.ang * RAD);
        var p = P[id]; if (!p) { p = P[id] = { x: tx, y: ty }; }
        p.tx = tx; p.ty = ty; p.ang = t.ang; p.depth = t.depth;
      });
      Object.keys(P).forEach(function (id) { if (!s.agents[id]) delete P[id]; });
    }

    function smoothPositions(dt, reduced) {
      var k = (reduced || snap) ? 1 : 1 - Math.exp(-dt / 140), moving = false;
      Object.keys(P).forEach(function (id) {
        var p = P[id]; var dx = p.tx - p.x, dy = p.ty - p.y;
        if (Math.abs(dx) + Math.abs(dy) < 0.15) { p.x = p.tx; p.y = p.ty; return; }
        p.x += dx * k; p.y += dy * k; moving = true;
      });
      return moving;
    }

    /* ------------------------------------------------------------------ small helpers */
    function lastT(a, kind) { for (var i = a.recent.length - 1; i >= 0; i--) if (a.recent[i].kind === kind) return a.recent[i].t; return -1; }
    function nsOf(a, t, reduced) { return reduced ? 1 : clamp((clamp((t - a.spawnedAt) / 900, 0, 1) - 0.8) / 0.2, 0, 1); }
    function lerp(a, b, u) { return a + (b - a) * u; }
    function q(p0, c, p1, u) { var v = 1 - u; return { x: v * v * p0.x + 2 * v * u * c.x + u * u * p1.x, y: v * v * p0.y + 2 * v * u * c.y + u * u * p1.y }; }
    function ctrl(a, b, sign, k) {
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      var px = -dy / len, py = dx / len;
      if (px * (V.cx - mx) + py * (V.cy - my) < 0) { px = -px; py = -py; }
      return { x: mx + px * sign * k * len, y: my + py * sign * k * len };
    }
    function setA(e, o) { for (var k in o) e.setAttribute(k, o[k]); return e; }
    function show(e, on) { e.setAttribute('display', on ? 'inline' : 'none'); }
    function wrap(text, n, maxLines) {
      var words = String(text).split(/\s+/), lines = [], cur = '';
      words.forEach(function (w) { if ((cur + ' ' + w).trim().length > n && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); });
      if (cur) lines.push(cur);
      if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,1}$/, '…'); }
      return lines;
    }

    /* ------------------------------------------------------------------ element pools */
    function mkPill(parent) {
      var g = E('g', { 'class': 'pill', display: 'none' }, parent);
      var r = E('rect', { 'class': 'pill-bg', rx: 9, ry: 9 }, g);
      var t1 = E('text', { 'text-anchor': 'middle' }, g), t2 = E('text', { 'text-anchor': 'middle' }, g);
      return { g: g, r: r, t1: t1, t2: t2 };
    }
    function setPill(pl, kind, lines, cx, cy) {
      var n = Math.max.apply(null, lines.map(function (l) { return l.length; })), w = n * 6.9 + 18, h = lines.length * 13 + 8;
      var x = clamp(cx - w / 2, 6, V.w - w - 6), y = clamp(cy - h / 2, 6, V.h - h - 6);
      pl.g.setAttribute('class', 'pill ' + kind); show(pl.g, true);
      setA(pl.r, { x: x, y: y, width: w, height: h });
      setA(pl.t1, { x: x + w / 2, y: y + 13 }); pl.t1.textContent = lines[0];
      setA(pl.t2, { x: x + w / 2, y: y + 26 }); pl.t2.textContent = lines[1] || ''; show(pl.t2, lines.length > 1);
    }
    function agentEls(a) {
      if (A[a.id]) return A[a.id];
      var o = { id: a.id };
      o.t1 = E('line', { 'class': 'th' }, gThreads); o.t2 = E('line', { 'class': 'th', display: 'none' }, gThreads);
      o.knot = E('g', { display: 'none' }, gThreads); E('circle', { 'class': 'knot-ring', r: 8.5 }, o.knot); E('circle', { 'class': 'knot-core', r: 4.5 }, o.knot);
      o.pulse1 = E('line', { 'class': 'pulse', display: 'none' }, gFx); o.pulse2 = E('line', { 'class': 'pulse', display: 'none' }, gFx);
      o.rip = E('circle', { 'class': 'rip', display: 'none' }, gFx);
      var g = o.g = E('g', { 'class': 'agent', tabindex: 0, role: 'button' }, gNodes);
      o.title = E('title', {}, g);
      o.hit = E('circle', { r: 17, fill: 'transparent' }, g);
      o.halo = E('circle', { 'class': 'halo' }, g); o.body = E('circle', { 'class': 'body' }, g);
      o.sel = E('circle', { 'class': 'selring' }, g); o.fring = E('circle', { 'class': 'fring' }, g);
      o.gCheck = E('polyline', { 'class': 'glyph', points: '-4,0.5 -1,3.5 4.5,-3' }, g);
      o.gPause = E('g', { 'class': 'glyph-fill' }, g); E('rect', { x: -3.6, y: -4, width: 2.5, height: 8, rx: .6 }, o.gPause); E('rect', { x: 1.1, y: -4, width: 2.5, height: 8, rx: .6 }, o.gPause);
      o.gX = E('path', { 'class': 'glyph', d: 'M-3.6 -3.6 L3.6 3.6 M3.6 -3.6 L-3.6 3.6' }, g);
      o.att = E('text', { 'class': 'att', display: 'none' }, g);
      o.lbl = E('text', { 'class': 'lbl' }, gLabels);
      o.pill = mkPill(gLabels); o.chip = mkPill(gLabels);
      g.addEventListener('click', function (e) { e.stopPropagation(); ctx.select(a.id); });
      g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); ctx.select(a.id); } });
      g.addEventListener('pointerenter', function () { hover = a.id; dirty = true; });
      g.addEventListener('pointerleave', function () { if (hover === a.id) hover = null; dirty = true; });
      g.addEventListener('focus', function () { hover = a.id; dirty = true; });
      g.addEventListener('blur', function () { if (hover === a.id) hover = null; dirty = true; });
      A[a.id] = o; return o;
    }
    function depEls(key) {
      if (DEP[key]) return DEP[key];
      var o = {}; o.path = E('path', { 'class': 'dep' }, gDeps); o.arrow = E('path', { 'class': 'dep-arrow', d: 'M-5 -4 L4 0 L-5 4 Z' }, gDeps);
      o.mid = E('g', {}, gDeps); o.open = E('circle', { 'class': 'dep-open', r: 5 }, o.mid);
      o.met = E('g', {}, o.mid); E('circle', { 'class': 'dep-met', r: 6.5 }, o.met); E('polyline', { 'class': 'dep-tick', points: '-3,0.5 -0.8,2.8 3.2,-2.2' }, o.met);
      DEP[key] = o; return o;
    }
    function msgEls(i) {
      if (MSG[i]) return MSG[i];
      var o = {}; o.path = E('path', { 'class': 'msg' }, gMsgs); o.bead = E('circle', { 'class': 'bead', r: 5 }, gMsgs); o.tag = E('text', { 'class': 'msg-tag', 'text-anchor': 'middle' }, gMsgs);
      MSG[i] = o; return o;
    }
    function outEls(id) {
      if (OUT[id]) return OUT[id];
      var o = {}; o.g = E('g', {}, gOuts); o.title = E('title', {}, o.g);
      o.page = E('path', { 'class': 'page', d: 'M-5.5 -7 L2 -7 L5.5 -3.5 L5.5 7 L-5.5 7 Z' }, o.g);
      o.fold = E('path', { 'class': 'page-ln', d: 'M2 -7 L2 -3.5 L5.5 -3.5' }, o.g); o.ln = E('path', { 'class': 'page-ln', d: 'M-3 0 L3 0 M-3 3 L3 3' }, o.g);
      o.tag = E('text', { 'class': 'out-tag' }, gLabels);
      OUT[id] = o; return o;
    }

    /* hub */
    var hub = {};
    hub.g = E('g', {}, gHubBack);
    hub.track = E('circle', { 'class': 'hub-track' }, hub.g); hub.arc = E('circle', { 'class': 'hub-arc' }, hub.g);
    hub.fin = E('circle', { 'class': 'rip', display: 'none' }, hub.g);
    hub.sock = E('g', {}, gHubBack); hub.sockShape = E('path', { d: 'M0 -8 L8 0 L0 8 L-8 0 Z' }, hub.sock); hub.sockLbl = E('text', { 'class': 'rel-lbl' }, gLabels);
    hub.ripAgent = E('circle', { 'class': 'rip', display: 'none' }, gFx);
    hub.taskLbl = E('text', { 'class': 'task-lbl', 'text-anchor': 'middle' }, gLabels);
    hub.ag = { id: null };
    (function () {
      var g = hub.ag.g = E('g', { 'class': 'agent', tabindex: -1, role: 'button' }, gNodes);
      hub.ag.title = E('title', {}, g); E('circle', { r: 26, fill: 'transparent' }, g);
      hub.ag.halo = E('circle', { 'class': 'halo' }, g); hub.ag.body = E('circle', { 'class': 'body' }, g);
      hub.ag.sel = E('circle', { 'class': 'selring' }, g); hub.ag.fring = E('circle', { 'class': 'fring' }, g);
      hub.ag.gCheck = E('polyline', { 'class': 'glyph', points: '-6,1 -2,5 7,-5', 'stroke-width': 3 }, g);
      hub.ag.lbl = E('text', { 'class': 'lbl', 'text-anchor': 'middle' }, gLabels);
      g.addEventListener('click', function (e) { e.stopPropagation(); ctx.select(L.hubId); });
      g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); ctx.select(L.hubId); } });
      g.addEventListener('pointerenter', function () { hover = L.hubId; dirty = true; }); g.addEventListener('pointerleave', function () { if (hover === L.hubId) hover = null; dirty = true; });
    })();

    /* key (legend for the encodings) */
    function buildKey() {
      while (gKey.firstChild) gKey.removeChild(gKey.firstChild);
      var x0 = 16, y0 = V.h - 16 - 6 * 17;
      E('rect', { x: x0 - 8, y: y0 - 16, width: 345, height: 6 * 17 + 20, rx: 8, fill: '#EAE8E1', 'fill-opacity': 0.88 }, gKey);
      var rows = [
        function (g, y) { E('line', { x1: x0, x2: x0 + 26, y1: y, y2: y, stroke: '#1F2528', 'stroke-width': 1.8 }, g); return 'thread = delegation'; },
        function (g, y) { E('path', { d: 'M' + x0 + ' ' + y + ' L' + (x0 + 26) + ' ' + y, stroke: '#56636A', 'stroke-width': 1.6, 'stroke-dasharray': '5 4', fill: 'none' }, g); return 'dashed arc = waits for (solid + tick when met)'; },
        function (g, y) { E('path', { d: 'M' + x0 + ' ' + y + ' L' + (x0 + 26) + ' ' + y, stroke: '#1F8A7A', 'stroke-width': 2, 'stroke-dasharray': '1.5 5', 'stroke-linecap': 'round' }, g); E('circle', { cx: x0 + 17, cy: y, r: 4, fill: '#1F8A7A' }, g); return 'bead on dotted arc = message'; },
        function (g, y) { E('line', { x1: x0, x2: x0 + 26, y1: y, y2: y, stroke: '#1F8A7A', 'stroke-width': 2.4 }, g); E('line', { x1: x0 + 11, x2: x0 + 20, y1: y, y2: y, stroke: '#5fd1bf', 'stroke-width': 4, 'stroke-linecap': 'round' }, g); return 'ripple + chip = tool call'; },
        function (g, y) { E('path', { d: 'M' + (x0 + 8) + ' ' + (y - 6) + ' h7 l3.5 3.5 v9 h-10.5 Z', fill: '#F3F1EA', stroke: '#1F8A7A', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }, g); return 'page = output (on its producer)'; },
        function (g, y) { E('circle', { cx: x0 + 13, cy: y, r: 4.5, fill: '#B7790A' }, g); E('circle', { cx: x0 + 13, cy: y, r: 8, fill: 'none', stroke: '#B7790A', 'stroke-width': 1.5 }, g); return 'knot = blocked · rust snap = failed'; }
      ];
      rows.forEach(function (fn, i) { var y = y0 + i * 17, t = E('text', { x: x0 + 36, y: y + 4 }, gKey); t.textContent = fn(gKey, y); });
    }

    /* ------------------------------------------------------------------ render */
    function nodeR(depth) { return (depth <= 1 ? 10.5 : 9) * L.sc; }

    function render(s, dtWall) {
      var reduced = ctx.reducedMotion(), sel = ctx.selected(), t = s.t;
      sel = sel && s.agents[sel] ? sel : null;
      var hubId = L.hubId, hubC = { x: V.cx, y: V.cy };
      var path = {}, rel = null;
      if (sel) {
        rel = {}; rel[sel] = 1; var pp = s.agents[sel].parentId; while (pp && s.agents[pp]) { rel[pp] = 1; path[pp] = 1; pp = s.agents[pp].parentId; } path[sel] = 1;
        s.agents[sel].children.forEach(function (c) { rel[c] = 1; });
        s.dependencies.forEach(function (d) { if (d.from === sel) rel[d.to] = 1; if (d.to === sel) rel[d.from] = 1; });
        s.messages.forEach(function (m) { if (m.from === sel) rel[m.to] = 1; if (m.to === sel) rel[m.from] = 1; });
      }
      var dim = function (id) { return rel && !rel[id] ? 0.3 : 1; };

      /* depth rings: one per delegation level, bowing in between main-agent spokes */
      while (gRings.firstChild) gRings.removeChild(gRings.firstChild);
      if (L.mains.length) {
        for (var d = 1; d <= L.D; d++) {
          var r = L.rf(d), rx = Math.max(V.Rx * r, L.hubR + 64 + (d - 1) * 70), ry = Math.max(V.Ry * r, L.hubR + 52 + (d - 1) * 50);
          var ms = L.mains.map(function (id) { return L.T[id].ang; }), dd = '';
          if (ms.length >= 3) {
            ms.forEach(function (ang, i) {
              var n2 = ms[(i + 1) % ms.length], a2 = n2 + (n2 <= ang ? 360 : 0), mid = (ang + a2) / 2;
              var p0 = { x: V.cx + rx * Math.cos(ang * RAD), y: V.cy + ry * Math.sin(ang * RAD) }, p1 = { x: V.cx + rx * Math.cos(a2 * RAD), y: V.cy + ry * Math.sin(a2 * RAD) };
              var c = { x: V.cx + rx * 0.86 * Math.cos(mid * RAD), y: V.cy + ry * 0.86 * Math.sin(mid * RAD) };
              if (i === 0) dd += 'M' + p0.x.toFixed(1) + ' ' + p0.y.toFixed(1);
              dd += ' Q' + c.x.toFixed(1) + ' ' + c.y.toFixed(1) + ' ' + p1.x.toFixed(1) + ' ' + p1.y.toFixed(1);
            });
            E('path', { 'class': 'ring', d: dd + ' Z' }, gRings);
          } else E('ellipse', { 'class': 'ring', cx: V.cx, cy: V.cy, rx: rx, ry: ry }, gRings);
        }
      }

      /* hub */
      var hubA = hubId ? s.agents[hubId] : null;
      var target = s.progress; if (reduced || snap) shownProg = target; else shownProg += (target - shownProg) * (1 - Math.exp(-dtWall / 220));
      if (Math.abs(target - shownProg) < 0.002) shownProg = target;
      var C = 2 * Math.PI * L.hubR;
      setA(hub.track, { cx: V.cx, cy: V.cy, r: L.hubR });
      setA(hub.arc, { cx: V.cx, cy: V.cy, r: L.hubR, transform: 'rotate(-90 ' + V.cx + ' ' + V.cy + ')', 'stroke-dasharray': (shownProg * C).toFixed(2) + ' ' + C.toFixed(2), 'class': 'hub-arc' + (shownProg >= 0.999 ? ' full' : '') });
      show(hub.arc, shownProg > 0.001);
      var pct = Math.round(s.progress * 100);
      hub.taskLbl.textContent = !s.task ? 'TASK · WAITING' : s.finished ? 'TASK · DONE' : 'TASK · ' + pct + '%';
      setA(hub.taskLbl, { x: V.cx, y: V.cy - L.hubR - 12 });
      var hs = hubA ? hubA.state : 'queued';
      hub.ag.g.setAttribute('class', 'agent st-' + hs + (sel && sel === hubId ? ' sel' : '')); hub.ag.g.setAttribute('transform', 'translate(' + V.cx + ' ' + V.cy + ')');
      hub.ag.g.setAttribute('tabindex', hubId ? 0 : -1); hub.ag.g.setAttribute('opacity', dim(hubId));
      var hr = 14 * Math.max(L.sc, 0.8);
      setA(hub.ag.body, { r: hr }); setA(hub.ag.halo, { r: hr + 8 }); setA(hub.ag.sel, { r: hr + 14 }); setA(hub.ag.fring, { r: hr + 12 });
      show(hub.ag.gCheck, hs === 'done');
      show(hub.ag.halo, hs === 'working' || hs === 'blocked');
      hub.ag.title.textContent = hubA ? hubA.name + ' (hub) · ' + U.stateWord(hubA) : 'Task hub';
      hub.ag.g.setAttribute('aria-label', hubA ? hubA.name + ', hub agent, ' + hubA.state : 'Task hub');
      setA(hub.ag.lbl, { x: V.cx, y: V.cy + L.hubR + 20 }); hub.ag.lbl.textContent = hubA ? hubA.label : ''; hub.ag.lbl.setAttribute('class', 'lbl' + (sel === hubId ? ' sel' : ''));
      // hub agent tool ripple
      show(hub.ripAgent, false);
      if (hubA && !reduced && hubA.toolAt != null && hubA.state === 'working') {
        var ha = t - hubA.toolAt; if (ha >= 0 && ha < 1000) { setA(hub.ripAgent, { cx: V.cx, cy: V.cy, r: hr + 4 + ease(ha / 1000) * 26, opacity: 1 - ha / 1000 }); show(hub.ripAgent, true); }
      }
      // final result: ring completes + release node lights up
      var finT = null; if (s.finished) { for (var li = s.log.length - 1; li >= 0; li--) if (s.log[li].kind === 'task' && /^Task finished/.test(s.log[li].text)) { finT = s.log[li].t; break; } }
      show(hub.fin, false);
      if (finT != null && !reduced && t - finT >= 0 && t - finT < 1400) { var fa = (t - finT) / 1400; setA(hub.fin, { cx: V.cx, cy: V.cy, r: L.hubR + 4 + ease(fa) * 70, opacity: 1 - fa }); show(hub.fin, true); }
      // release socket sits in the widest gap between main spokes
      var angs = L.mains.map(function (id) { return L.T[id].ang; }).sort(function (a, b) { return a - b; }), best = 90, bs = -1;
      if (angs.length) {
        angs.forEach(function (a0, i) {
          var a1 = i + 1 < angs.length ? angs[i + 1] : angs[0] + 360, gap = a1 - a0, mid = (a0 + a1) / 2, sn = Math.abs(Math.sin(mid * RAD));
          var sc2 = gap - (sn > 0.55 ? 45 : 0); if (sc2 > bs) { bs = sc2; best = mid; }
        });
      }
      var dA = ((best - relAng + 540) % 360) - 180; relAng = (reduced || snap) ? best : relAng + dA * (1 - Math.exp(-dtWall / 200));
      var rx2 = V.cx + L.hubR * Math.cos(relAng * RAD), ry2 = V.cy + L.hubR * Math.sin(relAng * RAD), lit = s.finished;
      hub.sock.setAttribute('transform', 'translate(' + rx2.toFixed(1) + ' ' + ry2.toFixed(1) + ') scale(' + (lit ? 1.15 : 0.85) + ')');
      hub.sockShape.setAttribute('class', lit ? 'rel-lit' : 'rel-sock');
      var relOut = (finT != null) ? s.outputs.filter(function (o) { return o.kind === 'release'; }).pop() : null;
      var cosA = Math.cos(relAng * RAD), sinA = Math.sin(relAng * RAD);
      hub.sockLbl.textContent = lit ? (relOut ? (/^release/i.test(relOut.name) ? relOut.name : 'RELEASE · ' + relOut.name) : 'RESULT · ' + s.finishedInfo.status).toUpperCase() : 'RESULT';
      setA(hub.sockLbl, { x: rx2 + cosA * 16, y: ry2 + sinA * 16 + 4, 'text-anchor': cosA > 0.35 ? 'start' : cosA < -0.35 ? 'end' : 'middle', 'class': 'rel-lbl' + (lit ? ' lit' : '') });
      hub.sockLbl.setAttribute('opacity', lit ? 1 : (L.dense ? 0 : 0.9));

      /* agents */
      var hubOrigin = hubC;
      s.order.forEach(function (id) {
        var a = s.agents[id], o = agentEls(a), p = P[id]; if (!p) return;
        var isHub = id === hubId;
        show(o.g, !isHub); o.g.setAttribute('tabindex', isHub ? -1 : 0); show(o.lbl, !isHub); if (isHub) { show(o.t1, false); show(o.t2, false); show(o.knot, false); show(o.pulse1, false); show(o.pulse2, false); show(o.rip, false); show(o.pill.g, false); show(o.chip.g, false); return; }
        var par = a.parentId && s.agents[a.parentId] ? P[a.parentId] : null, origin = par || hubOrigin;
        var prog = reduced ? 1 : clamp((t - a.spawnedAt) / 900, 0, 1), pe = ease(prog);
        var end = { x: lerp(origin.x, p.x, pe), y: lerp(origin.y, p.y, pe) };
        var ns = reduced ? 1 : clamp((prog - 0.8) / 0.2, 0, 1), nr = nodeR(p.depth), hot = !rel || rel[id], isSel = sel === id;
        var thHot = !rel || path[id] || a.parentId === sel;
        var op = rel ? (thHot ? 1 : 0.18) : 1;

        /* thread: spawn draw-out, state colour, knot (blocked), snap + mend (failed / retry) */
        var cls1 = 'th ' + a.state, cls2 = 'th ' + a.state, seg2 = false, knot = false, gap = 0, fade = 1;
        var failT = lastT(a, 'failed'), retryT = lastT(a, 'retry');
        if (a.state === 'failed') {
          var age = failT >= 0 ? t - failT : 9999, op1 = reduced ? 1 : clamp(age / 420, 0, 1); gap = 18 * ease(op1); fade = 1 - 0.55 * (reduced ? 1 : clamp(age / 900, 0, 1)); cls1 = cls2 = 'th failed';
        } else if (a.state === 'working' && !reduced && retryT >= 0 && failT >= 0 && retryT >= failT && t - retryT < 900) {
          var rr = clamp((t - retryT) / 900, 0, 1); gap = 18 * (1 - ease(rr)); fade = 0.45 + 0.55 * rr; cls1 = cls2 = 'th mend';
        }
        var dx = end.x - origin.x, dy = end.y - origin.y, len = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / len, uy = dy / len;
        if (gap > 0.6 && prog >= 1) {
          var bp = len * 0.58;
          setA(o.t1, { x1: origin.x, y1: origin.y, x2: origin.x + ux * (bp - gap / 2), y2: origin.y + uy * (bp - gap / 2), 'class': cls1 });
          setA(o.t2, { x1: origin.x + ux * (bp + gap / 2), y1: origin.y + uy * (bp + gap / 2), x2: end.x, y2: end.y, 'class': cls2 }); seg2 = true;
        } else if (a.state === 'blocked' && prog >= 1) {
          var kn = len * 0.55;
          setA(o.t1, { x1: origin.x, y1: origin.y, x2: origin.x + ux * kn, y2: origin.y + uy * kn, 'class': 'th done' });
          setA(o.t2, { x1: origin.x + ux * kn, y1: origin.y + uy * kn, x2: end.x, y2: end.y, 'class': 'th blocked-tail' }); seg2 = true; knot = true;
          o.knot.setAttribute('transform', 'translate(' + (origin.x + ux * kn).toFixed(1) + ' ' + (origin.y + uy * kn).toFixed(1) + ')');
        } else {
          setA(o.t1, { x1: origin.x, y1: origin.y, x2: end.x, y2: end.y, 'class': cls1 });
        }
        var tOp = op * fade;
        o.t1.setAttribute('opacity', tOp); o.t2.setAttribute('opacity', tOp); show(o.t2, seg2); show(o.knot, knot); o.knot.setAttribute('opacity', op);
        var wd = thHot && rel ? 1.2 : 0; o.t1.style.strokeWidth = wd ? '3' : ''; o.t2.style.strokeWidth = wd ? '3' : '';

        /* tool ripple along the thread (two pulses) and an arrival ring */
        show(o.pulse1, false); show(o.pulse2, false); show(o.rip, false);
        if (!reduced && a.toolAt != null && a.state === 'working' && prog >= 1) {
          var ta = t - a.toolAt;
          if (ta >= 0 && ta < 1300) {
            [[o.pulse1, 0], [o.pulse2, 330]].forEach(function (pr) {
              var u = clamp((ta - pr[1]) / 750, 0, 1); if (u <= 0 || u >= 1) return; var e2 = ease(u), s0 = Math.max(0, e2 - 0.16);
              setA(pr[0], { x1: lerp(origin.x, p.x, s0), y1: lerp(origin.y, p.y, s0), x2: lerp(origin.x, p.x, e2), y2: lerp(origin.y, p.y, e2), opacity: (1 - u * 0.5) * op }); show(pr[0], true);
            });
            if (ta > 650 && ta < 1300) { var ru = (ta - 650) / 650; setA(o.rip, { cx: p.x, cy: p.y, r: nr + 3 + ru * 16, opacity: (1 - ru) * op }); show(o.rip, true); }
          }
        }

        /* node */
        var popS = ns * (reduced ? 1 : 1 + (ns > 0 && ns < 1 ? 0.25 * Math.sin(ns * Math.PI) : 0));
        o.g.setAttribute('transform', 'translate(' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ') scale(' + Math.max(popS, 0.001).toFixed(3) + ')');
        o.g.setAttribute('class', 'agent st-' + a.state + (isSel ? ' sel' : '')); o.g.setAttribute('opacity', ns > 0 ? dim(id) : 0);
        o.g.setAttribute('aria-label', a.name + ', ' + a.state + (a.state === 'blocked' ? ': ' + a.blockedReason : a.state === 'failed' ? ': ' + a.error : '') + (a.attempt > 1 ? ', attempt ' + a.attempt : ''));
        o.title.textContent = a.name + ' · ' + U.stateWord(a);
        setA(o.body, { r: nr }); setA(o.halo, { r: nr + 5 }); setA(o.sel, { r: nr + 9 }); setA(o.fring, { r: nr + 7 });
        show(o.halo, a.state === 'working' || a.state === 'blocked');
        show(o.gCheck, a.state === 'done'); show(o.gPause, a.state === 'blocked'); show(o.gX, a.state === 'failed');
        var gs = (nr / 10.5).toFixed(2); [o.gCheck, o.gPause, o.gX].forEach(function (e) { e.setAttribute('transform', 'scale(' + gs + ')'); });
        if (a.attempt > 1) { show(o.att, true); setA(o.att, { x: nr + 2, y: -nr + 1 }); o.att.textContent = '×' + a.attempt; } else show(o.att, false);

        /* label: always for small teams; on hover/selection/problem states for dense ones */
        var rdx = p.x - V.cx, rdy = p.y - V.cy, rl = Math.sqrt(rdx * rdx + rdy * rdy) || 1, dirx = rdx / rl, diry = rdy / rl;
        var problem = a.state === 'blocked' || a.state === 'failed';
        var showLbl = ns > 0.5 && (!L.dense || p.depth <= 1 || problem || isSel || hover === id);
        show(o.lbl, showLbl);
        var side = Math.abs(dirx) > 0.35, lx = p.x + (side ? Math.sign(dirx) * (nr + 8) : 0), ly = p.y + (side ? 4 : (diry >= 0 ? nr + 17 : -nr - 8));
        setA(o.lbl, { x: lx.toFixed(1), y: ly.toFixed(1), 'text-anchor': side ? (dirx > 0 ? 'start' : 'end') : 'middle', 'class': 'lbl' + (a.state === 'waiting' || a.state === 'queued' ? ' dim' : '') + (isSel ? ' sel' : ''), opacity: dim(id) });
        o.lbl.textContent = a.label;

        /* callouts: blocked reason, failure, retry; tool chip while a tool call is in flight */
        var vs = diry >= 0 ? 1 : -1, py = p.y + vs * (nr + (side ? 18 : 34));
        var detail = hover === id || isSel;
        show(o.pill.g, false); show(o.chip.g, false);
        if (a.state === 'blocked') {
          var lines = wrap((a.blockedReason || 'blocked').toUpperCase(), L.dense && !detail ? 22 : 26, 2);
          setPill(o.pill, 'blocked', lines, p.x, py);
        } else if (a.state === 'failed') {
          setPill(o.pill, 'failed', wrap((a.error || 'failed').toUpperCase(), 26, 2), p.x, py);
        } else if (a.state === 'working' && a.attempt > 1 && retryT >= 0 && t - retryT < 2600 && ns > 0.5) {
          setPill(o.pill, 'retry', ['RETRY · ATTEMPT ' + a.attempt], p.x, py);
        } else if (a.state === 'working' && a.tool && a.toolAt != null && t - a.toolAt < Math.max(a.toolDuration || 0, 1100) + 500 && ns > 0.5 && (!L.dense || detail || true)) {
          setPill(o.chip, 'tool', [a.tool], p.x, py);
        }
        o.pill.g.setAttribute('opacity', dim(id)); o.chip.g.setAttribute('opacity', dim(id));
      });
      Object.keys(A).forEach(function (id) { if (!s.agents[id]) { var o = A[id]; [o.t1, o.t2, o.knot, o.pulse1, o.pulse2, o.rip, o.g, o.lbl, o.pill.g, o.chip.g].forEach(function (e) { e.remove(); }); delete A[id]; } });

      /* dependencies: dashed arc while open; solid with a tick once the dependency is done */
      var seen = {};
      s.dependencies.forEach(function (dep) {
        var f = s.agents[dep.from], to = s.agents[dep.to], pf = P[dep.from], pt = P[dep.to]; if (!f || !to || !pf || !pt) return;
        var key = dep.from + '>' + dep.to; seen[key] = 1; var o = depEls(key), met = f.state === 'done';
        var c = ctrl(pf, pt, 1, 0.3), mp = q(pf, c, pt, 0.5), ap = q(pf, c, pt, 0.86), ap2 = q(pf, c, pt, 0.9), flash = met && f.endedAt != null && !reduced && t - f.endedAt >= 0 && t - f.endedAt < 900;
        var hotD = !rel || dep.from === sel || dep.to === sel, vis = (to.state === 'done' && !flash && !hotD) ? 0.3 : 1;
        o.path.setAttribute('d', 'M' + pf.x.toFixed(1) + ' ' + pf.y.toFixed(1) + ' Q' + c.x.toFixed(1) + ' ' + c.y.toFixed(1) + ' ' + pt.x.toFixed(1) + ' ' + pt.y.toFixed(1));
        o.path.setAttribute('class', 'dep' + (flash ? ' flash' : met ? ' met' : ''));
        var ang = Math.atan2(ap2.y - ap.y, ap2.x - ap.x) / RAD;
        o.arrow.setAttribute('transform', 'translate(' + ap.x.toFixed(1) + ' ' + ap.y.toFixed(1) + ') rotate(' + ang.toFixed(1) + ')'); o.arrow.setAttribute('class', 'dep-arrow' + (met ? ' met' : ''));
        o.mid.setAttribute('transform', 'translate(' + mp.x.toFixed(1) + ' ' + mp.y.toFixed(1) + ')'); show(o.met, met); show(o.open, !met);
        var base = L.dense && !hotD ? 0.35 : 1; var oo = (rel ? (hotD ? 1 : 0.1) : vis * base) * Math.min(nsOf(f, t, reduced), nsOf(to, t, reduced));
        o.path.setAttribute('opacity', oo * (met && !flash ? 1 : 1)); o.arrow.setAttribute('opacity', oo); o.mid.setAttribute('opacity', (L.dense && !hotD) ? 0 : oo);
      });
      Object.keys(DEP).forEach(function (k) { if (!seen[k]) { DEP[k].path.remove(); DEP[k].arrow.remove(); DEP[k].mid.remove(); delete DEP[k]; } });

      /* messages: dotted arc + a bead that travels from sender to receiver */
      var mi = 0, msgs = s.messages, start = Math.max(0, msgs.length - 60);
      for (var i = start; i < msgs.length; i++) {
        var m = msgs[i], age = t - m.t, involved = sel && (m.from === sel || m.to === sel);
        var pf2 = P[m.from], pt2 = P[m.to]; if (!pf2 || !pt2) continue;
        var live = age >= 0 && age < 4200; if (!live && !involved) continue;
        var o2 = msgEls(mi++), c2 = ctrl(pf2, pt2, -1, 0.22);
        o2.path.setAttribute('d', 'M' + pf2.x.toFixed(1) + ' ' + pf2.y.toFixed(1) + ' Q' + c2.x.toFixed(1) + ' ' + c2.y.toFixed(1) + ' ' + pt2.x.toFixed(1) + ' ' + pt2.y.toFixed(1));
        var trav = reduced ? 1 : clamp(age / 1500, 0, 1), fadeM = live ? (age < 3000 ? 1 : 1 - (age - 3000) / 1200) : 0.35;
        var bp2 = q(pf2, c2, pt2, ease(trav));
        o2.path.setAttribute('opacity', (rel ? (involved ? 1 : 0.1) : 1) * fadeM);
        setA(o2.bead, { cx: bp2.x.toFixed(1), cy: bp2.y.toFixed(1), opacity: (rel && !involved ? 0.2 : 1) * (live ? fadeM : 0) }); show(o2.bead, live && (reduced ? age < 3000 : age < 2600));
        var showTag = live && age < (reduced ? 3000 : 2200) && (!L.dense || involved);
        o2.tag.textContent = m.text; setA(o2.tag, { x: bp2.x.toFixed(1), y: (bp2.y - 11).toFixed(1), opacity: fadeM }); show(o2.tag, showTag);
        show(o2.path, true);
      }
      for (; mi < MSG.length; mi++) { show(MSG[mi].path, false); show(MSG[mi].bead, false); show(MSG[mi].tag, false); }

      /* outputs: page glyphs attached to the producing agent */
      var seenO = {};
      s.outputs.forEach(function (out) {
        var a = s.agents[out.agentId], p = P[out.agentId]; if (!a || !p) return;
        seenO[out.id] = 1; var o = outEls(out.id), idx = a.outputs.indexOf(out.id);
        var isHubOut = out.agentId === hubId;
        var rdx = p.x - V.cx, rdy = p.y - V.cy, rl = Math.sqrt(rdx * rdx + rdy * rdy) || 1, dx = rdx / rl, dy = rdy / rl;
        var tx = -dy, ty = dx, nr = isHubOut ? 14 : nodeR(p.depth), off = nr + 10 + idx * 13 * L.sc;
        var gx = p.x + tx * off + dx * 3, gy = p.y + ty * off + dy * 3;
        if (isHubOut) { gx = V.cx + 26 + idx * 14; gy = V.cy - 2; }
        var age = t - out.t, pop = reduced ? 1 : (age >= 0 && age < 350 ? 1 + 0.9 * (1 - age / 350) : 1);
        o.g.setAttribute('transform', 'translate(' + gx.toFixed(1) + ' ' + gy.toFixed(1) + ') scale(' + (pop * (L.dense ? 0.78 : 1)).toFixed(3) + ')');
        o.page.setAttribute('class', 'page' + (out.kind === 'release' ? ' release' : ''));
        o.ln.setAttribute('d', out.kind === 'patch' ? 'M-3 0 L3 0 M0 -3 L0 3 M-3 4.5 L3 4.5' : out.kind === 'report' ? 'M-3 4 L-3 1 M0 4 L0 -1 M3 4 L3 2' : 'M-3 0 L3 0 M-3 3 L3 3');
        o.ln.setAttribute('stroke', out.kind === 'release' ? '#fff' : ''); o.fold.setAttribute('stroke', out.kind === 'release' ? '#fff' : '');
        o.title.textContent = out.name + ' · ' + a.name; o.g.setAttribute('opacity', age < 0 ? 0 : dim(out.agentId));
        var tagOn = age >= 0 && age < (reduced ? 2600 : 2200) || (sel === out.agentId) || hover === out.agentId;
        o.tag.textContent = out.name; var right = dx >= 0;
        setA(o.tag, { x: (gx + (right ? 10 : -10)).toFixed(1), y: (gy + 4).toFixed(1), 'text-anchor': right ? 'start' : 'end', opacity: dim(out.agentId) }); show(o.tag, tagOn && age >= 0);
      });
      Object.keys(OUT).forEach(function (k) { if (!seenO[k]) { OUT[k].g.remove(); OUT[k].tag.remove(); delete OUT[k]; } });
    }

    /* ------------------------------------------------------------------ contract */
    function run(dt) {
      var s = ctx.state(), reduced = ctx.reducedMotion();
      layout(s);
      var moving = smoothPositions(dt, reduced);
      render(s, dt);
      snap = false; lastStateT = s.t; dirty = false;
      settled = !moving && Math.abs(s.progress - shownProg) < 0.002;
    }
    return {
      update: function () { dirty = true; if (window.__agentlab && window.__agentlab.manual) run(0); },
      frame: function (dt) {
        var s = ctx.state(); if (!dirty && s.t === lastStateT && settled) return;
        run(dt);
      },
      onSelect: function () { dirty = true; },
      onMotionChange: function () { dirty = true; snap = true; },
      onReset: function (s) {
        Object.keys(A).forEach(function (id) { var o = A[id]; [o.t1, o.t2, o.knot, o.pulse1, o.pulse2, o.rip, o.g, o.lbl, o.pill.g, o.chip.g].forEach(function (e) { e.remove(); }); });
        A = {}; P = {}; Object.keys(DEP).forEach(function (k) { DEP[k].path.remove(); DEP[k].arrow.remove(); DEP[k].mid.remove(); }); DEP = {};
        Object.keys(OUT).forEach(function (k) { OUT[k].g.remove(); OUT[k].tag.remove(); }); OUT = {};
        snap = true; shownProg = 0; dirty = true;
      },
      resize: function (sz) { resize(sz); }
    };
  }
});
