/*
 * LivingWeb: draws the agent state as a living web. Claude Code (the main agent) is the hub in the centre, every real subagent is a node around it,
 * a curved glowing strand joins each subagent to the agent that created it.
 *
 * One pure function: render(state, options) -> { svg, layout }. No DOM, no timers, nothing invented: everything drawn comes from the state object
 * that shared/core.js builds from real events. The same string is used by the page (app/web/web.js) and by the local service
 * (GET /api/web, for the pane inside the Claude app), so both always show the same picture.
 *
 * Motion is written into the SVG as CSS animations whose phase comes from the clock, so the drawing can be replaced at any moment (a new event
 * arrived) without anything jumping:
 *   looping  (breathing glow, spinner, dots flowing along a strand)    delay = -(now % period)
 *   one-shot (a node emerging from the hub, a packet for a tool call,  delay = -(time since that event), left out once it is over
 *             a packet travelling back with a report, a finish ring)
 * options.reduced = true leaves every animation out.
 *
 * Colours: blue = working, violet = a delegated subagent that has not finished, mint = done, amber = waiting / needs you, coral = failed.
 */
(function (global) {
  'use strict';
  var C = { bg: '#050608', card: '#11151C', raised: '#191F29', edge: '#28313D', ink: '#F5F7FA', slate: '#929BAC', blue: '#4DA3FF', violet: '#A77BFF', mint: '#3DE5B3', amber: '#FFB84D', coral: '#FF6572', grey: '#5D6778' };
  var FONT = "'Inter Tight',Inter,-apple-system,'SF Pro Text',system-ui,'Segoe UI',sans-serif";
  var DEG = Math.PI / 180;

  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function n1(v) { return Math.round(v * 10) / 10; }
  function cut(t, n) { t = String(t == null ? '' : t); n = Math.max(2, Math.floor(n)); return t.length > n ? t.slice(0, n - 1).replace(/\s+$/, '') + '…' : t; }
  function wrap(t, per, lines) { // word wrap to at most `lines` lines of `per` characters
    var words = String(t || '').split(/\s+/).filter(Boolean), out = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var wd = words[i];
      if (!cur) cur = wd; else if ((cur + ' ' + wd).length <= per) cur += ' ' + wd; else { out.push(cur); cur = wd; }
      if (out.length === lines) break;
    }
    if (out.length < lines && cur) out.push(cur);
    if (out.length > lines) out.length = lines;
    var used = out.join(' ').length, all = words.join(' ').length;
    out = out.map(function (l) { return cut(l, per); });
    if (used < all && out.length) { var last = out[out.length - 1]; out[out.length - 1] = /…$/.test(last) ? last : cut(last + '…', per); }
    return out;
  }
  function fileName(p) { var s = String(p || '').trim().split(/\s/)[0].replace(/[)"'`,;]+$/, ''); var m = s.split('/').filter(Boolean); return m.length ? m[m.length - 1] : ''; }
  function isRoot(S, id) { var p = S.agents[id].parentId; return !p || !S.agents[p]; }
  function liveKids(S, a) { return (a.children || []).filter(function (c) { return S.agents[c] && S.agents[c].state !== 'done' && S.agents[c].state !== 'failed'; }); }

  /* What an agent is doing right now, in a few plain words. Built only from its real state, tool name and tool input. */
  var VERB = { Read: 'Reading', Edit: 'Editing', MultiEdit: 'Editing', Write: 'Writing', NotebookEdit: 'Editing', Grep: 'Searching the code', Glob: 'Finding files', LS: 'Listing files', Bash: 'Running a command', BashOutput: 'Reading command output',
    WebFetch: 'Fetching a page', WebSearch: 'Searching the web', TodoWrite: 'Updating the plan', Agent: 'Delegating work', Task: 'Delegating work', SubagentHandback: 'Reporting back', AskUserQuestion: 'Asking you a question',
    ExitPlanMode: 'Presenting a plan', Skill: 'Using a skill', ToolSearch: 'Finding tools' };
  var FILE_TOOL = { Read: 1, Edit: 1, MultiEdit: 1, Write: 1, NotebookEdit: 1 };
  function activity(S, a) {
    switch (a.state) {
      case 'working':
        if ((a.tool === 'Agent' || a.tool === 'Task' || !a.tool) && liveKids(S, a).length) return isRoot(S, a.id) ? 'Coordinating agents' : 'Delegating work';
        if (a.tool) {
          var v = VERB[a.tool];
          if (v && FILE_TOOL[a.tool]) { var f = fileName(a.toolInput); return f ? v + ' ' + f : v + ' a file'; }
          if (v) return v;
          var m = /^mcp__(.+?)__(.+)$/.exec(a.tool); if (m) return 'Using ' + m[2].replace(/_/g, ' ');
          return 'Using ' + String(a.tool).replace(/_/g, ' ');
        }
        if ((a.children || []).length) return 'Collecting results';
        return 'Working';
      case 'done': return 'Completed';
      case 'failed': return 'Failed';
      case 'blocked': return 'Needs you';
      case 'waiting': return 'Waiting';
      default: return 'Starting';
    }
  }
  /* What to call an agent: a subagent is named by the job it was given (the real description of the delegation); its type stays in `type`. */
  function titleOf(S, a) { var w = !isRoot(S, a.id) && a.work ? String(a.work).replace(/\s+/g, ' ').trim() : ''; return w || a.name; }
  function tone(S, a) { // colour name for an agent
    if (a.state === 'working') return 'blue';
    if (a.state === 'done') return 'mint';
    if (a.state === 'failed') return 'coral';
    if (a.state === 'blocked' || a.state === 'waiting') return 'amber';
    return isRoot(S, a.id) ? 'grey' : 'violet';
  }
  function summary(S) { // the "Right now" list: active agents first, then the rest in the order they appeared
    var rank = { blocked: 0, failed: 1, working: 2, waiting: 3, queued: 4, done: 5 };
    var list = S.order.map(function (id, i) { var a = S.agents[id]; return { id: id, name: titleOf(S, a), type: a.name, state: a.state, tone: tone(S, a), text: activity(S, a), work: a.work || '', main: isRoot(S, id), i: i }; });
    list.sort(function (x, y) { return (rank[x.state] - rank[y.state]) || (x.i - y.i); });
    var c = S.counts || {}, subs = Math.max(0, S.order.length - (S.order.length ? 1 : 0));
    return { title: S.task ? S.task.title : '', finished: !!S.finished, status: S.finishedInfo ? S.finishedInfo.status : null, agents: list, total: S.order.length, subagents: subs, counts: c };
  }

  /* ---------------------------------------------------------------- layout */
  var SLOTS4 = [-145, 35, -35, 145], SLOTS4T = [-122, 58, -58, 122], SLOTS6 = [-130, 50, -50, 130, 180, 0], SLOTS8 = SLOTS6.concat([-90, 90]);
  function layout(S, o) {
    o = o || {}; var w = o.w || 960, h = o.h || 600, ins = o.inset || {};
    var l = ins.l || 0, r = ins.r || 0, t = ins.t || 0, b = ins.b || 0;
    var aw = Math.max(220, w - l - r), ah = Math.max(220, h - t - b), cx = l + aw / 2, cy = t + ah / 2;
    var roots = S.order.filter(function (id) { return isRoot(S, id); }), hubId = roots[0] || null;
    var ring = hubId ? (S.agents[hubId].children || []).filter(function (c) { return S.agents[c]; }).concat(roots.slice(1)) : [];
    var N = ring.length, deep = {}, maxDeep = 0;
    ring.forEach(function (id) { var list = []; (function rec(x, g) { if (g > 40) return; (S.agents[x].children || []).forEach(function (c) { if (S.agents[c] && list.indexOf(c) < 0) { list.push(c); rec(c, g + 1); } }); })(id, 0); deep[id] = list; maxDeep = Math.max(maxDeep, list.length); });
    var f = N <= 4 ? 0.6 : N <= 6 ? 0.52 : N <= 8 ? 0.46 : N <= 12 ? 0.38 : N <= 18 ? 0.31 : N <= 28 ? 0.25 : 0.2;
    var two = N > 12; // two staggered rings
    var slots = N <= 4 ? (ah > aw * 1.1 ? SLOTS4T : SLOTS4) : N <= 6 ? SLOTS6 : N <= 8 ? SLOTS8 : null; // a tall, narrow area (a pane beside the chat) uses steeper diagonals
    var R0 = clamp(Math.min(aw, ah) * (N ? 0.2 : 0.24), 46, 132), r1 = 0, r2 = 0, rx = 0, ry = 0;
    for (var pass = 0; pass < 3; pass++) {
      r1 = Math.max(13, R0 * f); r2 = maxDeep ? clamp(r1 * 0.4, 8, 20) : 0;
      var pad = 14 + (maxDeep ? r2 * 2 + 14 : 0) + (r1 < 44 ? 20 : 0);
      rx = Math.max(40, aw / 2 - r1 - pad); ry = Math.max(40, ah / 2 - r1 - pad);
      if (!N) break;
      var near = Infinity; // closest a ring node gets to the centre
      for (var i = 0; i < N; i++) { var a0 = angleOf(i), k0 = two && i % 2 ? 0.66 : 1; near = Math.min(near, Math.hypot(rx * k0 * Math.cos(a0), ry * k0 * Math.sin(a0))); }
      var fit = (near - (N <= 8 ? 46 : 24)) / (1 + f); if (fit >= R0) break; R0 = Math.max(30, fit);
    }
    function angleOf(i) { return (slots ? slots[i] : -90 + (i + 0.5) * 360 / N) * DEG; }
    if (N > 1) { // shrink the nodes until neighbours (and their satellites) no longer touch
      var pts = ring.map(function (id, i) { var a = angleOf(i), k = two && i % 2 ? 0.66 : 1; return [cx + rx * k * Math.cos(a), cy + ry * k * Math.sin(a)]; }), dmin = Infinity;
      for (var u = 0; u < N; u++) for (var v = u + 1; v < N; v++) dmin = Math.min(dmin, Math.hypot(pts[u][0] - pts[v][0], pts[u][1] - pts[v][1]));
      r1 = Math.max(5, Math.min(r1, maxDeep ? (dmin - 12) / 3 : (dmin - (N <= 8 ? 14 : 3)) / 2)); r2 = maxDeep ? clamp(r1 * 0.4, 4, 20) : 0;
    }
    var nodes = {};
    if (hubId) nodes[hubId] = { x: cx, y: cy, r: R0, kind: 'hub' };
    ring.forEach(function (id, i) {
      var a = angleOf(i), k = two && i % 2 ? 0.66 : 1, x = cx + rx * k * Math.cos(a), y = cy + ry * k * Math.sin(a);
      nodes[id] = { x: x, y: y, r: r1, kind: 'ring', a: Math.atan2(y - cy, x - cx) };
      var list = deep[id], M = list.length; if (!M) return;
      var ds = r1 + r2 + 12, step = 2 * Math.asin(Math.min(0.95, (r2 + 3) / ds)), cap = Math.max(1, Math.floor(200 * DEG / step) + 1), out = nodes[id].a;
      list.forEach(function (c, j) { var layer = Math.floor(j / cap), inL = Math.min(cap, M - layer * cap), q = j % cap, ang = out + (q - (inL - 1) / 2) * step, d = ds + layer * (r2 * 2 + 6); nodes[c] = { x: x + d * Math.cos(ang), y: y + d * Math.sin(ang), r: r2, kind: 'sat' }; });
    });
    return { w: w, h: h, cx: cx, cy: cy, rx: rx, ry: ry, R0: R0, r1: r1, r2: r2, hubId: hubId, ring: ring, deep: deep, nodes: nodes };
  }

  /* ---------------------------------------------------------------- drawing helpers */
  var ICON = { // 24 x 24 line icons, drawn centred on 0,0
    code: '<path d="M-4.5 -5L-10 0L-4.5 5M4.5 -5L10 0L4.5 5M2 -8L-2 8"/>',
    book: '<path d="M0 -6.5C-3 -8.5 -7 -8.5 -9.5 -7.5V6.5C-7 5.5 -3 5.5 0 7.5C3 5.5 7 5.5 9.5 6.5V-7.5C7 -8.5 3 -8.5 0 -6.5ZM0 -6.5V7.5"/>',
    db: '<ellipse cx="0" cy="-6" rx="8" ry="3"/><path d="M-8 -6V6C-8 7.7 -4.4 9 0 9S8 7.7 8 6V-6M-8 0C-8 1.7 -4.4 3 0 3S8 1.7 8 0"/>',
    list: '<path d="M-3 -6H9M-3 0H9M-3 6H9"/><circle cx="-8" cy="-6" r="1.1"/><circle cx="-8" cy="0" r="1.1"/><circle cx="-8" cy="6" r="1.1"/>',
    flask: '<path d="M-3 -9H3M-2 -9V-2L-8 7.5C-8.6 8.6 -7.8 9.5 -6.6 9.5H6.6C7.8 9.5 8.6 8.6 8 7.5L2 -2V-9M-5 4H5"/>',
    check: '<circle r="9.5"/><path d="M-4.6 0.4L-1.4 3.8L5 -3.6"/>',
    cross: '<circle r="9.5"/><path d="M-3.6 -3.6L3.6 3.6M3.6 -3.6L-3.6 3.6"/>',
    pause: '<circle r="9.5"/><path d="M-2.6 -4V4M2.6 -4V4"/>',
    clock: '<circle r="9.5"/><path d="M0 -5V0L3.4 2.2"/>' };
  function iconFor(a) {
    if (a.state === 'done') return 'check'; if (a.state === 'failed') return 'cross'; if (a.state === 'blocked') return 'pause'; if (a.state === 'waiting') return 'clock';
    var s = (a.name + ' ' + (a.role || '')).toLowerCase();
    if (/explor|research|review|read|doc/.test(s)) return 'book';
    if (/plan|architect/.test(s)) return 'list';
    if (/data|sql|csv|\bdb\b|database/.test(s)) return 'db';
    if (/test|verif|\bqa\b|lint/.test(s)) return 'flask';
    return 'code';
  }
  function icon(name, size, color, sw) { return '<g transform="scale(' + n1(size / 24 * 10) / 10 + ')" fill="none" stroke="' + color + '" stroke-width="' + (sw || 1.7) + '" stroke-linecap="round" stroke-linejoin="round">' + ICON[name] + '</g>'; }
  function burst(size) { // the orange spark that marks Claude Code
    var s = '', R = size / 2;
    for (var i = 0; i < 12; i++) { var a = i * 30 * DEG, r0 = R * 0.2, r1 = R * (i % 2 ? 0.74 : 1); s += 'M' + n1(r0 * Math.cos(a)) + ' ' + n1(r0 * Math.sin(a)) + 'L' + n1(r1 * Math.cos(a)) + ' ' + n1(r1 * Math.sin(a)); }
    return '<path d="' + s + '" stroke="#FF8A4C" stroke-width="' + n1(Math.max(1.6, size * 0.085)) + '" stroke-linecap="round" fill="none"/>';
  }
  function text(x, y, t, size, o) {
    o = o || {};
    return '<text x="' + n1(x) + '" y="' + n1(y) + '" text-anchor="middle" font-size="' + n1(size) + '" font-weight="' + (o.w || 400) + '" fill="' + (o.fill || C.ink) + '"' + (o.ls ? ' letter-spacing="' + o.ls + '"' : '') + (o.op ? ' opacity="' + o.op + '"' : '') + '>' + esc(t) + '</text>';
  }
  var LIGHT = { blue: '#A9D2FF', violet: '#CDB6FF', mint: '#8FF0D2', amber: '#FFD596', coral: '#FFA3AB', grey: '#B4BCC9' };

  /* ---------------------------------------------------------------- render */
  function render(S, o) {
    o = o || {};
    var L = layout(S, o), w = L.w, h = L.h, now = o.now || 0, T = o.t != null ? o.t : S.t, red = !!o.reduced, sel = o.selected || null;
    var out = [], hub = L.hubId ? S.agents[L.hubId] : null, hn = hub ? L.nodes[L.hubId] : { x: L.cx, y: L.cy, r: L.R0 };
    function loop(name, ms, extra) { return red ? '' : 'animation:' + name + ' ' + ms + 'ms ' + (extra || 'linear') + ' -' + Math.round(now % ms) + 'ms infinite;'; }
    function once(name, ms, age, extra) { return 'animation:' + name + ' ' + ms + 'ms ' + (extra || 'ease-out') + ' -' + Math.max(0, Math.round(age)) + 'ms both;'; }
    function fresh(at, ms) { return !red && at != null && T - at >= 0 && T - at < ms; }

    var sm = summary(S), label = !hub ? 'Agent Activity Lab: waiting for Claude Code to start a task.' : (sm.title ? 'Task: ' + sm.title + '. ' : '') + sm.agents.map(function (a) { return a.name + ': ' + a.text; }).join('. ') + '.';
    out.push('<svg xmlns="http://www.w3.org/2000/svg" class="lw" viewBox="0 0 ' + n1(w) + ' ' + n1(h) + '" width="' + n1(w) + '" height="' + n1(h) + '" role="img" aria-label="' + esc(cut(label, 600)) + '" font-family="' + FONT + '">');
    /* defs */
    var d = '<defs>';
    Object.keys(LIGHT).forEach(function (k) {
      d += '<radialGradient id="lw-s-' + k + '" cx="0.36" cy="0.3" r="0.95"><stop offset="0" stop-color="' + C[k] + '" stop-opacity="0.2"/><stop offset="0.55" stop-color="#0A0E15" stop-opacity="0.96"/><stop offset="1" stop-color="' + C[k] + '" stop-opacity="0.42"/></radialGradient>' +
        '<radialGradient id="lw-h-' + k + '"><stop offset="0.45" stop-color="' + C[k] + '" stop-opacity="0.42"/><stop offset="0.72" stop-color="' + C[k] + '" stop-opacity="0.12"/><stop offset="1" stop-color="' + C[k] + '" stop-opacity="0"/></radialGradient>';
    });
    d += '<filter id="lw-blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter>';
    d += '<radialGradient id="lw-glow"><stop offset="0" stop-color="#4DA3FF" stop-opacity="0.16"/><stop offset="1" stop-color="#4DA3FF" stop-opacity="0"/></radialGradient>';
    var strands = [];
    Object.keys(L.nodes).forEach(function (id, i) {
      var n = L.nodes[id]; if (n.kind === 'hub') return;
      var a = S.agents[id], p = L.nodes[a.parentId] ? a.parentId : L.hubId, pn = L.nodes[p]; if (!pn) return;
      var dx = n.x - pn.x, dy = n.y - pn.y, dist = Math.hypot(dx, dy) || 1, ux = dx / dist, uy = dy / dist;
      var A = { x: pn.x + ux * (pn.r + 2), y: pn.y + uy * (pn.r + 2) }, B = { x: n.x - ux * (n.r + 2), y: n.y - uy * (n.r + 2) }, len = Math.hypot(B.x - A.x, B.y - A.y);
      var bend = n.kind === 'sat' ? 0 : clamp(len * 0.22, 6, 46) * ((dx * dy > 0) ? 1 : -1), mx = (A.x + B.x) / 2 - uy * bend, my = (A.y + B.y) / 2 + ux * bend;
      var s = { id: id, i: i, a: a, n: n, pa: S.agents[p], A: A, B: B, fwd: 'M' + n1(A.x) + ' ' + n1(A.y) + 'Q' + n1(mx) + ' ' + n1(my) + ' ' + n1(B.x) + ' ' + n1(B.y), back: 'M' + n1(B.x) + ' ' + n1(B.y) + 'Q' + n1(mx) + ' ' + n1(my) + ' ' + n1(A.x) + ' ' + n1(A.y),
        mid: { x: 0.3025 * A.x + 0.495 * mx + 0.2025 * B.x, y: 0.3025 * A.y + 0.495 * my + 0.2025 * B.y }, tone: tone(S, a), ptone: tone(S, S.agents[p]) };
      strands.push(s);
      d += '<linearGradient id="lw-g' + i + '" gradientUnits="userSpaceOnUse" x1="' + n1(A.x) + '" y1="' + n1(A.y) + '" x2="' + n1(B.x) + '" y2="' + n1(B.y) + '"><stop offset="0" stop-color="' + C[s.ptone === 'grey' ? 'blue' : s.ptone] + '"/><stop offset="1" stop-color="' + C[s.tone === 'blue' || s.tone === 'grey' ? 'violet' : s.tone] + '"/></linearGradient>';
    });
    d += '</defs>';
    out.push(d);
    if (!red) out.push('<style>@keyframes lw-breathe{0%,100%{opacity:.5}50%{opacity:1}}@keyframes lw-spin{to{transform:rotate(360deg)}}@keyframes lw-flow{to{stroke-dashoffset:-36}}@keyframes lw-go{from{offset-distance:0%}to{offset-distance:100%}}' +
      '@keyframes lw-out{0%,80%{opacity:1}100%{opacity:0}}@keyframes lw-fade{from{opacity:1}to{opacity:0}}@keyframes lw-ring{from{transform:scale(1);opacity:.95}to{transform:scale(1.55);opacity:0}}' +
      '@keyframes lw-emerge{from{transform:translate(var(--dx),var(--dy)) scale(.15);opacity:0}to{transform:translate(0,0) scale(1);opacity:1}}@keyframes lw-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}</style>');

    /* the web behind everything: spokes and sagging rings, centred on the hub */
    var RX = Math.max(L.rx + L.r1 * 0.6, L.R0 * 2.2), RY = Math.max(L.ry + L.r1 * 0.6, L.R0 * 1.9), SP = 12, rings = [0.4, 0.66, 0.92, 1.2], g = '';
    function pt(i, k) { var a = (i * 360 / SP - 90) * DEG; return [L.cx + RX * k * Math.cos(a), L.cy + RY * k * Math.sin(a)]; }
    for (var i = 0; i < SP; i++) { var p0 = pt(i, 0.26), p1 = pt(i, 1.3); g += 'M' + n1(p0[0]) + ' ' + n1(p0[1]) + 'L' + n1(p1[0]) + ' ' + n1(p1[1]); }
    var web = '<path d="' + g + '" stroke="#4DA3FF" stroke-opacity="0.12" stroke-width="1" fill="none"/>'; g = ''; var dots = '';
    rings.forEach(function (k) { for (var i = 0; i < SP; i++) { var a = pt(i, k), b = pt(i + 1, k), c = pt(i + 0.5, k * 0.9); g += 'M' + n1(a[0]) + ' ' + n1(a[1]) + 'Q' + n1(c[0]) + ' ' + n1(c[1]) + ' ' + n1(b[0]) + ' ' + n1(b[1]); if (k > 0.5 && k < 1.1) dots += '<circle cx="' + n1(a[0]) + '" cy="' + n1(a[1]) + '" r="1.2"/>'; } });
    web += '<path d="' + g + '" stroke="#5B8DEF" stroke-opacity="0.16" stroke-width="1" fill="none"/><g fill="#8FBFFF" opacity="0.45">' + dots + '</g>';
    out.push('<g class="lw-web">' + '<ellipse cx="' + n1(L.cx) + '" cy="' + n1(L.cy) + '" rx="' + n1(RX * 1.15) + '" ry="' + n1(RY * 1.15) + '" fill="url(#lw-glow)"/>' + web + '</g>');

    /* strands: parent -> subagent */
    strands.forEach(function (s) {
      var a = s.a, working = a.state === 'working', over = a.state === 'done' || a.state === 'failed', thin = s.n.kind === 'sat';
      var dim = sel && sel !== s.id && sel !== a.parentId ? 0.35 : 1, e = '<g class="lw-strand" data-to="' + esc(s.id) + '" opacity="' + dim + '">';
      var born = fresh(a.spawnedAt, 700), drawn = born ? ' pathLength="1" stroke-dasharray="1" style="' + once('lw-draw', 700, T - a.spawnedAt) + '"' : '';
      var glowC = C[s.tone === 'grey' ? 'violet' : s.tone];
      if (!thin && strands.length <= 14) e += '<path d="' + s.fwd + '" stroke="' + glowC + '" stroke-opacity="' + (working ? 0.75 : over ? 0.28 : 0.45) + '" stroke-width="' + (working ? 9 : 7) + '" fill="none" stroke-linecap="round" filter="url(#lw-blur)"/>'; // the glow around the strand
      e += '<path d="' + s.fwd + '" stroke="' + glowC + '" stroke-opacity="' + (working ? 0.3 : over ? 0.12 : 0.18) + '" stroke-width="' + (thin ? 5 : 8) + '" fill="none" stroke-linecap="round"/>';
      e += '<path d="' + s.fwd + '" stroke="url(#lw-g' + s.i + ')" stroke-opacity="' + (working ? 1 : over ? 0.7 : 0.9) + '" stroke-width="' + (thin ? 1.4 : working ? 2.8 : 2.2) + '" fill="none" stroke-linecap="round"' + drawn + '/>';
      var lit = null; for (var q = S.delegations.length - 1; q >= 0; q--) { var dl = S.delegations[q]; if (dl.to === s.id) { if (fresh(dl.t, 1800)) lit = dl; break; } }
      if (lit) e += '<path d="' + s.fwd + '" stroke="#E4D8FF" stroke-width="' + (thin ? 2.4 : 4) + '" fill="none" stroke-linecap="round" style="' + once('lw-fade', 1800, T - lit.t) + '"/>'; // delegation lights the strand up
      if (working && !red) e += '<path d="' + s.fwd + '" stroke="#EAF4FF" stroke-opacity="0.85" stroke-width="' + (thin ? 1.6 : 2.2) + '" stroke-dasharray="1.5 16.5" stroke-linecap="round" fill="none" style="' + loop('lw-flow', 1300) + '"/>';
      if (!thin) e += '<circle cx="' + n1(s.mid.x) + '" cy="' + n1(s.mid.y) + '" r="' + (working ? 3.6 : 2.8) + '" fill="#F5F7FA" opacity="' + (working ? 1 : over ? 0.5 : 0.75) + '"/><circle cx="' + n1(s.mid.x) + '" cy="' + n1(s.mid.y) + '" r="8" fill="' + C[s.tone === 'grey' ? 'violet' : s.tone] + '" opacity="' + (working ? 0.3 : 0.14) + '"/>';
      if (working && fresh(a.toolAt, 1000)) e += packet(s.fwd, 1000, T - a.toolAt, '#EAF4FF', C.blue, thin ? 2.6 : 4); // a tool call: a packet runs out along the strand
      for (var m = S.messages.length - 1, seen = 0; m >= 0 && seen < 6; m--, seen++) { var ms = S.messages[m]; if (ms.from === s.id && fresh(ms.t, 1400)) { e += packet(s.back, 1400, T - ms.t, '#F2FFFA', C.mint, thin ? 3.2 : 5.5); break; } } // a report travels back to the parent
      out.push(e + '</g>');
    });
    function packet(path, ms, age, core, glow, r) {
      var st = "offset-path:path('" + path + "');offset-rotate:0deg;animation:lw-go " + ms + 'ms cubic-bezier(.45,0,.25,1) -' + Math.round(age) + 'ms both,lw-out ' + ms + 'ms linear -' + Math.round(age) + 'ms both;';
      return '<g style="' + st + '"><circle r="' + n1(r * 2.6) + '" fill="' + glow + '" opacity="0.3"/><circle r="' + r + '" fill="' + core + '"/></g>';
    }

    /* nodes */
    function node(id, body, n, a, tn, extra) {
      var born = !!(a && n.kind !== 'hub' && fresh(a.spawnedAt, 760));
      var pn = born ? (L.nodes[a.parentId] || hn) : null;
      var inner = born ? '<g style="--dx:' + n1(pn.x - n.x) + 'px;--dy:' + n1(pn.y - n.y) + 'px;' + once('lw-emerge', 760, T - a.spawnedAt, 'cubic-bezier(.2,.8,.2,1)') + '">' : '<g>';
      var rings = '';
      if (born) rings += '<circle r="' + n1(n.r) + '" fill="none" stroke="' + C.violet + '" stroke-width="2" style="' + once('lw-ring', 900, T - a.spawnedAt) + '"/>';
      if (a && a.state === 'done' && fresh(a.endedAt, 1100)) rings += '<circle r="' + n1(n.r) + '" fill="none" stroke="' + C.mint + '" stroke-width="2.5" style="' + once('lw-ring', 1100, T - a.endedAt) + '"/>';
      if (a && a.state === 'failed' && fresh(a.endedAt, 1100)) rings += '<circle r="' + n1(n.r) + '" fill="none" stroke="' + C.coral + '" stroke-width="2.5" style="' + once('lw-ring', 1100, T - a.endedAt) + '"/>';
      var dim = sel && id && sel !== id && !(a && (a.parentId === sel || (S.agents[sel] && S.agents[sel].parentId === id))) ? 0.5 : 1;
      return '<g class="lw-n lw-' + n.kind + (sel && sel === id ? ' sel' : '') + '" data-node="' + esc(id || '') + '" data-state="' + (a ? a.state : 'idle') + '" transform="translate(' + n1(n.x) + ' ' + n1(n.y) + ')" opacity="' + dim + '">' + inner + (extra || '') + body + rings +
        (sel && sel === id ? '<circle r="' + n1(n.r + 7) + '" fill="none" stroke="' + C.ink + '" stroke-opacity="0.9" stroke-width="1.5"/>' : '') + '</g></g>';
    }
    function sphere(n, tn, a, strong) {
      var live = a && (a.state === 'working' || a.state === 'blocked'), s = '';
      s += '<circle r="' + n1(n.r * (strong ? 1.75 : 1.6)) + '" fill="url(#lw-h-' + tn + ')" opacity="' + (live ? 1 : a && a.state === 'done' ? 0.5 : 0.42) + '"' + (live ? ' style="' + loop('lw-breathe', a.state === 'blocked' ? 1800 : 2800, 'ease-in-out') + '"' : '') + '/>';
      s += '<circle r="' + n1(n.r) + '" fill="#07090D"/><circle r="' + n1(n.r) + '" fill="url(#lw-s-' + tn + ')" stroke="' + C[tn] + '" stroke-width="' + (strong ? 2.6 : n.kind === 'sat' ? 1.4 : 2) + '"' + (a && (a.state === 'waiting' || a.state === 'queued') && n.kind !== 'hub' ? ' stroke-dasharray="4 5"' : '') + '/>';
      if (n.r >= 20) s += '<path d="M' + n1(-n.r * 0.62) + ' ' + n1(-n.r * 0.5) + 'A' + n1(n.r * 0.82) + ' ' + n1(n.r * 0.82) + ' 0 0 1 ' + n1(n.r * 0.3) + ' ' + n1(-n.r * 0.78) + '" stroke="#FFFFFF" stroke-opacity="0.16" stroke-width="' + n1(Math.max(1.2, n.r * 0.035)) + '" fill="none" stroke-linecap="round"/>';
      if (a && a.state === 'working' && !red) { var cir = 2 * Math.PI * (n.r + 5); s += '<circle r="' + n1(n.r + 5) + '" fill="none" stroke="' + C[tn] + '" stroke-opacity="0.9" stroke-width="' + (strong ? 2.2 : 1.6) + '" stroke-linecap="round" stroke-dasharray="' + n1(cir * 0.16) + ' ' + n1(cir * 0.84) + '" style="' + loop('lw-spin', strong ? 5200 : 2600) + '"/>'; }
      return s;
    }
    strands.forEach(function (s) {
      var a = s.a, n = s.n, tn = s.tone, r = n.r, body = sphere(n, tn, a, false), lt = LIGHT[tn], act = activity(S, a);
      if (n.kind === 'sat') { if (r >= 12) body += icon(iconFor(a), r * 1.05, lt, 2.2); else body += '<circle r="' + n1(r * 0.36) + '" fill="' + C[tn] + '"/>'; }
      else if (r >= 44) { // icon, the job it was given (up to two lines), what it is doing right now
        var name = titleOf(S, a), fs2 = clamp(r * 0.175, 10, 14), one = name.length <= Math.floor(r * 1.7 / (clamp(r * 0.235, 11.5, 19) * 0.57));
        var longest = name.split(/\s+/).reduce(function (m, wd) { return Math.max(m, wd.length); }, 1); // shrink a little so the longest word still fits on a line
        var fs = one ? clamp(r * 0.235, 11.5, 19) : clamp(Math.min(r * 0.19, r * 1.62 / (longest * 0.55)), 11, 15.5), tl = one ? [name] : wrap(name, Math.max(Math.min(longest, 18), Math.floor(r * 1.62 / (fs * 0.55))), 2);
        var top = one ? r * 0.06 : -r * 0.13, after = top + (tl.length - 1) * fs * 1.16, ay = after + fs2 * 1.5, al;
        if (one) al = wrap(act, Math.floor(r * 1.5 / (fs2 * 0.53)), 2);
        else { var room = 2 * Math.sqrt(Math.max(1, r * r - ay * ay)) * 0.88; fs2 = clamp(Math.min(fs2, room / (act.length * 0.53)), 9.5, 14); al = [cut(act, Math.floor(room / (fs2 * 0.53)) + 1)]; } // one line, sized to the width the circle has at that height
        body += '<g transform="translate(0 ' + n1(-r * (one ? 0.47 : 0.58)) + ')">' + icon(iconFor(a), r * (one ? 0.42 : 0.32), lt, 1.9) + '</g>';
        tl.forEach(function (ln, j) { body += text(0, top + j * fs * 1.16, ln, fs, { w: 650 }); });
        al.forEach(function (ln, j) { body += text(0, ay + j * fs2 * 1.22, ln, fs2, { fill: lt, op: 0.92 }); });
      } else {
        if (r >= 20) body += icon(iconFor(a), r * 0.95, lt, 2); else body += '<circle r="' + n1(r * 0.34) + '" fill="' + C[tn] + '"/>';
        if (L.ring.length <= 32) body += text(0, r + 15, cut(titleOf(S, a), Math.max(8, (r * 2 + 34) / 6.2)), 11, { w: 600, fill: '#C7CEDA' });
      }
      out.push(node(s.id, '<title>' + esc(titleOf(S, a) + (titleOf(S, a) !== a.name ? ' (' + a.name + ')' : '') + ' · ' + act) + '</title>' + body, n, a, tn));
    });

    /* hub */
    var R = hn.r, htn = hub ? (S.finished && S.finishedInfo && S.finishedInfo.status && S.finishedInfo.status !== 'succeeded' && hub.state === 'done' ? 'coral' : tone(S, hub)) : 'grey', hb = '';
    hb += sphere(hn, htn, hub || { state: 'idle' }, true);
    var hname = hub ? hub.name : 'Claude Code', hact = hub ? activity(S, hub) : 'Waiting for a task', title = S.task && S.task.title ? S.task.title : '';
    if (R >= 78) {
      var tf = clamp(R * 0.14, 11.5, 19), tl = title ? wrap(title, Math.floor(R * 1.5 / (tf * 0.55)), 2) : [], pf = clamp(R * 0.105, 10.5, 14.5), pw = Math.min(R * 1.5, hact.length * pf * 0.58 + 26), py = R * 0.6;
      hb += '<g transform="translate(0 ' + n1(-R * 0.6) + ')">' + burst(R * 0.36) + '</g>';
      hb += text(0, -R * 0.2, cut(hname, 16), clamp(R * 0.215, 15, 28), { w: 700 });
      hb += text(0, -R * 0.06, '(MAIN AGENT)', clamp(R * 0.08, 8.5, 11), { fill: C.slate, ls: '0.22em' });
      hb += '<path d="M' + n1(-R * 0.3) + ' ' + n1(R * 0.04) + 'H' + n1(R * 0.3) + '" stroke="#FFFFFF" stroke-opacity="0.14"/>';
      tl.forEach(function (ln, j) { hb += text(0, R * (tl.length > 1 ? 0.21 : 0.3) + j * tf * 1.2, ln, tf, { w: 650 }); });
      hb += '<rect x="' + n1(-pw / 2) + '" y="' + n1(py - pf * 0.95) + '" width="' + n1(pw) + '" height="' + n1(pf * 1.9) + '" rx="' + n1(pf * 0.95) + '" fill="' + C[htn] + '" fill-opacity="0.14" stroke="' + C[htn] + '" stroke-opacity="0.55"/>' + text(0, py + pf * 0.35, cut(hact, pw / (pf * 0.56)), pf, { fill: LIGHT[htn], w: 500 });
    } else {
      hb += '<g transform="translate(0 ' + n1(-R * 0.4) + ')">' + burst(R * 0.5) + '</g>';
      hb += text(0, R * 0.2, cut(hname, 14), clamp(R * 0.24, 10, 17), { w: 700 });
      if (R >= 44) hb += text(0, R * 0.2 + clamp(R * 0.18, 9, 12) * 1.4, cut(hact, R * 1.84 / (clamp(R * 0.18, 9, 12) * 0.5)), clamp(R * 0.18, 9, 12), { fill: LIGHT[htn] });
    }
    out.push(node(L.hubId, '<title>' + esc(hname + ' · ' + hact) + '</title>' + hb, hn, hub, htn));
    out.push('</svg>');
    return { svg: out.join(''), layout: L, summary: sm };
  }

  global.LivingWeb = { burst: burst, titleOf: titleOf, render: render, layout: layout, activity: activity, tone: tone, summary: summary, COLORS: C, LIGHT: LIGHT, icon: function (a, size, color) { return icon(iconFor(a), size, color); } };
})(typeof window !== 'undefined' ? window : globalThis);
