/* 04 Routed Lattice
 * A circuit board on a dot grid. Agents are chips placed left to right by dependency level; every relation is an
 * orthogonal wire routed through channels between the columns (and through lanes above/below the board for long hops).
 *
 * Everything drawn is derived from the accumulated `state` (agents, delegations, dependencies, messages, outputs, t).
 * Nothing reads the scenario or unplayed events, so a live adapter feeds it unchanged.
 */
AgentChrome.mount({
  id: '04', name: 'Routed Lattice', tagline: 'Chips and wires on a dot grid. Everything that moves has a wire.',
  create: function (stage, ctx) {
    'use strict';
    var U = ctx.core.util, E = U.svgEl;
    var COLORS = { slate: '#56636A', ink: '#1F2528', mist: '#B7BCB8', acc: '#1F8A7A', accD: '#0f5d52', amber: '#B7790A', rust: '#B5472F', bg: '#EAE8E1', panel: '#F3F1EA' };

    /* ---- timing, all in scenario ms (derived from state.t, so scrubbing and replay are exact) ---- */
    var MSG_FLIGHT = 1300, MSG_LIFE = 4200, MSG_FADE = 1200, OUT_FLIGHT = 1700, RETRY_GLOW = 2600, TOOL_TAIL = 500;
    var SLOT = { deleg: -1, dep: 0, msg: 1, out: 1, task: 0 };       // pin slot (x slot spacing), left/right ports
    var MSG_CH = 2, LANE_STEP = 7;

    /* ---- DOM ---- */
    var scroll = document.createElement('div'); scroll.className = 'rl-scroll'; scroll.tabIndex = -1; stage.appendChild(scroll);
    var svg = E('svg', { xmlns: 'http://www.w3.org/2000/svg' }, scroll); svg.style.display = 'block';
    var defs = E('defs', null, svg);
    var pat = E('pattern', { id: 'rl-dots', width: 24, height: 24, patternUnits: 'userSpaceOnUse' }, defs);
    E('circle', { cx: 12, cy: 12, r: 1.15, fill: COLORS.mist }, pat);
    var gridRect = E('rect', { fill: 'url(#rl-dots)' }, svg);
    var gWires = E('g', null, svg), gTerm = E('g', null, svg), gChips = E('g', null, svg), gTop = E('g', { 'pointer-events': 'none' }, svg);
    var emptyTxt = E('text', { x: 24, y: 40, 'class': 'rl-empty' }, svg); emptyTxt.textContent = 'No agents yet. Chips appear here as agents are spawned.';

    scroll.addEventListener('click', function () { ctx.select(null); });
    var key = document.createElement('div'); key.className = 'rl-key'; stage.appendChild(key);
    function keyItem(svgInner, text) { var i = document.createElement('span'); i.className = 'rl-key-i'; i.innerHTML = '<svg viewBox="0 0 28 14" aria-hidden="true">' + svgInner + '</svg><span>' + text + '</span>'; key.appendChild(i); }
    keyItem('<path d="M1 7H27" stroke="' + COLORS.slate + '" stroke-width="2.4"/>', 'delegates');
    keyItem('<path d="M1 7H27" stroke="' + COLORS.ink + '" stroke-width="1.8" stroke-dasharray="5 3"/>', 'waits on');
    keyItem('<path d="M1 7H27" stroke="' + COLORS.ink + '" stroke-width="1.8"/>', 'met');
    keyItem('<path d="M1 7H27" stroke="' + COLORS.acc + '" stroke-width="3"/><circle cx="14" cy="7" r="4" fill="' + COLORS.acc + '" stroke="#fff" stroke-width="1.5"/>', 'message');
    keyItem('<path d="M9 1h7l4 4v8H9z" fill="' + COLORS.panel + '" stroke="' + COLORS.acc + '" stroke-width="1.4"/>', 'output');
    keyItem('<path d="M1 7H12M16 7H27" stroke="' + COLORS.slate + '" stroke-width="1.8"/><rect x="12" y="1" width="4" height="12" rx="1.5" fill="' + COLORS.amber + '"/>', 'blocked');
    keyItem('<path d="M1 7H8M20 7H27" stroke="' + COLORS.slate + '" stroke-width="1.8"/><path d="M12 2l3 4-3 1 3 5" fill="none" stroke="' + COLORS.rust + '" stroke-width="1.8"/>', 'failed');
    var sp = document.createElement('span'); sp.className = 'rl-key-sp'; key.appendChild(sp);
    var zoomBox = document.createElement('span'); zoomBox.className = 'rl-zoom'; key.appendChild(zoomBox);
    function zbtn(t, title, fn) { var b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.title = title; b.onclick = fn; zoomBox.appendChild(b); return b; }
    var zMinus = zbtn('−', 'Zoom out', function () { setZoom(curScale() / 1.2); });
    var zLbl = document.createElement('span'); zoomBox.appendChild(zLbl);
    var zPlus = zbtn('+', 'Zoom in', function () { setZoom(curScale() * 1.2); });
    var zAuto = zbtn('Auto', 'Readable size; scroll for the rest', function () { zoom = null; applySize(); });
    var zFit = zbtn('Fit all', 'Shrink the whole board into view', function () { zoom = fitScale(); applySize(); });

    /* ---- state ---- */
    var L = null, sig = '', disp = {}, chips = {}, anim = false, lastState = null, vb = { x: 0, y: 0, w: 800, h: 400 }, zoom = null, scale = 1, lastRoute = {};

    /* ======================================================================== layout */
    function computeLayout(s) {
      var ids = s.order.slice(), n = ids.length, A = s.agents;
      var compact = Math.max(s.plannedTotal || 0, n) > 14;
      var H = compact ? 26 : 36, PITCH = compact ? 60 : 76, maxLen = 4;
      ids.forEach(function (id) { maxLen = Math.max(maxLen, (A[id].label || '').length); });
      var W = Math.round(Math.max(78, maxLen * 7.9 + 33));

      // levels from parent and dependsOn relations (only agents that exist yet)
      var lv = {}; ids.forEach(function (id) { lv[id] = 0; });
      for (var it = 0; it < n + 2; it++) {
        var ch = false;
        ids.forEach(function (id) {
          var a = A[id], m = 0;
          if (a.parentId && A[a.parentId]) m = Math.max(m, lv[a.parentId] + 1);
          a.dependsOn.forEach(function (d) { if (A[d]) m = Math.max(m, lv[d] + 1); });
          if (m > lv[id] && m <= n) { lv[id] = m; ch = true; }
        });
        if (!ch) break;
      }
      var ncols = 0; ids.forEach(function (id) { ncols = Math.max(ncols, lv[id] + 1); });
      var cols = []; for (var c = 0; c < ncols; c++) cols.push([]);
      ids.forEach(function (id) { cols[lv[id]].push(id); });

      // edges (everything except transient messages)
      var edges = [], seen = {};
      s.delegations.forEach(function (d) { var k = 'g|' + d.from + '|' + d.to; if (seen[k] || !A[d.from] || !A[d.to]) return; seen[k] = 1; edges.push({ kind: 'deleg', from: d.from, to: d.to, key: k }); });
      s.dependencies.forEach(function (d) { var k = 'd|' + d.from + '|' + d.to; if (seen[k] || !A[d.from] || !A[d.to]) return; seen[k] = 1; edges.push({ kind: 'dep', from: d.from, to: d.to, key: k }); });
      ids.forEach(function (id) { if (!A[id].parentId) edges.push({ kind: 'task', from: 'TASK', to: id, key: 't|' + id }); });
      ids.forEach(function (id) { if (A[id].outputs.length) edges.push({ kind: 'out', from: id, to: 'REL', key: 'o|' + id }); });
      function colOf(id) { return id === 'TASK' ? -1 : id === 'REL' ? ncols : lv[id]; }
      edges.forEach(function (e) {
        e.sc = colOf(e.from); e.dc = colOf(e.to);
        e.direct = e.kind !== 'out' && e.dc === e.sc + 1;
        e.g1 = e.sc; e.g2 = e.kind === 'out' ? null : (e.direct ? null : e.dc - 1);
      });

      // gap widths from channel demand. Wires of the same net share a channel (a bus): same source+kind on the leaving side,
      // same target+kind on the arriving side. Messages reserve MSG_CH channels per gap.
      function chKey(e, which) { return which === 'x2' ? 'T|' + e.to + '|' + e.kind : 'S|' + e.from + '|' + e.kind; }
      var nets = {};   // gap -> { key -> [edges with which] }
      function addNet(g, e, which) { var m = nets[g] = nets[g] || {}, k = chKey(e, which); (m[k] = m[k] || []).push({ e: e, which: which }); }
      edges.forEach(function (e) { addNet(e.g1, e, 'x1'); if (e.g2 != null) addNet(e.g2, e, 'x2'); });
      var cnt = []; for (var g = 0; g <= ncols + 1; g++) cnt.push(nets[g - 1] ? Object.keys(nets[g - 1]).length : 0);
      var TW = 58, RW = 80, gw = cnt.map(function (k) { return U.clamp(10 + (k + MSG_CH) * 6, 36, 220); });
      var cx = {}; cx[-1] = 0; var gapL = {};
      gapL[-1] = TW; cx[0] = TW + gw[0];
      for (c = 0; c < ncols; c++) { gapL[c] = cx[c] + W; cx[c + 1] = gapL[c] + gw[c + 1]; }
      var relX = ncols > 0 ? cx[ncols] : TW + gw[0];
      function gapW(g) { return gw[g + 1]; }

      // rows: barycentric placement per column, left to right
      var yc = {};
      function isRoot(id) { return A[id] && !A[id].parentId; }
      cols.forEach(function (list) {
        var items = list.map(function (id, i) {
          var a = A[id], sum = 0, w = 0;
          if (a.parentId && A[a.parentId] && yc[a.parentId] != null) { var pw = isRoot(a.parentId) ? 0.3 : 1; sum += yc[a.parentId] * pw; w += pw; }
          a.dependsOn.forEach(function (d) { if (yc[d] != null) { sum += yc[d]; w += 1; } });
          return { id: id, want: w ? sum / w : null, ord: i };
        });
        var prev = -PITCH;
        items.forEach(function (it) { if (it.want == null) it.want = prev + PITCH; prev = it.want; });
        items.sort(function (a, b) { return a.want - b.want || a.ord - b.ord; });
        var last = -1e9, dev = 0;
        items.forEach(function (it) { it.y = Math.max(it.want, last + PITCH); last = it.y; dev += it.y - it.want; });
        var shift = -dev / items.length;
        items.forEach(function (it) { yc[it.id] = it.y + shift; });
      });
      var rootYs = ids.filter(isRoot).map(function (id) { return yc[id]; });
      yc.TASK = rootYs.length ? rootYs.reduce(function (a, b) { return a + b; }, 0) / rootYs.length : 0;
      var minC = 0, maxC = 0; if (n) { minC = 1e9; maxC = -1e9; ids.forEach(function (id) { minC = Math.min(minC, yc[id]); maxC = Math.max(maxC, yc[id]); }); }
      var chipTop = minC - H / 2, chipBot = maxC + H / 2;

      // channels: x for each net inside a gap, ordered by where its wires start
      Object.keys(nets).forEach(function (g) {
        g = Number(g); var m = nets[g], gl = gapL[g], w = gapW(g), keys = Object.keys(m);
        function ay(k) { var s = 0; m[k].forEach(function (u) { var id = u.which === 'x1' ? u.e.from : u.e.to; s += id === 'TASK' ? yc.TASK : id === 'REL' ? 0 : yc[id]; }); return s / m[k].length; }
        keys.sort(function (a, b) { return ay(a) - ay(b) || (a < b ? -1 : 1); });
        var inner = w - 16 - MSG_CH * 6, step = Math.min(6, inner / Math.max(1, keys.length));
        keys.forEach(function (k, i) { m[k].forEach(function (u) { u.e[u.which] = gl + 8 + i * step; }); });
      });

      // lanes for long hops (interval packing). Top pool for routes above the board's middle, bottom pool otherwise.
      var mid = (chipTop + chipBot) / 2;
      function rowY(id) { return id === 'TASK' ? yc.TASK : id === 'REL' ? mid : yc[id]; }
      var pools = { top: [], bottom: [], out: [] };
      edges.forEach(function (e) {
        if (e.direct) return;
        var pool = e.kind === 'out' ? 'out' : ((rowY(e.from) + rowY(e.to)) / 2 < mid ? 'top' : 'bottom');
        var x1 = e.x1, x2 = e.kind === 'out' ? relX : e.x2;
        e.pool = pool; e.lo = Math.min(x1, x2) - 3; e.hi = Math.max(x1, x2) + 3;
      });
      var laneCount = {};
      ['top', 'bottom', 'out'].forEach(function (p) {
        var list = edges.filter(function (e) { return e.pool === p; }).sort(function (a, b) { return a.lo - b.lo; });
        var ends = [];
        // outputs all end in the same RELEASE net, so they share one bus lane
        list.forEach(function (e) { var k = 0; if (p !== 'out') while (k < ends.length && ends[k] >= e.lo) k++; ends[k] = Math.max(ends[k] || 0, e.hi); e.lane = k; });
        laneCount[p] = ends.length;
      });
      var topBase = chipTop - 28, botBase = chipBot + 30;
      function laneY(pool, idx) {
        if (pool === 'top') return topBase - (MSG_CH * 2 + idx) * LANE_STEP;
        if (pool === 'bottom') return botBase + (MSG_CH * 2 + idx) * LANE_STEP;
        return topBase - (MSG_CH * 2 + laneCount.top + idx + 1) * LANE_STEP;
      }
      edges.forEach(function (e) { if (e.pool) e.laneY = laneY(e.pool, e.lane); });
      var topEdge = laneCount.out ? laneY('out', laneCount.out - 1) : (laneCount.top ? laneY('top', laneCount.top - 1) : topBase - MSG_CH * 2 * LANE_STEP);
      var botEdge = laneCount.bottom ? laneY('bottom', laneCount.bottom - 1) : botBase + MSG_CH * 2 * LANE_STEP;
      topEdge = Math.min(topEdge, chipTop - 24) - 10; botEdge = Math.max(botEdge, chipBot + 24) + 8;
      if (!n) { topEdge = -40; botEdge = 60; }

      var tgt = {};
      ids.forEach(function (id) { tgt[id] = { x: cx[lv[id]], y: yc[id] - H / 2 }; });
      return { ids: ids, lv: lv, ncols: ncols, W: W, H: H, PITCH: PITCH, compact: compact, TW: TW, RW: RW, gapL: gapL, gw: gw, cx: cx, yc: yc, edges: edges,
        relX: relX, tgt: tgt, topEdge: topEdge, botEdge: botEdge, chipTop: chipTop, chipBot: chipBot, topBase: topBase, botBase: botBase, laneCount: laneCount, empty: !n,
        right: relX + RW };
    }

    /* ======================================================================== geometry helpers */
    function f1(v) { return Math.round(v * 10) / 10; }
    function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
    function clean(pts) {
      var p = [pts[0]];
      for (var i = 1; i < pts.length; i++) { var q = p[p.length - 1]; if (Math.abs(pts[i][0] - q[0]) < 0.05 && Math.abs(pts[i][1] - q[1]) < 0.05) continue; p.push(pts[i]); }
      return p;
    }
    function rpath(pts, r) {
      var p = clean(pts); if (p.length < 2) return '';
      var d = 'M' + f1(p[0][0]) + ' ' + f1(p[0][1]);
      for (var i = 1; i < p.length - 1; i++) {
        var a = p[i - 1], b = p[i], c = p[i + 1], l1 = dist(a, b), l2 = dist(b, c), rr = Math.min(r, l1 / 2, l2 / 2);
        var cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if (Math.abs(cr) < 0.01) { d += 'L' + f1(b[0]) + ' ' + f1(b[1]); continue; }
        var p1 = [b[0] - (b[0] - a[0]) / l1 * rr, b[1] - (b[1] - a[1]) / l1 * rr], p2 = [b[0] + (c[0] - b[0]) / l2 * rr, b[1] + (c[1] - b[1]) / l2 * rr];
        d += 'L' + f1(p1[0]) + ' ' + f1(p1[1]) + 'Q' + f1(b[0]) + ' ' + f1(b[1]) + ' ' + f1(p2[0]) + ' ' + f1(p2[1]);
      }
      var z = p[p.length - 1]; return d + 'L' + f1(z[0]) + ' ' + f1(z[1]);
    }
    function plen(pts) { var t = 0; for (var i = 1; i < pts.length; i++) t += dist(pts[i - 1], pts[i]); return t; }
    function pointAt(pts, frac) {
      var tot = plen(pts), want = tot * U.clamp(frac, 0, 1), acc = 0;
      for (var i = 1; i < pts.length; i++) { var l = dist(pts[i - 1], pts[i]); if (acc + l >= want && l > 0) { var k = (want - acc) / l; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k]; } acc += l; }
      return pts[pts.length - 1];
    }
    function trimEnd(pts, len) {
      var p = clean(pts).slice(), left = len;
      while (p.length > 1) {
        var a = p[p.length - 2], b = p[p.length - 1], l = dist(a, b);
        if (l > left) { var k = (l - left) / l; p[p.length - 1] = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]; return p; }
        left -= l; p.pop();
      }
      return p;
    }
    function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function clip(t, n) { t = String(t || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
    function pillW(t, cw) { return Math.round(String(t).length * (cw || 7.3) + 18); }

    /* ======================================================================== ports and routes */
    function nodeBox(id) {
      if (id === 'TASK') return { x: 0, y: L.yc.TASK - 46, w: L.TW, h: 92 };
      if (id === 'REL') return { x: L.relX, y: L.topEdge + 6, w: L.RW, h: L.botEdge - L.topEdge - 12 };
      var d = disp[id] || L.tgt[id]; return { x: d.x, y: d.y, w: L.W, h: L.H };
    }
    function slotOff(kind) { return SLOT[kind] * (L.compact ? 6 : 9); }
    function route(e, attempt) {
      var A = nodeBox(e.from), B = nodeBox(e.to), off = slotOff(e.kind);
      var sy = A.y + A.h / 2 + (e.from === 'TASK' ? 0 : off), sx = A.x + A.w;
      var ty = B.y + B.h / 2 + (e.to === 'REL' ? 0 : off), tx = B.x;
      var x1 = e.x1, x2 = e.x2;
      if (attempt > 1 && e.to !== 'REL' && e.kind !== 'out') { // retry reroutes the wire: it takes a different channel into the chip
        var gl = L.gapL[e.dc - 1], lim = gl + L.gw[e.dc] - 6, sh = 5 * (attempt - 1);
        if (e.direct) x1 = Math.min(lim - MSG_CH * 6, x1 + sh); else x2 = Math.min(lim - MSG_CH * 6, x2 + sh);
      }
      if (e.kind === 'out') return [[sx, sy], [x1, sy], [x1, e.laneY], [L.relX, e.laneY]];
      if (e.direct) return [[sx, sy], [x1, sy], [x1, ty], [tx, ty]];
      return [[sx, sy], [x1, sy], [x1, e.laneY], [x2, e.laneY], [x2, ty], [tx, ty]];
    }
    function msgRoute(m, idx) {
      var A = nodeBox(m.from), B = nodeBox(m.to), off = slotOff('msg');
      var sy = A.y + A.h / 2 + off, sx = A.x + A.w, ty = B.y + B.h / 2 + off, tx = B.x;
      var sc = L.lv[m.from], dc = L.lv[m.to], j = idx % MSG_CH;
      var gS = sc, gD = dc - 1;
      function mx(g) { return L.gapL[g] + L.gw[g + 1] - 8 - j * 6; }
      if (dc === sc + 1) { var x = mx(gS); return [[sx, sy], [x, sy], [x, ty], [tx, ty]]; }
      var x1 = mx(gS), x2 = mx(gD), mid = (L.chipTop + L.chipBot) / 2, top = (sy + ty) / 2 < mid;
      var ly = top ? L.topBase - ((idx % MSG_CH) + 0) * LANE_STEP : L.botBase + ((idx % MSG_CH) + 0) * LANE_STEP;
      return [[sx, sy], [x1, sy], [x1, ly], [x2, ly], [x2, ty], [tx, ty]];
    }

    /* ======================================================================== chips (persistent, focusable) */
    function ensureChip(a) {
      if (chips[a.id]) return chips[a.id];
      var g = E('g', { 'class': 'agent', tabindex: 0, role: 'button' }, gChips);
      var c = { g: g, state: null, w: 0, h: 0 };
      c.ring = E('rect', { 'class': 'focus-ring', rx: 11, ry: 11 }, g);
      c.sel = E('rect', { rx: 11, ry: 11, fill: 'none', stroke: COLORS.ink, 'stroke-width': 1.5, display: 'none' }, g);
      c.glow = E('rect', { rx: 9, ry: 9, fill: 'none', stroke: COLORS.acc, 'stroke-width': 6, opacity: 0.22, display: 'none' }, g);
      c.body = E('rect', { 'class': 'body', rx: 8, ry: 8 }, g);
      c.glyph = E('g', null, g);
      c.text = E('text', { 'class': 'rl-name', 'dominant-baseline': 'central' }, g);
      c.title = E('title', null, g);
      c.hit = E('rect', { 'class': 'hit', fill: 'transparent' }, g);
      g.addEventListener('click', function (ev) { ev.stopPropagation(); ctx.select(a.id); });
      g.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); ctx.select(a.id); }
      });
      chips[a.id] = c; return c;
    }
    function glyphMarkup(st, cy) {
      var cx0 = 14;
      switch (st) {
        case 'working': return '<circle cx="' + cx0 + '" cy="' + cy + '" r="9" fill="none" stroke="' + COLORS.acc + '" stroke-width="1.5" opacity=".45"/><circle cx="' + cx0 + '" cy="' + cy + '" r="5.5" fill="' + COLORS.acc + '"/>';
        case 'done': return '<circle cx="' + cx0 + '" cy="' + cy + '" r="7.5" fill="' + COLORS.ink + '"/><path d="M' + (cx0 - 3.6) + ' ' + cy + 'l2.6 2.8 4.8-5.4" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>';
        case 'blocked': return '<circle cx="' + cx0 + '" cy="' + cy + '" r="7.5" fill="' + COLORS.amber + '"/><path d="M' + (cx0 - 2.2) + ' ' + (cy - 3.4) + 'v6.8M' + (cx0 + 2.2) + ' ' + (cy - 3.4) + 'v6.8" stroke="#fff" stroke-width="2" stroke-linecap="round"/>';
        case 'failed': return '<circle cx="' + cx0 + '" cy="' + cy + '" r="7.5" fill="' + COLORS.rust + '"/><path d="M' + (cx0 - 3) + ' ' + (cy - 3) + 'l6 6M' + (cx0 + 3) + ' ' + (cy - 3) + 'l-6 6" stroke="#fff" stroke-width="2" stroke-linecap="round"/>';
        case 'waiting': return '<circle cx="' + cx0 + '" cy="' + cy + '" r="6.5" fill="' + COLORS.bg + '" stroke="' + COLORS.ink + '" stroke-width="1.6" stroke-dasharray="2.6 2"/>';
        default: return '<circle cx="' + cx0 + '" cy="' + cy + '" r="6.5" fill="' + COLORS.bg + '" stroke="' + COLORS.mist + '" stroke-width="1.8"/>';
      }
    }
    function toolLive(s, a) { return a.state === 'working' && a.tool && s.t <= (a.toolAt || 0) + (a.toolDuration || 0) + TOOL_TAIL; }
    function updateChip(s, a, related) {
      var c = ensureChip(a), W = L.W, H = L.H, p = disp[a.id], sel = ctx.selected() === a.id, st = a.state;
      c.g.setAttribute('transform', 'translate(' + f1(p.x) + ',' + f1(p.y) + ')');
      if (c.w !== W || c.h !== H) {
        c.w = W; c.h = H;
        [c.body, c.glow].forEach(function (r) { r.setAttribute('width', W); r.setAttribute('height', H); });
        c.sel.setAttribute('x', -4); c.sel.setAttribute('y', -4); c.sel.setAttribute('width', W + 8); c.sel.setAttribute('height', H + 8);
        c.ring.setAttribute('x', -5); c.ring.setAttribute('y', -5); c.ring.setAttribute('width', W + 10); c.ring.setAttribute('height', H + 10);
        c.hit.setAttribute('width', W); c.hit.setAttribute('height', H);
        c.text.setAttribute('x', 29); c.text.setAttribute('y', H / 2 + 0.5);
        c.state = null;
      }
      var lit = toolLive(s, a), key = st + '|' + lit + '|' + sel;
      if (c.key !== key) {
        c.key = key;
        var stroke = COLORS.mist, sw = 1.6, fill = COLORS.panel, dash = null;
        if (st === 'working') { stroke = COLORS.acc; sw = 2.2; fill = lit ? '#D3E8E1' : '#E6EFEA'; }
        else if (st === 'blocked') { stroke = COLORS.amber; sw = 2.2; fill = '#F3EAD2'; }
        else if (st === 'failed') { stroke = COLORS.rust; sw = 2.2; fill = '#F1DED8'; }
        else if (st === 'done') { stroke = COLORS.ink; sw = 1.6; fill = COLORS.panel; }
        else if (st === 'waiting') { stroke = COLORS.ink; sw = 1.5; fill = COLORS.bg; dash = '5 3'; }
        c.body.setAttribute('stroke', stroke); c.body.setAttribute('stroke-width', sw); c.body.setAttribute('fill', fill);
        if (dash) c.body.setAttribute('stroke-dasharray', dash); else c.body.removeAttribute('stroke-dasharray');
        c.glyph.innerHTML = glyphMarkup(st, H / 2);
        c.glow.setAttribute('display', lit ? 'inline' : 'none');
        c.sel.setAttribute('display', sel ? 'inline' : 'none');
        c.text.setAttribute('class', 'rl-name' + (st === 'waiting' || st === 'queued' ? ' dim' : ''));
      }
      if (c.text.textContent !== a.label) c.text.textContent = a.label;
      var tt = a.name + ' · ' + U.stateWord(a); if (c.title.textContent !== tt) c.title.textContent = tt;
      c.g.setAttribute('aria-label', a.name + ', ' + U.stateWord(a) + (a.attempt > 1 ? ', attempt ' + a.attempt : '') + (a.tool && st === 'working' ? ', using ' + a.tool : ''));
      c.g.setAttribute('aria-pressed', sel ? 'true' : 'false');
      c.g.setAttribute('opacity', related ? 1 : 0.5);
    }

    /* ======================================================================== render */
    function pageGlyph(x, y, o, dim) {
      return '<g transform="translate(' + f1(x) + ',' + f1(y) + ')" opacity="' + (o == null ? 1 : o) + '"><path d="M0 0h7.5l3.5 3.5V13H0z" fill="' + COLORS.panel + '" stroke="' + COLORS.acc + '" stroke-width="1.4" stroke-linejoin="round"/><path d="M7.5 0v3.5H11" fill="none" stroke="' + COLORS.acc + '" stroke-width="1.2"/>' + (dim ? '' : '<path d="M2.4 7h6M2.4 9.8h6" stroke="' + COLORS.acc + '" stroke-width="1"/>') + '</g>';
    }
    function pill(x, y, text, fill, stroke, color, bold, cw) {
      var w = pillW(text, cw);
      return '<rect x="' + f1(x) + '" y="' + f1(y) + '" width="' + w + '" height="19" rx="9.5" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.3"/><text x="' + f1(x + 8) + '" y="' + f1(y + 13.2) + '" class="rl-pill" fill="' + color + '"' + (bold ? ' font-weight="700"' : '') + '>' + esc(text) + '</text>';
    }
    function retryT(a) { for (var i = a.recent.length - 1; i >= 0; i--) if (a.recent[i].kind === 'retry') return a.recent[i].t; return -1e9; }

    function render(s) {
      lastState = s;
      if (!L) return;
      var A = s.agents, sel = ctx.selected(), reduced = ctx.reducedMotion();
      emptyTxt.setAttribute('display', L.empty ? 'inline' : 'none');
      // relatedness for selection emphasis
      var rel = null;
      if (sel && A[sel]) {
        rel = {}; rel[sel] = 1;
        L.edges.forEach(function (e) { if (e.from === sel) rel[e.to] = 1; if (e.to === sel) rel[e.from] = 1; });
        s.messages.forEach(function (m) { if (s.t - m.t < 12000) { if (m.from === sel) rel[m.to] = 1; if (m.to === sel) rel[m.from] = 1; } });
      }
      function edgeRel(e) { return !rel || e.from === sel || e.to === sel; }
      L.ids.forEach(function (id) { updateChip(s, A[id], !rel || rel[id]); });
      Object.keys(chips).forEach(function (id) { if (!A[id]) { chips[id].g.remove(); delete chips[id]; delete disp[id]; } });

      var wires = '', top = '', term = '';
      var R = 7;
      // -------- static wires: task, delegation, dependency, outputs
      var order = ['task', 'deleg', 'dep', 'out'];
      order.forEach(function (kind) {
        L.edges.forEach(function (e) {
          if (e.kind !== kind) return;
          var to = A[e.to], from = A[e.from], att = to ? to.attempt : 1, pts = route(e, att);
          var op = edgeRel(e) ? 1 : 0.22, stroke = COLORS.slate, sw = 2.2, dash = '', cut = false, glow = false;
          if (kind === 'dep') { sw = 1.7; stroke = COLORS.ink; if (from && from.state !== 'done') dash = '6 4'; }
          if (kind === 'out') { stroke = COLORS.acc; sw = 1.5; op *= 0.55; }
          if (kind === 'task') { sw = 2.2; stroke = COLORS.slate; }
          if (to && (kind === 'deleg' || kind === 'dep') && to.state === 'failed') cut = true;
          if (to && (kind === 'deleg' || kind === 'dep') && att > 1 && to.state === 'working' && s.t - retryT(to) < RETRY_GLOW && s.t >= retryT(to)) { glow = true; stroke = COLORS.acc; sw = 3; }
          var use = cut ? trimEnd(pts, 24) : pts;
          wires += '<path d="' + rpath(use, R) + '" fill="none" stroke="' + stroke + '" stroke-width="' + sw + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + ' stroke-linecap="round" opacity="' + op + '"/>';
          // pads at the ends of a wire
          var p0 = pts[0], p1 = use[use.length - 1];
          wires += '<circle cx="' + f1(p0[0]) + '" cy="' + f1(p0[1]) + '" r="2.6" fill="' + stroke + '" opacity="' + op + '"/>';
          if (kind !== 'out' && kind !== 'task') wires += '<circle cx="' + f1(p1[0]) + '" cy="' + f1(p1[1]) + '" r="2.6" fill="' + (cut ? COLORS.rust : (kind === 'dep' && dash ? COLORS.bg : stroke)) + '" stroke="' + (cut ? COLORS.rust : stroke) + '" stroke-width="1.4" opacity="' + op + '"/>';
          if (glow) wires += '<path d="' + rpath(pts, R) + '" fill="none" stroke="' + COLORS.acc + '" stroke-width="7" opacity=".16" stroke-linecap="round"/>';
          e._pts = pts;
        });
      });

      // -------- messages: green wire with a packet; wire stays while the message is fresh
      var live = [];
      s.messages.forEach(function (m, i) {
        var age = s.t - m.t; if (age < 0) return;
        var mine = sel && (m.from === sel || m.to === sel) && age < 12000;
        if (age > MSG_LIFE && !mine) return;
        if (!A[m.from] || !A[m.to]) return;
        live.push({ m: m, i: i, age: age, mine: mine });
      });
      live.forEach(function (o, k) {
        var pts = msgRoute(o.m, o.i), age = o.age;
        var op = age <= MSG_LIFE - MSG_FADE ? 1 : age <= MSG_LIFE ? Math.max(0.18, (MSG_LIFE - age) / MSG_FADE) : 0.28;
        if (rel && !(o.m.from === sel || o.m.to === sel)) op *= 0.2;
        var d = rpath(pts, R);
        wires += '<path d="' + d + '" fill="none" stroke="' + COLORS.acc + '" stroke-width="3.2" stroke-linecap="round" opacity="' + f1(op) + '"/>';
        var inFlight = age < MSG_FLIGHT && !reduced, frac = reduced ? (age < MSG_LIFE ? 1 : 1) : U.clamp(age / MSG_FLIGHT, 0, 1);
        var q = pointAt(pts, inFlight ? U.ease(frac) : 1);
        var end = pts[pts.length - 1];
        top += '<circle cx="' + f1(end[0]) + '" cy="' + f1(end[1]) + '" r="2.8" fill="' + COLORS.acc + '" opacity="' + f1(op) + '"/>';
        if (age < MSG_FLIGHT + 600 || (reduced && age < 2200)) {
          top += '<circle cx="' + f1(q[0]) + '" cy="' + f1(q[1]) + '" r="5.2" fill="' + COLORS.acc + '" stroke="#fff" stroke-width="1.8"/>';
        }
        o.q = q; o.pts = pts;
      });
      // labels for the newest few packets (what was said), kept short
      live.filter(function (o) { return o.age < 2600; }).slice(-3).forEach(function (o) {
        var t = clip(o.m.text, 34), w = pillW(t, 7.2), x = o.q[0] - w / 2, y = o.q[1] - 29;
        top += '<rect x="' + f1(x) + '" y="' + f1(y) + '" width="' + w + '" height="19" rx="9.5" fill="' + COLORS.panel + '" stroke="' + COLORS.acc + '" stroke-width="1.3"/><text x="' + f1(x + 8) + '" y="' + f1(y + 13.2) + '" class="rl-pill" fill="' + COLORS.accD + '">' + esc(t) + '</text>';
      });

      // -------- output glyphs flowing to RELEASE
      var arrived = 0;
      s.outputs.forEach(function (o) {
        var age = s.t - o.t, e = null;
        for (var i = 0; i < L.edges.length; i++) if (L.edges[i].key === 'o|' + o.agentId) { e = L.edges[i]; break; }
        if (age < 0) return;
        if (!e || !e._pts || age >= OUT_FLIGHT || reduced) { arrived++; return; }
        var q = pointAt(e._pts, U.ease(age / OUT_FLIGHT));
        top += pageGlyph(q[0] - 5.5, q[1] - 6.5, 1);
      });

      // -------- terminals
      var T = nodeBox('TASK'), prog = U.clamp(s.progress, 0, 1), pct = Math.round(prog * 100);
      term += '<rect x="' + T.x + '" y="' + f1(T.y) + '" width="' + T.w + '" height="' + T.h + '" rx="9" fill="' + COLORS.panel + '" stroke="' + COLORS.slate + '" stroke-width="2"/>';
      term += '<clipPath id="rl-tclip"><rect x="' + (T.x + 2) + '" y="' + f1(T.y + 2) + '" width="' + (T.w - 4) + '" height="' + (T.h - 4) + '" rx="7"/></clipPath>';
      term += '<rect x="' + T.x + '" y="' + f1(T.y + T.h * (1 - prog)) + '" width="' + T.w + '" height="' + f1(T.h * prog) + '" fill="#BFDDD5" clip-path="url(#rl-tclip)"/>';
      term += '<text x="' + (T.x + T.w / 2) + '" y="' + f1(T.y + 22) + '" text-anchor="middle" class="rl-term">TASK</text>';
      term += '<text x="' + (T.x + T.w / 2) + '" y="' + f1(T.y + 56) + '" text-anchor="middle" class="rl-term-big">' + pct + '%</text>';
      term += '<text x="' + (T.x + T.w / 2) + '" y="' + f1(T.y + 76) + '" text-anchor="middle" class="rl-small">' + s.counts.done + '/' + Math.max(s.plannedTotal, s.order.length) + '</text>';
      var B = nodeBox('REL'), fin = s.finished, ok = fin && s.finishedInfo && s.finishedInfo.status === 'succeeded';
      var rfill = fin ? (ok ? COLORS.acc : COLORS.rust) : COLORS.panel, rcol = fin ? '#fff' : COLORS.ink;
      term += '<rect x="' + B.x + '" y="' + f1(B.y) + '" width="' + B.w + '" height="' + f1(B.h) + '" rx="9" fill="' + rfill + '" stroke="' + (fin ? rfill : COLORS.slate) + '" stroke-width="2"' + (fin ? '' : ' stroke-dasharray="6 4"') + '/>';
      term += '<text x="' + (B.x + B.w / 2) + '" y="' + f1(B.y + B.h - 44) + '" text-anchor="middle" class="rl-term" fill="' + rcol + '" style="fill:' + rcol + '">RELEASE</text>';
      term += '<text x="' + (B.x + B.w / 2) + '" y="' + f1(B.y + B.h - 22) + '" text-anchor="middle" class="rl-small" style="fill:' + (fin ? '#fff' : COLORS.slate) + '">' + (fin ? (ok ? 'RELEASED' : 'FAILED') : arrived + ' received') + '</text>';
      // received pages, stacked from the top of the terminal
      var pw = 17, perRow = Math.max(1, Math.floor((B.w - 12) / pw)), maxShow = Math.max(0, Math.floor((B.h - 90) / 20)) * perRow;
      for (var k = 0; k < Math.min(arrived, maxShow || 8); k++) {
        var gx = B.x + 8 + (k % perRow) * pw, gy = B.y + 12 + Math.floor(k / perRow) * 20;
        term += fin ? '<g transform="translate(' + f1(gx) + ',' + f1(gy) + ')"><path d="M0 0h7.5l3.5 3.5V13H0z" fill="#fff" stroke="#fff"/><path d="M2.6 7.4l1.8 2 3.4-3.8" fill="none" stroke="' + COLORS.acc + '" stroke-width="1.5"/></g>' : pageGlyph(gx, gy, 1);
      }
      if (fin && s.finishedInfo && ok) term += '<path d="M' + f1(B.x + B.w / 2 - 9) + ' ' + f1(B.y + B.h - 66) + 'l6 6 12-13" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>';

      // -------- per-chip overlays: output glyphs, retry tag, tool label, blocked callout, failed spark, waiting note
      L.ids.forEach(function (id) {
        var a = A[id], p = disp[id], W = L.W, H = L.H, dim = rel && !rel[id], o = dim ? 0.5 : 1;
        var by = p.y + H + 4;
        // output glyphs on the output side of the chip (top right)
        var outs = a.outputs, shown = Math.min(outs.length, 3);
        for (var i = 0; i < shown; i++) top += '<g opacity="' + o + '">' + pageGlyph(p.x + W - 12 - i * 14, p.y - 17, 1) + '</g>';
        if (outs.length > shown) top += '<text x="' + f1(p.x + W - 12 - shown * 14 + 10) + '" y="' + f1(p.y - 7) + '" text-anchor="end" class="rl-small" opacity="' + o + '">+' + (outs.length - shown) + '</text>';
        if (a.attempt > 1) top += '<g opacity="' + o + '">' + pill(p.x, p.y - 22, 'RETRY ' + a.attempt, COLORS.accD, COLORS.accD, '#fff', true, 7.4) + '</g>';
        // gate on blocked inputs
        if (a.state === 'blocked') {
          top += '<rect x="' + f1(p.x - 13) + '" y="' + f1(p.y + H / 2 - 14) + '" width="6" height="28" rx="2" fill="' + COLORS.amber + '" stroke="' + COLORS.bg + '" stroke-width="1.5"/>';
        }
        if (a.state === 'failed') {
          var sx = p.x - 12, sy = p.y + H / 2;
          top += '<path d="M' + f1(sx - 3) + ' ' + f1(sy - 10) + 'l5 7-4 2.4 5 8.6" fill="none" stroke="' + COLORS.rust + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';
        }
        // status label under the chip: tool pill / blocked / failed / waiting
        if (a.state === 'blocked') {
          var bt = clip((a.needs ? 'NEEDS ' + a.needs : a.blockedReason || 'BLOCKED').toUpperCase(), 28);
          top += '<g opacity="' + o + '">' + pill(p.x, by, bt, '#E8B23C', COLORS.amber, COLORS.ink, true, 7.5) + '</g>';
        } else if (a.state === 'failed') {
          var ft = clip(String(a.error || 'FAILED').toUpperCase(), 30);
          top += '<g opacity="' + o + '">' + pill(p.x, by, ft, COLORS.rust, COLORS.rust, '#fff', true, 7.5) + '</g>';
        } else if (toolLive(s, a)) {
          top += '<g opacity="' + o + '">' + pill(p.x, by, clip(a.tool, 22), COLORS.panel, COLORS.acc, COLORS.accD, false, 7.3) + '</g>';
        } else if (a.state === 'waiting') {
          var names = a.dependsOn.filter(function (d) { return A[d] && A[d].state !== 'done'; }).map(function (d) { return A[d].label; });
          if (names.length) top += '<text x="' + f1(p.x + 2) + '" y="' + f1(by + 12) + '" class="rl-small" opacity="' + o + '">' + esc(clip('waits: ' + names[0] + (names.length > 1 ? ' +' + (names.length - 1) : ''), 19)) + '</text>';
        }
      });

      gWires.innerHTML = wires; gTerm.innerHTML = term; gTop.innerHTML = top;
    }

    /* ======================================================================== sizing */
    function bounds() {
      var x0 = -18, y0 = L.topEdge - 14, x1 = L.right + 18, y1 = L.botEdge + 16;
      vb = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      svg.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
      gridRect.setAttribute('x', vb.x); gridRect.setAttribute('y', vb.y); gridRect.setAttribute('width', vb.w); gridRect.setAttribute('height', vb.h);
    }
    function fitScale() { var sz = ctx.size(), availW = Math.max(200, sz.w - 2), availH = Math.max(120, sz.h - 36 - 2); return Math.min(availW / vb.w, availH / vb.h); }
    function curScale() { return zoom != null ? zoom : U.clamp(fitScale(), 0.7, 1.15); }
    function setZoom(z) { zoom = U.clamp(z, 0.25, 2.5); applySize(); }
    function applySize() {
      scale = curScale();
      svg.setAttribute('width', Math.round(vb.w * scale)); svg.setAttribute('height', Math.round(vb.h * scale));
      zAuto.textContent = Math.round(scale * 100) + '%';
      zAuto.classList.toggle('on', zoom == null);
    }

    /* ======================================================================== update pipeline */
    function layoutSig(s) {
      var k = s.order.length + '|' + s.delegations.length + '|' + s.dependencies.length;
      s.order.forEach(function (id) { k += '|' + s.agents[id].outputs.length; });
      return k;
    }
    function relayout(s, snap) {
      L = computeLayout(s);
      L.ids.forEach(function (id) { var t = L.tgt[id]; if (!disp[id] || snap) disp[id] = { x: t.x, y: t.y }; });
      Object.keys(disp).forEach(function (id) { if (!s.agents[id]) delete disp[id]; });
      bounds(); applySize();
      anim = !snap && !ctx.reducedMotion();
    }
    function snapDisp() { L.ids.forEach(function (id) { disp[id] = { x: L.tgt[id].x, y: L.tgt[id].y }; }); anim = false; }

    return {
      update: function (s) {
        var sg = layoutSig(s);
        if (sg !== sig || !L) { sig = sg; relayout(s, false); if (ctx.reducedMotion()) snapDisp(); }
        render(s);
      },
      frame: function (dt) {
        if (!anim || !L) return;
        if (ctx.reducedMotion()) { snapDisp(); render(ctx.state()); return; }
        var moving = false, k = 1 - Math.exp(-dt / 110);
        L.ids.forEach(function (id) {
          var d = disp[id], t = L.tgt[id], dx = t.x - d.x, dy = t.y - d.y;
          if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4) { d.x = t.x; d.y = t.y; return; }
          d.x += dx * k; d.y += dy * k; moving = true;
        });
        anim = moving; render(ctx.state());
      },
      onSelect: function (id) {
        if (lastState) render(lastState);
        if (id && chips[id]) { try { chips[id].g.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' }); } catch (e) {} }
      },
      onReset: function (s) {
        Object.keys(chips).forEach(function (k) { chips[k].g.remove(); delete chips[k]; });
        disp = {}; sig = ''; L = null;
        sig = layoutSig(s); relayout(s, true); render(s);
      },
      onMotionChange: function (r) { if (r && L) { snapDisp(); } if (lastState) render(lastState); },
      resize: function () { if (L) applySize(); }
    };
  }
});
