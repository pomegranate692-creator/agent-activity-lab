/* 08 Territories: a live Voronoi map.
 *
 * Every main agent owns a region (the Voronoi cell of its seed). Subagents are dots inside their
 * owner's region. The orchestrator holds the middle; main agents sit on rings around it in creation order.
 * Cells are recomputed every frame from the CURRENT seed positions, and seeds glide to the position the
 * state asks for (instant under reduced motion). Nothing here reads the scenario: it only uses the state
 * object handed in by the shared chrome, so it works unchanged with live events.
 */
AgentChrome.mount({
  id: '08', name: 'Territories', tagline: 'A live map: each main agent owns a region, subagents are dots inside it.',
  create: function (stage, ctx) {
    var core = ctx.core, U = core.util;
    var NS = 'http://www.w3.org/2000/svg';
    var BG = '#F7F5EF', MARGIN = 2;
    var W = 960, H = 640;

    /* ------------------------------------------------------------------ tiny helpers */
    function sv(tag, attrs, parent) { var e = document.createElementNS(NS, tag); if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
    function setA(e, k, v) { if (e.__a === undefined) e.__a = {}; if (e.__a[k] !== v) { e.__a[k] = v; e.setAttribute(k, v); } }
    function setT(e, v) { if (e.__t !== v) { e.__t = v; e.textContent = v; } }
    function show(e, on) { setA(e, 'display', on ? 'inline' : 'none'); }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function trunc(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
    function wrap(text, n, maxLines) {
      var words = String(text || '').split(/\s+/), lines = [], cur = '';
      words.forEach(function (w) { if ((cur + ' ' + w).trim().length > n && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); });
      if (cur) lines.push(cur);
      if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = trunc(lines[maxLines - 1] + '…', n); }
      return lines;
    }

    /* ------------------------------------------------------------------ geometry */
    function clipPoly(poly, a, b, c) { // keep the half-plane a*x + b*y <= c
      var out = [];
      for (var i = 0; i < poly.length; i++) {
        var p = poly[i], q = poly[(i + 1) % poly.length];
        var dp = a * p[0] + b * p[1] - c, dq = a * q[0] + b * q[1] - c;
        if (dp <= 0) out.push(p);
        if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) { var t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
      }
      return out;
    }
    /** Voronoi cells of pts ([x,y]) inside rect [x0,y0,x1,y1] by half-plane clipping. O(n^2), fine for <= ~60 seeds. */
    function voronoi(pts, r) {
      return pts.map(function (pi, i) {
        var poly = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
        for (var j = 0; j < pts.length && poly.length > 2; j++) {
          if (j === i) continue;
          var nx = pts[j][0] - pi[0], ny = pts[j][1] - pi[1];
          if (nx * nx + ny * ny < 1e-6) continue;
          poly = clipPoly(poly, nx, ny, nx * (pi[0] + pts[j][0]) / 2 + ny * (pi[1] + pts[j][1]) / 2);
        }
        return poly;
      });
    }
    function area(poly) { var s = 0; for (var i = 0; i < poly.length; i++) { var p = poly[i], q = poly[(i + 1) % poly.length]; s += p[0] * q[1] - q[0] * p[1]; } return Math.abs(s) / 2; }
    function centroid(poly) {
      var a = 0, cx = 0, cy = 0;
      for (var i = 0; i < poly.length; i++) { var p = poly[i], q = poly[(i + 1) % poly.length], cr = p[0] * q[1] - q[0] * p[1]; a += cr; cx += (p[0] + q[0]) * cr; cy += (p[1] + q[1]) * cr; }
      if (Math.abs(a) < 1e-6) return poly.length ? poly[0] : [0, 0];
      return [cx / (3 * a), cy / (3 * a)];
    }
    function inside(poly, x, y) {
      var c = false;
      for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        var a = poly[i], b = poly[j];
        if (((a[1] > y) !== (b[1] > y)) && (x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0])) c = !c;
      }
      return c;
    }
    function distSeg(px, py, a, b) {
      var dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? clamp(((px - a[0]) * dx + (py - a[1]) * dy) / l2, 0, 1) : 0;
      return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
    }
    /** Radius of the largest circle around (x,y) that stays inside the cell. */
    function inradius(poly, x, y) { var m = 1e9; for (var i = 0; i < poly.length; i++) m = Math.min(m, distSeg(x, y, poly[i], poly[(i + 1) % poly.length])); return m === 1e9 ? 0 : m; }
    function pathOf(poly) { return poly.length < 3 ? '' : 'M' + poly.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('L') + 'Z'; }

    /* ------------------------------------------------------------------ hierarchy and seed layout (derived from state only) */
    /** hub = first root (the orchestrator), mains = its children (and any other roots), everything else is a dot in its owner's region. */
    function hierarchy(s) {
      var ag = s.agents, roots = [], mains = [], isMain = {}, owner = {}, desc = {}, depth = {};
      s.order.forEach(function (id) { var a = ag[id]; if (!a.parentId || !ag[a.parentId]) roots.push(id); });
      var hub = roots[0] || null;
      s.order.forEach(function (id) { if (id !== hub && (ag[id].parentId === hub || roots.indexOf(id) > 0)) { mains.push(id); isMain[id] = true; } });
      s.order.forEach(function (id) {
        var cur = id, d = 0, g = 0;
        while (cur !== hub && !isMain[cur] && ag[cur].parentId && ag[ag[cur].parentId] && g++ < 60) { cur = ag[cur].parentId; d++; }
        owner[id] = (cur === hub || isMain[cur]) ? cur : (hub || id); depth[id] = d;
      });
      var owners = hub ? [hub].concat(mains) : mains;
      owners.forEach(function (o) { desc[o] = []; });
      s.order.forEach(function (id) { if (id !== owner[id] && desc[owner[id]]) desc[owner[id]].push(id); });
      return { hub: hub, mains: mains, owners: owners, owner: owner, desc: desc, depth: depth, isOwner: function (id) { return id === hub || !!isMain[id]; } };
    }

    var RING_CAP = [8, 12, 16, 20, 24, 28, 32], RING_F = [0.30, 0.40, 0.46, 0.48, 0.49, 0.49, 0.49];
    /** Ring layout around the hub by creation order. Ring r holds RING_CAP[r] seeds; alternate rings are offset by half a step. */
    function ringTargets(hier) {
      var out = {}, cx = W / 2, cy = H / 2, left = hier.mains.slice(), r = 0, idx = 0;
      if (hier.hub) out[hier.hub] = [cx, cy];
      while (idx < hier.mains.length) {
        var n = Math.min(RING_CAP[Math.min(r, RING_CAP.length - 1)], hier.mains.length - idx), f = RING_F[Math.min(r, RING_F.length - 1)];
        var step = 2 * Math.PI / n, start = -Math.PI / 2 + (r % 2) * step / 2;
        for (var k = 0; k < n; k++) { var an = start + k * step; out[hier.mains[idx + k]] = [cx + Math.cos(an) * f * W, cy + Math.sin(an) * f * H]; }
        idx += n; r++;
      }
      return out;
    }
    /** When the task is finished the map "settles": Lloyd relaxation moves every seed to the centre of its own region. */
    function settle(targets, ids) {
      var rect = [MARGIN, MARGIN, W - MARGIN, H - MARGIN], p = ids.map(function (id) { return targets[id].slice(); });
      for (var it = 0; it < 6; it++) { var cells = voronoi(p, rect); p = p.map(function (q, i) { return cells[i].length > 2 ? centroid(cells[i]) : q; }); }
      var out = {}; ids.forEach(function (id, i) { out[id] = p[i]; }); return out;
    }

    /* ------------------------------------------------------------------ view state */
    var pos = {};            // id -> {x,y,tx,ty} current (animated) and target positions for every agent
    var tint = {};           // owner id -> {r,g,b,a} current tint (tweened)
    var layoutKey = '', layoutT = {};
    var snap = true, hoverId = null, lastHier = null, cellOrder = '', lastS = null;
    var svg, gCells, gDeps, gDeleg, gMsg, gAgents, gCallouts, gHud, gTip, gMsgT, bgRect, emptyT;
    var cellNodes = {}, agentNodes = {}, calloutNodes = {}, hudNodes = null, sumNodes = null, tipNodes = null;
    var pools = {};

    var TINT = {
      working: { c: [31, 138, 122], a: 0.15, stroke: '#1F8A7A', sw: 2, dash: '' },
      done: { c: [31, 37, 40], a: 0.18, stroke: '#1F2528', sw: 1.5, dash: '' },
      blocked: { c: [183, 121, 10], a: 0.22, stroke: '#B7790A', sw: 2, dash: '' },
      failed: { c: [181, 71, 47], a: 0.2, stroke: '#B5472F', sw: 2, dash: '' },
      waiting: { c: [247, 245, 239], a: 0, stroke: '#1F2528', sw: 1.5, dash: '5 4' },
      queued: { c: [247, 245, 239], a: 0, stroke: '#B7BCB8', sw: 1.5, dash: '5 4' }
    };
    var PRIO = { waiting: 0, queued: 0, done: 1, working: 2, blocked: 3, failed: 4 };

    /* ------------------------------------------------------------------ build the SVG skeleton */
    svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet', focusable: 'false' });
    var root = document.createElement('div'); root.className = 't8'; root.appendChild(svg); stage.appendChild(root);
    var defs = sv('defs', null, svg);
    var mk = sv('marker', { id: 't8-arr', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto', markerUnits: 'userSpaceOnUse' }, defs);
    sv('path', { d: 'M1 1.5L9 5L1 8.5', fill: 'none', stroke: '#56636A', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, mk);
    bgRect = sv('rect', { x: 0, y: 0, width: W, height: H, fill: BG }, svg);
    gCells = sv('g', { 'aria-hidden': 'true' }, svg);
    gDeps = sv('g', { fill: 'none', 'aria-hidden': 'true' }, svg);
    gDeleg = sv('g', { fill: 'none', 'aria-hidden': 'true' }, svg);
    gMsg = sv('g', { fill: 'none', 'aria-hidden': 'true' }, svg);
    gAgents = sv('g', null, svg);
    gCallouts = sv('g', { 'aria-hidden': 'true' }, svg);
    gMsgT = sv('g', { 'aria-hidden': 'true' }, svg);
    gHud = sv('g', null, svg);
    gTip = sv('g', { 'pointer-events': 'none', 'aria-hidden': 'true' }, svg);
    emptyT = sv('text', { class: 't8-empty', 'text-anchor': 'middle' }, svg); emptyT.textContent = 'No territory claimed yet. The map divides as agents spawn.';

    // reusable element pools, keyed by edge id
    function pool(layer, tag) {
      var items = {}, used = {};
      return {
        begin: function () { used = {}; },
        get: function (key, attrs) { var e = items[key]; if (!e) { e = sv(tag, attrs, layer); items[key] = e; } used[key] = true; return e; },
        end: function () { for (var k in items) if (!used[k]) { items[k].remove(); delete items[k]; } },
        clear: function () { for (var k in items) { items[k].remove(); delete items[k]; } }
      };
    }
    pools.dep = pool(gDeps, 'path'); pools.del = pool(gDeleg, 'path'); pools.msg = pool(gMsg, 'path');
    pools.msgDot = pool(gMsg, 'circle'); pools.msgBg = pool(gMsgT, 'rect'); pools.msgTxt = pool(gMsgT, 'text');

    /* ------------------------------------------------------------------ nodes */
    function cellNode(id) {
      var n = cellNodes[id];
      if (!n) { n = sv('path', { class: 't8-cell', 'stroke-linejoin': 'round' }, gCells); n.addEventListener('click', function () { ctx.select(id); }); cellNodes[id] = n; }
      return n;
    }
    var GLYPH = { done: 'M-4.3 .6l3.1 3.4l5.7 -7.1', blocked: 'M-2.7 -4.2v8.4M2.7 -4.2v8.4', failed: 'M-3.6 -3.6l7.2 7.2M3.6 -3.6l-7.2 7.2' };
    function agentNode(id) {
      var n = agentNodes[id];
      if (n) return n;
      var g = sv('g', { class: 'agent', tabindex: 0, role: 'button' }, gAgents);
      n = { g: g };
      n.hit = sv('circle', { class: 'hit', r: 14, fill: 'transparent' }, g);
      n.sel = sv('circle', { class: 't8-sel' }, g); n.focus = sv('circle', { class: 't8-focus' }, g);
      n.halo = sv('circle', { class: 't8-halo' }, g); n.body = sv('circle', { class: 't8-body' }, g);
      n.glyph = sv('path', { class: 't8-glyph' }, g);
      n.outs = sv('g', null, g);
      n.label = sv('text', { class: 't8-lbl', 'text-anchor': 'middle' }, g);
      n.chip = sv('g', null, g); n.chipR = sv('rect', { height: 17, rx: 4, fill: BG, 'stroke-width': 1 }, n.chip); n.chipT = sv('text', { class: 't8-chip-t', 'text-anchor': 'middle', y: 12.5 }, n.chip);
      g.addEventListener('click', function (e) { e.stopPropagation(); ctx.select(id); });
      g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); ctx.select(id); } });
      g.addEventListener('mouseenter', function () { hoverId = id; });
      g.addEventListener('mouseleave', function () { if (hoverId === id) hoverId = null; });
      g.addEventListener('focus', function () { hoverId = id; });
      g.addEventListener('blur', function () { if (hoverId === id) hoverId = null; });
      agentNodes[id] = n; return n;
    }
    function calloutNode(id) {
      var n = calloutNodes[id];
      if (!n) { n = { g: sv('g', null, gCallouts) }; n.pill = sv('rect', { height: 20, rx: 10 }, n.g); n.pt = sv('text', { class: 't8-pill-t', 'text-anchor': 'middle', y: 14 }, n.g); n.r1 = sv('text', { class: 't8-reason', 'text-anchor': 'middle' }, n.g); n.r2 = sv('text', { class: 't8-reason', 'text-anchor': 'middle' }, n.g); calloutNodes[id] = n; }
      return n;
    }
    function dropMissing(s) {
      [agentNodes, calloutNodes, cellNodes].forEach(function (m) { Object.keys(m).forEach(function (id) { if (!s.agents[id]) { var n = m[id]; (n.g || n).remove(); delete m[id]; } }); });
      Object.keys(pos).forEach(function (id) { if (!s.agents[id]) delete pos[id]; });
      Object.keys(tint).forEach(function (id) { if (!s.agents[id]) delete tint[id]; });
    }

    /* ------------------------------------------------------------------ per-frame render */
    function seedRadius(id, compact, ir, isOwner, isHub) {
      if (isOwner) { var r = isHub ? 11 : 10; if (compact) r = 9; return clamp(Math.min(r, ir * 0.38), 5, r); }
      return compact ? 5 : 6;
    }

    function render(s, dt) {
      lastS = s;
      var reduced = ctx.reducedMotion(), instant = reduced || snap;
      var hier = hierarchy(s); lastHier = hier;
      var ids = s.order, total = ids.length, compact = total > 14, crowd = total > 24;
      show(emptyT, total === 0); setA(emptyT, 'x', W / 2); setA(emptyT, 'y', H / 2);
      var rect = [MARGIN, MARGIN, W - MARGIN, H - MARGIN];
      dropMissing(s);

      /* 1. seed targets from state (cached) */
      var key = hier.owners.join(',') + '|' + W + 'x' + H + '|' + (s.finished ? 1 : 0);
      if (key !== layoutKey) {
        layoutKey = key; layoutT = ringTargets(hier);
        if (s.finished && hier.owners.length > 1) layoutT = settle(layoutT, hier.owners);
      }
      var k = instant ? 1 : 1 - Math.exp(-dt / 150);
      hier.owners.forEach(function (id) {
        var t = layoutT[id], p = pos[id];
        if (!p) {
          var hp = hier.hub && id !== hier.hub ? pos[hier.hub] : null;
          // a new seed is born at the orchestrator and glides out; a 4px nudge keeps the two cells distinct
          var sx = hp && !snap ? hp.x + Math.sign(t[0] - hp.x || 1) * 4 : t[0], sy = hp && !snap ? hp.y + Math.sign(t[1] - hp.y || 1) * 4 : t[1];
          p = pos[id] = { x: sx, y: sy, tx: t[0], ty: t[1] };
        }
        p.tx = t[0]; p.ty = t[1]; p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k;
        if (Math.abs(p.tx - p.x) < 0.05) p.x = p.tx; if (Math.abs(p.ty - p.y) < 0.05) p.y = p.ty;
      });

      /* 2. Voronoi cells from the current seed positions */
      var pts = hier.owners.map(function (id) { return [pos[id].x, pos[id].y]; });
      var polys = voronoi(pts, rect), cellOf = {}, ir = {}, totalArea = (rect[2] - rect[0]) * (rect[3] - rect[1]), doneArea = 0;
      hier.owners.forEach(function (id, i) {
        cellOf[id] = polys[i]; ir[id] = inradius(polys[i], pos[id].x, pos[id].y);
        if (s.agents[id].state === 'done') doneArea += area(polys[i]);
      });

      /* 3. dots (subagents) inside their owner's cell */
      hier.owners.forEach(function (o) {
        var list = hier.desc[o]; if (!list || !list.length) return;
        var cell = cellOf[o], p0 = pos[o], R = clamp(ir[o] * 0.62, 14, 78), byParent = {};
        list.forEach(function (id) { var par = s.agents[id].parentId; (byParent[par] = byParent[par] || []).push(id); });
        function place(parent, level) {
          var kids = byParent[parent]; if (!kids) return;
          var pp = parent === o ? [p0.x, p0.y] : [pos[parent].tx !== undefined ? pos[parent].tx : pos[parent].x, pos[parent].ty !== undefined ? pos[parent].ty : pos[parent].y];
          var baseAng = parent === o ? -Math.PI / 2 : Math.atan2(pp[1] - p0.y, pp[0] - p0.x);
          var spread = parent === o ? 220 : 130, per = parent === o ? 6 : 4;
          kids.forEach(function (id, idx) {
            var row = Math.floor(idx / per), inRow = Math.min(per, kids.length - row * per), kk = idx - row * per;
            var an = baseAng + ((-spread / 2 + spread * (kk + 0.5) / inRow) * Math.PI / 180);
            var rr = (parent === o ? R : R * 0.55) * (1 + 0.5 * row), tx, ty, tries = 0, f = 1;
            do { tx = pp[0] + Math.cos(an) * rr * f; ty = pp[1] + Math.sin(an) * rr * f; f *= 0.84; tries++; } while (tries < 9 && !inside(cell, tx, ty));
            var d = pos[id];
            if (!d) { d = pos[id] = { x: pp[0], y: pp[1], tx: tx, ty: ty }; if (snap) { d.x = tx; d.y = ty; } }
            d.tx = tx; d.ty = ty; d.x += (tx - d.x) * k; d.y += (ty - d.y) * k;
            place(id, level + 1);
          });
        }
        place(o, 0);
      });
      ids.forEach(function (id) { if (!pos[id]) pos[id] = { x: W / 2, y: H / 2, tx: W / 2, ty: H / 2 }; });
      function P(id) { return pos[id]; }
      function R_(id) { var a = hier.isOwner(id); return seedRadius(id, compact, ir[id] || 40, a, id === hier.hub); }

      /* 4. region tints, borders, order */
      var sel = ctx.selected();
      var order = hier.owners.slice().sort(function (a, b) { return PRIO[s.agents[a].state] - PRIO[s.agents[b].state]; });
      var sig = order.join(',');
      hier.owners.forEach(function (id) {
        var a = s.agents[id], T = TINT[a.state] || TINT.queued, n = cellNode(id), tn = tint[id];
        var ta = T.a + (id === sel ? 0.07 : 0);
        if (!tn) tn = tint[id] = { r: T.c[0], g: T.c[1], b: T.c[2], a: 0 };
        var kk = instant ? 1 : 1 - Math.exp(-dt / 220);
        tn.r += (T.c[0] - tn.r) * kk; tn.g += (T.c[1] - tn.g) * kk; tn.b += (T.c[2] - tn.b) * kk; tn.a += (ta - tn.a) * kk;
        setA(n, 'd', pathOf(cellOf[id]));
        setA(n, 'fill', 'rgba(' + Math.round(tn.r) + ',' + Math.round(tn.g) + ',' + Math.round(tn.b) + ',' + tn.a.toFixed(3) + ')');
        setA(n, 'stroke', T.stroke); setA(n, 'stroke-width', T.sw + (id === sel ? 1.5 : 0)); setA(n, 'stroke-dasharray', T.dash);
        setA(n, 'aria-label', a.name + ' region');
      });
      if (sig !== cellOrder) { cellOrder = sig; order.forEach(function (id) { gCells.appendChild(cellNodes[id]); }); }

      /* 5. selection-aware thread emphasis */
      var rel = {};
      if (sel && s.agents[sel]) {
        rel[sel] = true;
        s.delegations.forEach(function (d) { if (d.from === sel) rel[d.to] = true; if (d.to === sel) rel[d.from] = true; });
        s.dependencies.forEach(function (d) { if (d.from === sel) rel[d.to] = true; if (d.to === sel) rel[d.from] = true; });
        s.messages.forEach(function (m) { if (m.from === sel) rel[m.to] = true; if (m.to === sel) rel[m.from] = true; });
      }
      function dimFor(a, b) { return sel && s.agents[sel] ? ((a === sel || b === sel) ? 1 : 0.2) : 1; }
      function trimmed(a, b, pad) {
        var pa = P(a), pb = P(b), dx = pb.x - pa.x, dy = pb.y - pa.y, L = Math.hypot(dx, dy) || 1;
        var ra = R_(a) + pad, rb = R_(b) + pad; if (L < ra + rb + 4) { ra = rb = Math.max(0, (L - 4) / 2); }
        return [pa.x + dx / L * ra, pa.y + dy / L * ra, pb.x - dx / L * rb, pb.y - dy / L * rb];
      }
      function line(c) { return 'M' + c[0].toFixed(1) + ' ' + c[1].toFixed(1) + 'L' + c[2].toFixed(1) + ' ' + c[3].toFixed(1); }

      /* 6. dependencies: dashed, arrow points at the agent that waits */
      pools.dep.begin();
      s.dependencies.forEach(function (d) {
        if (!s.agents[d.from] || !s.agents[d.to]) return;
        var to = s.agents[d.to], waiting = to.state === 'waiting' || to.state === 'queued';
        var e = pools.dep.get(d.from + '>' + d.to, { stroke: '#56636A', 'stroke-dasharray': '5 4', 'stroke-width': 1.6, 'marker-end': 'url(#t8-arr)' });
        setA(e, 'd', line(trimmed(d.from, d.to, 4)));
        setA(e, 'opacity', ((waiting ? 1 : 0.4) * dimFor(d.from, d.to)).toFixed(2));
      });
      pools.dep.end();

      /* 7. delegation: solid lines. Dots hang from their parent; orchestrator-to-main lines stay faint until work is handed over. */
      pools.del.begin();
      var seen = {};
      s.delegations.forEach(function (d) {
        if (!s.agents[d.from] || !s.agents[d.to]) return;
        var kk2 = d.from + '>' + d.to, main = d.from === hier.hub && hier.isOwner(d.to);
        if (main && !d.work && !seen[kk2]) { return; }
        if (!main && !d.spawn && !d.work) return;
        seen[kk2] = Math.max(seen[kk2] || 0, d.t);
      });
      Object.keys(seen).forEach(function (kk2) {
        var pr = kk2.split('>'), main = pr[0] === hier.hub && hier.isOwner(pr[1]);
        var age = s.t - seen[kk2], pulse = main ? Math.max(0, 1 - age / 2500) : 0;
        var e = pools.del.get(kk2, { stroke: '#1F2528', 'stroke-linecap': 'round' });
        setA(e, 'd', line(trimmed(pr[0], pr[1], 3)));
        setA(e, 'stroke-width', main ? (crowd ? 0.8 : 1 + pulse * 1.2).toFixed(2) : 1.25);
        setA(e, 'opacity', ((main ? (crowd ? 0.12 + 0.2 * pulse : 0.22 + 0.78 * pulse) : 0.9) * dimFor(pr[0], pr[1])).toFixed(2));
      });
      pools.del.end();

      /* 8. messages: dotted green line, a dot travels from sender to receiver (positions come from message age in state time) */
      pools.msg.begin(); pools.msgDot.begin(); pools.msgBg.begin(); pools.msgTxt.begin();
      var tick = [];
      var latest = {};
      for (var mi = s.messages.length - 1; mi >= 0; mi--) {
        var m = s.messages[mi], age2 = s.t - m.t; if (age2 > 5200) break; if (age2 < 0) continue;
        if (!s.agents[m.from] || !s.agents[m.to]) continue;
        var mk2 = m.from + '>' + m.to; if (!latest[mk2]) latest[mk2] = { m: m, age: age2 };
        if (tick.length < 3 && age2 < 4200) tick.push({ m: m, age: age2, i: mi });
      }
      Object.keys(latest).forEach(function (mk2) {
        var L = latest[mk2], m = L.m, age = L.age, c = trimmed(m.from, m.to, 4), fade = age < 3500 ? 1 : 1 - (age - 3500) / 1700;
        var dm = dimFor(m.from, m.to);
        var e = pools.msg.get(mk2, { stroke: '#1F8A7A', 'stroke-width': 2.4, 'stroke-dasharray': '0.1 5', 'stroke-linecap': 'round' });
        setA(e, 'd', line(c)); setA(e, 'opacity', (fade * dm).toFixed(2));
        var pr = clamp(age / 1000, 0, 1), eased = reduced ? 1 : U.ease(pr);
        if (pr < 1 || reduced && age < 1500) {
          var dEl = pools.msgDot.get(mk2, { r: 4, fill: '#1F8A7A', stroke: BG, 'stroke-width': 1.6 });
          setA(dEl, 'cx', (c[0] + (c[2] - c[0]) * eased).toFixed(1)); setA(dEl, 'cy', (c[1] + (c[3] - c[1]) * eased).toFixed(1));
        }
      });
      // message ticker: the words of the latest messages, in a fixed corner so they never cover the map
      var ty = 12;
      tick.forEach(function (tk) {
        var f = s.agents[tk.m.from], t = s.agents[tk.m.to], fade = tk.age < 2800 ? 1 : 1 - (tk.age - 2800) / 1400;
        var txt = f.label + ' → ' + t.label + '  ' + trunc(tk.m.text, 40), w = txt.length * 6.7 + 16;
        var bg = pools.msgBg.get('t' + tk.i, { height: 20, rx: 5, fill: BG, stroke: '#1F8A7A', 'stroke-width': 1 }), tt = pools.msgTxt.get('t' + tk.i, { class: 't8-msg-t' });
        setA(bg, 'x', 10); setA(bg, 'y', ty); setA(bg, 'width', w.toFixed(1)); setA(bg, 'opacity', fade.toFixed(2));
        setA(tt, 'x', 18); setA(tt, 'y', ty + 14); setT(tt, txt); setA(tt, 'opacity', fade.toFixed(2)); ty += 25;
      });
      pools.msg.end(); pools.msgDot.end(); pools.msgBg.end(); pools.msgTxt.end();

      /* 9. agents: seed bodies, labels, tool chips, output pages, callouts */
      var wanted = {};
      ids.forEach(function (id) {
        var a = s.agents[id], p = P(id), n = agentNode(id), isOwn = hier.isOwner(id), r = R_(id);
        wanted[id] = true;
        setA(n.g, 'transform', 'translate(' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ')');
        var isSel = sel === id, hov = hoverId === id, relNode = !sel || rel[id];
        setA(n.g, 'class', 'agent' + (isSel ? ' is-sel' : ''));
        setA(n.g, 'aria-label', a.name + ', ' + U.stateWord(a) + (a.parentId && s.agents[a.parentId] ? ', subagent of ' + s.agents[a.parentId].name : ''));
        setA(n.g, 'opacity', relNode ? 1 : 0.6);
        setA(n.body, 'r', r); setA(n.body, 'class', 't8-body ' + a.state);
        setA(n.hit, 'r', Math.max(14, r + 6)); setA(n.sel, 'r', r + 6); setA(n.focus, 'r', r + 9);
        var haloOn = a.state === 'working' || a.state === 'blocked';
        show(n.halo, haloOn); setA(n.halo, 'r', r + (isOwn ? 7 : 5)); setA(n.halo, 'stroke', a.state === 'blocked' ? '#B7790A' : '#1F8A7A');
        var gl = GLYPH[a.state]; show(n.glyph, !!gl); if (gl) { setA(n.glyph, 'd', gl); setA(n.glyph, 'transform', 'scale(' + (r / 10).toFixed(2) + ')'); }
        // label (a short name under the seed; in a crowded map only for big regions, hover or selection)
        var showLbl = isOwn ? (!compact || ir[id] >= 34 || isSel || hov) : (!compact || isSel || hov || sel === a.parentId);
        show(n.label, showLbl); if (showLbl) { setA(n.label, 'y', r + 15); setA(n.label, 'class', 't8-lbl' + (isOwn ? '' : ' sub')); setT(n.label, a.label); }
        // tool chip (only while the agent is working)
        var chipOn = a.state === 'working' && a.tool && (!compact ? true : (isOwn && ir[id] >= 40) || isSel || hov);
        var chipTxt = (a.attempt > 1 ? 'retry ' + a.attempt + ' · ' : '') + (a.tool || '');
        if (!chipOn && a.state === 'working' && a.attempt > 1 && (isOwn || !compact)) { chipOn = true; chipTxt = 'retry ' + a.attempt; }
        show(n.chip, chipOn);
        if (chipOn) {
          var cw = chipTxt.length * 6.9 + 14; setT(n.chipT, chipTxt); setA(n.chipT, 'x', (cw / 2).toFixed(1)); setA(n.chipR, 'width', cw.toFixed(1));
          setA(n.chipR, 'stroke', a.attempt > 1 ? '#B5472F' : '#1F8A7A'); setA(n.chipT, 'class', 't8-chip-t' + (a.attempt > 1 ? ' retry' : ''));
          if (isOwn) setA(n.chip, 'transform', 'translate(' + (-cw / 2).toFixed(1) + ' ' + (r + (showLbl ? 22 : 6)) + ')');
          else { // a subagent's chip sits beside its dot, on the side away from the owner, so it never covers the owner's label
            var op = pos[hier.owner[id]] || p, dir = p.x >= op.x ? 1 : -1;
            setA(n.chip, 'transform', 'translate(' + (dir > 0 ? r + 7 : -(r + 7 + cw)).toFixed(1) + ' -9)');
          }
        }
        // outputs: page glyphs sit on the seed that produced them
        var no = a.outputs.length, oKey = no + (compact ? 'c' : '');
        if (n.outs.__k !== oKey) {
          n.outs.__k = oKey; n.outs.innerHTML = '';
          var shown = Math.min(no, compact ? 1 : 3);
          for (var oi = 0; oi < shown; oi++) { var ox = oi * 13; sv('path', { class: 't8-page', d: 'M' + ox + ' 0h8l4 4v11h-12z' }, n.outs); sv('path', { class: 't8-page-fold', d: 'M' + (ox + 8) + ' 0v4h4' }, n.outs); }
          if (no > shown) { var tx = sv('text', { class: 't8-chip-t', x: shown * 13 + 1, y: 13 }, n.outs); tx.textContent = '+' + (no - shown); }
        }
        setA(n.outs, 'transform', 'translate(' + (r + 5) + ' ' + (-r - 15) + ')');
        // callouts for blocked / failed: say why
        var co = calloutNodes[id], needCo = (a.state === 'blocked' || a.state === 'failed') && (!crowd || isSel || hov);
        if (needCo) {
          co = calloutNode(id);
          var blocked = a.state === 'blocked';
          var head = blocked ? 'NEEDS ' + String(a.needs || 'HELP').toUpperCase() : trunc(String(a.error || 'FAILED').toUpperCase(), 30) + ' · RETRY';
          if (compact && !isSel && !hov) head = blocked ? 'BLOCKED' : 'FAILED';
          var pw = head.length * 7.6 + 18, reason = (!compact || isSel || hov) && blocked ? wrap(a.blockedReason, 34, 2) : [];
          var cx = clamp(p.x, pw / 2 + 4, W - pw / 2 - 4), cy = p.y + r + (showLbl ? 24 : 8);
          if (cy + 20 + reason.length * 13 > H - 4) cy = p.y - r - 46 - reason.length * 13;
          setA(co.g, 'transform', 'translate(' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ')');
          setA(co.pill, 'x', (-pw / 2).toFixed(1)); setA(co.pill, 'width', pw.toFixed(1)); setA(co.pill, 'fill', blocked ? '#B7790A' : '#B5472F');
          setT(co.pt, head);
          [co.r1, co.r2].forEach(function (rt, ri) { var on = reason[ri] != null; show(rt, on); if (on) { setT(rt, reason[ri]); setA(rt, 'y', 33 + ri * 13); } });
          show(co.g, true); setA(co.g, 'opacity', relNode ? 1 : 0.5);
        } else if (co) { show(co.g, false); }
      });

      /* 10. HUD: MAP CLAIMED + done area, summary badge on finish, hover tip */
      renderHud(s, doneArea / totalArea, total);
      renderTip(s, hier, P, R_);
      snap = false;
    }

    function renderHud(s, doneShare, total) {
      if (!hudNodes) {
        hudNodes = { g: sv('g', null, gHud) };
        hudNodes.bg = sv('rect', { rx: 8, fill: BG, stroke: '#1F8A7A', 'stroke-width': 1.2, opacity: 0.94 }, hudNodes.g);
        hudNodes.t1 = sv('text', { class: 't8-hud-t', 'text-anchor': 'end' }, hudNodes.g);
        hudNodes.t2 = sv('text', { class: 't8-hud-sub', 'text-anchor': 'end' }, hudNodes.g);
        hudNodes.barBg = sv('rect', { height: 4, rx: 2, fill: '#D3D2CA' }, hudNodes.g);
        hudNodes.bar = sv('rect', { height: 4, rx: 2, fill: '#1F2528' }, hudNodes.g);
      }
      var pct = Math.round(s.progress * 100), dpct = Math.round(doneShare * 100);
      var w = 226, h = 54, x = W - 10 - w, y = H - 10 - h;
      setA(hudNodes.bg, 'x', x); setA(hudNodes.bg, 'y', y); setA(hudNodes.bg, 'width', w); setA(hudNodes.bg, 'height', h);
      setA(hudNodes.t1, 'x', x + w - 12); setA(hudNodes.t1, 'y', y + 19); setT(hudNodes.t1, 'MAP CLAIMED · ' + pct + '%');
      setA(hudNodes.t2, 'x', x + w - 12); setA(hudNodes.t2, 'y', y + 47); setT(hudNodes.t2, 'DONE AREA ' + dpct + '%');
      setA(hudNodes.barBg, 'x', x + 12); setA(hudNodes.barBg, 'y', y + 29); setA(hudNodes.barBg, 'width', w - 24);
      setA(hudNodes.bar, 'x', x + 12); setA(hudNodes.bar, 'y', y + 29); setA(hudNodes.bar, 'width', ((w - 24) * clamp(doneShare, 0, 1)).toFixed(1));
      show(hudNodes.g, total > 0);

      if (!sumNodes) {
        sumNodes = { g: sv('g', null, gHud) };
        sumNodes.bg = sv('rect', { rx: 10, fill: BG, 'stroke-width': 1.6 }, sumNodes.g);
        sumNodes.k = sv('text', { class: 't8-sum-k', x: 16, y: 24 }, sumNodes.g);
        sumNodes.lines = [0, 1, 2].map(function (i) { return sv('text', { class: 't8-sum-t', x: 16, y: 46 + i * 19 }, sumNodes.g); });
        sumNodes.m = sv('text', { class: 't8-sum-m', x: 16 }, sumNodes.g);
      }
      var fin = s.finished && s.finishedInfo;
      show(sumNodes.g, !!fin);
      if (fin) {
        var ok = fin.status === 'succeeded', lines = wrap(fin.summary || '', 48, 3), bw = 420, bh = 62 + lines.length * 19 + 8;
        // park the badge where it covers the fewest agents
        var cands = [], best = null, bestN = 1e9;
        for (var gy = H - 12 - bh; gy >= 44; gy -= 20) [W / 2 - bw / 2, 8, W - bw - 8, W * 0.25 - bw / 2, W * 0.75 - bw / 2].forEach(function (x) { cands.push([clamp(x, 8, W - bw - 8), gy]); });
        cands.forEach(function (c) {
          var n = 0;
          Object.keys(pos).forEach(function (id) { var q = pos[id]; if (q.x + 38 > c[0] && q.x - 38 < c[0] + bw && q.y + 44 > c[1] && q.y - 26 < c[1] + bh) n++; });
          if (c[0] + bw > W - 240 && c[1] + bh > H - 80) n += 50;
          if (n < bestN) { bestN = n; best = c; }
        });
        var bx = best[0], by = best[1];
        setA(sumNodes.g, 'transform', 'translate(' + bx.toFixed(0) + ' ' + by.toFixed(0) + ')');
        setA(sumNodes.bg, 'width', bw); setA(sumNodes.bg, 'height', bh); setA(sumNodes.bg, 'stroke', ok ? '#1F8A7A' : '#B5472F');
        setT(sumNodes.k, 'TASK FINISHED · ' + String(fin.status || '').toUpperCase()); setA(sumNodes.k, 'class', 't8-sum-k' + (ok ? '' : ' rust'));
        sumNodes.lines.forEach(function (ln, i) { setT(ln, lines[i] || ''); });
        setA(sumNodes.m, 'y', 46 + lines.length * 19 + 8);
        setT(sumNodes.m, fin.outputIds.length + ' outputs · ' + s.counts.done + ' of ' + s.order.length + ' agents done · map settled');
      }
    }

    function renderTip(s, hier, P, R_) {
      if (!tipNodes) {
        tipNodes = { g: sv('g', null, gTip) };
        tipNodes.bg = sv('rect', { rx: 6, fill: '#1F2528', opacity: 0.0 }, tipNodes.g);
        tipNodes.bg2 = sv('rect', { rx: 6, fill: BG, stroke: '#1F2528', 'stroke-width': 1.2 }, tipNodes.g);
        tipNodes.n = sv('text', { class: 't8-tip-n', x: 10, y: 17 }, tipNodes.g);
        tipNodes.s = sv('text', { class: 't8-tip-s', x: 10, y: 32 }, tipNodes.g);
      }
      var a = hoverId && s.agents[hoverId];
      show(tipNodes.g, !!a);
      if (!a) return;
      var p = P(hoverId), r = R_(hoverId), st = trunc(U.stateWord(a) + (a.tool && a.state === 'working' ? ' · ' + a.tool : ''), 44), nm = trunc(a.name, 30);
      var w = Math.max(nm.length * 7.6, st.length * 6.7) + 20, x = clamp(p.x - w / 2, 4, W - w - 4), y = p.y - r - 52; if (y < 4) y = p.y + r + 30;
      setA(tipNodes.g, 'transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')');
      setA(tipNodes.bg2, 'width', w.toFixed(1)); setA(tipNodes.bg2, 'height', 40); setA(tipNodes.bg, 'width', 0); setA(tipNodes.bg, 'height', 0);
      setT(tipNodes.n, nm); setT(tipNodes.s, st);
    }

    function applySize(size) {
      if (!size || !size.w || !size.h || (size.w === W && size.h === H && layoutKey)) return;
      W = size.w; H = size.h; svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      setA(bgRect, 'width', W); setA(bgRect, 'height', H);
      layoutKey = ''; snap = true; if (lastS) render(lastS, 0);
    }
    if (window.ResizeObserver) new ResizeObserver(function () { applySize(ctx.size()); }).observe(stage);
    applySize(ctx.size());

    /* ------------------------------------------------------------------ chrome contract */
    function fresh() { Object.keys(pools).forEach(function (k) { pools[k].clear(); }); cellOrder = ''; }
    return {
      update: function (s, events, dtSim) { lastS = s; if (!dtSim) render(s, 0); },
      frame: function (dt, now, s) { render(s, dt); },
      onSelect: function () { if (lastS) render(lastS, 0); },
      onReset: function (s) { pos = {}; tint = {}; layoutKey = ''; snap = true; hoverId = null; fresh(); Object.keys(agentNodes).forEach(function (id) { agentNodes[id].g.remove(); delete agentNodes[id]; }); Object.keys(calloutNodes).forEach(function (id) { calloutNodes[id].g.remove(); delete calloutNodes[id]; }); Object.keys(cellNodes).forEach(function (id) { cellNodes[id].remove(); delete cellNodes[id]; }); },
      onMotionChange: function () { snap = true; },
      resize: applySize
    };
  }
});
