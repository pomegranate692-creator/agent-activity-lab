/*
 * 05 Contribution River
 * A Sankey-style flow answering "how did everything feed the result".
 *
 *   - Agents are vertical bars. Columns come from topological levels of the contribution graph:
 *       dependsOn edges, plus "a subagent feeds its parent" edges, plus "a subagent inherits its
 *       parent's inputs". Edges that are implied by a longer path are dropped (transitive reduction).
 *       Agents with no dependency edges and no parent (the coordinator) are drawn as a chip, not a bar.
 *   - Bar thickness = effort so far (working time up to now, blocked/failed time excluded). It grows live.
 *     Not-yet-started agents get a fixed placeholder thickness, never a predicted one.
 *   - Ribbons are contributions A -> B. Style comes from the SOURCE agent's state:
 *       working = teal + flowing, done = grey, blocked = amber (dam on the ribbon + callout),
 *       failed = rust (eddy + callout), waiting/queued = dashed channel.
 *   - Outputs are pebbles dropped on the producer's ribbon and carried downstream to the RELEASE channel,
 *     which fills with delivered effort as pebbles arrive.
 *   - Messages are a brief labelled tick between two bars; delegations are a brief "assigned" flag.
 *
 * Everything is derived from the state passed in (state + log + agents). No future events are read.
 */
