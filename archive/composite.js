/* "All ten as one": a SINGLE picture that merges the ten designs as toggleable layers.
 *   01 Orb web      hub + delegation threads + message beads
 *   02 Hive cells   subagents bud off their parent as small hexagons
 *   03 Radar        concentric rings = delegation depth
 *   04 Lattice      dependencies routed as circuit traces (radial + along a ring)
 *   05 River        ribbons from each agent into the hub; width = time since the agent started
 *   06 Floorplan    each main agent's wedge is a room with walls and a name plate
 *   07 Swimlanes    outer ring is the time axis (event ticks, NOW) + a mini lane inside every card
 *   08 Territories  each room is tinted by its worst state
 *   09 Card tree    main agents are status cards (state text, tool, outputs)
 *   10 Matrix       message counts as a small sender x receiver grid
 * Everything is derived from accumulated state (s.agents, s.log, s.messages ...), so it works unchanged on live events. */
(function (g) {
  var NS = 'http://www.w3.org/2000/svg';
  var INK = '#1F2528', TEAL = '#1F8A7A', AMBER = '#B7790A', RUST = '#B5472F', SLATE = '#56636A', MIST = '#B7BCB8', BG = '#EAE8E1';
  var TINT = { working: '#cfe5de', done: '#d9d9d3', blocked: '#f1deba', failed: '#efcfc6', waiting: 'none', queued: 'none' };
  var COL = { working: TEAL, done: INK, blocked: AMBER, failed: RUST, waiting: SLATE, queued: MIST };
  var RANK = { done: 0, queued: 1, waiting: 2, working: 3, blocked: 4, failed: 5 };
  var LAYERS = [['01', 'Threads and beads'], ['02', 'Hive cells'], ['03', 'Depth rings'], ['04', 'Routed wires'], ['05', 'River ribbons'], ['06', 'Room walls'], ['07', 'Time ring'], ['08', 'Region tint'], ['09', 'Status cards'], ['10', 'Message matrix']];

  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function cut(t, n) { t = String(t == null ? '' : t); return t.length > n ? t.slice(0, n - 1) + '…' : t; }

  g.__AppViews.views.push({
    id: 'one', name: 'All ten as one', tagline: 'One picture, ten designs as layers',
    create: function (stage, ctx) {
      var U = ctx.core.util;
      var wrap = document.createElement('div'); wrap.className = 'co-wrap'; stage.appendChild(wrap);
      var svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'co-svg'); svg.setAttribute('role', 'group'); svg.setAttribute('aria-label', 'Combined view of all agents'); wrap.appendChild(svg);
      var panel = document.createElement('div'); panel.className = 'co-layers'; wrap.appendChild(panel);
      var hidden = {}; var sel = null; var lastSig = '', lastBuild = 0, W = 960, H = 560, geo = null, anim = [];

      /* ---- layer chips ---- */
      var ph = document.createElement('div'); ph.className = 'co-lh'; ph.textContent = 'LAYERS = THE TEN DESIGNS'; panel.appendChild(ph);
      LAYERS.forEach(function (L) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'co-chip'; b.setAttribute('aria-pressed', 'true'); b.dataset.layer = L[0];
        b.innerHTML = '<i>' + L[0] + '</i><span>' + L[1] + '</span>';
        b.onclick = function () { hidden[L[0]] = !hidden[L[0]]; b.setAttribute('aria-pressed', String(!hidden[L[0]])); applyHidden(); lastSig = ''; update(ctx.state()); };
        b.onmouseenter = function () { svg.setAttribute('data-focus', L[0]); }; b.onmouseleave = function () { svg.removeAttribute('data-focus'); };
        b.onfocus = b.onmouseenter; b.onblur = b.onmouseleave; panel.appendChild(b);
      });
      var key = document.createElement('div'); key.className = 'co-key'; key.innerHTML = '<b>How to read it</b><br>Card = main agent, hexagon = subagent.<br>Wedge = its room (tint = worst state).<br>Rings = delegation depth.<br>Ribbon width = time since start.<br>Dashed wire = waiting, thin = met.<br>Teal dot = message in flight.<br>Outer ring = time, bar in card = its span.<br>Grid = who messaged whom.'; panel.appendChild(key);
      var solo = document.createElement('button'); solo.type = 'button'; solo.className = 'co-all'; solo.textContent = 'Show all ten'; solo.onclick = function () { hidden = {}; [].forEach.call(panel.querySelectorAll('.co-chip'), function (c) { c.setAttribute('aria-pressed', 'true'); }); applyHidden(); lastSig = ''; update(ctx.state()); }; panel.appendChild(solo);
      function applyHidden() { LAYERS.forEach(function (L) { var gr = svg.querySelector('.L' + L[0]); if (gr) gr.style.display = hidden[L[0]] ? 'none' : ''; }); }

      /* ---- layout from state ---- */
      function layout(s) {
        var ids = s.order.slice(); if (!ids.length) return null;
        var root = ids.filter(function (id) { return !s.agents[id].parentId; })[0] || ids[0];
        var depth = {}, kids = {}, top = [];
        function d(id, seen) { if (depth[id] != null) return depth[id]; var a = s.agents[id]; if (!a || id === root) return (depth[id] = 0); if (seen[id]) return 1; seen[id] = 1; var p = a.parentId && s.agents[a.parentId] ? a.parentId : root; return (depth[id] = p === root ? 1 : d(p, seen) + 1); }
        ids.forEach(function (id) { d(id, {}); });
        ids.forEach(function (id) { if (id === root) return; var a = s.agents[id]; var p = a.parentId && s.agents[a.parentId] ? a.parentId : root; (kids[p] = kids[p] || []).push(id); });
        top = kids[root] || [];
        var D = 1; ids.forEach(function (id) { D = Math.max(D, depth[id]); });
        var padL = 190, padR = 200; var cx = padL + (W - padL - padR) / 2, cy = H / 2 + 4;
        var R = Math.max(120, Math.min((W - padL - padR) / 2, H / 2) - 22);
        var hubR = 28, rT = R, rIn = hubR + 6, rOut = R - 26;
        var rd = {}; for (var k = 1; k <= D; k++) rd[k] = D === 1 ? R * 0.62 : (k === 1 ? R * 0.60 : R * (0.60 + 0.25 * (k - 1) / (D - 1)));
        function weight(id) { var w = 1; (kids[id] || []).forEach(function (c) { w += 0.45 * weight(c); }); return Math.max(1, Math.min(w, 3)); }
        var tw = 0; top.forEach(function (id) { tw += weight(id); }); var ang0 = 0, pos = {}, sector = {}, GAP = top.length > 1 ? 0.035 : 0;
        var full = Math.PI * 2 - GAP * top.length;
        top.forEach(function (id) {
          var w = full * weight(id) / tw; var a0 = ang0 + GAP / 2, a1 = a0 + w; ang0 += w + GAP; sector[id] = { a0: a0, a1: a1, mid: (a0 + a1) / 2 };
          pos[id] = { a: (a0 + a1) / 2, r: rd[1] };
          (function place(pid, lo, hi) { var cs = kids[pid] || []; if (!cs.length) return; var tot = 0; cs.forEach(function (c) { tot += weight(c); }); var cur = lo;
            cs.forEach(function (c) { var cw = (hi - lo) * weight(c) / tot; var mid = cur + cw / 2; pos[c] = { a: mid, r: rd[Math.min(depth[c], D)] || rd[D] }; cur += cw; place(c, cur - cw, cur); }); })(id, a0 + (a1 - a0) * 0.04, a1 - (a1 - a0) * 0.04);
        });
        pos[root] = { a: 0, r: 0 };
        // stagger crowded main-agent cards radially
        if (top.length > 3) { var gapPx = 2 * Math.PI * rd[1] / top.length; if (gapPx < 112) top.forEach(function (id, i) { pos[id].r = rd[1] + (i % 2 ? 1 : -1) * R * 0.07; }); }
        return { ids: ids, root: root, depth: depth, kids: kids, top: top, D: D, cx: cx, cy: cy, R: R, hubR: hubR, rIn: rIn, rOut: rOut, rd: rd, pos: pos, sector: sector };
      }
      function P(r, a) { return { x: geo.cx + r * Math.sin(a), y: geo.cy - r * Math.cos(a) }; }
      function XY(id) { var p = geo.pos[id]; return p ? P(p.r, p.a) : { x: geo.cx, y: geo.cy }; }
      function worst(s, id) { var w = s.agents[id].state; (geo.kids[id] || []).forEach(function (c) { var x = worst(s, c); if (RANK[x] > RANK[w]) w = x; }); return w; }
      function counts(s, id) { var n = 0, dn = 0; (function walk(i) { n++; if (s.agents[i].state === 'done') dn++; (geo.kids[i] || []).forEach(walk); })(id); return [dn, n]; }
      function arcPath(r0, r1, a0, a1) { var p0 = P(r1, a0), p1 = P(r1, a1), q1 = P(r0, a1), q0 = P(r0, a0); var big = (a1 - a0) > Math.PI ? 1 : 0; return 'M' + p0.x + ' ' + p0.y + ' A' + r1 + ' ' + r1 + ' 0 ' + big + ' 1 ' + p1.x + ' ' + p1.y + ' L' + q1.x + ' ' + q1.y + ' A' + r0 + ' ' + r0 + ' 0 ' + big + ' 0 ' + q0.x + ' ' + q0.y + ' Z'; }
      function arcLine(r, a0, a1) { var p0 = P(r, a0), p1 = P(r, a1); var big = Math.abs(a1 - a0) > Math.PI ? 1 : 0; return 'M' + p0.x + ' ' + p0.y + ' A' + r + ' ' + r + ' 0 ' + big + ' ' + (a1 >= a0 ? 1 : 0) + ' ' + p1.x + ' ' + p1.y; }
      function glyph(state, x, y, r) {
        var c = COL[state] || SLATE;
        if (state === 'working') return '<circle cx="' + x + '" cy="' + y + '" r="' + (r + 3) + '" fill="none" stroke="' + c + '" stroke-opacity=".35" stroke-width="1.5" class="co-pulse"/><circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + c + '"/>';
        if (state === 'done') return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + c + '"/><path d="M' + (x - r * .5) + ' ' + y + 'l' + r * .35 + ' ' + r * .4 + 'l' + r * .7 + ' -' + r * .8 + '" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
        if (state === 'blocked') return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + c + '"/><path d="M' + (x - r * .3) + ' ' + (y - r * .45) + 'v' + r * .9 + 'M' + (x + r * .3) + ' ' + (y - r * .45) + 'v' + r * .9 + '" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>';
        if (state === 'failed') return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + c + '"/><path d="M' + (x - r * .4) + ' ' + (y - r * .4) + 'l' + r * .8 + ' ' + r * .8 + 'M' + (x + r * .4) + ' ' + (y - r * .4) + 'l-' + r * .8 + ' ' + r * .8 + '" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>';
        return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + BG + '" stroke="' + c + '" stroke-width="1.4"' + (state === 'waiting' ? ' stroke-dasharray="2.5 2.5"' : '') + '/>';
      }
      function hex(x, y, r) { var p = []; for (var i = 0; i < 6; i++) { var a = Math.PI / 3 * i + Math.PI / 6; p.push((x + r * Math.cos(a)).toFixed(1) + ',' + (y + r * Math.sin(a)).toFixed(1)); } return p.join(' '); }

      /* ---- build ---- */
      function build(s) {
        geo = layout(s); anim = [];
        if (!geo) { svg.innerHTML = '<text x="' + W / 2 + '" y="' + H / 2 + '" text-anchor="middle" fill="' + SLATE + '" font-family="Inter Tight, sans-serif" font-size="15">Waiting for the first agent…</text>'; return; }
        var o = { 1: '', 2: '', 3: '', 4: '', 5: '', 6: '', 7: '', 8: '', 9: '', 10: '' }, top = '', cx = geo.cx, cy = geo.cy, R = geo.R, T = s.t;
        var span = Math.max(20000, Math.ceil(T / 5000) * 5000); function tAng(t) { return Math.min(1, Math.max(0, t / span)) * Math.PI * 2 * 0.985; }
        /* 03 depth rings */
        for (var k = 1; k <= geo.D; k++) o[3] += '<circle cx="' + cx + '" cy="' + cy + '" r="' + geo.rd[k] + '" fill="none" stroke="' + MIST + '" stroke-width="1" stroke-dasharray="1 4"/><text x="' + (cx + 4) + '" y="' + (cy - geo.rd[k] - 3) + '" class="co-t co-dim">DEPTH ' + k + '</text>';
        o[3] += '<circle cx="' + cx + '" cy="' + cy + '" r="' + geo.rOut + '" fill="none" stroke="' + MIST + '" stroke-width="1"/>';
        /* 08 region tint + 06 room walls */
        geo.top.forEach(function (id) {
          var sc = geo.sector[id], st = worst(s, id), cn = counts(s, id), a = s.agents[id];
          o[8] += '<path d="' + arcPath(geo.rIn, geo.rOut, sc.a0, sc.a1) + '" fill="' + TINT[st] + '" fill-opacity="' + (st === 'done' ? .5 : .7) + '" stroke="none"/>';
          var wc = st === 'failed' ? RUST : st === 'blocked' ? AMBER : INK; var ww = (st === 'failed' || st === 'blocked') ? 2.4 : 1.4;
          o[6] += '<path d="' + arcPath(geo.rIn, geo.rOut, sc.a0, sc.a1) + '" fill="none" stroke="' + wc + '" stroke-width="' + ww + '" stroke-linejoin="round"' + (st === 'waiting' || st === 'queued' ? ' stroke-dasharray="5 4" stroke-opacity=".55"' : '') + '/>';
          var lp = P(geo.rOut - 9, sc.mid); var rot = sc.mid * 180 / Math.PI; var flip = (rot > 90 && rot < 270); var tr = flip ? rot + 180 : rot;
          o[6] += '<text transform="translate(' + lp.x.toFixed(1) + ' ' + lp.y.toFixed(1) + ') rotate(' + (tr - 0).toFixed(1) + ')" text-anchor="middle" class="co-t co-room">' + esc(cut((a.name || id).toUpperCase(), 14)) + ' · ' + cn[0] + '/' + cn[1] + '</text>';
        });
        /* 07 time ring */
        var tr0 = geo.R - 7;
        o[7] += '<circle cx="' + cx + '" cy="' + cy + '" r="' + tr0 + '" fill="none" stroke="' + MIST + '" stroke-width="10" stroke-opacity=".55"/>';
        if (T > 0) o[7] += '<path d="' + arcLine(tr0, 0, Math.max(0.001, tAng(T))) + '" fill="none" stroke="' + (s.finished ? INK : TEAL) + '" stroke-width="10" stroke-opacity=".85"/>';
        for (var i = 0; i < 12; i++) { var aa = i / 12 * Math.PI * 2 * 0.985, p0 = P(tr0 - 5, aa), p1 = P(tr0 + 5, aa); o[7] += '<line x1="' + p0.x + '" y1="' + p0.y + '" x2="' + p1.x + '" y2="' + p1.y + '" stroke="' + BG + '" stroke-width="1"/>'; if (i % 3 === 0) { var lt = P(tr0 + 14, aa); o[7] += '<text x="' + lt.x + '" y="' + (lt.y + 3) + '" text-anchor="middle" class="co-t co-dim">' + (span * i / 12000).toFixed(0) + 's</text>'; } }
        s.log.forEach(function (l) { if (l.kind !== 'blocked' && l.kind !== 'failed' && l.kind !== 'output') return; var p = P(tr0, tAng(l.t)); o[7] += l.kind === 'blocked' ? '<rect x="' + (p.x - 4) + '" y="' + (p.y - 4) + '" width="8" height="8" fill="' + AMBER + '" stroke="' + BG + '" transform="rotate(45 ' + p.x + ' ' + p.y + ')"/>' : l.kind === 'failed' ? '<circle cx="' + p.x + '" cy="' + p.y + '" r="4.5" fill="' + RUST + '" stroke="' + BG + '"/>' : '<circle cx="' + p.x + '" cy="' + p.y + '" r="2.6" fill="' + BG + '" stroke="' + INK + '" stroke-width="1.2"/>'; });
        var np = P(tr0 - 9, tAng(T)), np2 = P(tr0 + 9, tAng(T)); o[7] += '<line x1="' + np.x + '" y1="' + np.y + '" x2="' + np2.x + '" y2="' + np2.y + '" stroke="' + INK + '" stroke-width="2.4"/><text x="' + cx + '" y="' + (cy - R - 14) + '" text-anchor="middle" class="co-t co-dim">TIME RING · ' + (T / 1000).toFixed(1) + 's · diamond = blocked, dot = failed, ring = output</text>';
        /* effort for ribbons */
        var eff = {}, maxE = 1; geo.ids.forEach(function (id) { var a = s.agents[id]; var e = a.startedAt != null ? Math.max(0, (a.endedAt != null ? a.endedAt : T) - a.startedAt) : 0; eff[id] = e; if (id !== geo.root) maxE = Math.max(maxE, e); });
        /* 05 river ribbons + 01 threads */
        geo.ids.forEach(function (id) {
          if (id === geo.root) return; var a = s.agents[id], p = XY(id), pid = a.parentId && s.agents[a.parentId] && a.parentId !== geo.root ? a.parentId : geo.root, q = XY(pid);
          var wdt = a.startedAt == null ? 1.5 : Math.max(2.5, eff[id] / maxE * 15); var c = COL[a.state] || SLATE; var dash = (a.state === 'waiting' || a.state === 'queued') ? ' stroke-dasharray="3 5"' : '';
          var mx = (p.x + geo.cx) / 2, my = (p.y + geo.cy) / 2; var nx = -(p.y - geo.cy) * 0.18, ny = (p.x - geo.cx) * 0.18;
          o[5] += '<path d="M' + p.x + ' ' + p.y + ' Q' + (mx + nx) + ' ' + (my + ny) + ' ' + geo.cx + ' ' + geo.cy + '" fill="none" stroke="' + c + '" stroke-opacity="' + (a.state === 'done' ? .2 : .3) + '" stroke-width="' + wdt.toFixed(1) + '" stroke-linecap="round"' + dash + '/>';
          if (a.state === 'blocked') { var dm = P(geo.rd[Math.max(1, geo.depth[id] - 1)] * 0.62, geo.pos[id].a); o[5] += '<line x1="' + (dm.x - 7) + '" y1="' + (dm.y - 7) + '" x2="' + (dm.x + 7) + '" y2="' + (dm.y + 7) + '" stroke="' + AMBER + '" stroke-width="4" stroke-linecap="round"/>'; }
          var sd = sel && (sel === id || sel === pid); o[1] += '<line x1="' + q.x + '" y1="' + q.y + '" x2="' + p.x + '" y2="' + p.y + '" stroke="' + (sd ? INK : SLATE) + '" stroke-width="' + (sd ? 2 : 1.1) + '" stroke-opacity="' + (sd ? 1 : .55) + '"' + (a.state === 'queued' ? ' stroke-dasharray="2 3"' : '') + '/>';
        });
        /* 04 routed wires: radial out, along a ring channel, radial in */
        var wi = 0;
        geo.ids.forEach(function (id) { var a = s.agents[id]; (a.dependsOn || []).forEach(function (dep) {
          if (!s.agents[dep] || !geo.pos[dep] || !geo.pos[id]) return; var pa = geo.pos[dep], pb = geo.pos[id]; var met = s.agents[dep].state === 'done';
          var rc = Math.max(pa.r, pb.r) + 16 + (wi % 3) * 6; rc = Math.min(rc, geo.rOut - 4); wi++;
          var a0 = pa.a, a1 = pb.a; if (Math.abs(a1 - a0) < 0.0001) a1 += 0.001; var A = P(pa.r, a0), B = P(pb.r, a1), A2 = P(rc, a0), B2 = P(rc, a1);
          var rel = sel && (sel === id || sel === dep);
          o[4] += '<path d="M' + A.x + ' ' + A.y + ' L' + A2.x + ' ' + A2.y + ' ' + arcLine(rc, a0, a1).replace(/^M[^A]*/, '') + ' L' + B.x + ' ' + B.y + '" fill="none" stroke="' + (met ? SLATE : INK) + '" stroke-width="' + (rel ? 2 : 1.2) + '" stroke-opacity="' + (rel ? .95 : met ? .4 : .7) + '"' + (met ? '' : ' stroke-dasharray="4 3"') + ' stroke-linejoin="round"/><circle cx="' + B.x + '" cy="' + B.y + '" r="2.2" fill="' + (met ? SLATE : INK) + '"/>';
        }); });
        /* 01 message beads (travel along a dotted arc) */
        s.messages.slice(-24).forEach(function (m) { if (!geo.pos[m.from] || !geo.pos[m.to]) return; var A = XY(m.from), B = XY(m.to); var mx = (A.x + B.x) / 2 + (geo.cx - (A.x + B.x) / 2) * 0.35, my = (A.y + B.y) / 2 + (geo.cy - (A.y + B.y) / 2) * 0.35; var age = T - m.t;
          o[1] += '<path d="M' + A.x + ' ' + A.y + ' Q' + mx + ' ' + my + ' ' + B.x + ' ' + B.y + '" fill="none" stroke="' + TEAL + '" stroke-width="1.2" stroke-dasharray="1.5 4" stroke-linecap="round" stroke-opacity="' + (age < 4000 ? .9 : .3) + '"/>';
          if (age >= 0 && age < 2400) { anim.push({ A: A, C: { x: mx, y: my }, B: B, m: m, born: m.t }); o[1] += '<circle class="co-bead" data-i="' + (anim.length - 1) + '" r="4" fill="' + TEAL + '" stroke="' + BG + '" stroke-width="1.5"/>'; }
        });
        /* hub */
        var pr = s.progress || 0; var hp = P(geo.hubR, 0);
        o[1] += '<circle cx="' + cx + '" cy="' + cy + '" r="' + geo.hubR + '" fill="' + BG + '" stroke="' + INK + '" stroke-width="1.6"/><path d="' + (pr > 0 ? arcLine(geo.hubR - 4, 0, Math.min(pr, .9999) * Math.PI * 2) : 'M0 0') + '" fill="none" stroke="' + (s.finished ? INK : TEAL) + '" stroke-width="5"/>';
        var rootA = s.agents[geo.root]; o[1] += '<text x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" class="co-t co-hub">' + (s.finished ? 'DONE' : Math.round(pr * 100) + '%') + '</text><text x="' + cx + '" y="' + (cy + 9) + '" text-anchor="middle" class="co-t co-dim">' + (s.finished ? 'RESULT' : 'TASK') + '</text>';
        var outsN = s.outputs.length; if (outsN) o[1] += '<g transform="translate(' + (cx + geo.hubR - 4) + ' ' + (cy - geo.hubR - 2) + ')"><rect x="-8" y="-9" width="16" height="18" rx="2" fill="#fff" stroke="' + TEAL + '" stroke-width="1.3"/><text y="4" text-anchor="middle" class="co-t" fill="' + TEAL + '" font-size="9">' + outsN + '</text></g>';
        o[1] += '<g class="co-node" tabindex="0" role="button" data-id="' + geo.root + '" aria-label="' + esc(rootA.name + ' ' + rootA.state) + '"><circle cx="' + cx + '" cy="' + cy + '" r="' + geo.hubR + '" fill="transparent" stroke="' + (sel === geo.root ? INK : 'none') + '" stroke-width="3"/></g>';
        /* nodes: main agents = cards (09) or dots; deeper = hexes (02) */
        var CW = 98, CH = 38;
        geo.ids.forEach(function (id) {
          if (id === geo.root) return; var a = s.agents[id], p = XY(id), dp = geo.depth[id], selD = sel === id, st = a.state;
          var tools = (a.tool && st === 'working' && T - (a.toolAt || 0) < Math.max(a.toolDuration || 0, 1800)) ? a.tool : null;
          var outs = a.outputs.length;
          if (dp === 1) {
            var inner = '';
            if (!hidden['09']) {
              var x = p.x - CW / 2, y = p.y - CH / 2, c = COL[st];
              var line2 = st === 'working' ? (tools || a.work || 'working') : st === 'blocked' ? 'needs approval' : st === 'failed' ? (a.attempt > 1 ? 'failed · try ' + a.attempt : 'failed') : st === 'waiting' ? 'waits: ' + (a.dependsOn || []).map(function (d2) { return s.agents[d2] ? (s.agents[d2].label || s.agents[d2].name) : d2; }).join(',') : st === 'done' ? 'done' : 'ready';
              var t0 = a.startedAt != null ? a.startedAt / span : null, t1 = a.startedAt != null ? ((a.endedAt != null ? a.endedAt : T) / span) : null;
              inner += '<rect x="' + x + '" y="' + y + '" width="' + CW + '" height="' + CH + '" rx="6" fill="' + (st === 'waiting' || st === 'queued' ? '#F6F4EE' : '#fff') + '" stroke="' + (selD ? INK : c) + '" stroke-width="' + (selD ? 2.6 : 1.5) + '"' + (st === 'waiting' ? ' stroke-dasharray="4 3"' : '') + '/><rect x="' + x + '" y="' + y + '" width="4" height="' + CH + '" rx="2" fill="' + c + '"/>' + glyph(st, x + 15, y + 12, 5.5) +
                '<text x="' + (x + 25) + '" y="' + (y + 15) + '" class="co-t co-card">' + esc(cut(a.name, 13)) + '</text><text x="' + (x + 25) + '" y="' + (y + 26) + '" class="co-t co-sub">' + esc(cut(line2, 15)) + '</text>';
              /* 07 mini lane inside the card */
              if (t0 != null) inner += '<rect x="' + (x + 8) + '" y="' + (y + CH - 6) + '" width="' + (CW - 16) + '" height="2.5" rx="1" fill="' + MIST + '" fill-opacity=".6"/><rect x="' + (x + 8 + t0 * (CW - 16)) + '" y="' + (y + CH - 6) + '" width="' + Math.max(2, (t1 - t0) * (CW - 16)) + '" height="2.5" rx="1" fill="' + c + '"/>';
              if (outs) inner += '<g transform="translate(' + (x + CW - 7) + ' ' + (y + 1) + ')"><rect x="-7" y="-6" width="13" height="15" rx="2" fill="#fff" stroke="' + TEAL + '" stroke-width="1.2"/><text y="4" x="-0.5" text-anchor="middle" class="co-t" fill="' + TEAL + '" font-size="8.5">' + outs + '</text></g>';
            } else inner += glyph(st, p.x, p.y, 8) + '<text x="' + p.x + '" y="' + (p.y + 20) + '" text-anchor="middle" class="co-t co-card">' + esc(cut(a.label || a.name, 8)) + '</text>';
            top += '<g class="co-node" tabindex="0" role="button" data-id="' + id + '" aria-label="' + esc(a.name + ', ' + st + (a.blockedReason ? ': ' + a.blockedReason : a.error ? ': ' + a.error : '')) + '">' + inner + '<rect x="' + (p.x - CW / 2 - 3) + '" y="' + (p.y - CH / 2 - 3) + '" width="' + (CW + 6) + '" height="' + (CH + 6) + '" fill="transparent"/></g>';
            if (tools) o[1] += '<g transform="translate(' + P(geo.pos[id].r + CH / 2 + 12, geo.pos[id].a).x + ' ' + P(geo.pos[id].r + CH / 2 + 12, geo.pos[id].a).y + ')"><rect x="-' + (cut(tools, 12).length * 3.3 + 6) + '" y="-8" width="' + (cut(tools, 12).length * 6.6 + 12) + '" height="15" rx="7" fill="#fff" stroke="' + TEAL + '"/><text text-anchor="middle" y="3" class="co-t" fill="' + TEAL + '" font-size="9">' + esc(cut(tools, 12)) + '</text></g>';
          } else {
            var inner2 = '';
            if (!hidden['02']) inner2 += '<polygon points="' + hex(p.x, p.y, 11) + '" fill="' + (st === 'waiting' || st === 'queued' ? BG : TINT[st] === 'none' ? BG : '#fff') + '" stroke="' + (selD ? INK : COL[st]) + '" stroke-width="' + (selD ? 2.6 : 1.5) + '"' + (st === 'waiting' ? ' stroke-dasharray="3 2.5"' : '') + '/>' + glyph(st, p.x, p.y, 3.6);
            else inner2 += glyph(st, p.x, p.y, 5);
            inner2 += '<text x="' + p.x + '" y="' + (p.y + 22) + '" text-anchor="middle" class="co-t co-sub">' + esc(cut(a.label || a.name, 7)) + '</text>';
            if (outs) inner2 += '<rect x="' + (p.x + 8) + '" y="' + (p.y - 15) + '" width="8" height="10" rx="1.5" fill="#fff" stroke="' + TEAL + '" stroke-width="1"/>';
            top += '<g class="co-node" tabindex="0" role="button" data-id="' + id + '" aria-label="' + esc(a.name + ', ' + st) + '">' + inner2 + '<circle cx="' + p.x + '" cy="' + p.y + '" r="14" fill="transparent"/></g>';
            if (tools) o[1] += '<text x="' + p.x + '" y="' + (p.y - 15) + '" text-anchor="middle" class="co-t" fill="' + TEAL + '" font-size="9">' + esc(cut(tools, 10)) + '</text>';
          }
          /* callouts: reasons live next to the agent */
          if (st === 'blocked' || st === 'failed') { var why = st === 'blocked' ? a.blockedReason : a.error; var pp = P(geo.pos[id].r + (dp === 1 ? CH / 2 + 30 : 28), geo.pos[id].a); var txt = (st === 'blocked' ? '⏸ ' : '✕ ') + cut(why, 30); var wpx = txt.length * 5.6 + 14;
            var bx = Math.max(6, Math.min(W - wpx - 6, pp.x - wpx / 2)), by = Math.max(10, Math.min(H - 24, pp.y - 8));
            top += '<g class="co-call"><rect x="' + bx + '" y="' + by + '" width="' + wpx + '" height="17" rx="8.5" fill="' + (st === 'blocked' ? AMBER : RUST) + '"/><text x="' + (bx + wpx / 2) + '" y="' + (by + 12) + '" text-anchor="middle" class="co-t" fill="#fff" font-size="10">' + esc(txt) + '</text></g>'; }
        });
        /* 10 matrix inset */
        var n = geo.ids.length;
        if (n <= 30) {
          var cs = Math.max(4, Math.min(10, Math.floor(118 / n))), mw = cs * n, mx0 = W - mw - 18, my0 = H - mw - 30; var M = {}; s.messages.forEach(function (m) { var k2 = m.from + '>' + m.to; M[k2] = (M[k2] || 0) + 1; });
          o[10] += '<text x="' + mx0 + '" y="' + (my0 - 8) + '" class="co-t co-dim">MESSAGES  row → col</text><rect x="' + (mx0 - 3) + '" y="' + (my0 - 3) + '" width="' + (mw + 6) + '" height="' + (mw + 6) + '" rx="4" fill="#fff" fill-opacity=".6" stroke="' + MIST + '"/>';
          geo.ids.forEach(function (ri, i) { geo.ids.forEach(function (ci, j) { var x = mx0 + j * cs, y = my0 + i * cs, cnt = M[ri + '>' + ci] || 0; var del = s.delegations.some(function (d3) { return d3.from === ri && d3.to === ci; });
            if (i === j) o[10] += '<rect x="' + x + '" y="' + y + '" width="' + cs + '" height="' + cs + '" fill="' + COL[s.agents[ri].state] + '" fill-opacity=".9"/>';
            else if (cnt) o[10] += '<rect x="' + x + '" y="' + y + '" width="' + cs + '" height="' + cs + '" fill="' + TEAL + '" fill-opacity="' + Math.min(1, .35 + cnt * .2) + '"/>';
            else if (del) o[10] += '<rect x="' + (x + .5) + '" y="' + (y + .5) + '" width="' + (cs - 1) + '" height="' + (cs - 1) + '" fill="none" stroke="' + INK + '" stroke-opacity=".5"/>'; }); });
        }
        var out = ''; ['03', '08', '06', '07', '05', '04', '01', '02', '09', '10'].forEach(function (key) { var gk = key === '02' || key === '09' ? '' : '<g class="L' + key + '">' + o[parseInt(key, 10)] + '</g>'; out += gk; });
        out += '<g class="L09">' + top + '</g>'; /* nodes carry both 02 hexes and 09 cards; each inner part honours its own toggle */
        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.innerHTML = out; applyHidden(); if (hidden['02'] && hidden['09']) { /* both off: dots only, still selectable */ }
      }

      function frame(dt, now, s) {
        if (!anim.length || ctx.reducedMotion()) return; var T = ctx.state().t;
        [].forEach.call(svg.querySelectorAll('.co-bead'), function (b) { var a = anim[+b.dataset.i]; if (!a) return; var u = Math.min(1, Math.max(0, (T - a.born) / 2000)), m = 1 - u; b.setAttribute('cx', (m * m * a.A.x + 2 * m * u * a.C.x + u * u * a.B.x).toFixed(1)); b.setAttribute('cy', (m * m * a.A.y + 2 * m * u * a.C.y + u * u * a.B.y).toFixed(1)); });
      }
      function sigOf(s) { var x = [s.order.length, s.messages.length, s.outputs.length, s.log.length, s.finished ? 1 : 0, sel, Math.floor(s.t / 250), Math.round(s.progress * 100)].join('|'); s.order.forEach(function (id) { var a = s.agents[id]; x += '|' + a.state + (a.tool || '') + a.attempt; }); return x; }
      function update(s) { var sg = sigOf(s); if (sg === lastSig) return; var now = performance.now(); if (now - lastBuild < 90 && s.order.length > 0 && sg.split('|').slice(0, 5).join() === lastSig.split('|').slice(0, 5).join() && !ctx.state().finished) { return; } lastSig = sg; lastBuild = now; build(s); }
      svg.addEventListener('click', function (e) { var n = e.target.closest && e.target.closest('.co-node'); if (n) ctx.select(n.dataset.id); });
      svg.addEventListener('keydown', function (e) { if (e.key !== 'Enter' && e.key !== ' ') return; var n = e.target.closest && e.target.closest('.co-node'); if (n) { e.preventDefault(); e.stopPropagation(); ctx.select(n.dataset.id); } });
      return {
        update: update, frame: frame, onSelect: function (id) { sel = id; lastSig = ''; update(ctx.state()); }, onReset: function () { lastSig = ''; anim = []; },
        resize: function (z) { if (z && z.w > 50 && z.h > 50) { W = z.w; H = z.h; svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); lastSig = ''; update(ctx.state()); } }
      };
    }
  });
})(window);
