/* 03 Radar
 *  rings  = delegation depth (centre = orchestrator, ring 1 = its agents, ring 2 = their subagents ...)
 *  angle  = sector per top-level agent; subagents sit inside their parent's sector on the next ring
 *  outer ring = finished share of agents (state.progress), filling clockwise from the top
 *  Every mark is derived from the accumulated state (state.t is the only clock), never from unplayed events.
 */
(function () {
  'use strict';
  var C = AgentCore.COLORS, U = AgentCore.util;
  var BG = '#EAE8E1', PANEL = '#F3F1EA', INK = C.ink, SLATE = C.slate, MIST = C.mist, ACC = C.acc, AMBER = C.amber, RUST = C.rust;
  var TRAIL_MS = 7000, MSG_MS = 3600, MSG_FLIGHT = 1100;

  function setA(el, o) { var c = el.__a || (el.__a = {}); for (var k in o) { var v = o[k]; if (c[k] !== v) { c[k] = v; if (v == null) el.removeAttribute(k); else el.setAttribute(k, v); } } }
  function setT(el, t) { if (el.__t !== t) { el.__t = t; el.textContent = t; } }
  function f1(n) { return Math.round(n * 10) / 10; }

  AgentChrome.mount({
    id: '03', name: 'Radar',
    tagline: 'Rings are delegation depth. Angle groups related work. The outer ring fills as agents finish.',
    create: function (stage, ctx) {
      var svg = U.svgEl('svg', { 'class': 'rd', width: '100%', height: '100%' }, stage);
      function layer() { return U.svgEl('g', null, svg); }
      var L = { bg: U.svgEl('rect', { fill: 'transparent' }, svg) };
      ['wedge', 'rings', 'spokes', 'prog', 'deleg', 'dep', 'trail', 'msg', 'nodes', 'over', 'top'].forEach(function (k) { L[k] = layer(); });
      L.bg.addEventListener('click', function () { ctx.select(null); });
      var empty = U.svgEl('text', { 'class': 'rd-empty' }, L.top); empty.textContent = 'Waiting for the orchestrator to start…';

      var W = 960, H = 640, cx = 480, cy = 330, Rout = 290, snapAll = true;
      var views = {}, info = {}, lay = null, dispProg = 0, lastState = null;

      /* ---------------------------------------------------------- pools */
      function pool(parent, make) {
        var map = {}, used = {};
        return {
          get: function (key) { used[key] = 1; return map[key] || (map[key] = make(key, parent)); },
          sweep: function () { for (var k in map) if (!used[k]) { map[k].remove(); delete map[k]; } used = {}; },
          clear: function () { for (var k in map) map[k].remove(); map = {}; used = {}; }
        };
      }
      var P = {
        wedge: pool(L.wedge, function (k, p) { return U.svgEl('path', { fill: ACC, 'fill-opacity': .09, stroke: 'none' }, p); }),
        ring: pool(L.rings, function (k, p) { var g = U.svgEl('g', null, p); U.svgEl('circle', { fill: 'none', stroke: MIST, 'stroke-width': 1 }, g); U.svgEl('text', { 'class': 'rd-ring-lbl', 'text-anchor': 'end' }, g); return g; }),
        spoke: pool(L.spokes, function (k, p) { return U.svgEl('line', { stroke: '#D3D2CA', 'stroke-width': 1 }, p); }),
        deleg: pool(L.deleg, function (k, p) { return U.svgEl('path', { fill: 'none', 'stroke-linecap': 'round' }, p); }),
        dep: pool(L.dep, function (k, p) { return U.svgEl('path', { fill: 'none', 'stroke-linecap': 'round', 'stroke-dasharray': '6 4' }, p); }),
        trail: pool(L.trail, function (k, p) { return U.svgEl('path', { fill: 'none', stroke: ACC, 'stroke-linecap': 'round', 'stroke-width': 4 }, p); }),
        msg: pool(L.msg, function (k, p) {
          var g = U.svgEl('g', null, p);
          U.svgEl('path', { fill: 'none', stroke: ACC, 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-dasharray': '0.5 5' }, g);
          U.svgEl('circle', { r: 4.5, fill: ACC, stroke: PANEL, 'stroke-width': 1.5 }, g);
          U.svgEl('title', null, g); return g;
        }),
        pill: pool(L.over, function (k, p) { var g = U.svgEl('g', { 'pointer-events': 'none' }, p); U.svgEl('rect', { height: 18, rx: 9 }, g); U.svgEl('text', { 'class': 'rd-pill-t', y: 13 }, g); return g; })
      };

      /* ---------------------------------------------------------- static layers */
      var progBase = U.svgEl('circle', { fill: 'none', stroke: MIST, 'stroke-width': 7 }, L.prog);
      var progArc = U.svgEl('circle', { fill: 'none', stroke: ACC, 'stroke-width': 7 }, L.prog);
      var ticks = U.svgEl('path', { fill: 'none', stroke: INK, 'stroke-width': 1 }, L.prog);
      var taskLbl = U.svgEl('text', { 'class': 'rd-task' }, L.top);

      /* ---------------------------------------------------------- geometry */
      function ringR(d) { return Rout * (0.14 + 0.70 * d / Math.max(2, lay ? lay.maxDepth : 2)); }
      function pt(r, a) { return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
      function chord(ax, ay, bx, by) { var mx = (ax + bx) / 2, my = (ay + by) / 2, qx = cx + (mx - cx) * 0.3, qy = cy + (my - cy) * 0.3; return { d: 'M' + f1(ax) + ' ' + f1(ay) + 'Q' + f1(qx) + ' ' + f1(qy) + ' ' + f1(bx) + ' ' + f1(by), at: function (t) { var u = 1 - t; return [u * u * ax + 2 * u * t * qx + t * t * bx, u * u * ay + 2 * u * t * qy + t * t * by]; } }; }

      /* Layout from state only: depth from parentId, sectors proportional to leaf counts. */
      function computeLayout(s) {
        var ag = s.agents, center = null, kids = {}, i, id;
        for (i = 0; i < s.order.length; i++) { id = s.order[i]; if (ag[id].parentId == null) { center = id; break; } }
        if (!center) return null;
        s.order.forEach(function (x) { kids[x] = []; });
        var parentOf = {};
        s.order.forEach(function (x) { if (x === center) return; var p = ag[x].parentId; if (!p || !ag[p] || p === x) p = center; parentOf[x] = p; kids[p].push(x); });
        var leaf = {}; function leaves(x) { if (leaf[x]) return leaf[x]; var n = 0; kids[x].forEach(function (k) { n += leaves(k); }); return (leaf[x] = n || 1); }
        var inf = {}; inf[center] = { depth: 0, a: 0, a0: 0, a1: 0, top: center, parent: null, kids: kids[center] };
        var maxDepth = 1;
        function assign(x, a0, a1, depth, top) {
          inf[x] = { depth: depth, a0: a0, a1: a1, a: (a0 + a1) / 2, top: top, parent: parentOf[x], kids: kids[x] };
          if (depth > maxDepth) maxDepth = depth;
          var tot = 0; kids[x].forEach(function (k) { tot += leaves(k); });
          var cur = a0; kids[x].forEach(function (k) { var w = (a1 - a0) * leaves(k) / tot; assign(k, cur, cur + w, depth + 1, top); cur += w; });
        }
        var tops = kids[center], tt = 0; tops.forEach(function (k) { tt += leaves(k); });
        var cur = -Math.PI / 2; tops.forEach(function (k) { var w = 2 * Math.PI * leaves(k) / tt; assign(k, cur, cur + w, 1, k); cur += w; });
        return { center: center, info: inf, maxDepth: maxDepth, tops: tops };
      }

      function place(s) {
        if (!lay) return;
        info = lay.info; var byDepth = {};
        s.order.forEach(function (id) { var d = info[id] && info[id].depth; if (d > 0) (byDepth[d] = byDepth[d] || []).push(id); });
        Object.keys(byDepth).forEach(function (d) {
          var r = ringR(Number(d)), arr = byDepth[d].sort(function (a, b) { return info[a].a - info[b].a; }), run = 0;
          arr.forEach(function (id, i) {
            var gap = i ? (info[id].a - info[arr[i - 1]].a) * r : 99;
            run = gap < 30 ? run + 1 : 0;
            var off = run === 0 ? 0 : (run % 2 ? 15 : -15);
            var p = pt(r + off, info[id].a); info[id].tx = p[0]; info[id].ty = p[1]; info[id].r = r + off;
          });
        });
        var ci = info[lay.center]; ci.tx = cx; ci.ty = cy; ci.r = 0;
      }

      /* ---------------------------------------------------------- node views */
      function nodeR(id) { var d = info[id].depth; return d === 0 ? 17 : d === 1 ? 11 : d === 2 ? 8.5 : 7; }
      function mkNode(id) {
        var g = U.svgEl('g', { 'class': 'agent', tabindex: 0, role: 'button' }, L.nodes);
        var v = { g: g, x: info[id].tx, y: info[id].ty, appear: ctx.reducedMotion() || snapAll ? 1 : 0 };
        v.sel = U.svgEl('circle', { 'class': 'rd-sel' }, g);
        v.focus = U.svgEl('circle', { 'class': 'rd-focus' }, g);
        v.halo = U.svgEl('circle', { fill: 'none', 'stroke-width': 1.5 }, g);
        v.body = U.svgEl('circle', null, g);
        v.glyph = U.svgEl('path', { fill: 'none', stroke: '#fff', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
        v.hit = U.svgEl('circle', { fill: 'transparent' }, g);
        v.lbl = U.svgEl('text', { 'class': 'rd-lbl' }, g);
        v.outs = U.svgEl('g', null, g);
        v.att = U.svgEl('g', null, g); U.svgEl('circle', { r: 6.5, fill: PANEL, stroke: ACC, 'stroke-width': 1.5 }, v.att); v.attT = U.svgEl('text', { 'text-anchor': 'middle', y: 3.5, 'font-size': 9.5, 'font-weight': 700, fill: INK }, v.att);
        v.card = U.svgEl('g', { visibility: 'hidden' }, g);
        v.cardR = U.svgEl('rect', { rx: 10, fill: PANEL, stroke: INK, 'stroke-width': 1.5 }, v.card);
        v.cardCk = U.svgEl('circle', { r: 7, fill: ACC }, v.card); v.cardCkP = U.svgEl('path', { fill: 'none', stroke: '#fff', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', d: 'M-3.2 .2L-.9 2.6L3.4 -2.4' }, v.card);
        v.cardT = U.svgEl('text', { 'class': 'rd-card-t' }, v.card);
        v.cardL = [0, 1, 2, 3].map(function () { return U.svgEl('text', { 'class': 'rd-card-s' }, v.card); });
        v.cardM = U.svgEl('text', { 'class': 'rd-card-m' }, v.card);
        g.addEventListener('click', function (e) { e.stopPropagation(); ctx.select(id); });
        g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); ctx.select(id); } });
        views[id] = v; return v;
      }

      function glyphPath(kind, r) {
        if (kind === 'done') return 'M' + f1(-.42 * r) + ' ' + f1(.04 * r) + 'L' + f1(-.1 * r) + ' ' + f1(.36 * r) + 'L' + f1(.46 * r) + ' ' + f1(-.32 * r);
        if (kind === 'failed') return 'M' + f1(-.33 * r) + ' ' + f1(-.33 * r) + 'L' + f1(.33 * r) + ' ' + f1(.33 * r) + 'M' + f1(.33 * r) + ' ' + f1(-.33 * r) + 'L' + f1(-.33 * r) + ' ' + f1(.33 * r);
        if (kind === 'blocked') return 'M' + f1(-.26 * r) + ' ' + f1(-.38 * r) + 'L' + f1(-.26 * r) + ' ' + f1(.38 * r) + 'M' + f1(.26 * r) + ' ' + f1(-.38 * r) + 'L' + f1(.26 * r) + ' ' + f1(.38 * r);
        return '';
      }

      var PAGE = 'M0 0H6.5L10 3.5V13H0ZM6.5 0V3.5H10';
      function buildOuts(v, a, s, r) {
        var key = a.outputs.join('|'); if (v.outKey === key) return; v.outKey = key;
        while (v.outs.firstChild) v.outs.removeChild(v.outs.firstChild);
        a.outputs.slice(0, 3).forEach(function (oid, i) {
          var o = s.outputs.filter(function (x) { return x.id === oid; })[0];
          var g = U.svgEl('g', { transform: 'translate(' + (i * 13 - 5) + ',-6.5)' }, v.outs);
          U.svgEl('path', { d: PAGE, fill: PANEL, stroke: ACC, 'stroke-width': 1.4, 'stroke-linejoin': 'round' }, g);
          var t = U.svgEl('title', null, g); t.textContent = o ? o.name : oid;
        });
        if (a.outputs.length > 3) { var t = U.svgEl('text', { x: 34, y: 4, 'font-size': 10, fill: ACC, 'font-weight': 700 }, v.outs); t.textContent = '+' + (a.outputs.length - 3); }
      }

      /* where the label and callout stack sit relative to a node */
      function tagGeom(id, v) {
        var inf = info[id], r = nodeR(id), ux, uy;
        if (inf.depth === 0) { ux = 0; uy = 1; }
        else {
          var ang = inf.a; ux = Math.cos(ang); uy = Math.sin(ang);
          if (inf.kids.length) { var tx = -uy, ty = ux; ux = tx; uy = ty; if (uy < -.2 && Math.abs(ux) < .3) { ux = -ux; uy = -uy; } }
          else { var dx = v.x - cx, dy = v.y - cy, m = Math.hypot(dx, dy) || 1; ux = dx / m; uy = dy / m; }
        }
        var px = v.x + ux * (r + 7), py = v.y + uy * (r + 7);
        var anchor = ux > .3 ? 'start' : ux < -.3 ? 'end' : 'middle';
        var mode = uy < -.55 ? 'top' : uy > .55 ? 'bottom' : 'side';
        return { px: px, py: py, anchor: anchor, mode: mode, ux: ux, uy: uy };
      }

      /* ---------------------------------------------------------- render */
      var pillTextCache = {};
      var pending = [];
      function pill(key, text, fill, stroke, tcolor, tg) { pending.push({ key: key, text: text, fill: fill, stroke: stroke, tcolor: tcolor, tg: tg }); }
      function layoutPills() {
        var placed = [];
        pending.forEach(function (q) {
          var g = P.pill.get(q.key), rect = g.firstChild, t = g.childNodes[1], tg = q.tg;
          setT(t, q.text); setA(t, { fill: q.tcolor });
          var w = pillTextCache[q.text]; if (w == null) { w = t.getComputedTextLength ? t.getComputedTextLength() : q.text.length * 7.3; pillTextCache[q.text] = w; }
          var bw = w + 18, x, y;
          if (tg.mode === 'top') y = tg.py - 2 - 13 - 22; else if (tg.mode === 'bottom') y = tg.py + 17; else y = tg.py + 10;
          x = tg.anchor === 'start' ? tg.px - 2 : tg.anchor === 'end' ? tg.px - bw + 2 : tg.px - bw / 2;
          x = U.clamp(x, 6, W - bw - 6); y = U.clamp(y, 4, H - 24);
          var dir = tg.mode === 'top' ? -1 : 1;
          for (var tries = 0; tries < 6; tries++) {
            var hit = placed.some(function (o) { return x < o.x + o.w + 4 && x + bw + 4 > o.x && y < o.y + 22 && y + 22 > o.y; });
            if (!hit) break; y = U.clamp(y + dir * 21, 4, H - 24);
          }
          placed.push({ x: x, y: y, w: bw });
          setA(rect, { width: f1(bw), fill: q.fill, stroke: q.stroke, 'stroke-width': 1.4 }); setA(t, { x: 9 }); setA(g, { transform: 'translate(' + f1(x) + ',' + f1(y) + ')' });
        });
        pending = [];
      }

      function wrap(text, max, lines) {
        var words = String(text || '').split(/\s+/), out = [], cur = '';
        words.forEach(function (w) { if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); });
        if (cur) out.push(cur);
        if (out.length > lines) { out = out.slice(0, lines); out[lines - 1] = out[lines - 1].replace(/\s*\S{0,2}$/, '').slice(0, max - 1) + '…'; }
        return out;
      }

      function render(s) {
        lastState = s;
        var sel = ctx.selected();
        if (!lay) { empty.style.display = ''; setA(empty, { x: cx, y: cy }); }
        else empty.style.display = 'none';
        var tNow = s.t;

        /* outer ring: finished share of agents, clockwise from top */
        var circ = 2 * Math.PI * Rout;
        setA(progBase, { cx: cx, cy: cy, r: Rout }); setA(progArc, { cx: cx, cy: cy, r: Rout, 'stroke-dasharray': f1(circ * dispProg) + ' ' + f1(circ), transform: 'rotate(-90 ' + cx + ' ' + cy + ')' });
        var td = ''; for (var i = 0; i < 10; i++) { var a = i / 10 * 2 * Math.PI - Math.PI / 2, p1 = pt(Rout - 15, a), p2 = pt(Rout - 6, a); td += 'M' + f1(p1[0]) + ' ' + f1(p1[1]) + 'L' + f1(p2[0]) + ' ' + f1(p2[1]); }
        setA(ticks, { d: td });
        var pct = Math.round(s.progress * 100);
        setT(taskLbl, s.finished ? 'TASK · COMPLETE' : 'TASK · ' + pct + '%'); setA(taskLbl, { x: cx, y: cy - Rout - 12 });

        if (!lay) { ['wedge', 'ring', 'spoke', 'deleg', 'dep', 'trail', 'msg', 'pill'].forEach(function (k) { P[k].sweep(); }); return; }

        /* rings + depth labels */
        for (var d = 1; d <= Math.max(2, lay.maxDepth); d++) {
          var g = P.ring.get('r' + d), r = ringR(d); setA(g.firstChild, { cx: cx, cy: cy, r: f1(r) });
          var angs = s.order.filter(function (x) { return info[x] && info[x].depth === d; }).map(function (x) { return Math.atan2(info[x].ty - cy, info[x].tx - cx); }).sort(function (a, b) { return a - b; });
          var best = -Math.PI * .75, bg = -1;
          for (var ai = 0; ai < angs.length; ai++) { var n = angs[(ai + 1) % angs.length], gap = (ai + 1 < angs.length ? n - angs[ai] : n + 2 * Math.PI - angs[ai]); if (gap > bg) { bg = gap; best = angs[ai] + gap / 2; } }
          var lp = pt(r, best), tl = g.childNodes[1]; setT(tl, 'DEPTH ' + d); setA(tl, { x: f1(lp[0]), y: f1(lp[1] + 3.5), 'text-anchor': 'middle' });
        }
        /* spokes for each top-level agent */
        lay.tops.forEach(function (id) { var a = info[id].a, p = pt(Rout - 8, a); setA(P.spoke.get('s' + id), { x1: cx, y1: cy, x2: f1(p[0]), y2: f1(p[1]) }); });

        /* selection sector */
        if (sel && info[sel] && info[sel].depth > 0) {
          var ti = info[info[sel].top], r0 = 26, r1 = ringR(Math.max(2, lay.maxDepth)) + 34;
          var q0 = pt(r1, ti.a0), q1 = pt(r1, ti.a1), q2 = pt(r0, ti.a1), q3 = pt(r0, ti.a0), big = (ti.a1 - ti.a0) > Math.PI ? 1 : 0;
          setA(P.wedge.get('w'), { d: 'M' + f1(q3[0]) + ' ' + f1(q3[1]) + 'L' + f1(q0[0]) + ' ' + f1(q0[1]) + 'A' + f1(r1) + ' ' + f1(r1) + ' 0 ' + big + ' 1 ' + f1(q1[0]) + ' ' + f1(q1[1]) + 'L' + f1(q2[0]) + ' ' + f1(q2[1]) + 'A' + r0 + ' ' + r0 + ' 0 ' + big + ' 0 ' + f1(q3[0]) + ' ' + f1(q3[1]) + 'Z' });
        }

        function V(id) { return views[id]; }
        function rel(a, b) { return sel && (a === sel || b === sel); }
        function dim(a, b) { return sel && !(a === sel || b === sel) ? .28 : 1; }

        /* delegation: radial line for parent -> child; chord for a handoff between other agents */
        var pairs = {}, pk = [];
        s.delegations.forEach(function (dl) { var k = dl.from + '>' + dl.to; if (!pairs[k]) { pairs[k] = { from: dl.from, to: dl.to, work: false }; pk.push(k); } if (dl.work) pairs[k].work = true; });
        pk.forEach(function (k) {
          var pr = pairs[k], A = V(pr.from), B = V(pr.to); if (!A || !B) return;
          var el = P.deleg.get(k), tree = info[pr.to] && info[pr.to].parent === pr.from, R = rel(pr.from, pr.to);
          var d = tree ? 'M' + f1(A.x) + ' ' + f1(A.y) + 'L' + f1(B.x) + ' ' + f1(B.y) : chord(A.x, A.y, B.x, B.y).d;
          setA(el, { d: d, stroke: INK, 'stroke-width': (pr.work ? 1.8 : 1.1) + (R ? 1 : 0), opacity: (pr.work ? .9 : .5) * (R ? 1.1 : 1) * dim(pr.from, pr.to) });
        });

        /* dependencies: dashed chords; solid-dark while the dependency is still open */
        s.dependencies.forEach(function (dp, i) {
          var A = V(dp.from), B = V(dp.to); if (!A || !B) return;
          var open = s.agents[dp.from] && s.agents[dp.from].state !== 'done', R = rel(dp.from, dp.to);
          setA(P.dep.get('d' + i), { d: chord(A.x, A.y, B.x, B.y).d, stroke: SLATE, 'stroke-width': (open ? 1.7 : 1.2) + (R ? .8 : 0), opacity: (open ? .95 : .35) * dim(dp.from, dp.to) });
        });

        /* trails: green arc behind the blip, length from time since last tool call */
        s.order.forEach(function (id) {
          var a = s.agents[id], v = V(id); if (!v || !info[id] || info[id].depth === 0 || a.toolAt == null) return;
          var age = tNow - a.toolAt; if (age < 0 || age > TRAIL_MS) return;
          var fr = 1 - age / TRAIL_MS, rr = Math.hypot(v.x - cx, v.y - cy), ang = Math.atan2(v.y - cy, v.x - cx), len = (12 + 64 * fr) / rr;
          var p0 = pt(rr, ang - len), p1 = pt(rr, ang);
          setA(P.trail.get('t' + id), { d: 'M' + f1(p0[0]) + ' ' + f1(p0[1]) + 'A' + f1(rr) + ' ' + f1(rr) + ' 0 0 1 ' + f1(p1[0]) + ' ' + f1(p1[1]), opacity: f1((.3 + .55 * fr) * (sel && sel !== id ? .5 : 1)) });
        });

        /* messages: dotted chord, dot travels from sender to receiver (position derived from state.t) */
        var ms = s.messages;
        for (var mi = ms.length - 1; mi >= 0; mi--) {
          var m = ms[mi], age = tNow - m.t; if (age > MSG_MS) break; if (age < 0) continue;
          var A = V(m.from), B = V(m.to); if (!A || !B) continue;
          var ch = chord(A.x, A.y, B.x, B.y), g = P.msg.get('m' + mi), fade = Math.max(.2, 1 - age / MSG_MS), dot = g.childNodes[1];
          var tt = ctx.reducedMotion() ? (age < 2000 ? 1 : -1) : (age < MSG_FLIGHT ? U.ease(age / MSG_FLIGHT) : -1);
          setA(g.firstChild, { d: ch.d, opacity: f1(fade * dim(m.from, m.to)) });
          if (tt < 0) setA(dot, { visibility: 'hidden' }); else { var pp = ch.at(tt); setA(dot, { visibility: 'visible', cx: f1(pp[0]), cy: f1(pp[1]) }); }
          setT(g.lastChild, (s.agents[m.from] ? s.agents[m.from].name : m.from) + ' → ' + (s.agents[m.to] ? s.agents[m.to].name : m.to) + ': ' + m.text);
        }

        /* nodes */
        var compact = s.order.length > 18;
        s.order.forEach(function (id) {
          var a = s.agents[id], v = V(id), inf = info[id]; if (!v || !inf) return;
          var r = nodeR(id) * (0.4 + 0.6 * v.appear), st = a.state, isSel = sel === id, fin = id === lay.center && s.finished;
          setA(v.g, { transform: 'translate(' + f1(v.x) + ',' + f1(v.y) + ')', 'aria-label': a.name + ', ' + (st === 'blocked' ? 'blocked: ' + (a.blockedReason || '') : st === 'failed' ? 'failed: ' + (a.error || '') : st) + ', depth ' + inf.depth, opacity: v.appear < 1 ? f1(v.appear) : 1 });
          v.g.classList.toggle('sel', isSel);
          setA(v.sel, { r: f1(r + 6) }); setA(v.focus, { r: f1(r + 9) }); setA(v.hit, { r: f1(Math.max(r + 5, 15)) });
          var fill = st === 'working' ? ACC : st === 'done' ? INK : st === 'blocked' ? AMBER : st === 'failed' ? RUST : BG;
          var stroke = st === 'waiting' ? INK : st === 'queued' ? MIST : PANEL;
          setA(v.body, { r: f1(r), fill: fill, stroke: stroke, 'stroke-width': st === 'waiting' || st === 'queued' ? 1.7 : 1.5, 'stroke-dasharray': st === 'waiting' ? '2.2 2.2' : null });
          var halo = st === 'working' ? ACC : st === 'blocked' ? AMBER : null;
          setA(v.halo, { r: f1(r + 6), stroke: halo || 'none', opacity: .4 });
          var gp = glyphPath(st, r); setA(v.glyph, { d: gp, 'stroke-width': f1(Math.max(1.6, r * .2)), visibility: gp ? 'visible' : 'hidden' });
          if (st === 'blocked') setA(v.glyph, { 'stroke-width': f1(Math.max(1.8, r * .24)) });
          if (fin) { setA(v.body, { visibility: 'hidden' }); setA(v.glyph, { visibility: 'hidden' }); setA(v.halo, { stroke: 'none' }); } else setA(v.body, { visibility: 'visible' });
          buildOuts(v, a, s, r);
          var tg = tagGeom(id, v);
          var oo = r + 12 + (a.outputs.length > 1 ? 4 : 0); setA(v.outs, { transform: 'translate(' + f1(-tg.ux * oo) + ',' + f1(-tg.uy * oo) + ')' });
          setT(v.lbl, fin ? '' : a.label); setA(v.lbl, { x: f1(tg.px - v.x), y: f1(tg.py - v.y + (tg.mode === 'top' ? -2 : tg.mode === 'bottom' ? 11 : 4)), 'text-anchor': tg.anchor });
          v.lbl.setAttribute('class', 'rd-lbl' + (compact ? ' compact' : '') + (compact && st === 'done' && !isSel ? ' dimmed' : ''));
          if (a.attempt > 1) { setA(v.att, { transform: 'translate(' + f1(r * .75) + ',' + f1(r * .8) + ')', visibility: 'visible' }); setT(v.attT, String(a.attempt)); } else setA(v.att, { visibility: 'hidden' });
          /* final result: the orchestrator becomes a summary badge */
          if (fin) {
            var info2 = s.finishedInfo || {}, lines = wrap(info2.summary || '', 27, 4), h = 52 + lines.length * 14 + 14, w = 204;
            setA(v.card, { visibility: 'visible' }); setA(v.cardR, { x: -w / 2, y: -h / 2, width: w, height: h });
            setA(v.cardCk, { cx: -w / 2 + 20, cy: -h / 2 + 22 }); setA(v.cardCkP, { transform: 'translate(' + (-w / 2 + 20) + ',' + (-h / 2 + 22) + ')' });
            setT(v.cardT, (a.label || 'ORCH') + ' · ' + String(info2.status || 'done').toUpperCase()); setA(v.cardT, { x: -w / 2 + 34, y: -h / 2 + 26 });
            v.cardL.forEach(function (t, i) { setT(t, lines[i] || ''); setA(t, { x: -w / 2 + 14, y: -h / 2 + 50 + i * 14 }); });
            var no = (info2.outputIds || []).length; setT(v.cardM, no + (no === 1 ? ' OUTPUT' : ' OUTPUTS') + ' · ' + s.order.length + ' AGENTS'); setA(v.cardM, { x: -w / 2 + 14, y: h / 2 - 11 });
            setA(v.hit, { r: 1, visibility: 'hidden' }); setA(v.sel, { r: 0 }); setA(v.focus, { r: 0 });
          } else { setA(v.card, { visibility: 'hidden' }); setA(v.hit, { visibility: 'visible' }); }
          /* callouts: blocked reason, failure, retry, current tool */
          var key = 'p' + id;
          if (st === 'blocked') {
            var txt = String(a.blockedReason || 'blocked'); if (txt.length > 34 && a.needs) txt = 'needs ' + a.needs; pill(key, txt.toUpperCase().slice(0, 36), AMBER, AMBER, '#fff', tg);
          } else if (st === 'failed') pill(key, (String(a.error || 'failed').toUpperCase().slice(0, 30)) + ' · RETRY', RUST, RUST, '#fff', tg);
          else {
            var rt = null; for (var q = a.recent.length - 1; q >= 0; q--) if (a.recent[q].kind === 'retry') { rt = a.recent[q].t; break; }
            if (st === 'working' && a.attempt > 1 && rt != null && tNow - rt < 2500 && tNow >= rt) pill(key, 'RETRY ' + a.attempt, PANEL, ACC, '#0f5d52', tg);
            else if (st === 'working' && a.tool && a.toolAt != null && tNow >= a.toolAt && tNow - a.toolAt < (a.toolDuration || 0) + 1500) pill(key, a.tool, PANEL, ACC, '#0f5d52', tg);
          }
        });
        layoutPills();
        Object.keys(views).forEach(function (id) { if (!s.agents[id]) { views[id].g.remove(); delete views[id]; } });
        ['wedge', 'ring', 'spoke', 'deleg', 'dep', 'trail', 'msg', 'pill'].forEach(function (k) { P[k].sweep(); });
        if (!sel) P.wedge.sweep();
      }

      function sync(s) {
        lay = computeLayout(s);
        if (lay) { place(s); s.order.forEach(function (id) { if (!info[id]) return; if (!views[id]) mkNode(id); if (snapAll || ctx.reducedMotion()) { views[id].x = info[id].tx; views[id].y = info[id].ty; } }); }
        if (snapAll || ctx.reducedMotion()) dispProg = s.progress;
        snapAll = false; render(s);
      }

      function setSize(size) {
        W = Math.max(480, size.w || 960); H = Math.max(360, size.h || 640); cx = W / 2; cy = H / 2 + 8; Rout = Math.min(W / 2 - 16, H / 2 - 30);
        setA(svg, { viewBox: '0 0 ' + W + ' ' + H }); setA(L.bg, { x: 0, y: 0, width: W, height: H });
        snapAll = true; pillTextCache = {};
      }
      setSize(ctx.size());

      return {
        update: function (s) { sync(s); },
        frame: function (dt, now, s) {
          if (!lay) return; var moving = false, k = 1 - Math.exp(-dt / 110), instant = ctx.reducedMotion();
          Object.keys(views).forEach(function (id) {
            var v = views[id], i = info[id]; if (!i) return;
            if (instant) { v.x = i.tx; v.y = i.ty; v.appear = 1; return; }
            if (Math.abs(v.x - i.tx) > .15 || Math.abs(v.y - i.ty) > .15) { v.x += (i.tx - v.x) * k; v.y += (i.ty - v.y) * k; moving = true; }
            if (v.appear < 1) { v.appear = Math.min(1, v.appear + dt / 350); moving = true; }
          });
          if (Math.abs(dispProg - s.progress) > .0008) { dispProg = instant ? s.progress : dispProg + (s.progress - dispProg) * (1 - Math.exp(-dt / 220)); moving = true; } else dispProg = s.progress;
          if (moving) render(s);
        },
        onSelect: function () { if (lastState) render(lastState); },
        onMotionChange: function () { snapAll = true; if (lastState) sync(lastState); },
        onReset: function (s) { Object.keys(views).forEach(function (id) { views[id].g.remove(); delete views[id]; }); for (var k in P) P[k].clear(); snapAll = true; pillTextCache = {}; sync(s); },
        resize: function (size) { setSize(size); if (lastState) sync(lastState); }
      };
    }
  });
})();