AgentChrome.mount({
  id: '05', name: 'Contribution River', tagline: 'Width is effort. Follow the river from the plan to the final release.',
  create: function (stage, ctx) {
    var U = ctx.core.util;
    var NS = 'http://www.w3.org/2000/svg';
    var REL = '__release';
    var BAR_W = 26, LBL_H = 20, EFF_H = 16, GAP = 10, BASE = 18, PEB_SPEED = 0.16, REL_W = 44;
    var MSG_MS = 2600, DLG_MS = 1800, FX_MS = 1100, NAME_MS = 1600;

    function el(name, attrs, parent, cls) {
      var e = document.createElementNS(NS, name);
      if (cls) e.setAttribute('class', cls);
      if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
      if (parent) parent.appendChild(e);
      return e;
    }
    function txt(parent, cls, s, attrs) { var t = el('text', attrs, parent, cls); t.textContent = s == null ? '' : s; return t; }
    function setText(t, s) { if (t.textContent !== s) t.textContent = s; }
    function setA(e, k, v) { var sv = String(v); if (e.getAttribute(k) !== sv) e.setAttribute(k, sv); }
    function trunc(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
    function fmtS(ms) { return (ms / 1000).toFixed(1) + 's'; }
    function r1(v) { return Math.round(v * 10) / 10; }

    /* ------------------------------------------------------------ svg skeleton */
    var svg = el('svg', { width: '100%', height: '100%', 'class': 'rv', focusable: 'false' }, stage);
    var defs = el('defs', null, svg);
    var pat = el('pattern', { id: 'rv-hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
    el('rect', { width: 6, height: 6, fill: '#E9D9AE' }, pat);
    el('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: '#B7790A', 'stroke-width': 2.4 }, pat);
    var gRibbon = el('g', null, svg), gFlow = el('g', null, svg), gRel = el('g', null, svg), gNodes = el('g', null, svg),
      gOver = el('g', null, svg), gPeb = el('g', null, svg), gMsg = el('g', null, svg), gHead = el('g', null, svg);

    var tTitle = txt(gHead, 'rv-title t-sans', '', { x: 28, y: 24 });
    var tHead = txt(gHead, 'rv-head', '', { x: 28, y: 44 });
    var gaugeTrack = el('rect', { x: 28, y: 52, width: 280, height: 10, rx: 5 }, gHead, 'gauge-track');
    var gaugeFill = el('rect', { x: 28, y: 52, width: 0, height: 10, rx: 5 }, gHead, 'gauge-fill');
    var tGauge = txt(gHead, 'rv-sub', '', { x: 320, y: 61 });
    var tEmpty = txt(gHead, 'rv-sub', 'Waiting for agents…', { x: 28, y: 130 });
    var tKey1 = txt(gHead, 'rv-key', 'Thickness = effort so far (working time, grows live).  Dashed = not flowing yet.  Amber dam = blocked.  Rust eddy = failed.', { x: 28 });
    var tKey2 = txt(gHead, 'rv-key', 'Page = an output, carried downstream to RELEASE.  Dotted tick = a message.  Click or focus a bar to follow its contributions.', { x: 28 });

    /* ------------------------------------------------------------ state */
    var S = null, W = 0, H = 0, topo = null, topoKey = '', sizeKey = '';
    var nodes = {}, edgeDom = {}, pebDom = {}, msgPool = [], dlgPool = [], chipDom = {};
    var disp = {}, scaleDisp = BASE, snap = true, effort = {}, relBox = null, relFillRect = null;
    var geom = {}; // per-render geometry cache
    var reducedNow = false;

    /* ------------------------------------------------------------ topology (structure only) */
    function structKey(s) {
      var k = [];
      for (var i = 0; i < s.order.length; i++) { var a = s.agents[s.order[i]]; k.push(a.id + '|' + (a.parentId || '') + '|' + a.dependsOn.join(',')); }
      return k.join(';');
    }
    function buildTopo(s) {
      var A = s.agents, ids = s.order, T = { roots: [], flow: [], inFlow: {}, preds: {}, succs: {}, edges: [], level: {}, cols: [], maxLevel: 0 };
      var dependedOn = {}, seenId = {};
      ids = ids.filter(function (id) { if (seenId[id]) return false; seenId[id] = 1; return true; }); // tolerate a re-spawned id from a live source
      ids.forEach(function (id) { A[id].dependsOn.forEach(function (d) { dependedOn[d] = true; }); });
      ids.forEach(function (id) {
        var a = A[id];
        if (a.parentId == null && a.dependsOn.length === 0 && !dependedOn[id]) T.roots.push(id); else { T.flow.push(id); T.inFlow[id] = true; }
      });
      var E = {};
      function add(u, v) { if (u !== v && T.inFlow[u] && T.inFlow[v]) E[u + '>' + v] = [u, v]; }
      T.flow.forEach(function (id) {
        var a = A[id], p = a.parentId && A[a.parentId];
        a.dependsOn.forEach(function (d) { add(d, id); });
        if (p && T.inFlow[p.id]) { add(id, p.id); if (!a.dependsOn.length) p.dependsOn.forEach(function (d) { add(d, id); }); }
      });
      var list = Object.keys(E).map(function (k) { return E[k]; });
      // levels (longest path); edges that close a cycle are dropped
      var preds = {}, vis = {}, done = {};
      T.flow.forEach(function (id) { preds[id] = []; });
      list.forEach(function (e) { preds[e[1]].push(e[0]); });
      var drop = {};
      function lv(id) {
        if (done[id] != null) return done[id];
        vis[id] = 1; var m = -1;
        preds[id].forEach(function (p) {
          if (vis[p] && done[p] == null) { drop[p + '>' + id] = true; return; }
          m = Math.max(m, lv(p));
        });
        vis[id] = 0; done[id] = m + 1; return m + 1;
      }
      T.flow.forEach(function (id) { lv(id); });
      list = list.filter(function (e) { return !drop[e[0] + '>' + e[1]]; });
      // transitive reduction
      var out = {}; T.flow.forEach(function (id) { out[id] = []; });
      list.forEach(function (e) { out[e[0]].push(e[1]); });
      function reach(from, target, skipFirst) {
        var seen = {}, stack = out[from].filter(function (x) { return x !== skipFirst; });
        while (stack.length) { var x = stack.pop(); if (x === target) return true; if (seen[x]) continue; seen[x] = 1; out[x].forEach(function (y) { stack.push(y); }); }
        return false;
      }
      list = list.filter(function (e) { return !reach(e[0], e[1], e[1]); });
      T.flow.forEach(function (id) { T.preds[id] = []; T.succs[id] = []; T.level[id] = done[id]; T.maxLevel = Math.max(T.maxLevel, done[id]); });
      list.forEach(function (e) { T.preds[e[1]].push(e[0]); T.succs[e[0]].push(e[1]); T.edges.push({ key: e[0] + '>' + e[1], u: e[0], v: e[1] }); });
      // recompute levels after reduction is unnecessary (reduction never changes longest paths)
      T.flow.forEach(function (id) { if (!T.succs[id].length) T.edges.push({ key: id + '>' + REL, u: id, v: REL, toRel: true }); });
      T.relCol = T.maxLevel + 1;
      for (var c = 0; c <= T.maxLevel; c++) T.cols.push([]);
      T.flow.forEach(function (id) { T.cols[T.level[id]].push(id); });
      T.maxN = 0; T.cols.forEach(function (c) { T.maxN = Math.max(T.maxN, c.length); });
      T.compact = T.maxN >= 7;
      return T;
    }

    /* nominal vertical placement (barycentre relaxation); stored as fraction of the draw height */
    function resolve(items, lo, hi, gap) {
      items.sort(function (a, b) { return a.c - b.c || a.i - b.i; });
      var y = lo, i;
      for (i = 0; i < items.length; i++) { var top = Math.max(items[i].c - items[i].f / 2, y); items[i].top = top; y = top + items[i].f + gap; }
      if (y - gap > hi) { y = hi; for (i = items.length - 1; i >= 0; i--) { var t2 = Math.min(items[i].top, y - items[i].f); items[i].top = t2; y = t2 - gap; } }
      return items;
    }
    function nominal(T, drawH) {
      var fp = LBL_H + 44 + EFF_H + GAP; if (T.maxN * fp > drawH) fp = Math.max(24, drawH / Math.max(1, T.maxN));
      var C = {};
      T.cols.forEach(function (col) { var n = col.length, pitch = Math.min(fp + 8, drawH / Math.max(1, n)); col.forEach(function (id, i) { C[id] = drawH / 2 + (i - (n - 1) / 2) * pitch; }); });
      function relax(col, nb) {
        var items = col.map(function (id, i) {
          var ns = nb[id], c = C[id];
          if (ns && ns.length) { var m = 0; ns.forEach(function (x) { m += C[x]; }); c = m / ns.length; }
          return { id: id, c: c, f: fp, i: i };
        });
        resolve(items, 0, drawH, 4); items.forEach(function (it) { C[it.id] = it.top + it.f / 2; });
      }
      for (var it = 0; it < 6; it++) {
        for (var c = 1; c < T.cols.length; c++) relax(T.cols[c], T.preds);
        for (c = T.cols.length - 2; c >= 0; c--) relax(T.cols[c], T.succs);
      }
      T.nom = {}; T.flow.forEach(function (id) { T.nom[id] = C[id] / Math.max(1, drawH); });
    }

    /* ------------------------------------------------------------ effort (from state only) */
    function computeEffort(s) {
      var open = {}, non = {}, out = {};
      s.log.forEach(function (l) {
        if (!l.agentId) return;
        if (l.kind === 'blocked' || l.kind === 'failed') { if (open[l.agentId] == null) open[l.agentId] = l.t; }
        else if (l.kind === 'unblocked' || l.kind === 'retry') { if (open[l.agentId] != null) { non[l.agentId] = (non[l.agentId] || 0) + (l.t - open[l.agentId]); open[l.agentId] = null; } }
      });
      s.order.forEach(function (id) {
        var a = s.agents[id];
        if (a.startedAt == null) { out[id] = 0; return; }
        var end = a.endedAt != null ? a.endedAt : s.t, e = end - a.startedAt - (non[id] || 0);
        if (open[id] != null) e -= Math.max(0, end - open[id]);
        out[id] = Math.max(0, e);
      });
      return out;
    }

    /* ------------------------------------------------------------ DOM records */
    function ensureNode(a) {
      if (nodes[a.id]) return nodes[a.id];
      var n = { id: a.id }, id = a.id;
      n.g = el('g', { tabindex: 0, role: 'button' }, gNodes, 'agent');
      n.title = el('title', null, n.g);
      n.hit = el('rect', null, n.g, 'hit');
      n.sel = el('rect', { rx: 5 }, n.g, 'rv-sel'); n.focus = el('rect', { rx: 5 }, n.g, 'rv-focus');
      n.bar = el('rect', { width: BAR_W, rx: 2 }, n.g, 'bar');
      n.ic = el('g', null, n.g);
      n.icRing = el('circle', { r: 7 }, n.ic, 'ic'); n.icGlyph = el('path', null, n.ic, 'ic');
      n.lbl = txt(n.g, 'rv-lbl', a.label || a.name);
      n.eff = txt(n.g, 'rv-eff', '');
      n.cap = txt(n.g, 'wait-cap', '');
      n.g.addEventListener('click', function () { ctx.select(id); });
      n.g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); ctx.select(id); } });
      // overlays (callouts that sit on the river)
      n.pillG = el('g', null, gOver); n.pillR = el('rect', { rx: 10, height: 20 }, n.pillG, 'pill pill-tool'); n.pillT = txt(n.pillG, 'pill-tool-t', '');
      n.dam = el('rect', { rx: 2, width: 9 }, gOver, 'dam');
      n.eddy = el('path', null, gOver, 'eddy');
      var pts = []; for (var th = 0; th <= 9.2; th += 0.25) { var r = 1.5 + th * 1.35; pts.push((r * Math.cos(th)).toFixed(1) + ',' + (r * Math.sin(th)).toFixed(1)); }
      n.eddy.setAttribute('d', 'M' + pts.join('L'));
      n.fx = el('circle', null, gOver);
      n.callG = el('g', null, gOver); n.callR = el('rect', { rx: 7 }, n.callG, 'pill'); n.callT1 = txt(n.callG, 'pill-t pill-t-b', ''); n.callT2 = txt(n.callG, 'pill-t', '');
      nodes[a.id] = n; return n;
    }
    function ensureChip(a) {
      if (chipDom[a.id]) return chipDom[a.id];
      var c = { id: a.id }, id = a.id;
      c.g = el('g', { tabindex: 0, role: 'button' }, gNodes, 'agent');
      c.title = el('title', null, c.g);
      c.sel = el('rect', { rx: 11, height: 38 }, c.g, 'rv-sel'); c.focus = el('rect', { rx: 11, height: 38 }, c.g, 'rv-focus');
      c.r = el('rect', { rx: 9, height: 34, width: 176, fill: '#F3F1EA', 'stroke-width': 1.6 }, c.g);
      c.dot = el('circle', { r: 6 }, c.g, 'bar'); c.t1 = txt(c.g, 'rv-lbl', a.label || a.name); c.t2 = txt(c.g, 'rv-eff', '');
      c.g.addEventListener('click', function () { ctx.select(id); });
      c.g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); ctx.select(id); } });
      chipDom[a.id] = c; return c;
    }
    function ensureEdge(e) {
      if (edgeDom[e.key]) return edgeDom[e.key];
      var d = { path: el('path', null, gRibbon, 'rb'), flows: [], side: false };
      if (e.toRel) gRibbon.insertBefore(d.path, gRibbon.firstChild);
      for (var i = 0; i < 3; i++) d.flows.push(el('path', null, gFlow, 'rb-flow'));
      edgeDom[e.key] = d; return d;
    }
    function ensurePeb(o) {
      if (pebDom[o.id]) return pebDom[o.id];
      var p = { g: el('g', null, gPeb) };
      p.title = el('title', null, p.g);
      p.glyph = el('path', { d: 'M-5,-7 H2 L6,-3 V7 H-5 Z' }, p.g, 'peb'); p.fold = el('path', { d: 'M2,-7 V-3 H6' }, p.g, 'peb-fold');
      p.nameG = el('g', null, p.g); p.nameR = el('rect', { rx: 8, height: 17, y: -8.5 }, p.nameG, 'peb-name-bg'); p.nameT = txt(p.nameG, 'peb-name', '', { y: 4 });
      pebDom[o.id] = p; return p;
    }

    /* ------------------------------------------------------------ release channel */
    relBox = el('rect', { rx: 4 }, gRel, 'rel-box'); relFillRect = el('rect', { rx: 3 }, gRel, 'rel-fill');
    var relTitle = txt(gRel, 'rel-t', 'RELEASE', { 'text-anchor': 'middle' });
    var relCap = txt(gRel, 'rv-sub', 'FINAL OUTPUT', { 'text-anchor': 'middle' });
    var relSum = [txt(gRel, 'rel-sum', '', {}), txt(gRel, 'rel-sum', '', {}), txt(gRel, 'rel-sum', '', {}), txt(gRel, 'rel-sum', '', {})];

    /* ------------------------------------------------------------ render */
    function render(dt) {
      var s = S; if (!s || !W) return;
      reducedNow = ctx.reducedMotion();
      var k = structKey(s);
      var drawTop = 98, drawBottom = H - 52, drawH = Math.max(120, drawBottom - drawTop);
      var sk = W + 'x' + H;
      if (!topo || k !== topoKey) { topo = buildTopo(s); topoKey = k; sizeKey = ''; }
      if (sizeKey !== sk) { nominal(topo, drawH); sizeKey = sk; }
      effort = computeEffort(s);
      var A = s.agents, compact = topo.compact;
      var minH = compact ? 16 : 24, effLine = compact ? 0 : EFF_H, gap = compact ? 4 : GAP, lblH = compact ? 16 : LBL_H;

      // ---- vertical/horizontal geometry
      var relW = REL_W, relX = W - 134, left = 30;
      var pitch = Math.min(150, (relX - left - 80) / Math.max(1, topo.maxLevel));
      var below = {}; topo.flow.forEach(function (id) { var st = A[id].state; below[id] = (st === 'blocked' || st === 'failed') ? 4 + 36 : (st === 'waiting' && !compact ? 14 : 0); });
      var scale = BASE;
      for (var it = 0; it < 16; it++) {
        var worst = 0;
        topo.cols.forEach(function (col) { var sum = 0; col.forEach(function (id) { sum += lblH + effLine + gap + below[id] + Math.max(minH, effort[id] * scale / 1000); }); worst = Math.max(worst, sum); });
        if (worst <= drawH) break; scale *= 0.88;
      }
      scale = Math.max(2, scale);
      if (snap || reducedNow || scale < scaleDisp) scaleDisp = scale; else scaleDisp += (scale - scaleDisp) * (1 - Math.exp(-dt / 250));
      var kf = (snap || reducedNow) ? 1 : 1 - Math.exp(-dt / 1000 * 9);
      var hOf = {}, tgt = {};
      topo.flow.forEach(function (id) { var a = A[id]; hOf[id] = (a.startedAt == null || a.state === 'waiting' || a.state === 'queued') && !effort[id] ? minH : Math.max(minH, effort[id] * scaleDisp / 1000); });
      topo.cols.forEach(function (col, ci) {
        var items = col.map(function (id, i) { return { id: id, c: drawTop + topo.nom[id] * drawH, f: lblH + effLine + below[id] + hOf[id] + gap, i: i }; });
        resolve(items, drawTop, drawBottom, 0);
        items.forEach(function (it2) { tgt[it2.id] = { x: left + ci * pitch, y: it2.top + lblH }; });
      });
      topo.flow.forEach(function (id) {
        var d = disp[id], t = tgt[id];
        if (!d) { disp[id] = d = { x: t.x, y: t.y }; } else { d.x += (t.x - d.x) * kf; d.y += (t.y - d.y) * kf; }
      });
      Object.keys(disp).forEach(function (id) { if (!topo.inFlow[id]) delete disp[id]; });
      var relTop = drawTop + drawH * 0.1, relH = drawH * 0.7, relMid = relTop + relH / 2;
      geom = { relX: relX, relW: relW, relTop: relTop, relH: relH, relMid: relMid, hOf: hOf, drawTop: drawTop, drawBottom: drawBottom };

      // ---- ribbons
      var outs = {}, ins = {};
      topo.edges.forEach(function (e) { (outs[e.u] = outs[e.u] || []).push(e); (ins[e.v] = ins[e.v] || []).push(e); });
      function yc(id) { return id === REL ? relMid : disp[id].y + hOf[id] / 2; }
      Object.keys(outs).forEach(function (u) {
        var list = outs[u].slice().sort(function (a, b) { return yc(a.v) - yc(b.v); }), sl = hOf[u] / list.length, cur = disp[u].y;
        list.forEach(function (e) { e.x0 = disp[u].x + BAR_W; e.y0 = cur; e.t0 = sl; cur += sl; });
      });
      Object.keys(ins).forEach(function (v) {
        var list = ins[v].slice().sort(function (a, b) { return yc(a.u) - yc(b.u); }), total = 0;
        list.forEach(function (e) { total += e.t0; });
        if (v === REL) {
          var fit = Math.min(1, (relH - 8) / Math.max(1, total)), cur = relMid - total * fit / 2;
          list.forEach(function (e) { e.x1 = relX; e.t1 = e.t0 * fit; e.y1 = cur; cur += e.t1; });
        } else {
          var cur2 = disp[v].y; list.forEach(function (e) { e.x1 = disp[v].x; e.t1 = hOf[v] * e.t0 / total; e.y1 = cur2; cur2 += e.t1; });
        }
      });
      var sel = ctx.selected(), related = {}, relEdge = {};
      if (sel) { related[sel] = true; topo.edges.forEach(function (e) { if (e.u === sel || e.v === sel) { related[e.u] = related[e.v] = true; relEdge[e.key] = true; } }); }
      var edgeByKey = {};
      topo.edges.forEach(function (e) {
        edgeByKey[e.key] = e;
        var d = ensureEdge(e), src = A[e.u], st = src.state, xm = (e.x0 + e.x1) / 2;
        var cls = st === 'done' ? 'done' : st === 'working' ? 'working' : st === 'blocked' ? 'blocked' : st === 'failed' ? 'failed' : 'future';
        var p = 'M' + r1(e.x0) + ',' + r1(e.y0) + ' C' + r1(xm) + ',' + r1(e.y0) + ' ' + r1(xm) + ',' + r1(e.y1) + ' ' + r1(e.x1) + ',' + r1(e.y1) +
          ' L' + r1(e.x1) + ',' + r1(e.y1 + e.t1) + ' C' + r1(xm) + ',' + r1(e.y1 + e.t1) + ' ' + r1(xm) + ',' + r1(e.y0 + e.t0) + ' ' + r1(e.x0) + ',' + r1(e.y0 + e.t0) + ' Z';
        d.path.setAttribute('d', p); d.path.setAttribute('class', 'rb rb-' + cls + (sel && !relEdge[e.key] ? ' dim' : ''));
        d.path.style.opacity = e.toRel && topo.level[e.u] < topo.maxLevel && !(sel && relEdge[e.key]) ? '.55' : '';
        var nf = st === 'working' ? (e.t0 >= 16 ? 3 : e.t0 >= 9 ? 2 : 1) : 0;
        var off = reducedNow ? 0 : -(s.t * 0.04);
        for (var i = 0; i < 3; i++) {
          var f = d.flows[i];
          if (i >= nf) { f.style.display = 'none'; continue; }
          f.style.display = '';
          var fr = (i + 1) / (nf + 1), ya = e.y0 + e.t0 * fr, yb = e.y1 + e.t1 * fr;
          f.setAttribute('d', 'M' + r1(e.x0) + ',' + r1(ya) + ' C' + r1(xm) + ',' + r1(ya) + ' ' + r1(xm) + ',' + r1(yb) + ' ' + r1(e.x1) + ',' + r1(yb));
          f.style.strokeDashoffset = String(r1(off)); f.style.opacity = sel && !relEdge[e.key] ? '.12' : '';
        }
        // centreline samples for pebble routes
        var yA = e.y0 + e.t0 / 2, yB = e.y1 + e.t1 / 2, pts = [], len = 0;
        for (var j = 0; j <= 12; j++) {
          var u = j / 12, mu = 1 - u;
          var px = mu * mu * mu * e.x0 + 3 * mu * mu * u * xm + 3 * mu * u * u * xm + u * u * u * e.x1;
          var py = mu * mu * mu * yA + 3 * mu * mu * u * yA + 3 * mu * u * u * yB + u * u * u * yB;
          if (pts.length) len += Math.hypot(px - pts[pts.length - 1][0], py - pts[pts.length - 1][1]);
          pts.push([px, py, len]);
        }
        e.cl = pts;
      });
      Object.keys(edgeDom).forEach(function (key) { if (!edgeByKey[key]) { edgeDom[key].path.remove(); edgeDom[key].flows.forEach(function (f) { f.remove(); }); delete edgeDom[key]; } });

      // ---- bars + overlays
      var totalEffort = 0;
      topo.flow.forEach(function (id) { totalEffort += effort[id]; });
      topo.flow.forEach(function (id) {
        var a = A[id], n = ensureNode(a), d = disp[id], h = hOf[id], x = d.x, y = d.y, st = a.state;
        var isSel = sel === id, dimmed = sel && !related[id];
        n.g.setAttribute('class', 'agent' + (isSel ? ' sel' : '') + (dimmed ? ' dim' : ''));
        var label = trunc(a.label || a.name, 10) + (a.attempt > 1 ? ' ↻' + a.attempt : '');
        var stw = U.stateWord(a);
        setA(n.g, 'aria-label', a.name + ', ' + stw + ', effort ' + fmtS(effort[id]));
        setText(n.title, a.name + ' · ' + stw + ' · effort so far ' + fmtS(effort[id]) + (a.work ? ' · ' + a.work : ''));
        setA(n.hit, 'x', r1(x - 8)); setA(n.hit, 'y', r1(y - lblH - 2)); setA(n.hit, 'width', 112); setA(n.hit, 'height', r1(h + lblH + 4 + effLine + below[id]));
        var rx0 = r1(x - 5), ry0 = r1(y - 5), rw = BAR_W + 10, rh = r1(h + 10);
        [n.sel, n.focus].forEach(function (r) { setA(r, 'x', rx0); setA(r, 'y', ry0); setA(r, 'width', rw); setA(r, 'height', rh); });
        setA(n.bar, 'x', r1(x)); setA(n.bar, 'y', r1(y)); setA(n.bar, 'height', r1(h));
        setA(n.bar, 'class', 'bar bar-' + st);
        // icon
        var cx = x + BAR_W / 2, cy = y + h / 2, light = st === 'waiting' || st === 'queued';
        n.ic.setAttribute('transform', 'translate(' + r1(cx) + ',' + r1(cy) + ')'); n.ic.style.display = (h >= 18 && st !== 'queued') ? '' : 'none';
        var ringCls = 'ic' + (light ? ' ic-dark' : ''), glyphCls = ringCls;
        setA(n.icRing, 'class', ringCls); n.icRing.style.strokeDasharray = st === 'waiting' ? '2.2 2.2' : '';
        var gd = st === 'done' ? 'M-3.2,0.2 L-1,2.6 L3.4,-2.4' : st === 'blocked' ? 'M-2.2,-3 V3 M2.2,-3 V3' : st === 'failed' ? 'M-3,-3 L3,3 M3,-3 L-3,3' : st === 'working' ? 'M0,-0.1 L0,0.1' : '';
        setA(n.icGlyph, 'd', gd);
        // label + effort + wait caption
        setA(n.lbl, 'x', r1(x)); setA(n.lbl, 'y', r1(y - 6)); setText(n.lbl, label);
        n.eff.style.display = compact ? 'none' : ''; setA(n.eff, 'x', r1(x)); setA(n.eff, 'y', r1(y + h + 13));
        setText(n.eff, a.startedAt == null ? '' : fmtS(effort[id]));
        var cap = '';
        if (st === 'waiting' && !compact) { var w = a.dependsOn.filter(function (dd) { return A[dd] && A[dd].state !== 'done'; }).map(function (dd) { return A[dd].label || dd; }); if (w.length) cap = trunc('waits: ' + w[0] + (w.length > 1 ? ' +' + (w.length - 1) : ''), Math.max(8, Math.floor((pitch - 10) / 6.6))); }
        setText(n.cap, cap); setA(n.cap, 'x', r1(x)); setA(n.cap, 'y', r1(y + h + 13 + 14));
        var bx = x + BAR_W + 8, midY = y + h / 2;
        // tool pill
        if (st === 'working' && a.tool) {
          var tw = Math.min(a.tool.length, 16) * 7 + 14; setText(n.pillT, trunc(a.tool, 16)); setA(n.pillT, 'x', r1(bx + 7)); setA(n.pillT, 'y', r1(midY + 4));
          setA(n.pillR, 'x', r1(bx)); setA(n.pillR, 'y', r1(midY - 10)); setA(n.pillR, 'width', tw); n.pillG.style.display = ''; n.pillG.style.opacity = dimmed ? '.4' : '';
        } else n.pillG.style.display = 'none';
        // dam (blocked) or lifting dam (just unblocked)
        var lastRec = function (kind) { for (var q = a.recent.length - 1; q >= 0; q--) if (a.recent[q].kind === kind) return a.recent[q].t; return null; };
        var tUn = st === 'working' ? lastRec('unblocked') : null, tRe = st === 'working' ? lastRec('retry') : null;
        var lift = tUn != null && s.t - tUn >= 0 && s.t - tUn < FX_MS && !reducedNow ? (s.t - tUn) / FX_MS : -1;
        if (st === 'blocked' || lift >= 0) {
          setA(n.dam, 'x', r1(x + BAR_W + 14)); setA(n.dam, 'y', r1(y - 6 - (lift >= 0 ? lift * 24 : 0))); setA(n.dam, 'height', r1(h + 12));
          n.dam.style.display = ''; n.dam.style.opacity = lift >= 0 ? String(1 - lift) : (dimmed ? '.4' : '');
        } else n.dam.style.display = 'none';
        // eddy (failed)
        if (st === 'failed') { n.eddy.style.display = ''; n.eddy.setAttribute('transform', 'translate(' + r1(x + BAR_W + 24) + ',' + r1(midY) + ') rotate(' + (reducedNow ? 0 : r1(s.t * 0.18 % 360)) + ')'); n.eddy.style.opacity = dimmed ? '.4' : ''; } else n.eddy.style.display = 'none';
        // one-shot rings: reopening after retry (flow resumes)
        var ring = tRe != null && s.t - tRe >= 0 && s.t - tRe < FX_MS && !reducedNow ? (s.t - tRe) / FX_MS : -1;
        if (ring >= 0) { n.fx.style.display = ''; setA(n.fx, 'class', 'ring-fx-ok'); setA(n.fx, 'cx', r1(x + BAR_W + 24)); setA(n.fx, 'cy', r1(midY)); setA(n.fx, 'r', r1(6 + ring * 26)); n.fx.style.opacity = String(1 - ring); } else n.fx.style.display = 'none';
        // callout (blocked / failed)
        if (st === 'blocked' || st === 'failed') {
          var l1 = st === 'blocked' ? trunc(a.blockedReason || 'blocked', 30) : trunc(a.error || 'failed', 30);
          var l2 = st === 'blocked' ? (a.needs ? 'needs ' + trunc(a.needs, 24) : 'waiting on someone') : 'attempt ' + a.attempt + ' failed';
          var cw = Math.max(l1.length * 6.9 + 12, l2.length * 6.6 + 12), cxp = Math.max(8, Math.min(x - 4, W - cw - 8));
          setA(n.callR, 'class', 'pill pill-' + st); setA(n.callR, 'x', r1(cxp)); setA(n.callR, 'y', r1(y + h + effLine + 4)); setA(n.callR, 'width', r1(cw)); setA(n.callR, 'height', 34);
          setText(n.callT1, l1); setA(n.callT1, 'x', r1(cxp + 6)); setA(n.callT1, 'y', r1(y + h + effLine + 4 + 14));
          setText(n.callT2, l2); setA(n.callT2, 'x', r1(cxp + 6)); setA(n.callT2, 'y', r1(y + h + effLine + 4 + 27));
          n.callG.style.display = ''; n.callG.style.opacity = dimmed ? '.4' : '';
        } else n.callG.style.display = 'none';
      });
      Object.keys(nodes).forEach(function (id) {
        if (!topo.inFlow[id]) { var n = nodes[id]; n.g.remove(); [n.pillG, n.dam, n.eddy, n.fx, n.callG].forEach(function (e) { e.remove(); }); delete nodes[id]; }
      });

      // ---- coordinator chips (roots)
      var cxr = W - 20;
      topo.roots.slice().reverse().forEach(function (id) {
        var a = A[id], c = ensureChip(a), w = 176; cxr -= w; var x = cxr, y = 12; cxr -= 10;
        var st = a.state, isSel = sel === id;
        c.g.setAttribute('class', 'agent' + (isSel ? ' sel' : '') + (sel && !isSel ? ' dim' : ''));
        var eff = a.startedAt == null ? 0 : ((a.endedAt != null ? a.endedAt : s.t) - a.startedAt);
        setA(c.g, 'aria-label', a.name + ', coordinator, ' + st);
        setText(c.title, a.name + ' · ' + U.stateWord(a) + ' · ' + (a.role || 'coordinator'));
        [c.sel, c.focus].forEach(function (r) { setA(r, 'x', x - 3); setA(r, 'y', y - 3); setA(r, 'width', w + 6); });
        setA(c.r, 'x', x); setA(c.r, 'y', y); setA(c.r, 'width', w); setA(c.r, 'class', ''); c.r.setAttribute('stroke', st === 'working' ? '#1F8A7A' : st === 'blocked' ? '#B7790A' : st === 'failed' ? '#B5472F' : '#1F2528');
        c.r.setAttribute('stroke-dasharray', st === 'waiting' ? '4 3' : '');
        setA(c.dot, 'cx', x + 16); setA(c.dot, 'cy', y + 17); setA(c.dot, 'class', 'bar bar-' + st);
        setA(c.t1, 'x', x + 30); setA(c.t1, 'y', y + 15); setText(c.t1, trunc(a.label || a.name, 9));
        setA(c.t2, 'x', x + 30); setA(c.t2, 'y', y + 28); setText(c.t2, 'coordinator · ' + st);
      });
      Object.keys(chipDom).forEach(function (id) { if (topo.roots.indexOf(id) < 0) { chipDom[id].g.remove(); delete chipDom[id]; } });

      // ---- pebbles (outputs): dropped on the producer's ribbon, carried downstream into RELEASE
      var arrivedIdx = 0, arrivedMap = {}, arrivedList = [];
      function routeFor(id) {
        var route = [], first = (outs[id] || []).slice().sort(function (a, b) { return (b.v === REL ? 1e9 : topo.level[b.v]) - (a.v === REL ? 1e9 : topo.level[a.v]) || 0; });
        var e = first.length ? first[first.length - 1] : null, guard = 0, pts = [], len = 0;
        // choose the nearest successor (lowest level) at each hop
        while (e && guard++ < 40) {
          e.cl.forEach(function (p) { if (pts.length) len += Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]); pts.push([p[0], p[1], len]); });
          if (e.v === REL) break;
          var nxt = (outs[e.v] || []).slice().sort(function (a, b) { return (a.v === REL ? 1e9 : topo.level[a.v]) - (b.v === REL ? 1e9 : topo.level[b.v]); });
          e = nxt[0] || null;
        }
        return { pts: pts, len: len };
      }
      var routeCache = {};
      s.outputs.forEach(function (o) {
        var p = ensurePeb(o), t0 = s.t - o.t, rt = null;
        if (topo.inFlow[o.agentId]) rt = routeCache[o.agentId] || (routeCache[o.agentId] = routeFor(o.agentId));
        var dist = t0 * PEB_SPEED, arrived = s.finished || reducedNow || !rt || !rt.pts.length || dist >= rt.len;
        if (arrived) { arrivedMap[o.id] = arrivedList.length; arrivedList.push(o); p.g.style.display = 'none'; return; }
        p.g.style.display = '';
        var pts = rt.pts, i = 1; while (i < pts.length - 1 && pts[i][2] < dist) i++;
        var a0 = pts[i - 1], a1 = pts[i], seg = Math.max(0.001, a1[2] - a0[2]), u = U.clamp((dist - a0[2]) / seg, 0, 1);
        var px = a0[0] + (a1[0] - a0[0]) * u, py = a0[1] + (a1[1] - a0[1]) * u;
        p.g.setAttribute('transform', 'translate(' + r1(px) + ',' + r1(py) + ')');
        setText(p.title, o.name + ' (' + o.kind + ') from ' + (A[o.agentId] ? A[o.agentId].name : o.agentId));
        var showName = t0 < NAME_MS;
        p.nameG.style.display = showName ? '' : 'none';
        if (showName) { var nm = trunc(o.name, 22), w2 = nm.length * 6.6 + 14; setText(p.nameT, nm); setA(p.nameT, 'x', 22); setA(p.nameR, 'x', 14); setA(p.nameR, 'width', r1(w2)); p.nameG.style.opacity = String(t0 > NAME_MS - 500 ? (NAME_MS - t0) / 500 : 1); }
        p.g.style.opacity = sel && A[o.agentId] && !related[o.agentId] ? '.35' : '';
      });
      Object.keys(pebDom).forEach(function (id) { if (!s.outputs.some(function (o) { return o.id === id; })) { pebDom[id].g.remove(); delete pebDom[id]; } });

      // delivered effort: an agent counts once it is done and everything it produced has arrived
      var delivered = 0;
      topo.flow.forEach(function (id) {
        var a = A[id]; if (a.state !== 'done' && !s.finished) return;
        var ok = a.outputs.every(function (oid) { return arrivedMap[oid] != null; });
        if (ok || s.finished) delivered += effort[id];
      });
      var frac = totalEffort > 0 ? U.clamp(delivered / totalEffort, 0, 1) : 0;
      if (s.finished) frac = 1;

      // ---- release channel
      setA(relBox, 'x', relX); setA(relBox, 'y', r1(relTop)); setA(relBox, 'width', relW); setA(relBox, 'height', r1(relH));
      relBox.setAttribute('class', 'rel-box' + (s.finished ? ' fin' : ''));
      var fh = relH * frac; setA(relFillRect, 'x', relX + 2); setA(relFillRect, 'width', relW - 4); setA(relFillRect, 'y', r1(relTop + relH - fh)); setA(relFillRect, 'height', r1(Math.max(0, fh - 2)));
      setA(relTitle, 'x', relX + relW / 2); setA(relTitle, 'y', r1(relTop - 12)); setA(relCap, 'x', relX + relW / 2); setA(relCap, 'y', r1(relTop + relH + 16));
      setText(relCap, s.finished ? 'DELIVERED' : 'FINAL OUTPUT');
      var rows = Math.max(1, Math.floor((relH - 12) / 18)), nShow = 0;
      var relPebs = relGlyphs(arrivedList.length);
      arrivedList.forEach(function (o, i) {
        var g = relPebs[i], cI = Math.floor(i / rows) % 2, rI = i % rows;
        g.setAttribute('transform', 'translate(' + r1(relX + 12 + cI * 20) + ',' + r1(relTop + relH - 14 - rI * 18) + ')');
        g.firstChild.textContent = o.name; nShow++;
      });
      relGlyphsTrim(arrivedList.length);
      var sumLines = [];
      if (s.finished && s.finishedInfo) {
        var words = ((s.finishedInfo.status || '') + ': ' + (s.finishedInfo.summary || '')).split(' '), line = '';
        words.forEach(function (w3) { if ((line + ' ' + w3).length > 19 && line) { sumLines.push(line); line = w3; } else line = line ? line + ' ' + w3 : w3; }); if (line) sumLines.push(line);
      }
      relSum.forEach(function (t, i) { setText(t, sumLines[i] != null ? (i === 3 && sumLines.length > 4 ? trunc(sumLines[i], 17) + '…' : sumLines[i]) : ''); setA(t, 'x', W - 134 + relW / 2 - 56); setA(t, 'y', r1(relTop + relH + 34 + i * 14)); });

      // ---- messages (brief labelled ticks) and delegation flags
      var live = [];
      for (var mi = s.messages.length - 1; mi >= 0 && live.length < 6; mi--) { var m = s.messages[mi], age = s.t - m.t; if (age >= 0 && age < MSG_MS && topo.inFlow[m.from] && topo.inFlow[m.to]) live.push({ m: m, age: age }); else if (age >= MSG_MS) break; }
      poolSync(msgPool, live.length, function () {
        var o = { g: el('g', null, gMsg) }; o.path = el('path', null, o.g, 'msg-line'); o.dot = el('circle', { r: 3.6 }, o.g, 'msg-dot'); o.chipR = el('rect', { rx: 8, height: 17 }, o.g, 'msg-chip'); o.t = txt(o.g, 'msg-t', ''); return o;
      });
      live.forEach(function (L, i) {
        var o = msgPool[i], f = disp[L.m.from], t = disp[L.m.to], fh2 = hOf[L.m.from], th = hOf[L.m.to];
        var fy = f.y + fh2 / 2, ty = t.y + th / 2, d2, mx, my, sameCol = false;
        if (Math.abs(f.x - t.x) < 2) { var bx2 = f.x - 46; d2 = 'M' + r1(f.x) + ',' + r1(fy) + ' C' + r1(bx2) + ',' + r1(fy) + ' ' + r1(bx2) + ',' + r1(ty) + ' ' + r1(t.x) + ',' + r1(ty); mx = f.x - 35; my = (fy + ty) / 2; sameCol = true; }
        else {
          var fwd = t.x > f.x, x0 = fwd ? f.x + BAR_W : f.x, x1 = fwd ? t.x : t.x + BAR_W, xm2 = (x0 + x1) / 2;
          d2 = 'M' + r1(x0) + ',' + r1(fy) + ' C' + r1(xm2) + ',' + r1(fy) + ' ' + r1(xm2) + ',' + r1(ty) + ' ' + r1(x1) + ',' + r1(ty); mx = xm2; my = (fy + ty) / 2;
        }
        var al = L.age > MSG_MS - 700 ? (MSG_MS - L.age) / 700 : 1; o.g.style.opacity = String(r1(al * 10) / 10); o.g.style.display = '';
        setA(o.path, 'd', d2); setA(o.dot, 'cx', r1(mx)); setA(o.dot, 'cy', r1(my));
        var tx = trunc(L.m.text, 34), cw2 = tx.length * 6.1 + 14, cxm = Math.max(6, Math.min(sameCol ? mx - cw2 + 24 : mx - cw2 / 2, W - cw2 - 6));
        setText(o.t, tx); setA(o.t, 'x', r1(cxm + 7)); setA(o.t, 'y', r1(my - 12 + 1)); setA(o.chipR, 'x', r1(cxm)); setA(o.chipR, 'y', r1(my - 25)); setA(o.chipR, 'width', r1(cw2));
      });
      var dl = [];
      for (var di = s.delegations.length - 1; di >= 0 && dl.length < 5; di--) { var dg = s.delegations[di], ag = s.t - dg.t; if (dg.work && ag >= 0 && ag < DLG_MS && topo.inFlow[dg.to] && dg.description) dl.push({ d: dg, age: ag }); else if (ag >= DLG_MS) break; }
      poolSync(dlgPool, dl.length, function () { var o = { g: el('g', null, gMsg) }; o.t = txt(o.g, 'dlg-t', ''); o.t.setAttribute('style', 'paint-order:stroke;stroke:#EAE8E1;stroke-width:4px;stroke-linejoin:round'); return o; });
      dl.forEach(function (L, i) {
        var o = dlgPool[i], d3 = disp[L.d.to]; o.g.style.display = '';
        setText(o.t, '▸ ' + trunc(L.d.description, 34)); setA(o.t, 'x', r1(d3.x)); setA(o.t, 'y', r1(d3.y - lblH - 6));
        o.g.style.opacity = String(L.age > DLG_MS - 600 ? (DLG_MS - L.age) / 600 : 1);
      });

      // ---- header, key
      var pct = Math.round(s.progress * 100);
      setText(tTitle, s.task ? s.task.title : 'Task');
      setText(tHead, 'EFFORT DELIVERED · ' + pct + '% OF AGENTS DONE' + (s.finished ? ' · FINISHED' : ''));
      setA(gaugeFill, 'width', r1(280 * frac)); gaugeFill.style.display = frac > 0.004 ? '' : 'none';
      setText(tGauge, fmtS(delivered) + ' of ' + fmtS(totalEffort) + ' effort delivered so far');
      tEmpty.style.display = topo.flow.length ? 'none' : '';
      setA(tKey1, 'y', H - 30); setA(tKey2, 'y', H - 14);
      snap = false;
    }

    // glyph pool for pebbles that already sit in the release channel
    var relGlyphPool = [];
    function relGlyphs(n) {
      while (relGlyphPool.length < n) { var g = el('g', null, gRel); el('title', null, g); el('path', { d: 'M-5,-7 H2 L6,-3 V7 H-5 Z' }, g, 'peb'); el('path', { d: 'M2,-7 V-3 H6' }, g, 'peb-fold'); relGlyphPool.push(g); }
      for (var i = 0; i < n; i++) relGlyphPool[i].style.display = '';
      return relGlyphPool;
    }
    function relGlyphsTrim(n) { for (var i = n; i < relGlyphPool.length; i++) relGlyphPool[i].style.display = 'none'; }
    function poolSync(pool, n, make) {
      while (pool.length < n) pool.push(make());
      for (var i = 0; i < pool.length; i++) if (i >= n) pool[i].g.style.display = 'none';
    }

    function clearAll() {
      [nodes, chipDom].forEach(function (m) { Object.keys(m).forEach(function (id) { m[id].g.remove(); delete m[id]; }); });
      Object.keys(nodes).forEach(function (id) { delete nodes[id]; });
      Object.keys(edgeDom).forEach(function (k) { edgeDom[k].path.remove(); edgeDom[k].flows.forEach(function (f) { f.remove(); }); delete edgeDom[k]; });
      Object.keys(pebDom).forEach(function (k) { pebDom[k].g.remove(); delete pebDom[k]; });
      gOver.innerHTML = ''; disp = {}; topo = null; topoKey = ''; snap = true;
    }

    return {
      update: function (s, events) {
        S = s;
        var mgr = window.__agentlab;
        if (mgr && mgr.manual) render(0);
        else if (events.length) render(0);
      },
      frame: function (dt, now, s) { S = s; render(Math.min(dt, 100)); },
      onSelect: function () { render(0); },
      onReset: function (s) { S = s; clearAll(); render(0); },
      onMotionChange: function () { snap = true; render(0); },
      resize: function (size) {
        W = size.w; H = size.h; svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); sizeKey = ''; snap = true;
        setA(tKey1, 'x', 28); setA(tKey2, 'x', 28); render(0);
      }
    };
  }
});
