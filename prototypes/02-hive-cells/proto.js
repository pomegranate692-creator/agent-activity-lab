/*
 * 02 Hive Cells.
 * The orchestrator is the queen cell at the centre. Main agents take hex slots in an axial spiral in the
 * order they spawn. Subagents bud as small satellite cells from their parent. A strip of mini hexes at the
 * top has one cell per agent and is the task progress.
 *
 * Everything drawn is derived from the accumulated `state` (and from the events handed to update() for
 * one-shot animations such as budding, a crack, a retry ring and a flying message dot).
 */
AgentChrome.mount({
  id: '02', name: 'Hive Cells', tagline: 'Queen cell, adjacent cells, budding subagents',
  create: function (stage, ctx) {
    'use strict';
    var U = ctx.core.util, NS = 'http://www.w3.org/2000/svg', SQ3 = Math.sqrt(3);
    var C = { bg: '#EAE8E1', ink: '#1F2528', mist: '#B7BCB8', slate: '#56636A', acc: '#1F8A7A', amber: '#B7790A', rust: '#B5472F', line: '#D3D2CA' };
    var FILL = { working: '#D9EAE5', waiting: '#F3F1EA', queued: '#EFEDE6', blocked: '#F1E2C6', failed: '#F1DAD3', done: '#DEE0DC' };
    var STROKE = { working: C.acc, waiting: C.ink, queued: C.mist, blocked: C.amber, failed: C.rust, done: C.ink };

    /* ---------------------------------------------------------------- DOM */
    var wrap = document.createElement('div'); wrap.className = 'hive'; stage.appendChild(wrap);
    var svg = document.createElementNS(NS, 'svg'); wrap.appendChild(svg);
    function el(name, attrs, parent) { var e = document.createElementNS(NS, name); if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
    var gLattice = el('g', null, svg), gLinks = el('g', null, svg), gCells = el('g', null, svg), gDoors = el('g', { 'pointer-events': 'none' }, svg), gDeps = el('g', null, svg),
      gThreads = el('g', { 'pointer-events': 'none' }, svg), gFly = el('g', { 'pointer-events': 'none' }, svg), gPills = el('g', { 'pointer-events': 'none' }, svg), gStrip = el('g', null, svg);
    var tip = document.createElement('div'); tip.className = 'hive-tip'; wrap.appendChild(tip);
    var empty = document.createElement('div'); empty.className = 'hive-empty'; empty.textContent = 'Waiting for the task to start…'; wrap.appendChild(empty);

    function Pool(layer) { this.layer = layer; this.map = {}; this.used = {}; }
    Pool.prototype.begin = function () { this.used = {}; };
    Pool.prototype.get = function (key, make) { var e = this.map[key]; if (!e) { e = make(this.layer); this.map[key] = e; } this.used[key] = 1; return e; };
    Pool.prototype.end = function () { for (var k in this.map) if (!this.used[k]) { this.map[k].root.remove(); delete this.map[k]; } };
    var pLattice = new Pool(gLattice), pLinks = new Pool(gLinks), pDoors = new Pool(gDoors), pDeps = new Pool(gDeps), pThreads = new Pool(gThreads), pFly = new Pool(gFly), pPills = new Pool(gPills), pStrip = new Pool(gStrip);

    /* ---------------------------------------------------------------- geometry helpers */
    function hexPts(cx, cy, R) { var p = []; for (var i = 0; i < 6; i++) { var a = (-90 + 60 * i) * Math.PI / 180; p.push((cx + R * Math.cos(a)).toFixed(1) + ',' + (cy + R * Math.sin(a)).toFixed(1)); } return p.join(' '); }
    function pageD(x, y, w) { var h = w * 1.25, f = w * 0.34; return 'M' + x + ' ' + y + 'h' + (w - f) + 'l' + f + ' ' + f + 'v' + (h - f) + 'h' + (-w) + 'z M' + (x + w - f) + ' ' + y + 'v' + f + 'h' + f; }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

    /* axial spiral of slots: slot 0 = centre, ring 1 starts NW and runs clockwise (NW, NE, E, SE, SW, W) */
    var slotCache = [[0, 0]];
    (function () {
      var moves = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
      for (var ring = 1; ring <= 8; ring++) {
        var q = 0, r = -ring;
        for (var d = 0; d < 6; d++) for (var n = 0; n < ring; n++) { slotCache.push([q, r]); q += moves[d][0]; r += moves[d][1]; }
      }
    })();
    function slotUnit(i) { var s = slotCache[Math.min(i, slotCache.length - 1)]; return { x: SQ3 * (s[0] + s[1] / 2), y: 1.5 * s[1] }; }
    function ringOf(i) { var s = slotCache[Math.min(i, slotCache.length - 1)]; return Math.max(Math.abs(s[0]), Math.abs(s[1]), Math.abs(-s[0] - s[1])); }

    var RM = 0.94, RELEASE = '__release';
    function satRadius(depth) { return depth <= 2 ? 0.5 : depth === 3 ? 0.4 : 0.32; }

    /* Layout in unit space (slot spacing = sqrt(3)). Depends only on the state, never on the scenario's ids. */
    function computeLayout(s) {
      var pos = {}, circles = [], kind = {}, root = null, i, id, a;
      for (i = 0; i < s.order.length; i++) {
        id = s.order[i]; a = s.agents[id];
        if (!a.parentId || !s.agents[a.parentId]) { if (!root) { root = id; kind[id] = 'root'; } else kind[id] = 'main'; }
        else if (a.parentId === root) kind[id] = 'main';
        else kind[id] = 'sub';
      }
      var slot = 0, maxSlot = 0;
      s.order.forEach(function (id) {
        if (kind[id] === 'root') { pos[id] = { x: 0, y: 0, r: RM, kind: 'root', depth: 1 }; circles.push(pos[id]); }
      });
      s.order.forEach(function (id) {
        if (kind[id] !== 'main') return;
        slot++; var u = slotUnit(slot); pos[id] = { x: u.x, y: u.y, r: RM, kind: 'main', depth: 1, slot: slot }; circles.push(pos[id]); maxSlot = slot;
      });
      var relSlot = -1;
      if (s.finished && root) { relSlot = ++slot; var ur = slotUnit(slot); pos[RELEASE] = { x: ur.x, y: ur.y, r: RM, kind: 'release', depth: 1, slot: slot }; circles.push(pos[RELEASE]); maxSlot = slot; }
      var rx = pos[root] ? pos[root].x : 0, ry = pos[root] ? pos[root].y : 0;
      var offs = [0, 35, -35, 70, -70, 105, -105, 140, -140, 180];
      var pending = s.order.filter(function (id) { return kind[id] === 'sub'; }), guard = 0;
      while (pending.length && guard++ < 8) {
        var next = [];
        pending.forEach(function (id) {
          var a = s.agents[id], par = pos[a.parentId];
          if (!par) { next.push(id); return; }
          var depth = par.depth + 1, r = satRadius(depth), base = (par.x === rx && par.y === ry) ? -Math.PI / 2 : Math.atan2(par.y - ry, par.x - rx);
          var dmin = par.r * 0.9 + r + 0.28, best = null;
          for (var di = 0; di < 7 && !best; di++) {
            var d = dmin + di * 0.28;
            for (var oi = 0; oi < offs.length && !best; oi++) {
              var ang = base + offs[oi] * Math.PI / 180, c = { x: par.x + d * Math.cos(ang), y: par.y + d * Math.sin(ang) }, ok = true;
              for (var q = 0; q < circles.length; q++) { var o = circles[q]; var lim = r + (o.kind === 'sub' ? o.r : o.r * 0.95) + 0.14; if (Math.hypot(c.x - o.x, c.y - o.y) < lim) { ok = false; break; } }
              if (ok) best = c;
            }
          }
          if (!best) best = { x: par.x + dmin * Math.cos(base), y: par.y + dmin * Math.sin(base) };
          pos[id] = { x: best.x, y: best.y, r: r, kind: 'sub', depth: depth, parent: a.parentId }; circles.push(pos[id]);
        });
        pending = next;
      }
      pending.forEach(function (id) { pos[id] = { x: 0, y: 0, r: 0.3, kind: 'sub', depth: 2 }; });
      var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      Object.keys(pos).forEach(function (k) { var p = pos[k]; x0 = Math.min(x0, p.x - p.r * 0.87); x1 = Math.max(x1, p.x + p.r * 0.87); y0 = Math.min(y0, p.y - p.r); y1 = Math.max(y1, p.y + p.r); });
      if (x0 > x1) { x0 = -1; x1 = 1; y0 = -1; y1 = 1; }
      return { pos: pos, kind: kind, root: root, bbox: { x0: x0, x1: x1, y0: y0, y1: y1 }, maxSlot: maxSlot, relSlot: relSlot };
    }

    /* ---------------------------------------------------------------- runtime state */
    var W = 960, H = 600, STRIP_H = 58;
    var lay = null, views = {}, lastState = null, clock = 0, hoverId = null;
    var disp = { k: 40, ox: 480, oy: 330 }, targ = { k: 40, ox: 480, oy: 330 };
    var flyers = [], rings = [], outPop = {}, failEv = {}, doneEv = {};
    var pillBoxes = {};

    function size() { var r = stage.getBoundingClientRect(); if (r.width > 50 && r.height > 50) { W = Math.round(r.width); H = Math.round(r.height); } svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); }

    /* ---------------------------------------------------------------- cell views */
    function mkView(id) {
      var g = el('g', { 'class': 'agent', tabindex: 0, role: 'button' }, gCells);
      var v = { id: id, g: g, ux: 0, uy: 0, sc: 1, tx: 0, ty: 0, r: RM, kind: 'main', st: null, glyphKey: '', crackP: 0, pop: 0, outEls: {}, pxR: 0, px: 0, py: 0, label: '', name: '' };
      v.sel = el('polygon', { 'class': 'c-sel' }, g);
      v.queen = el('polygon', { fill: 'none', stroke: C.ink, 'stroke-width': 1.2, display: 'none' }, g);
      v.hex = el('polygon', { 'stroke-linejoin': 'round' }, g);
      v.inner = el('polygon', { fill: 'none', 'stroke-width': 1.3, display: 'none', 'stroke-linejoin': 'round' }, g);
      v.crack = el('polyline', { fill: 'none', stroke: '#7B2A18', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: 1, display: 'none' }, g);
      v.glyph = el('g', { 'class': 'glyph' }, g);
      v.text = el('text', { 'class': 'c-lbl' }, g);
      v.badge = el('text', { 'class': 'c-badge' }, g);
      v.outs = el('g', null, g);
      v.hit = el('polygon', { 'class': 'hit', fill: 'transparent' }, g);
      if (id !== RELEASE) {
        g.addEventListener('click', function () { ctx.select(id); });
        g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); ctx.select(id); } });
      } else {
        g.setAttribute('aria-label', 'Final result');
        g.addEventListener('keydown', function (e) { if (e.key === ' ') e.stopPropagation(); });
      }
      g.addEventListener('mouseenter', function () { hoverId = id; showTip(id); });
      g.addEventListener('mouseleave', function () { if (hoverId === id) { hoverId = null; hideTip(); } });
      g.addEventListener('focus', function () { hoverId = id; showTip(id); });
      g.addEventListener('blur', function () { if (hoverId === id) { hoverId = null; hideTip(); } });
      return v;
    }

    function glyphFor(v, st) {
      v.glyph.innerHTML = '';
      var g = v.glyph;
      if (v.id === RELEASE) { el('path', { d: 'M-0.8 -1 h1 l0.6 0.6 v1.8 h-1.6z M0.2 -1 v0.6 h0.6', fill: '#fff', stroke: C.acc, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }, g); el('polyline', { points: '-0.4,0.35 -0.1,0.7 0.4,0', fill: 'none', stroke: C.acc, 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g); return; }
      if (st === 'working') { el('circle', { r: 1, fill: 'none', stroke: C.acc, 'stroke-width': 1.3, opacity: 0.55 }, g); v.dot = el('circle', { r: 0.5, fill: C.acc }, g); }
      else if (st === 'waiting') el('circle', { r: 0.72, fill: C.bg, stroke: C.ink, 'stroke-width': 1.5, 'stroke-dasharray': '2 2.2' }, g);
      else if (st === 'queued') el('circle', { r: 0.72, fill: 'none', stroke: C.mist, 'stroke-width': 1.6 }, g);
      else if (st === 'blocked') { el('circle', { r: 1, fill: '#FBF1DC', stroke: C.amber, 'stroke-width': 1.5 }, g); el('rect', { x: -0.4, y: -0.42, width: 0.28, height: 0.84, fill: C.amber }, g); el('rect', { x: 0.12, y: -0.42, width: 0.28, height: 0.84, fill: C.amber }, g); }
      else if (st === 'failed') { el('circle', { r: 0.9, fill: C.rust }, g); el('path', { d: 'M-0.38 -0.38 L0.38 0.38 M0.38 -0.38 L-0.38 0.38', stroke: '#fff', 'stroke-width': 1.8, 'stroke-linecap': 'round' }, g); }
      else if (st === 'done') { el('circle', { r: 0.9, fill: C.ink }, g); el('polyline', { points: '-0.42,0.02 -0.12,0.34 0.44,-0.34', fill: 'none', stroke: '#fff', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g); }
    }

    var CRACK = [[0.08, -0.98], [-0.06, -0.62], [0.2, -0.32], [-0.1, -0.02], [0.18, 0.3], [-0.04, 0.62], [0.06, 0.98]];

    /* Draw one cell at its current display position. */
    function drawView(v, a, s) {
      var R = v.pxR, cx = v.px, cy = v.py, st = v.id === RELEASE ? 'release' : a.state;
      var big = R >= 22;
      var fs = clamp(R * 0.2, 10, 14), label = v.label, w = SQ3 * R * 0.86, chW = fs * 0.62 + fs * 0.05;
      var fits = label.length * chW <= w;
      var showLabel = fits && R >= 17;
      v.showLabel = showLabel;
      v.hex.setAttribute('points', hexPts(cx, cy, R));
      v.hit.setAttribute('points', hexPts(cx, cy, R));
      v.sel.setAttribute('points', hexPts(cx, cy, R + 5));
      v.sel.setAttribute('stroke-linejoin', 'round');
      if (v.kind === 'root') { v.queen.setAttribute('display', ''); v.queen.setAttribute('points', hexPts(cx, cy, R + 4)); v.queen.setAttribute('stroke', st === 'working' ? C.acc : C.ink); } else v.queen.setAttribute('display', 'none');
      if (st === 'release') {
        v.hex.setAttribute('fill', '#CFE6DF'); v.hex.setAttribute('stroke', s.finishedInfo && s.finishedInfo.status !== 'succeeded' ? C.rust : C.acc); v.hex.setAttribute('stroke-width', 3); v.hex.removeAttribute('stroke-dasharray');
        v.inner.setAttribute('display', ''); v.inner.setAttribute('points', hexPts(cx, cy, R * 0.8)); v.inner.setAttribute('stroke', C.acc); v.inner.setAttribute('opacity', 0.7);
      } else {
        v.hex.setAttribute('fill', FILL[st]); v.hex.setAttribute('stroke', STROKE[st]);
        v.hex.setAttribute('stroke-width', st === 'working' || st === 'blocked' || st === 'failed' ? 2.3 : 1.8);
        if (st === 'waiting') v.hex.setAttribute('stroke-dasharray', '7 5'); else v.hex.removeAttribute('stroke-dasharray');
        if (st === 'working') { v.inner.setAttribute('display', ''); v.inner.setAttribute('points', hexPts(cx, cy, R * 0.78)); v.inner.setAttribute('stroke', C.acc); v.inner.setAttribute('opacity', 0.55); } else v.inner.setAttribute('display', 'none');
      }
      /* crack (failed): drawn on, then stays until retry */
      if (st === 'failed' && v.crackP > 0) {
        v.crack.setAttribute('display', '');
        v.crack.setAttribute('points', CRACK.map(function (p) { return (cx + p[0] * R * 0.9).toFixed(1) + ',' + (cy + p[1] * R * 0.9).toFixed(1); }).join(' '));
        v.crack.setAttribute('stroke-dasharray', '1 1'); v.crack.setAttribute('stroke-dashoffset', (1 - clamp(v.crackP, 0, 1)).toFixed(3));
      } else v.crack.setAttribute('display', 'none');
      /* glyph + label */
      if (v.glyphKey !== st) { glyphFor(v, st); v.glyphKey = st; }
      var gr = showLabel ? clamp(R * 0.2, 4.5, 13) : clamp(R * 0.34, 4.5, 14), gy = showLabel ? cy + R * 0.36 : cy;
      if (st === 'release') { gr = clamp(R * 0.3, 7, 22); gy = cy - R * 0.08; }
      var pulse = 1;
      if (st === 'working' && !ctx.reducedMotion()) pulse = 1 + 0.12 * Math.sin(clock / 420);
      v.glyph.setAttribute('transform', 'translate(' + cx.toFixed(1) + ' ' + gy.toFixed(1) + ') scale(' + gr.toFixed(2) + ')');
      if (v.dot) v.dot.setAttribute('r', (0.5 * pulse).toFixed(3));
      if (showLabel) {
        v.text.style.display = ''; v.text.setAttribute('x', cx.toFixed(1)); v.text.setAttribute('y', (cy - R * (st === 'release' ? -0.46 : 0.2) + fs * 0.35).toFixed(1)); v.text.setAttribute('font-size', fs.toFixed(1)); v.text.textContent = label;
        v.text.style.fontSize = fs.toFixed(1) + 'px';
      } else v.text.style.display = 'none';
      /* retry badge */
      if (v.id === RELEASE) { var nOut = s.finishedInfo ? (s.finishedInfo.outputIds || []).length : 0; v.badge.style.display = ''; v.badge.textContent = nOut + ' outputs'; v.badge.setAttribute('x', cx.toFixed(1)); v.badge.setAttribute('y', (cy + R * 0.82).toFixed(1)); v.badge.style.fontSize = clamp(R * 0.17, 9, 12) + 'px'; }
      else if (a && a.attempt > 1 && R >= 14) { v.badge.style.display = ''; v.badge.textContent = '↻' + a.attempt; v.badge.setAttribute('x', cx.toFixed(1)); v.badge.setAttribute('y', (cy + R * 0.8).toFixed(1)); v.badge.style.fontSize = clamp(R * 0.18, 9, 12) + 'px'; } else v.badge.style.display = 'none';
      /* outputs: page glyphs stacked on the producing cell */
      drawOutputs(v, a, s, cx, cy, R);
    }

    function drawOutputs(v, a, s, cx, cy, R) {
      var ids = [];
      if (v.id === RELEASE) ids = [];
      else if (a) ids = a.outputs.map(function (oid) { var o = s.outputs.filter(function (x) { return x.id === oid; })[0]; return { id: oid, name: o ? o.name : oid, kind: o ? o.kind : 'doc' }; });
      var wpx = clamp(R * 0.3, 8, 17), maxShow = 4, shown = ids.slice(-maxShow), seen = {};
      shown.forEach(function (o, i) {
        seen[o.id] = 1; var e = v.outEls[o.id];
        if (!e) { e = v.outEls[o.id] = { g: el('g', null, v.outs), p: null }; e.p = el('path', { fill: o.kind === 'patch' ? '#E4DDF0' : o.kind === 'report' ? '#F1E2C6' : o.kind === 'release' ? '#CFE6DF' : '#fff', stroke: C.acc, 'stroke-width': 1.3, 'stroke-linejoin': 'round' }, e.g); }
        var pop = outPop[o.id] == null ? 1 : outPop[o.id];
        var x = cx + R * 0.5 + i * wpx * 0.5, y = cy - R * 1.02 - i * wpx * 0.28;
        if (v.id === RELEASE) { x = cx - wpx * 1.0 + i * wpx * 0.9; y = cy - R * 0.62 - i * 0; }
        e.p.setAttribute('d', pageD(0, 0, wpx));
        var sc = pop < 1 ? 0.3 + 0.7 * U.ease(pop) : 1;
        e.g.setAttribute('transform', 'translate(' + (x - wpx / 2).toFixed(1) + ' ' + (y - wpx * 0.6).toFixed(1) + ') scale(' + sc.toFixed(2) + ')');
      });
      Object.keys(v.outEls).forEach(function (k) { if (!seen[k]) { v.outEls[k].g.remove(); delete v.outEls[k]; } });
      if (ids.length > maxShow) {
        if (!v.more) v.more = el('text', { 'class': 'c-badge' }, v.outs);
        v.more.textContent = '+' + (ids.length - maxShow); v.more.setAttribute('x', (cx + R * 0.5 + maxShow * wpx * 0.5 + wpx).toFixed(1)); v.more.setAttribute('y', (cy - R * 1.02 - 3 * wpx * 0.28 + wpx * 0.5).toFixed(1));
      } else if (v.more) { v.more.remove(); v.more = null; }
    }

    /* ---------------------------------------------------------------- tooltip */
    function showTip(id) {
      var s = lastState; if (!s) return; var v = views[id]; if (!v) return;
      var html;
      if (id === RELEASE) html = '<b>Final result</b>' + (s.finishedInfo ? '<i>' + s.finishedInfo.status + '</i> · ' + esc(s.finishedInfo.summary || '') : '');
      else { var a = s.agents[id]; if (!a) return; html = '<b>' + esc(a.name) + '</b><i>' + a.state + '</i>' + (a.state === 'blocked' ? ': ' + esc(a.blockedReason || '') : a.state === 'failed' ? ': ' + esc(a.error || '') : a.state === 'working' && a.tool ? ' · ' + esc(a.tool) : '') + (a.work ? '<br>' + esc(a.work) : ''); }
      tip.innerHTML = html; tip.classList.add('on');
      var tw = tip.offsetWidth, th = tip.offsetHeight, x = v.px - tw / 2, y = v.py - v.pxR - th - 10;
      if (y < STRIP_H) y = v.py + v.pxR + 10;
      tip.style.left = clamp(x, 6, W - tw - 6) + 'px'; tip.style.top = clamp(y, 6, H - th - 6) + 'px';
    }
    function hideTip() { tip.classList.remove('on'); }
    function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

    /* ---------------------------------------------------------------- sync state -> views and targets */
    function relatedSet(s, sid) {
      var rel = {}; if (!sid) return rel;
      s.delegations.forEach(function (d) { if (d.from === sid) rel[d.to] = 1; if (d.to === sid) rel[d.from] = 1; });
      s.dependencies.forEach(function (d) { if (d.from === sid) rel[d.to] = 1; if (d.to === sid) rel[d.from] = 1; });
      s.messages.forEach(function (m) { if (m.from === sid) rel[m.to] = 1; if (m.to === sid) rel[m.from] = 1; });
      delete rel[sid]; return rel;
    }

    function fitTarget() {
      var b = lay.bbox, pad = 30, top = STRIP_H + 14, bot = 46;
      var aw = W - pad * 2, ah = H - top - bot;
      var k = clamp(Math.min(78, aw / (b.x1 - b.x0), ah / (b.y1 - b.y0)), 9, 78);
      targ.k = k; targ.ox = W / 2 - (b.x0 + b.x1) / 2 * k; targ.oy = top + ah / 2 - (b.y0 + b.y1) / 2 * k;
    }

    function sync(s, events, snap) {
      lastState = s;
      var anim = !snap && !ctx.reducedMotion();
      lay = computeLayout(s);
      var spawned = {}, finEv = false;
      events.forEach(function (e) {
        if (e.type === 'agent_spawned') spawned[e.agentId] = 1;
        if (e.type === 'task_finished') finEv = true;
        if (e.type === 'agent_failed') failEv[e.agentId] = 1;
        if (e.type === 'output_produced') outPop[e.outputId] = anim ? 0 : 1;
        if (e.type === 'agent_retry' && anim) rings.push({ id: e.agentId, age: 0 });
        if (e.type === 'message_sent') flyers.push({ from: e.fromId, to: e.toId, text: e.text, age: 0 });
      });
      var oldK = disp.k; fitTarget();
      var first = !Object.keys(views).length;
      var ids = s.order.slice(); if (lay.pos[RELEASE]) ids.push(RELEASE);
      ids.forEach(function (id) {
        var p = lay.pos[id]; if (!p) return;
        var v = views[id], a = s.agents[id], fresh = !v;
        if (fresh) {
          v = views[id] = mkView(id);
          if (anim && (spawned[id] || (id === RELEASE && finEv))) {
            var par = id === RELEASE ? views[lay.root] : views[s.agents[id].parentId];
            v.ux = par ? par.ux : p.x; v.uy = par ? par.uy : p.y; v.sc = 0.08; if (p.kind === 'main' || p.kind === 'root') { v.ux = p.x; v.uy = p.y; v.sc = 0.2; }
            v.pop = 1;
          } else { v.ux = p.x; v.uy = p.y; v.sc = 1; }
        }
        v.tx = p.x; v.ty = p.y; v.kind = p.kind; v.r = p.r;
        if (snap || !anim) { v.ux = p.x; v.uy = p.y; v.sc = 1; }
        if (id === RELEASE) { v.label = 'RELEASE'; v.name = 'Release'; v.g.setAttribute('aria-label', 'Final result: release ' + (s.finishedInfo ? s.finishedInfo.status : '')); }
        else {
          v.label = a.label || a.name; v.name = a.name;
          var desc = a.name + ', ' + a.state + (a.state === 'blocked' ? ': ' + a.blockedReason : a.state === 'failed' ? ': ' + a.error : '');
          if (v.desc !== desc) { v.desc = desc; v.g.setAttribute('aria-label', desc); }
          if (v.st !== a.state) {
            if (a.state === 'failed') v.crackP = (anim && failEv[id]) ? 0 : 1; else v.crackP = 0;
            if (anim && v.st && events.length) v.pop = 0.8;
            v.st = a.state;
          }
        }
      });
      Object.keys(views).forEach(function (id) { if (!lay.pos[id] || (id !== RELEASE && !s.agents[id])) { views[id].g.remove(); delete views[id]; } });
      if (snap || !anim || first) { disp.k = targ.k; disp.ox = targ.ox; disp.oy = targ.oy; }
      empty.style.display = s.order.length ? 'none' : '';
      failEv = {};
      render();
    }

    /* ---------------------------------------------------------------- render */
    function px(v) { v.pxR = v.r * disp.k * v.sc * (1 + 0.05 * v.pop); v.px = disp.ox + v.ux * disp.k; v.py = disp.oy + v.uy * disp.k; }

    function lineEnds(A, B, ia, ib) { var dx = B.px - A.px, dy = B.py - A.py, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d; return { x1: A.px + ux * A.pxR * ia, y1: A.py + uy * A.pxR * ia, x2: B.px - ux * B.pxR * ib, y2: B.py - uy * B.pxR * ib, ux: ux, uy: uy, d: d }; }

    function render() {
      var s = lastState; if (!s) return;
      var sid = ctx.selected(), rel = relatedSet(s, sid), id;
      Object.keys(views).forEach(function (k) { px(views[k]); });
      /* cells */
      Object.keys(views).forEach(function (k) {
        var v = views[k], a = s.agents[k];
        drawView(v, a, s);
        v.g.setAttribute('class', 'agent' + (sid === k ? ' sel' : '') + (rel[k] ? ' rel' : ''));
        v.g.style.opacity = sid && sid !== k && !rel[k] ? 0.72 : 1;
      });
      /* lattice of free slots (capacity of the hive) */
      pLattice.begin();
      if (lay.root) {
        var rings0 = Math.max(1, ringOf(lay.maxSlot) + (ringOf(lay.maxSlot + 1) === ringOf(lay.maxSlot) ? 0 : 0));
        var lastIdx = 0; for (var si = 0; si < slotCache.length; si++) if (ringOf(si) <= rings0) lastIdx = si;
        var circles = Object.keys(views).map(function (k) { return views[k]; });
        for (var i = 1; i <= lastIdx; i++) {
          var u = slotUnit(i), cx = disp.ox + u.x * disp.k, cy = disp.oy + u.y * disp.k, taken = false;
          for (var q = 0; q < circles.length; q++) { var c = circles[q]; if (c.kind === 'sub' ? Math.hypot(c.px - cx, c.py - cy) < c.pxR + RM * disp.k * 0.8 : Math.hypot(c.px - cx, c.py - cy) < RM * disp.k * 0.9) { taken = true; break; } }
          if (taken || cx - RM * disp.k * 0.87 < 8 || cx + RM * disp.k * 0.87 > W - 8 || cy - RM * disp.k < STRIP_H + 6 || cy + RM * disp.k > H - 40) continue;
          var e = pLattice.get(i, function (layer) { var p = el('polygon', { fill: 'none', stroke: C.line, 'stroke-width': 1, 'stroke-linejoin': 'round' }, layer); return { root: p, p: p }; });
          e.p.setAttribute('points', hexPts(cx, cy, RM * disp.k));
        }
      }
      pLattice.end();
      /* delegation links */
      pLinks.begin(); pDoors.begin(); pThreads.begin(); pDeps.begin();
      var seen = {};
      s.delegations.forEach(function (d) {
        var k = d.from + '>' + d.to; if (seen[k]) return; seen[k] = 1;
        var A = views[d.from], B = views[d.to]; if (!A || !B) return;
        var hot = sid && (d.from === sid || d.to === sid);
        var adjacent = A.kind !== 'sub' && B.kind !== 'sub' && Math.hypot(A.px - B.px, A.py - B.py) < (A.pxR + B.pxR) * 1.0 + 6;
        if (adjacent) {
          /* doorway on the shared edge */
          var L = lineEnds(A, B, 1, 1), mx = (A.px + B.px) / 2, my = (A.py + B.py) / 2, nx = -L.uy, ny = L.ux, hl = A.pxR * 0.32;
          var ed = pDoors.get('door:' + k, function (layer) { var l = el('line', { stroke: C.ink, 'stroke-width': 4, 'stroke-linecap': 'round' }, layer); return { root: l, l: l }; });
          ed.l.setAttribute('x1', mx - nx * hl); ed.l.setAttribute('y1', my - ny * hl); ed.l.setAttribute('x2', mx + nx * hl); ed.l.setAttribute('y2', my + ny * hl);
          ed.l.setAttribute('stroke', hot ? C.acc : C.ink); ed.l.setAttribute('stroke-width', hot ? 5 : 4); ed.l.setAttribute('opacity', sid && !hot ? 0.45 : 1);
        } else {
          var E = lineEnds(A, B, 0.9, 0.9);
          var tgt = hot ? pThreads : pLinks;
          var en = tgt.get('del:' + k, function (layer) { var gg = el('g', null, layer), l = el('line', { 'stroke-linecap': 'round' }, gg), dot = el('circle', {}, gg); return { root: gg, l: l, dot: dot }; });
          var seg = { x1: E.x1, y1: E.y1, x2: E.x2, y2: E.y2 };
          en.l.setAttribute('x1', seg.x1); en.l.setAttribute('y1', seg.y1); en.l.setAttribute('x2', seg.x2); en.l.setAttribute('y2', seg.y2);
          en.l.setAttribute('stroke', hot ? C.acc : C.ink); en.l.setAttribute('stroke-width', hot ? 2.6 : 1.5); en.root.setAttribute('opacity', sid && !hot ? 0.35 : 1);
          en.dot.setAttribute('cx', seg.x2); en.dot.setAttribute('cy', seg.y2); en.dot.setAttribute('r', hot ? 3.4 : 2.4); en.dot.setAttribute('fill', hot ? C.acc : C.ink);
        }
      });
      if (lay.pos[RELEASE] && views[RELEASE] && views[lay.root]) {
        var Ar = views[lay.root], Br = views[RELEASE], Lr = lineEnds(Ar, Br, 1, 1), mxr = (Ar.px + Br.px) / 2, myr = (Ar.py + Br.py) / 2, hl2 = Ar.pxR * 0.32;
        if (Math.hypot(Ar.px - Br.px, Ar.py - Br.py) < (Ar.pxR + Br.pxR) + 8) {
          var er = pDoors.get('door:release', function (layer) { var l = el('line', { stroke: C.acc, 'stroke-width': 4, 'stroke-linecap': 'round' }, layer); return { root: l, l: l }; });
          er.l.setAttribute('x1', mxr + Lr.uy * hl2); er.l.setAttribute('y1', myr - Lr.ux * hl2); er.l.setAttribute('x2', mxr - Lr.uy * hl2); er.l.setAttribute('y2', myr + Lr.ux * hl2);
        } else {
          var el2 = pLinks.get('del:release', function (layer) { var l = el('line', { stroke: C.acc, 'stroke-width': 2, 'stroke-linecap': 'round' }, layer); return { root: l, l: l }; });
          el2.l.setAttribute('x1', Lr.x1); el2.l.setAttribute('y1', Lr.y1); el2.l.setAttribute('x2', Lr.x2); el2.l.setAttribute('y2', Lr.y2);
        }
      }
      /* dependencies: dashed, only while the dependant waits on an unfinished agent (all of them for the selection) */
      s.dependencies.forEach(function (d) {
        var A = views[d.from], B = views[d.to], fa = s.agents[d.from], fb = s.agents[d.to]; if (!A || !B || !fa || !fb) return;
        var unmet = fa.state !== 'done' && fb.state === 'waiting', hot = sid && (d.from === sid || d.to === sid);
        if (!unmet && !hot) return;
        var E = lineEnds(A, B, 0.72, 0.72), key = 'dep:' + d.from + '>' + d.to, tgt = hot ? pThreads : pDeps;
        var en = tgt.get(key, function (layer) { var gg = el('g', null, layer), l = el('line', { 'stroke-linecap': 'round', 'stroke-dasharray': '6 5' }, gg), ar = el('polygon', {}, gg); return { root: gg, l: l, ar: ar }; });
        var col = hot ? (unmet ? C.ink : C.slate) : C.slate;
        en.l.setAttribute('x1', E.x1); en.l.setAttribute('y1', E.y1); en.l.setAttribute('x2', E.x2); en.l.setAttribute('y2', E.y2); en.l.setAttribute('stroke', col); en.l.setAttribute('stroke-width', hot ? 2.2 : 1.8);
        en.root.setAttribute('opacity', unmet ? 1 : 0.55);
        var ax = E.x2, ay = E.y2, ux = E.ux, uy = E.uy, sz = 7;
        en.ar.setAttribute('points', ax + ',' + ay + ' ' + (ax - ux * sz - uy * sz * 0.55) + ',' + (ay - uy * sz + ux * sz * 0.55) + ' ' + (ax - ux * sz + uy * sz * 0.55) + ',' + (ay - uy * sz - ux * sz * 0.55)); en.ar.setAttribute('fill', col);
      });
      /* thread lines for the selection: messages */
      if (sid) {
        var ms = {};
        s.messages.forEach(function (m) {
          if (m.from !== sid && m.to !== sid) return; var key = m.from + '>' + m.to; if (ms[key]) return; ms[key] = 1;
          var A = views[m.from], B = views[m.to]; if (!A || !B) return; var E = lineEnds(A, B, 0.55, 0.55);
          var en = pThreads.get('msg:' + key, function (layer) { var l = el('line', { stroke: C.acc, 'stroke-width': 2.4, 'stroke-dasharray': '1 6', 'stroke-linecap': 'round' }, layer); return { root: l, l: l }; });
          en.l.setAttribute('x1', E.x1); en.l.setAttribute('y1', E.y1); en.l.setAttribute('x2', E.x2); en.l.setAttribute('y2', E.y2);
        });
      }
      pLinks.end(); pDoors.end(); pThreads.end(); pDeps.end();
      /* flying message dots */
      pFly.begin();
      var rm = ctx.reducedMotion();
      flyers.forEach(function (f, i) {
        var A = views[f.from], B = views[f.to]; if (!A || !B) return;
        var dur = rm ? 1600 : 950, p = clamp(f.age / dur, 0, 1), q = rm ? 0.5 : U.ease(p);
        var x = A.px + (B.px - A.px) * q, y = A.py + (B.py - A.py) * q, fade = rm ? 1 : (p > 0.85 ? (1 - p) / 0.15 : 1);
        var en = pFly.get('f' + i + ':' + f.from + f.to + f.t, function (layer) {
          var gg = el('g', null, layer), tr = el('line', { stroke: C.acc, 'stroke-width': 2.4, 'stroke-dasharray': '1 5', 'stroke-linecap': 'round' }, gg), ring = el('circle', { r: 7, fill: '#fff', stroke: C.acc, 'stroke-width': 2 }, gg), dot = el('circle', { r: 4, fill: C.acc }, gg);
          var bg = el('rect', { rx: 4, fill: '#F3F1EA', stroke: C.acc, 'stroke-width': 1 }, gg), tx = el('text', { 'class': 'msg-t' }, gg); return { root: gg, tr: tr, ring: ring, dot: dot, bg: bg, tx: tx };
        });
        en.root.setAttribute('opacity', fade);
        en.tr.setAttribute('x1', A.px); en.tr.setAttribute('y1', A.py); en.tr.setAttribute('x2', rm ? B.px : x); en.tr.setAttribute('y2', rm ? B.py : y);
        en.ring.setAttribute('cx', x); en.ring.setAttribute('cy', y); en.dot.setAttribute('cx', x); en.dot.setAttribute('cy', y);
        var txt = f.text.length > 34 ? f.text.slice(0, 33) + '…' : f.text, tw = txt.length * 6.8 + 12, tx0 = clamp(x - tw / 2, 4, W - tw - 4), ty0 = clamp(y - 30, STRIP_H, H - 24);
        en.tx.textContent = txt; en.tx.setAttribute('x', tx0 + 6); en.tx.setAttribute('y', ty0 + 13);
        en.bg.setAttribute('x', tx0); en.bg.setAttribute('y', ty0); en.bg.setAttribute('width', tw); en.bg.setAttribute('height', 19);
      });
      rings.forEach(function (r, i) {
        var v = views[r.id]; if (!v) return; var p = clamp(r.age / 800, 0, 1);
        var en = pFly.get('ring' + i + r.id, function (layer) { var c = el('polygon', { fill: 'none', stroke: C.acc, 'stroke-width': 3, 'stroke-linejoin': 'round' }, layer); return { root: c, c: c }; });
        en.c.setAttribute('points', hexPts(v.px, v.py, v.pxR * (1.02 + 0.55 * U.ease(p)))); en.c.setAttribute('opacity', (1 - p).toFixed(2));
      });
      pFly.end();
      drawPills(s, sid);
      drawStrip(s);
    }

    /* ---------------------------------------------------------------- callouts: reason, error, tool in use */
    function drawPills(s, sid) {
      pPills.begin();
      var items = [], root = views[lay.root], c0 = root ? { x: root.px, y: root.py } : { x: W / 2, y: H / 2 };
      Object.keys(views).forEach(function (id) {
        var v = views[id], a = s.agents[id];
        if (id === RELEASE) { if (s.finishedInfo) items.push({ id: id, key: 'rel', v: v, kind: 'release', lines: [{ t: (s.finishedInfo.status || 'done').toUpperCase() + ' · RELEASE READY', b: 1 }], prio: 3 }); return; }
        if (a.state === 'blocked') items.push({ id: id, key: 'blk', v: v, kind: 'blocked', lines: [{ t: 'BLOCKED' + (a.needs ? ' · ' + a.needs.toUpperCase() : ''), b: 1 }].concat(wrapLines(a.blockedReason || '', 28)).map(function (l) { return typeof l === 'string' ? { t: l } : l; }), prio: 3 });
        else if (a.state === 'failed') items.push({ id: id, key: 'fail', v: v, kind: 'failed', lines: [{ t: 'FAILED · attempt ' + a.attempt, b: 1 }].concat(wrapLines(a.error || '', 28)).map(function (l) { return typeof l === 'string' ? { t: l } : l; }), prio: 3 });
        else if (a.state === 'working' && a.tool && s.t - (a.toolAt || 0) < Math.max(a.toolDuration || 0, 900) + 900 && (v.pxR >= 24 || sid === id || hoverId === id)) items.push({ id: id, key: 'tool', v: v, kind: 'tool', lines: [{ t: a.tool, b: 1 }], prio: 1 });
      });
      items.forEach(function (it) {
        var fs = 11, lh = 14, pw = 0, v = it.v;
        it.lines.forEach(function (l) { pw = Math.max(pw, l.t.length * (fs * 0.63) + 16); });
        var ph = it.lines.length * lh + 8; it.w = pw; it.h = ph;
        var dx = v.px - c0.x, dy = v.py - c0.y, dl = Math.hypot(dx, dy); if (dl < 4) { dx = 0; dy = 1; dl = 1; } dx /= dl; dy /= dl;
        var base = Math.atan2(dy, dx), best = null, bestCost = 1e12, offs = [0, 40, -40, 80, -80, 120, -120, 180];
        for (var oi = 0; oi < offs.length; oi++) {
          var ang = base + offs[oi] * Math.PI / 180, cdx = Math.cos(ang), cdy = Math.sin(ang);
          var off = v.pxR * 0.95 + (Math.abs(cdx) * pw + Math.abs(cdy) * ph) / 2 + 4, rx = v.px + cdx * off, ry = v.py + cdy * off;
          rx = clamp(rx, pw / 2 + 6, W - pw / 2 - 6); ry = clamp(ry, STRIP_H + ph / 2 + 2, H - ph / 2 - 4);
          var cost = oi * 2;
          Object.keys(views).forEach(function (k2) { var o = views[k2]; if (o === v) return; var ox2 = Math.min(rx + pw / 2, o.px + o.pxR * 0.87) - Math.max(rx - pw / 2, o.px - o.pxR * 0.87), oy2 = Math.min(ry + ph / 2, o.py + o.pxR) - Math.max(ry - ph / 2, o.py - o.pxR); if (ox2 > 0 && oy2 > 0) cost += ox2 * oy2 / 40; });
          var ox3 = Math.min(rx + pw / 2, v.px + v.pxR * 0.87) - Math.max(rx - pw / 2, v.px - v.pxR * 0.87), oy3 = Math.min(ry + ph / 2, v.py + v.pxR) - Math.max(ry - ph / 2, v.py - v.pxR); if (ox3 > 0 && oy3 > 0) cost += ox3 * oy3 / 40;
          items.forEach(function (o) { if (o.x == null) return; var ox4 = Math.min(rx + pw / 2, o.x + o.w / 2) - Math.max(rx - pw / 2, o.x - o.w / 2), oy4 = Math.min(ry + ph / 2, o.y + o.h / 2) - Math.max(ry - ph / 2, o.y - o.h / 2); if (ox4 > 0 && oy4 > 0) cost += 300 + ox4 * oy4 / 10; });
          if (cost < bestCost) { bestCost = cost; best = { x: rx, y: ry }; }
        }
        it.x = best.x; it.y = best.y;
      });
      /* clamp and push apart */
      for (var pass = 0; pass < 8; pass++) {
        items.forEach(function (it) { it.x = clamp(it.x, it.w / 2 + 6, W - it.w / 2 - 6); it.y = clamp(it.y, STRIP_H + it.h / 2 + 2, H - it.h / 2 - 4); });
        for (var i = 0; i < items.length; i++) for (var j = i + 1; j < items.length; j++) {
          var A = items[i], B = items[j], ox = (A.w + B.w) / 2 + 4 - Math.abs(A.x - B.x), oy = (A.h + B.h) / 2 + 3 - Math.abs(A.y - B.y);
          if (ox > 0 && oy > 0) { var mv = oy / 2 + 1, dir = A.y <= B.y ? 1 : -1; if (A.prio >= B.prio) B.y += dir * oy; else A.y -= dir * oy; }
        }
      }
      items.forEach(function (it) {
        var en = pPills.get(it.id + ':' + it.key, function (layer) { var gg = el('g', null, layer), r = el('rect', { rx: 8 }, gg); return { root: gg, r: r, lines: [] }; });
        var fill = it.kind === 'blocked' ? '#946106' : it.kind === 'failed' ? C.rust : it.kind === 'release' ? '#0f5d52' : '#F3F1EA', fg = it.kind === 'tool' ? '#0f5d52' : '#fff';
        en.r.setAttribute('x', it.x - it.w / 2); en.r.setAttribute('y', it.y - it.h / 2); en.r.setAttribute('width', it.w); en.r.setAttribute('height', it.h); en.r.setAttribute('fill', fill);
        en.r.setAttribute('stroke', it.kind === 'tool' ? C.acc : 'none'); en.r.setAttribute('stroke-width', 1.3); en.r.setAttribute('rx', it.lines.length === 1 ? it.h / 2 : 8);
        it.lines.forEach(function (l, li) {
          var t = en.lines[li]; if (!t) t = en.lines[li] = el('text', { 'class': 'pill-t' }, en.root);
          t.textContent = l.t; t.setAttribute('x', it.x - it.w / 2 + 8); t.setAttribute('y', it.y - it.h / 2 + 4 + 14 * li + 10); t.setAttribute('fill', fg); t.setAttribute('class', 'pill-t' + (l.b ? '' : ' dim'));
        });
        while (en.lines.length > it.lines.length) en.lines.pop().remove();
      });
      pPills.end();
    }
    function wrapLines(t, n) {
      var words = String(t).split(/\s+/), lines = [], cur = '';
      words.forEach(function (w) { if (cur && (cur + ' ' + w).length > n) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; });
      if (cur) lines.push(cur);
      if (lines.length > 2) { lines = lines.slice(0, 2); lines[1] = lines[1].slice(0, n - 1) + '…'; }
      return lines;
    }
    function clip(t, n) { t = String(t); return t.length > n ? t.slice(0, n - 1) + '…' : t; }

    /* ---------------------------------------------------------------- top strip: one mini hex per agent = task progress */
    function drawStrip(s) {
      pStrip.begin();
      var n = Math.max(s.plannedTotal || 0, s.order.length, 1), x0 = 26;
      var maxW = W - 52 - 190, rr = clamp((maxW / n) / (SQ3 * 1.16), 5, 15), step = SQ3 * rr * 1.16, cy = 29;
      for (var i = 0; i < n; i++) {
        var id = s.order[i], a = id && s.agents[id], cx = x0 + rr * 0.87 + i * step;
        var en = pStrip.get('s' + i, function (layer) {
          var gg = el('g', { 'class': 'strip-cell' }, layer), p = el('polygon', { 'stroke-linejoin': 'round' }, gg); var t = el('title', null, gg);
          return { root: gg, p: p, t: t, id: null };
        });
        en.p.setAttribute('points', hexPts(cx, cy, rr));
        var st = a ? a.state : 'unspawned';
        var fill = 'none', stroke = C.mist, dash = '3 3', sw = 1.4;
        if (st === 'working') { fill = C.acc; stroke = C.acc; dash = ''; } else if (st === 'done') { fill = C.ink; stroke = C.ink; dash = ''; } else if (st === 'blocked') { fill = C.amber; stroke = C.amber; dash = ''; } else if (st === 'failed') { fill = C.rust; stroke = C.rust; dash = ''; } else if (st === 'waiting') { stroke = C.ink; fill = 'none'; } else if (st === 'queued') { stroke = C.mist; dash = ''; }
        en.p.setAttribute('fill', fill); en.p.setAttribute('stroke', stroke); en.p.setAttribute('stroke-width', sw); if (dash) en.p.setAttribute('stroke-dasharray', dash); else en.p.removeAttribute('stroke-dasharray');
        en.p.setAttribute('opacity', sid0() && id === sid0() ? 1 : 1);
        en.t.textContent = a ? a.name + ' · ' + a.state : 'not spawned yet';
        en.id = id || null; en.root.style.cursor = id ? 'pointer' : 'default';
        en.root.onclick = id ? (function (id2) { return function () { ctx.select(id2); }; })(id) : null;
        if (id && id === ctx.selected()) { en.p.setAttribute('stroke', C.acc); en.p.setAttribute('stroke-width', 3); }
      }
      var lbl = pStrip.get('lbl', function (layer) { var t = el('text', { 'class': 'strip-lbl' }, layer); return { root: t, t: t }; });
      lbl.t.setAttribute('x', x0 + n * step + 10); lbl.t.setAttribute('y', cy + 5);
      lbl.t.textContent = s.finished ? 'TASK · COMPLETE' : 'TASK · ' + Math.round(s.progress * 100) + '%';
      pStrip.end();
    }
    function sid0() { return ctx.selected(); }

    /* ---------------------------------------------------------------- animation frame */
    function approach(cur, tgt, dt, tau) { return cur + (tgt - cur) * (1 - Math.exp(-dt / tau)); }
    function frame(dt) {
      clock += dt; var s = lastState; if (!s || !lay) return;
      var rm = ctx.reducedMotion(), busy = false;
      if (rm) {
        Object.keys(views).forEach(function (k) { var v = views[k]; v.ux = v.tx; v.uy = v.ty; v.sc = 1; v.pop = 0; if (v.st === 'failed') v.crackP = 1; });
        disp.k = targ.k; disp.ox = targ.ox; disp.oy = targ.oy; rings = [];
        Object.keys(outPop).forEach(function (k) { outPop[k] = 1; });
        flyers.forEach(function (f) { f.age += dt; }); flyers = flyers.filter(function (f) { return f.age < 1600; });
        render(); return;
      }
      disp.k = approach(disp.k, targ.k, dt, 220); disp.ox = approach(disp.ox, targ.ox, dt, 220); disp.oy = approach(disp.oy, targ.oy, dt, 220);
      Object.keys(views).forEach(function (k) {
        var v = views[k];
        v.ux = approach(v.ux, v.tx, dt, 230); v.uy = approach(v.uy, v.ty, dt, 230); v.sc = approach(v.sc, 1, dt, 230);
        if (Math.abs(v.sc - 1) < 0.004) v.sc = 1;
        if (v.pop > 0) v.pop = Math.max(0, v.pop - dt / 350);
        if (v.st === 'failed' && v.crackP < 1) v.crackP = Math.min(1, v.crackP + dt / 450);
      });
      Object.keys(outPop).forEach(function (k) { if (outPop[k] < 1) outPop[k] = Math.min(1, outPop[k] + dt / 350); });
      flyers.forEach(function (f) { f.age += dt; }); flyers = flyers.filter(function (f) { return f.age < 1000; });
      rings.forEach(function (r) { r.age += dt; }); rings = rings.filter(function (r) { return r.age < 800; });
      render();
    }

    return {
      update: function (s, events) { size(); sync(s, events || [], false); },
      frame: frame,
      onSelect: function () { render(); },
      onReset: function (s) {
        Object.keys(views).forEach(function (k) { views[k].g.remove(); }); views = {}; flyers = []; rings = []; outPop = {}; failEv = {}; hoverId = null; hideTip();
        [pLattice, pLinks, pDoors, pDeps, pThreads, pFly, pPills, pStrip].forEach(function (p) { p.begin(); p.end(); });
        lastState = s; size(); sync(s, [], true);
      },
      onMotionChange: function () { if (lastState) sync(lastState, [], true); },
      resize: function () { size(); if (lastState) { sync(lastState, [], true); } }
    };
  }
});
