/* 06 Floorplan: an office with the plumbing showing.
 *
 * Everything drawn is derived from the accumulated state (and state.t), never from unplayed events:
 *   rooms      = workstreams derived from parent/dependency shape (see derive())
 *   desks      = one per spawned agent (pop-in is a function of state.t - spawnedAt)
 *   edges      = delegations (solid), dependencies (dashed), messages (dotted green + envelope)
 *   documents  = piles on the producing desk; fly to the OUTBOX once state.finished
 * The only wall-clock animation is the final flight of documents to the outbox and layout easing.
 */
AgentChrome.mount({
  id: '06', name: 'Floorplan', tagline: 'An office, with the plumbing showing.',
  create: function (stage, ctx) {
    var core = ctx.core, U = core.util, C = core.COLORS;
    var NS = 'http://www.w3.org/2000/svg';
    var ROOMFILL = '#F3F1EA', DESKFILL = '#E7E5DD', DARKAMBER = '#9A6406';
    var W = 960, H = 600, KEYH = 26, MARGIN = 14, GAP = 14;
    var CW = 132, BLOCK_TXT = 52, BLOCK_FIG = 66;       // base desk cell (width, text zone, figure zone)
    var MSG_MS = 1700, POP_MS = 380, DELEG_MS = 650;     // sim-clock animation lengths
    var FLY_MS = 520, FLY_TOTAL = 1000;                  // wall-clock flight of documents (own clock)

    /* ------------------------------------------------------------ svg helpers */
    function set(el, o) {
      var c = el.__c || (el.__c = {});
      for (var k in o) { var v = o[k]; if (c[k] !== v) { c[k] = v; if (k === 'text') el.textContent = v; else if (v == null) el.removeAttribute(k); else el.setAttribute(k, v); } }
      return el;
    }
    function mk(name, attrs, parent) { var e = document.createElementNS(NS, name); if (attrs) set(e, attrs); if (parent) parent.appendChild(e); return e; }
    function Pool(parent, factory) { this.m = {}; this.parent = parent; this.f = factory; }
    Pool.prototype.get = function (k) { var e = this.m[k]; if (!e) { e = this.f(this.parent, k); this.m[k] = e; } e.__seen = true; return e; };
    Pool.prototype.sweep = function () { for (var k in this.m) { var e = this.m[k]; if (!e.__seen) { e.root.remove(); delete this.m[k]; } else e.__seen = false; } };
    function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
    function wrap(text, maxChars, maxLines) {
      var words = String(text || '').split(/\s+/), lines = [], cur = '';
      for (var i = 0; i < words.length; i++) {
        var w = words[i]; if (w.length > maxChars) w = w.slice(0, maxChars - 1) + '…';
        if (!cur) cur = w; else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w; else { lines.push(cur); cur = w; }
      }
      if (cur) lines.push(cur);
      if (lines.length > maxLines) { lines = lines.slice(0, maxLines); var l = lines[maxLines - 1]; lines[maxLines - 1] = (l.length >= maxChars ? l.slice(0, maxChars - 1) : l) + '…'; }
      return lines;
    }

    /* ------------------------------------------------------------ svg skeleton */
    var svg = mk('svg', { 'class': 'fp', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet' }, stage);
    var gRooms = mk('g', null, svg), gDeleg = mk('g', null, svg), gDeps = mk('g', null, svg), gMsgs = mk('g', null, svg),
      gDesks = mk('g', null, svg), gOver = mk('g', null, svg), gKey = mk('g', null, svg);

    /* ------------------------------------------------------------ state kept between frames */
    var rooms = [], roomOf = {}, layoutSig = '', roomEls = {}, desks = {}, clock = 0, flightStart = null, wasFinished = false, needSnap = true;
    var easeK = 0;
    var delegPool = new Pool(gDeleg, function (p) { var e = mk('path', { 'class': 'deleg', fill: 'none', 'stroke-linecap': 'round' }, p); return { root: e, el: e }; });
    var depPool = new Pool(gDeps, function (p) {
      var g = mk('g', null, p), e = mk('path', { fill: 'none' }, g), ar = mk('path', { d: 'M-5 -4 L2 0 L-5 4', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
      return { root: g, el: e, arrow: ar };
    });
    var msgPool = new Pool(gMsgs, function (p) { var e = mk('path', { fill: 'none', 'stroke-linecap': 'round' }, p); var t = mk('title', null, e); return { root: e, el: e, title: t }; });
    var envPool = new Pool(gMsgs, function (p) {
      var g = mk('g', null, p);
      mk('rect', { x: -8, y: -5.5, width: 16, height: 11, rx: 2, fill: '#fff', stroke: C.acc, 'stroke-width': 1.6 }, g);
      mk('path', { d: 'M-7.5 -4.5 L0 1.5 L7.5 -4.5', fill: 'none', stroke: C.acc, 'stroke-width': 1.4, 'stroke-linejoin': 'round' }, g);
      return { root: g };
    });
    var envTxtPool = new Pool(gOver, function (p) { var t = mk('text', { 'class': 'msg-t hl', 'text-anchor': 'middle' }, p); return { root: t, text: t }; });
    var docPool = new Pool(gOver, function (p) { var d = docGlyph(p); return { root: d.g, d: d }; });

    /* ------------------------------------------------------------ document glyph */
    function docGlyph(parent) {
      var g = mk('g', null, parent);
      var page = mk('path', { d: 'M0 0 H9 L13 4 V17 H0 Z', fill: '#fff', stroke: C.acc, 'stroke-width': 1.3, 'stroke-linejoin': 'round' }, g);
      mk('path', { d: 'M9 0 V4 H13', fill: 'none', stroke: C.acc, 'stroke-width': 1.1, 'stroke-linejoin': 'round' }, g);
      var mark = mk('path', { fill: 'none', stroke: C.acc, 'stroke-width': 1.2, 'stroke-linecap': 'round' }, g);
      var title = mk('title', null, g);
      return {
        g: g, page: page, title: title,
        kind: function (k, name) {
          set(mark, { d: k === 'patch' ? 'M3 8 h5 M5.5 5.5 v5 M3 13.5 h5' : k === 'report' ? 'M3 14 v-3 M6.5 14 v-6 M10 14 v-4' : k === 'release' ? 'M3.5 6 h6 l-1.5 2.5 l1.5 2.5 h-6 z' : 'M3 8 h7 M3 11 h7 M3 14 h4' });
          set(title, { text: name || k });
        }
      };
    }

    /* ------------------------------------------------------------ derive rooms from state */
    function derive(s) {
      var A = s.agents, ids = s.order, idx = {}, i;
      ids.forEach(function (id, n) { idx[id] = n; });
      function isRoot(id) { var a = A[id]; return !a.parentId || !A[a.parentId]; }
      function mainOf(id) {
        var a = A[id], g = 0;
        while (a.parentId && A[a.parentId] && g++ < 60) { var p = A[a.parentId]; if (isRoot(p.id)) return a.id; a = p; }
        return a.id;
      }
      var hasDependents = {};
      s.dependencies.forEach(function (d) { hasDependents[d.from] = true; });
      var mains = ids.filter(function (id) { return !isRoot(id) && isRoot(A[id].parentId); });
      var roomOfMain = {}, visiting = {};
      function assign(mid) {
        if (roomOfMain[mid]) return roomOfMain[mid];
        var a = A[mid];
        if (visiting[mid]) return mid;
        visiting[mid] = true;
        var key;
        if (a.children.length) key = mid;                                      // a main agent with a subtree owns a room
        else {
          var deps = a.dependsOn.filter(function (d) { return A[d]; });
          if (!deps.length) key = 'command';                                   // no prerequisites: sits beside the orchestrator
          else if (!hasDependents[mid]) key = 'dock';                          // nothing downstream: it delivers the result
          else {
            var set1 = {}, list = [];
            deps.forEach(function (d) { var m = mainOf(d), r = isRoot(m) ? 'command' : assign(m); if (r !== 'command' && r !== 'dock' && !set1[r]) { set1[r] = 1; list.push(r); } });
            key = list.length === 1 ? list[0] : mid;                           // fed by exactly one room: join it; else start a new stage
          }
        }
        visiting[mid] = false; roomOfMain[mid] = key; return key;
      }
      mains.forEach(assign);
      var map = { command: { key: 'command', kind: 'command', title: 'COMMAND', members: [] }, dock: { key: 'dock', kind: 'dock', title: 'DOCK', members: [] } };
      var order = ['command'];
      var headOf = {};
      mains.forEach(function (m) { var k = roomOfMain[m]; if (k !== 'command' && k !== 'dock' && !map[k]) { map[k] = { key: k, kind: 'stream', title: (A[k].name || A[k].label).toUpperCase(), members: [] }; order.push(k); } });
      order.push('dock');
      var roomKeyOf = {};
      ids.forEach(function (id) {
        var key;
        if (isRoot(id)) key = 'command';
        else key = roomOfMain[mainOf(id)] || 'command';
        roomKeyOf[id] = key;
      });
      // members: head first, then its descendants by spawn order, then attached leaf mains
      function rank(id) { // head 0, descendants of head 1, attached mains 2
        var key = roomKeyOf[id]; if (id === key) return 0; return mainOf(id) === key ? 1 : 2;
      }
      ids.forEach(function (id) { map[roomKeyOf[id]].members.push(id); });
      Object.keys(map).forEach(function (k) {
        var r = map[k];
        if (r.kind === 'stream') r.members.sort(function (a, b) { return rank(a) - rank(b) || idx[a] - idx[b]; });
        else if (r.kind === 'command') r.members.sort(function (a, b) { return (isRoot(b) ? 1 : 0) - (isRoot(a) ? 1 : 0) || idx[a] - idx[b]; });
      });
      var list2 = order.map(function (k) { return map[k]; });
      var of = {}; list2.forEach(function (r) { r.members.forEach(function (id) { of[id] = r.key; }); });
      return { rooms: list2, roomOf: of };
    }

    /* ------------------------------------------------------------ layout */
    function deskFit(n, w, h) {
      var best = null;
      for (var c = 1; c <= Math.max(1, n); c++) {
        var r = Math.ceil(n / c), cw = w / c, ch = h / r;
        var sc = Math.min(1, cw / CW, (ch - BLOCK_TXT) / BLOCK_FIG);
        if (sc < 0.45) sc = Math.max(sc, 0.45 * 0 + sc);
        if (!best || sc > best.s + 1e-6 || (Math.abs(sc - best.s) < 1e-6 && r < best.rows)) best = { cols: c, rows: r, s: sc, cw: cw, ch: ch };
      }
      return best || { cols: 1, rows: 1, s: 1, cw: w, ch: h };
    }
    function roomInner(r, w, h) {
      var inner = { x: 10, y: 36, w: w - 20, h: h - 46 }, outH = 0;
      if (r.kind === 'dock') { outH = U.clamp(inner.h * 0.44, 74, 170); }
      return { x: inner.x, y: inner.y, w: inner.w, h: inner.h - (outH ? outH + 8 : 0), outH: outH };
    }
    function scoreGrid(list, cols, rows, avW, avH) {
      var cw = (avW - (cols - 1) * GAP) / cols, ch = (avH - (rows - 1) * GAP) / rows, mn = 9, sum = 0;
      list.forEach(function (r) {
        var ri = roomInner(r, cw, ch), f = deskFit(Math.max(1, r.members.length), ri.w, ri.h);
        mn = Math.min(mn, f.s); sum += f.s;
      });
      var asp = Math.abs(Math.log((cw / ch) / 1.25));          // prefer rooms close to a landscape office, not tall corridors
      return mn * 10 + sum / list.length - (cols * rows - list.length) * 0.15 - asp * 1.2;
    }
    function computeLayout() {
      var n = rooms.length, avW = W - 2 * MARGIN, avH = H - 2 * MARGIN - KEYH, best = null;
      for (var c = 1; c <= n; c++) {
        var r = Math.ceil(n / c), sc = scoreGrid(rooms, c, r, avW, avH);
        if (!best || sc > best.sc + 1e-6) best = { cols: c, rows: r, sc: sc };
      }
      var rows = best.rows, per = [], base = Math.floor(n / rows), extra = n % rows;
      for (var i = 0; i < rows; i++) per.push(base + (i < extra ? 1 : 0));
      var rowH = (avH - (rows - 1) * GAP) / rows, k = 0, out = {};
      for (var rr = 0; rr < rows; rr++) {
        var cnt = per[rr], list = rooms.slice(k, k + cnt); k += cnt;
        var wts = list.map(function (r) { return Math.max(2, r.members.length) + 1; }), tot = wts.reduce(function (a, b) { return a + b; }, 0);
        var x = MARGIN, avail = avW - (cnt - 1) * GAP;
        list.forEach(function (room, ci) {
          var w = avail * wts[ci] / tot, y = MARGIN + rr * (rowH + GAP);
          var ri = roomInner(room, w, rowH), f = deskFit(Math.max(1, room.members.length), ri.w, ri.h), L = { x: x, y: y, w: w, h: rowH, desks: {}, fit: f };
          var mem = room.members, nn = mem.length;
          var blockH = BLOCK_FIG * f.s + BLOCK_TXT;
          mem.forEach(function (id, mi) {
            var col = mi % f.cols, row = Math.floor(mi / f.cols), inRow = Math.min(f.cols, nn - row * f.cols);
            var off = (f.cols - inRow) * f.cw / 2;
            L.desks[id] = { cx: x + ri.x + off + (col + 0.5) * f.cw, top: y + ri.y + row * f.ch + Math.max(0, (f.ch - blockH) / 2), s: f.s, cw: f.cw };
          });
          if (ri.outH) L.outbox = { x: x + ri.x, y: y + ri.y + ri.h + 8, w: ri.w, h: ri.outH };
          out[room.key] = L; x += w + GAP;
        });
      }
      return out;
    }

    /* ------------------------------------------------------------ rooms */
    var tgtRooms = {}, curRooms = {};
    function ensureRoom(key) {
      var e = roomEls[key]; if (e) return e;
      var g = mk('g', null, gRooms);
      e = { g: g, rect: mk('rect', { rx: 12, fill: ROOMFILL, 'stroke-width': 2.2 }, g), title: mk('text', { 'class': 'room-title' }, g), count: mk('text', { 'class': 'room-count', 'text-anchor': 'end' }, g),
        barBg: mk('rect', { rx: 2, height: 4, fill: '#D3D2CA' }, g), bar: mk('rect', { rx: 2, height: 4, fill: C.acc }, g),
        box: mk('rect', { rx: 8, 'stroke-width': 1.8 }, g), boxT: mk('text', { 'class': 'box-t' }, g), boxS1: mk('text', { 'class': 'box-s' }, g), boxS2: mk('text', { 'class': 'box-s' }, g) };
      roomEls[key] = e; return e;
    }

    /* ------------------------------------------------------------ desks */
    function ensureDesk(id) {
      var d = desks[id]; if (d) return d;
      var g = mk('g', { 'class': 'agent', tabindex: 0, role: 'button' }, gDesks);
      d = { id: id, g: g };
      d.plate = mk('rect', { 'class': 'plate', rx: 10, fill: 'rgba(31,138,122,0)', stroke: 'rgba(0,0,0,0)', 'stroke-width': 2.4 }, g);
      d.focus = mk('rect', { 'class': 'focus', rx: 10, fill: 'none', stroke: C.ink, 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, g);
      d.A = mk('g', null, g);
      d.halo = mk('circle', { cx: 0, cy: 17, r: 19, fill: 'none', 'stroke-width': 1.6 }, d.A);
      d.hand = mk('g', { transform: 'translate(24 15) scale(1.3) translate(-24 -15)', fill: 'none', stroke: C.amber, 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, d.A);
      mk('path', { d: 'M15 38 Q22 32 24 20' }, d.hand); mk('circle', { cx: 24, cy: 15, r: 4.4, fill: '#F6E7C4' }, d.hand); mk('path', { d: 'M21.5 10.5 v-4.5 M24 10 v-5.5 M26.5 10.5 v-4.5', 'stroke-width': 1.7 }, d.hand);
      d.body = mk('path', { d: 'M-17 44 Q-17 31 0 31 Q17 31 17 44 Z', 'stroke-width': 1.6 }, d.A);
      d.head = mk('circle', { cx: 0, cy: 17, r: 11, 'stroke-width': 1.8 }, d.A);
      d.glyph = mk('path', { fill: 'none', stroke: '#fff', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, d.A);
      d.desk = mk('rect', { x: -42, y: 40, width: 84, height: 24, rx: 5, 'stroke-width': 1.8 }, d.A);
      d.dots = [-10, 0, 10].map(function (x) { return mk('circle', { cx: x, cy: 52, r: 2.5, fill: C.acc }, d.A); });
      d.retry = mk('g', { fill: 'none', stroke: C.rust, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, d.A);
      d.retryArc = mk('path', { d: 'M-30 24 A8 8 0 1 1 -24 28 M-24 28 l0 -5 M-24 28 l5 -1' }, d.retry);
      d.retryTxt = mk('text', { x: -37, y: 19, 'font-size': 10, 'font-weight': 700, fill: C.rust, stroke: 'none', 'text-anchor': 'middle' }, d.retry);
      d.pile = mk('g', null, d.A);
      d.docs = [0, 1, 2, 3].map(function () { var dg = docGlyph(d.pile); return dg; });
      d.more = mk('text', { x: 48, y: 58, 'font-size': 10, 'font-weight': 700, fill: '#0f5d52' }, d.pile);
      d.B = mk('g', null, g);
      d.label = mk('text', { 'class': 'dlabel hl', x: 0, y: 12 }, d.B);
      d.sub = mk('text', { 'class': 'dsub hl', x: 0, y: 25 }, d.B);
      d.chipR = mk('rect', { rx: 5, height: 17, fill: ROOMFILL, stroke: C.acc, 'stroke-width': 1.3 }, d.B);
      d.chipT = mk('text', { 'class': 'chip-t', x: 0, y: 36 }, d.B);
      d.callR = mk('rect', { rx: 5 }, d.B);
      d.callT = [mk('text', { 'class': 'call-t', x: 0 }, d.B), mk('text', { 'class': 'call-t', x: 0 }, d.B)];
      d.title = mk('title', null, g);
      d.hit = mk('rect', { fill: 'transparent' }, g);
      g.addEventListener('click', function () { ctx.select(id); });
      g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); ctx.select(id); } });
      d.cur = null; desks[id] = d; return d;
    }

    function unmetDeps(s, a) { return a.dependsOn.filter(function (id) { return s.agents[id] && s.agents[id].state !== 'done'; }); }

    function renderDesk(d, s, a, tg, nowSel, related) {
      var reduced = ctx.reducedMotion();
      var cur = d.cur, sub = a.parentId && s.agents[a.parentId] && s.agents[a.parentId].parentId ? 0.88 : 1;
      var sT = tg.s * sub;
      if (!cur || needSnap || reduced) cur = d.cur = { cx: tg.cx, top: tg.top, s: sT };
      else { cur.cx += (tg.cx - cur.cx) * easeK; cur.top += (tg.top - cur.top) * easeK; cur.s += (sT - cur.s) * easeK; }
      sT = cur.s;
      var pop = reduced ? 1 : U.ease(clamp01((s.t - a.spawnedAt) / POP_MS)), blockH = BLOCK_FIG * tg.s + BLOCK_TXT;
      var st = a.state, col = st === 'working' ? C.acc : st === 'done' ? C.ink : st === 'blocked' ? C.amber : st === 'failed' ? C.rust : C.ink;
      var textCol = st === 'blocked' ? DARKAMBER : st === 'failed' ? C.rust : C.ink;
      set(d.g, { transform: 'translate(' + cur.cx.toFixed(1) + ' ' + (cur.top + blockH / 2).toFixed(1) + ') scale(' + (0.7 + 0.3 * pop).toFixed(3) + ') translate(0 ' + (-blockH / 2).toFixed(1) + ')', opacity: pop.toFixed(2),
        'aria-label': a.name + ', ' + U.stateWord(a) + (a.outputs.length ? ', ' + a.outputs.length + ' documents' : '') });
      var cwp = tg.cw - 4, hw = cwp / 2;
      set(d.plate, { x: -hw, y: -4, width: cwp, height: blockH + 4, fill: nowSel ? 'rgba(31,138,122,.10)' : related ? 'rgba(31,138,122,.05)' : 'rgba(31,138,122,0)', stroke: nowSel ? C.acc : related ? 'rgba(31,138,122,.45)' : 'rgba(0,0,0,0)', 'stroke-dasharray': related && !nowSel ? '3 3' : null });
      set(d.focus, { x: -hw - 2, y: -6, width: cwp + 4, height: blockH + 8 });
      set(d.hit, { x: -hw, y: -4, width: cwp, height: blockH + 4 });
      set(d.A, { transform: 'scale(' + sT.toFixed(3) + ')' });
      // figure
      var empty = st === 'waiting' || st === 'queued';
      set(d.head, { fill: empty ? ROOMFILL : col, stroke: empty ? (st === 'waiting' ? C.ink : C.mist) : col, 'stroke-dasharray': st === 'waiting' ? '3.5 3' : null });
      set(d.body, { fill: empty ? ROOMFILL : col, 'fill-opacity': empty ? 1 : 0.22, stroke: empty ? (st === 'waiting' ? C.ink : C.mist) : col, 'stroke-dasharray': st === 'waiting' ? '3.5 3' : null, 'stroke-opacity': empty ? 1 : 0.55 });
      set(d.halo, { stroke: col, 'stroke-opacity': st === 'working' || st === 'blocked' ? 0.4 : 0, 'stroke-width': 1.6 });
      set(d.glyph, { d: st === 'done' ? 'M-5 17.5 l3.6 3.6 l7 -8' : st === 'failed' ? 'M-4.5 12.5 l9 9 M4.5 12.5 l-9 9' : '', opacity: st === 'done' || st === 'failed' ? 1 : 0 });
      set(d.hand, { opacity: st === 'blocked' ? 1 : 0 });
      set(d.desk, { fill: DESKFILL, stroke: st === 'working' ? C.acc : st === 'blocked' ? C.amber : st === 'failed' ? C.rust : st === 'done' ? '#7e8b90' : C.mist, 'stroke-dasharray': null });
      var typing = st === 'working', ph = Math.floor(s.t / 170) % 3;
      d.dots.forEach(function (dot, i) { set(dot, { opacity: typing ? (reduced ? 0.9 : (i === ph ? 1 : 0.3)) : 0 }); });
      var showRetry = st === 'failed' || a.attempt > 1;
      set(d.retry, { opacity: showRetry ? 1 : 0, stroke: st === 'failed' ? C.rust : C.slate });
      set(d.retryArc, { 'stroke-dasharray': st === 'failed' ? '3 2.5' : null });
      set(d.retryTxt, { text: a.attempt > 1 ? String(a.attempt) : '', fill: st === 'failed' ? C.rust : C.slate });
      // documents pile (only those that have not flown to the outbox yet)
      var onDesk = a.outputs.filter(function (oid) { return fliedFrac(s, oid) <= 0; });
      var shown = onDesk.slice(-4);
      d.docs.forEach(function (dg, i) {
        var oid = shown[i];
        if (!oid) { set(dg.g, { opacity: 0 }); return; }
        var o = outputById(s, oid);
        dg.kind(o ? o.kind : 'doc', o ? o.name : oid);
        var tidy = st === 'done', rot = tidy ? 0 : (i % 2 ? 5 : -4);
        set(dg.g, { opacity: 1, transform: 'translate(' + (49 + i * 3.4) + ' ' + (34 - i * 3.6) + ') rotate(' + rot + ' 6 8)' });
      });
      set(d.more, { text: onDesk.length > 4 ? '+' + (onDesk.length - 4) : '' });
      // text zone (physical size)
      var by = BLOCK_FIG * sT + 2;
      set(d.B, { transform: 'translate(0 ' + by.toFixed(1) + ')' });
      set(d.label, { text: a.label, fill: textCol });
      var maxChars = Math.max(10, Math.floor((cwp - 8) / 6.4));
      var subText = '';
      if (st === 'waiting') { var um = unmetDeps(s, a).map(function (id) { return s.agents[id].label; }); subText = 'waits: ' + um.slice(0, 2).join(', ') + (um.length > 2 ? ' +' + (um.length - 2) : ''); }
      else if (st === 'queued') subText = 'ready';
      set(d.sub, { text: subText.length > maxChars + 2 ? subText.slice(0, maxChars) + '…' : subText });
      // chip / callout
      var chipTxt = '';
      if (st === 'working' && a.tool && a.toolAt != null && s.t - a.toolAt < Math.max(a.toolDuration || 0, 700) + 500 && s.t >= a.toolAt) chipTxt = a.tool.length > maxChars - 2 ? a.tool.slice(0, maxChars - 3) + '…' : a.tool;
      var cw = chipTxt.length * 6.4 + 14;
      set(d.chipR, { x: -cw / 2, y: 20, width: cw, opacity: chipTxt ? 1 : 0 });
      set(d.chipT, { text: chipTxt, y: 32.5, opacity: chipTxt ? 1 : 0 });
      var callText = st === 'blocked' ? (a.blockedReason || (a.needs ? 'needs ' + a.needs : 'blocked')) : st === 'failed' ? (a.error || 'failed') : '';
      var lines = callText ? wrap(callText, maxChars, st === 'failed' ? 2 : 2) : [];
      if (st === 'failed' && lines.length) { var ll = lines[lines.length - 1]; if (lines.length < 2 && ll.length + 8 <= maxChars) lines[lines.length - 1] = ll + ' · RETRY'; else if (lines.length < 2) lines.push('↻ RETRY'); }
      var maxLen = 0; lines.forEach(function (l) { maxLen = Math.max(maxLen, l.length); });
      var rw = maxLen * 6.4 + 12, rh = lines.length * 13 + 5;
      set(d.callR, { x: -rw / 2, y: 20, width: rw, height: rh, fill: st === 'failed' ? C.rust : DARKAMBER, opacity: lines.length ? 1 : 0 });
      d.callT.forEach(function (t, i) { set(t, { text: lines[i] || '', y: 33 + i * 13, opacity: lines[i] ? 1 : 0 }); });
      set(d.title, { text: a.name + ' · ' + U.stateWord(a) + (a.work ? ' · ' + a.work : '') });
      // anchor for edges (stage coords)
      d.ax = cur.cx; d.ay = cur.top + 28 * sT * (0.7 + 0.3 * pop) + 0; d.pileX = cur.cx + 52 * sT; d.pileY = cur.top + 30 * sT; d.pop = pop;
    }

    function outputById(s, id) { for (var i = 0; i < s.outputs.length; i++) if (s.outputs[i].id === id) return s.outputs[i]; return null; }

    /* flight progress of a final output toward the outbox (wall clock, own clock) */
    function fliedFrac(s, oid) {
      if (!s.finished || !s.finishedInfo) return 0;
      var ids = s.finishedInfo.outputIds, i = ids.indexOf(oid); if (i < 0) return 0;
      if (ctx.reducedMotion() || flightStart == null) return 1;
      var n = ids.length, stag = n > 1 ? Math.min(70, (FLY_TOTAL - FLY_MS) / (n - 1)) : 0;
      return clamp01((clock - flightStart - i * stag) / FLY_MS);
    }

    /* ------------------------------------------------------------ geometry for edges */
    function curve(a, b, bend) {
      var dx = b.x - a.x, dy = b.y - a.y, dist = Math.sqrt(dx * dx + dy * dy) || 1;
      var mx = (a.x + b.x) / 2 + (-dy / dist) * bend * dist, my = (a.y + b.y) / 2 + (dx / dist) * bend * dist;
      return { a: a, c: { x: mx, y: my }, b: b, d: 'M' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) + ' Q' + mx.toFixed(1) + ' ' + my.toFixed(1) + ' ' + b.x.toFixed(1) + ' ' + b.y.toFixed(1) };
    }
    function at(cv, t) { var u = 1 - t; return { x: u * u * cv.a.x + 2 * u * t * cv.c.x + t * t * cv.b.x, y: u * u * cv.a.y + 2 * u * t * cv.c.y + t * t * cv.b.y }; }
    function tan(cv, t) { var u = 1 - t; var dx = 2 * u * (cv.c.x - cv.a.x) + 2 * t * (cv.b.x - cv.c.x), dy = 2 * u * (cv.c.y - cv.a.y) + 2 * t * (cv.b.y - cv.c.y); return Math.atan2(dy, dx) * 180 / Math.PI; }

    /* ------------------------------------------------------------ main render */
    function render(s) {
      var reduced = ctx.reducedMotion(), sel = ctx.selected();
      var relDesks = {};
      if (sel) {
        s.delegations.forEach(function (e) { if (e.from === sel) relDesks[e.to] = 1; if (e.to === sel) relDesks[e.from] = 1; });
        s.dependencies.forEach(function (e) { if (e.from === sel) relDesks[e.to] = 1; if (e.to === sel) relDesks[e.from] = 1; });
        s.messages.forEach(function (e) { if (e.from === sel) relDesks[e.to] = 1; if (e.to === sel) relDesks[e.from] = 1; });
      }
      var Ls = tgtRooms, pct = Math.round(s.progress * 100);
      // rooms
      var seenRoom = {};
      rooms.forEach(function (room) {
        var L = Ls[room.key]; if (!L) return; seenRoom[room.key] = 1;
        var e = ensureRoom(room.key), cr = curRooms[room.key];
        if (!cr || needSnap || reduced) cr = curRooms[room.key] = { x: L.x, y: L.y, w: L.w, h: L.h };
        else { cr.x += (L.x - cr.x) * easeK; cr.y += (L.y - cr.y) * easeK; cr.w += (L.w - cr.w) * easeK; cr.h += (L.h - cr.h) * easeK; }
        var done = 0, blocked = 0, failed = 0, working = 0;
        room.members.forEach(function (id) { var st = s.agents[id].state; if (st === 'done') done++; else if (st === 'blocked') blocked++; else if (st === 'failed') failed++; else if (st === 'working') working++; });
        var alive = room.kind === 'dock' || room.kind === 'command' || room.members.length > 0;
        set(e.g, { opacity: alive ? 1 : 0 });
        set(e.rect, { x: cr.x, y: cr.y, width: cr.w, height: cr.h, stroke: failed ? C.rust : blocked ? C.amber : C.ink });
        var title = room.kind === 'command' ? 'COMMAND · ' + pct + '%' : room.title;
        set(e.title, { x: cr.x + 14, y: cr.y + 21, text: title, 'font-size': cr.w < 150 ? 10.5 : null, 'letter-spacing': cr.w < 150 ? '.03em' : null });
        var cnt = room.members.length && cr.w >= (room.kind === 'command' ? 240 : 170) ? done + '/' + room.members.length + ' done' : '';
        set(e.count, { x: cr.x + cr.w - 14, y: cr.y + 21, text: cnt });
        if (room.kind === 'command') { set(e.barBg, { x: cr.x + 14, y: cr.y + 27, width: cr.w - 28, opacity: 1 }); set(e.bar, { x: cr.x + 14, y: cr.y + 27, width: Math.max(0, (cr.w - 28) * s.progress), opacity: 1 }); }
        else { set(e.barBg, { opacity: 0 }); set(e.bar, { opacity: 0 }); }
        // outbox (dock only)
        if (room.kind === 'dock' && L.outbox) {
          var ob = L.outbox, fin = s.finished, info = s.finishedInfo, ok = info && info.status === 'succeeded';
          set(e.box, { x: ob.x, y: ob.y, width: ob.w, height: ob.h, fill: fin ? (ok ? 'rgba(31,138,122,.10)' : 'rgba(181,71,47,.10)') : 'rgba(0,0,0,0)', stroke: fin ? (ok ? C.acc : C.rust) : C.ink, 'stroke-dasharray': fin ? null : '6 5', opacity: 1 });
          var made = s.outputs.length;
          set(e.boxT, { x: ob.x + ob.w / 2, y: ob.y + 17, text: fin ? 'OUTBOX · ' + (info.status || 'finished').toUpperCase() : 'OUTBOX', opacity: 1 });
          var l1 = fin ? wrap(info.summary || '', Math.floor((ob.w - 12) / 6.2), 2) : [];
          set(e.boxS1, { x: ob.x + ob.w / 2, y: ob.y + ob.h - 20, text: fin ? (l1[0] || '') : '', opacity: 1 });
          set(e.boxS2, { x: ob.x + ob.w / 2, y: ob.y + ob.h - 7, text: fin ? (l1[1] || '') : (made ? (ob.w < 140 ? made + ' docs' : ob.w < 230 ? made + ' docs · pending' : made + ' document' + (made === 1 ? '' : 's') + ' made · result pending') : (ob.w < 230 ? 'pending' : 'result pending')), opacity: 1 });
        } else { set(e.box, { opacity: 0 }); set(e.boxT, { opacity: 0 }); set(e.boxS1, { opacity: 0 }); set(e.boxS2, { opacity: 0 }); }
      });
      Object.keys(roomEls).forEach(function (k) { if (!seenRoom[k]) { roomEls[k].g.remove(); delete roomEls[k]; delete curRooms[k]; } });

      // desks
      var deskSeen = {};
      rooms.forEach(function (room) {
        var L = Ls[room.key]; if (!L) return;
        room.members.forEach(function (id) {
          var a = s.agents[id], tg = L.desks[id]; if (!a || !tg) return;
          deskSeen[id] = 1; var d = ensureDesk(id);
          renderDesk(d, s, a, tg, sel === id, !!relDesks[id] && sel !== id);
        });
      });
      Object.keys(desks).forEach(function (id) { if (!deskSeen[id]) { desks[id].g.remove(); delete desks[id]; } });

      // delegation edges (solid, thin): parent -> child, one per pair
      var pairs = {}, pairOrder = [];
      s.delegations.forEach(function (e) { var k = e.from + '>' + e.to; if (!pairs[k]) { pairs[k] = { from: e.from, to: e.to, t: e.t, work: !!e.work, tw: e.work ? e.t : Infinity }; pairOrder.push(k); } else { if (e.work) { pairs[k].work = true; pairs[k].tw = Math.min(pairs[k].tw, e.t); } } });
      pairOrder.forEach(function (k) {
        var p = pairs[k], f = desks[p.from], t = desks[p.to]; if (!f || !t || f.pop < 0.3 || t.pop < 0.3) return;
        var rel = !sel || p.from === sel || p.to === sel;
        // a parent->child spawn link is drawn when it is inside one room, or once work has really been delegated; otherwise only when selected
        if (!p.work && roomOf[p.from] !== roomOf[p.to] && !(sel && rel)) return;
        var cv = curve({ x: f.ax, y: f.ay }, { x: t.ax, y: t.ay }, 0), prog = reduced || !p.work ? 1 : U.ease(clamp01((s.t - p.tw) / DELEG_MS));
        var it = delegPool.get(k);
        set(it.el, { d: cv.d, pathLength: 1, 'stroke-dasharray': prog >= 0.999 ? null : prog.toFixed(3) + ' 1', stroke: rel && sel ? C.slate : '#8E989A', 'stroke-width': rel && sel ? 2.2 : 1.4, opacity: rel ? 0.9 : 0.16 });
      });
      delegPool.sweep();

      // dependency edges (dashed): prerequisite -> dependent
      s.dependencies.forEach(function (e) {
        var f = desks[e.from], t = desks[e.to]; if (!f || !t || f.pop < 0.3 || t.pop < 0.3) return;
        var fa = s.agents[e.from], ta = s.agents[e.to];
        var open = fa.state !== 'done';
        var cv = curve({ x: f.ax, y: f.ay }, { x: t.ax, y: t.ay }, 0.1), rel = !sel || e.from === sel || e.to === sel, it = depPool.get(e.from + '>' + e.to);
        var o = rel ? (open ? 0.95 : 0.5) : 0.14;
        set(it.el, { d: cv.d, stroke: open ? C.ink : '#9AA3A5', 'stroke-width': open ? 1.9 : 1.3, 'stroke-dasharray': open ? '6 4' : '3 5', opacity: o });
        var pt = at(cv, 0.86), ang = tan(cv, 0.86);
        set(it.arrow, { transform: 'translate(' + pt.x.toFixed(1) + ' ' + pt.y.toFixed(1) + ') rotate(' + ang.toFixed(0) + ')', stroke: open ? C.ink : '#9AA3A5', 'stroke-width': 1.7, opacity: o });
      });
      depPool.sweep();

      // messages: persistent dotted trail per pair + envelope in flight (a function of s.t)
      var trail = {};
      s.messages.forEach(function (m) { var k = m.from + '>' + m.to; var e = trail[k] || (trail[k] = { from: m.from, to: m.to, last: m.t, texts: [] }); e.last = Math.max(e.last, m.t); e.texts.push(m.text); });
      Object.keys(trail).forEach(function (k) {
        var e = trail[k], f = desks[e.from], t = desks[e.to]; if (!f || !t) return;
        var cv = curve({ x: f.ax, y: f.ay }, { x: t.ax, y: t.ay }, -0.12), age = s.t - e.last, rel = !sel || e.from === sel || e.to === sel;
        var o = rel ? U.clamp(1 - (age - 6000) / 10000, 0.22, 1) : 0.12;
        var it = msgPool.get(k);
        set(it.el, { d: cv.d, stroke: C.acc, 'stroke-width': 2.6, 'stroke-dasharray': '0.1 6', opacity: o });
        set(it.title, { text: (s.agents[e.from] ? s.agents[e.from].name : e.from) + ' → ' + (s.agents[e.to] ? s.agents[e.to].name : e.to) + ': ' + e.texts.slice(-3).join(' | ') });
      });
      msgPool.sweep();
      s.messages.forEach(function (m, i) {
        var age = s.t - m.t; if (age < 0 || age > MSG_MS) return;
        var f = desks[m.from], t = desks[m.to]; if (!f || !t) return;
        var cv = curve({ x: f.ax, y: f.ay }, { x: t.ax, y: t.ay }, -0.12);
        var pt = at(cv, reduced ? 0.5 : U.ease(clamp01(age / (MSG_MS * 0.8))));
        var it = envPool.get('m' + i + '@' + m.t);
        var fade = reduced || age < MSG_MS * 0.8 ? 1 : 1 - (age - MSG_MS * 0.8) / (MSG_MS * 0.2);
        set(it.root, { transform: 'translate(' + pt.x.toFixed(1) + ' ' + pt.y.toFixed(1) + ')', opacity: fade });
        // the text only shows mid-flight, away from the desks' own labels and callouts
        var dA = Math.hypot(pt.x - f.ax, pt.y - f.ay), dB = Math.hypot(pt.x - t.ax, pt.y - t.ay), showTxt = dA > 70 && dB > 70;
        if (showTxt) { var tt = envTxtPool.get('m' + i + '@' + m.t); set(tt.text, { x: pt.x.toFixed(1), y: (pt.y - 12).toFixed(1), opacity: fade, text: m.text.length > 34 ? m.text.slice(0, 33) + '…' : m.text }); }
      });
      envPool.sweep(); envTxtPool.sweep();

      // documents: flying / delivered (final outputs only)
      if (s.finished && s.finishedInfo) {
        var ids = s.finishedInfo.outputIds, dock = Ls.dock, ob = dock && dock.outbox, n = ids.length;
        if (ob) {
          var cols = Math.max(1, Math.floor((ob.w - 16) / 17)), top = ob.y + 30, rowsAvail = Math.max(1, Math.floor((ob.h - 30 - 34) / 21));
          var perRow = cols, cap = perRow * rowsAvail;
          ids.forEach(function (oid, i) {
            var o = outputById(s, oid); if (!o) return;
            var fr = fliedFrac(s, oid), src = desks[o.agentId];
            var slot = Math.min(i, cap - 1), rowN = Math.floor(slot / perRow), colN = slot % perRow, inRow = Math.min(perRow, Math.min(n, cap) - rowN * perRow);
            var ex = ob.x + ob.w / 2 - inRow * 17 / 2 + colN * 17 + 1, ey = top + rowN * 21;
            var sx = src ? src.pileX : ex, sy = src ? src.pileY : ey;
            if (fr <= 0) return;
            var cv = { a: { x: sx, y: sy }, c: { x: (sx + ex) / 2, y: Math.min(sy, ey) - 50 }, b: { x: ex, y: ey } }, pt = fr >= 1 ? { x: ex, y: ey } : at(cv, U.ease(fr));
            var it = docPool.get(oid);
            it.d.kind(o.kind, o.name); set(it.root, { transform: 'translate(' + pt.x.toFixed(1) + ' ' + pt.y.toFixed(1) + ') rotate(' + (fr >= 1 ? 0 : (6 * Math.sin(fr * 6.28)).toFixed(1)) + ' 6 8)' });
          });
        }
      }
      docPool.sweep();
      needSnap = false;
    }

    function relayout(snap) {
      var s = ctx.state(), dv = derive(s); rooms = dv.rooms; roomOf = dv.roomOf;
      var sig = W + 'x' + H + '|' + rooms.map(function (r) { return r.key + ':' + r.members.join(','); }).join(';');
      if (sig !== layoutSig || snap) { layoutSig = sig; tgtRooms = computeLayout(); if (snap) needSnap = true; }
    }

    function drawKey() {
      gKey.innerHTML = ''; var y = H - 11, x = MARGIN + 4;
      function item(drawFn, w, label) { drawFn(x, y); var t = mk('text', { 'class': 'key-t', x: x + w + 6, y: y + 4, text: label }, gKey); x += w + 6 + label.length * 6.6 + 24; }
      item(function (x, y) { mk('path', { d: 'M' + x + ' ' + y + ' H' + (x + 24), stroke: '#8E989A', 'stroke-width': 1.6, fill: 'none' }, gKey); }, 24, 'delegation');
      item(function (x, y) { mk('path', { d: 'M' + x + ' ' + y + ' H' + (x + 24), stroke: C.ink, 'stroke-width': 1.9, fill: 'none', 'stroke-dasharray': '6 4' }, gKey); }, 24, 'waits for (arrow feeds)');
      item(function (x, y) { mk('path', { d: 'M' + x + ' ' + y + ' H' + (x + 24), stroke: C.acc, 'stroke-width': 2.6, fill: 'none', 'stroke-dasharray': '0.1 6', 'stroke-linecap': 'round' }, gKey); }, 24, 'message');
      item(function (x, y) { var g = mk('g', { transform: 'translate(' + x + ' ' + (y - 8) + ')' }, gKey); var d = docGlyph(g); d.kind('doc', ''); }, 13, 'document (piles on its desk)');
      item(function (x, y) { mk('rect', { x: x, y: y - 6, width: 22, height: 12, rx: 3, fill: 'none', stroke: C.ink, 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, gKey); }, 22, 'outbox (dashed = unfinished)');
    }

    function sizeUp() {
      var sz = ctx.size(); if (sz.w > 40 && sz.h > 40) { W = sz.w; H = sz.h; }
      set(svg, { viewBox: '0 0 ' + W + ' ' + H }); drawKey();
    }

    sizeUp();
    relayout(true);

    function stepFlight(s, events) {
      var finishedNow = s.finished;
      if (finishedNow && !wasFinished) {
        var viaEvent = events && events.some(function (e) { return e.type === 'task_finished'; });
        flightStart = viaEvent && !ctx.reducedMotion() ? clock : null;
      }
      if (!finishedNow) flightStart = null;
      wasFinished = finishedNow;
    }

    return {
      update: function (s, events) {
        easeK = 0; stepFlight(s, events); relayout(false); render(s);
      },
      frame: function (dt) {
        clock += dt; easeK = Math.min(1, dt / 140); render(ctx.state()); easeK = 0;
      },
      onSelect: function () { render(ctx.state()); },
      onReset: function (s) { flightStart = null; wasFinished = s.finished; needSnap = true; layoutSig = ''; relayout(true); render(s); },
      onMotionChange: function () { needSnap = true; render(ctx.state()); },
      resize: function () { sizeUp(); layoutSig = ''; relayout(true); render(ctx.state()); }
    };
  }
});
