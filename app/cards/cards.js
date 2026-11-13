/* Agents view (the Card tree, chosen as the primary visualization). Owned copy of prototypes/09-card-tree, refined for live runs:
 *   - the card's bottom edge is a lane showing when the agent was active (real start/end), replacing the old tool-progress sliver,
 *     which animated against a placeholder duration and so implied progress that was not measured
 *   - a working card shows its current tool and how long it has been running, or the agent's latest commentary
 * Delegation as an org chart. Root at the left, one column per depth, a card per agent that reads like a status line.
 * Everything is derived from the accumulated `state` (never from scenario.js), and the layout is computed from the
 * parent/dependency shape, so it works for any number of agents and for the live adapter.
 *
 *   elbows            delegation (parent -> child), drawn from the parent's right edge
 *   dashed arcs       dependencies ("waits for"), in the right gutter, with an arrowhead at the dependent
 *   dotted green arcs messages (a pulse travels sender -> receiver when the event arrives, a label shows for a few seconds)
 *   chevron           collapse / expand a subtree; finished subtrees collapse by themselves (unless you pinned them open)
 */
window.__AppViews.views.push({
  id: 'cards', name: 'Agents', tagline: 'Delegation as an org chart whose cards read like a status report.',
  create: function (stage, ctx) {
    var U = ctx.core.util;
    var NS = 'http://www.w3.org/2000/svg';
    var W = 264, PITCH = 340, PADX = 32, GAP = 14, H1 = 58, H2 = 76, CAP = 27, AUTO_COLLAPSE_MS = 1500, PULSE_MS = 1100, LABEL_MS = 2600;
    var RANK = { done: 0, queued: 1, waiting: 2, working: 3, blocked: 4, failed: 5 };
    var INK = '#F5F7FA', ACC = '#4DA3FF', AMBER = '#FFB84D', RUST = '#FF6572', SLATE = '#5D6778', MIST = '#3A4554', VIOLET = '#A77BFF', MINT = '#3DE5B3', BG = '#050608', RAISED = '#191F29';
    function motionClass() { stage.classList.toggle('ac-reduced', !!ctx.reducedMotion()); }

    /* ------------------------------------------------------------ DOM */
    var scroller = el('div', 'cd-scroll', stage);
    var canvas = el('div', 'cd-canvas', scroller);
    var under = svg('svg', { 'class': 'cd-under', 'aria-hidden': 'true' }, canvas);
    under.innerHTML = '<defs>' +
      marker('cd-m-dep', SLATE) + marker('cd-m-depx', INK) + marker('cd-m-msg', ACC) + marker('cd-m-res', MINT) + marker('cd-m-resx', RUST) + '</defs>' +
      '<g class="g-elb"></g><g class="g-dep"></g><g class="g-msg"></g>';
    motionClass();
    var gElb = under.querySelector('.g-elb'), gDep = under.querySelector('.g-dep'), gMsg = under.querySelector('.g-msg');
    var taskEl = el('div', 'cd-task', canvas); taskEl.innerHTML = '<div class="cd-task-title"></div><div class="cd-task-pct"></div><div class="cd-task-bar"><i></i></div>';
    var taskTitle = taskEl.children[0], taskPct = taskEl.children[1], taskBar = taskEl.querySelector('i');
    var countsEl = el('div', 'cd-counts', canvas);
    var tail = el('div', null, canvas); tail.style.display = 'none';
    var resultEl = null;
    var over = svg('svg', { 'class': 'cd-over', 'aria-hidden': 'true' }, canvas);
    var emptyEl = el('div', 'cd-empty', canvas); emptyEl.textContent = 'Waiting for the first agent to spawn…';
    var legend = el('div', 'cd-legend', stage); legend.setAttribute('aria-hidden', 'true');
    legend.innerHTML =
      '<span><svg viewBox="0 0 36 10"><path d="M1 8H12Q16 8 16 5Q16 2 20 2H35" stroke="' + VIOLET + '" stroke-width="1.6" fill="none"/></svg>delegates to</span>' +
      '<span><svg viewBox="0 0 36 10"><path d="M1 5H35" stroke="' + ACC + '" stroke-width="2.4" stroke-dasharray="0.1 5" stroke-linecap="round" fill="none"/></svg>message</span>' +
      '<span><svg viewBox="0 0 36 10"><path d="M1 5H35" stroke="' + SLATE + '" stroke-width="1.6" stroke-dasharray="5 4" fill="none"/></svg>waits for</span>' +
      '<span><b class="cd-lg-tog">▸ 2/5</b>folded: done/total</span>' +
      '<span><b class="cd-lg-re">↻2</b>retried</span>';

function el(tag, cls, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; }
    function svg(tag, attrs, parent) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
    function marker(id, color) { return '<marker id="' + id + '" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 1L8 4.5L0 8z" fill="' + color + '"/></marker>'; }
    function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

    /* ------------------------------------------------------------ glyphs */
    function glyph(st, mini) {
      var s = '<svg viewBox="0 0 30 30"' + (mini ? ' class="mini"' : '') + ' aria-hidden="true">';
      if (st === 'working') s += mini ? '<circle cx="15" cy="15" r="10" fill="' + ACC + '"/>'
        : '<circle class="g-halo" cx="15" cy="15" r="12" fill="none" stroke="' + ACC + '" stroke-width="1.5"/><circle cx="15" cy="15" r="11" fill="none" stroke="' + ACC + '" stroke-opacity=".22" stroke-width="2"/>' +
          '<circle class="g-spin" cx="15" cy="15" r="11" fill="none" stroke="' + ACC + '" stroke-width="2" stroke-linecap="round" stroke-dasharray="20 49.1"/><circle cx="15" cy="15" r="4.5" fill="' + ACC + '"/>';
      else if (st === 'blocked') s += mini ? '<circle cx="15" cy="15" r="11" fill="' + AMBER + '"/><path d="M12 10.5v9M18 10.5v9" stroke="' + BG + '" stroke-width="3" stroke-linecap="round"/>'
        : '<circle cx="15" cy="15" r="11" fill="' + AMBER + '" fill-opacity=".16" stroke="' + AMBER + '" stroke-width="1.6"/><path d="M12.5 11v8M17.5 11v8" stroke="' + AMBER + '" stroke-width="2.2" stroke-linecap="round"/>';
      else if (st === 'failed') s += mini ? '<circle cx="15" cy="15" r="11" fill="' + RUST + '"/><path d="M11 11l8 8M19 11l-8 8" stroke="' + BG + '" stroke-width="3" stroke-linecap="round"/>'
        : '<circle cx="15" cy="15" r="11" fill="' + RUST + '" fill-opacity=".16" stroke="' + RUST + '" stroke-width="1.6"/><path d="M11.5 11.5l7 7M18.5 11.5l-7 7" stroke="' + RUST + '" stroke-width="2" stroke-linecap="round"/>';
      else if (st === 'done') s += mini ? '<circle cx="15" cy="15" r="11" fill="' + MINT + '"/><path d="M10 15.5l3.4 3.6l6.4-7.8" stroke="' + BG + '" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
        : '<circle cx="15" cy="15" r="11" fill="' + MINT + '" fill-opacity=".14" stroke="' + MINT + '" stroke-width="1.6"/><path d="M10.4 15.4l3.2 3.4l6-7.4" stroke="' + MINT + '" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
      else if (st === 'waiting') s += '<circle cx="15" cy="15" r="' + (mini ? 10 : 11) + '" fill="none" stroke="' + AMBER + '" stroke-opacity=".75" stroke-width="' + (mini ? 3 : 1.6) + '" stroke-dasharray="' + (mini ? '4 4' : '3 3.2') + '"/>';
      else s += '<circle cx="15" cy="15" r="' + (mini ? 10 : 11) + '" fill="none" stroke="' + MIST + '" stroke-width="' + (mini ? 3 : 1.6) + '"/>';
      return s + '</svg>';
    }
    function kindIcon(kind) {
      var p = { doc: '<path d="M1 1h6l4 4v8H1z" fill="' + RAISED + '"/><path d="M7 1v4h4"/>',
        patch: '<path d="M3.5 4.5L1 7l2.5 2.5M8.5 4.5L11 7 8.5 9.5M6.8 3.5L5.2 10.5" fill="none"/>',
        report: '<path d="M1 1h10v12H1z" fill="' + RAISED + '"/><path d="M3.5 10V7.5M6 10V4.5M8.5 10V6.5" fill="none"/>',
        release: '<path d="M1 7.5V1.5h6l4.5 5-5 5z" fill="' + RAISED + '"/><circle cx="4" cy="4.5" r=".9"/>' }[kind] || '<path d="M1 1h6l4 4v8H1z" fill="' + RAISED + '"/><path d="M7 1v4h4"/>';
      return '<svg viewBox="0 0 12 14" fill="none" stroke="' + MINT + '" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' + p + '</svg>';
    }

    /* ------------------------------------------------------------ state */
    var S = null, INFO = {}, KIDS = {}, nodes = {}, lay = null;
    var cards = {}, toggles = {}, pulses = [], edgeEls = {}, snap = true, prevFinished = false;
    var edgesDirty = true, lastUser = -1e9, scrollTo = null, resultKey = '';

    ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(function (ev) { scroller.addEventListener(ev, function () { lastUser = performance.now(); scrollTo = null; }, { passive: true }); });

    function isRoot(id) { var p = S.agents[id].parentId; return !p || !S.agents[p]; }
    function inSubtree(id, root) { var g = 0; while (id && g++ < 200) { if (id === root) return true; var a = S.agents[id]; id = a && a.parentId; } return false; }

    function buildInfo(s) {
      KIDS = {}; INFO = {};
      s.order.forEach(function (id) { var p = s.agents[id].parentId; if (p && s.agents[p]) (KIDS[p] = KIDS[p] || []).push(id); });
      function rec(id, depth) {
        var r = INFO[id]; if (r) return r;
        r = INFO[id] = { desc: 0, done: 0, worst: -1, worstState: null, maxEnd: 0, all: true, outs: [] };
        if (depth > 60) return r;
        (KIDS[id] || []).forEach(function (c) {
          var ci = rec(c, depth + 1), ca = s.agents[c];
          r.desc += 1 + ci.desc; r.done += (ca.state === 'done' ? 1 : 0) + ci.done;
          var rk = RANK[ca.state]; if (rk > r.worst) { r.worst = rk; r.worstState = ca.state; }
          if (ci.worst > r.worst) { r.worst = ci.worst; r.worstState = ci.worstState; }
          r.all = r.all && ca.state === 'done' && ci.all; r.maxEnd = Math.max(r.maxEnd, ca.endedAt || 0, ci.maxEnd);
          r.outs = r.outs.concat(ca.outputs, ci.outs);
        });
        return r;
      }
      s.order.forEach(function (id) { rec(id, 0); });
    }

    /** A finished subtree folds by itself a moment after the last agent in it is done; a click pins either choice. */
    function isCollapsed(id) {
      var a = S.agents[id], kids = KIDS[id];
      if (!kids || !kids.length) return false;
      if (toggles[id] !== undefined) return !toggles[id];
      if (isRoot(id)) return false;
      var i = INFO[id];
      if (a.state !== 'done' || !i.all) return false;
      if (S.t - Math.max(i.maxEnd, a.endedAt || 0) < AUTO_COLLAPSE_MS) return false;
      var sel = ctx.selected(); if (sel && sel !== id && inSubtree(sel, id)) return false;
      return true;
    }

    /* ------------------------------------------------------------ words on the card */
    function agentName(id) { return S.agents[id] ? S.agents[id].name : id; }
    function wrapLines(t, cap) { var lines = 1, cur = 0; t.split(' ').forEach(function (w) { var n = w.length; if (cur === 0) cur = n; else if (cur + 1 + n <= cap) cur += 1 + n; else { lines++; cur = n; } while (cur > cap) { lines++; cur -= cap; } }); return lines; }
    function statusOf(a) {
      var t, wrap = false;
      switch (a.state) {
        case 'working':
          if (a.tool) { var run = S.t - (a.toolAt || 0); t = a.tool + (run >= 2000 ? ' · ' + Math.round(run / 1000) + 's' : '') + (a.attempt > 1 ? ' · try ' + a.attempt : ''); }
          else if (KIDS[a.id]) t = KIDS[a.id].some(function (c) { return S.agents[c].state !== 'done'; }) ? 'delegating' : 'collecting results';
          else { var said = null; for (var q = a.recent.length - 1; q >= 0; q--) if (a.recent[q].kind === 'note') { said = a.recent[q].text.replace(/^Said: /, ''); break; } t = said ? 'says: ' + (said.length > 22 ? said.slice(0, 21) + '…' : said) : 'working'; }
          break;
        case 'done': t = 'done'; break;
        case 'failed': t = 'failed: ' + (a.error || 'error'); wrap = true; break;
        case 'blocked': { var r = a.blockedReason || 'needs help'; t = /^needs?\b/i.test(r) ? r.charAt(0).toLowerCase() + r.slice(1) : 'blocked: ' + r; wrap = true; break; }
        case 'waiting': {
          var un = a.dependsOn.filter(function (d) { return !(S.agents[d] && S.agents[d].state === 'done'); }).map(function (d) { return agentName(d).toLowerCase(); });
          t = un.length ? 'waits for ' + un.join(', ') : 'waiting'; wrap = true; break;
        }
        default: t = 'queued, ready';
      }
      return { text: t, lines: wrap ? Math.min(2, wrapLines(t, CAP)) : 1 };
    }

    /* ------------------------------------------------------------ layout (tidy tree, parent centred on its children) */
    function doLayout() {
      var s = S; nodes = {}; var order = [], cursor = 0, maxDepth = 0;
      function shift(list, d) { list.forEach(function (n) { n.y += d; shift(n.kids, d); }); }
      function place(id, depth) {
        var a = s.agents[id], st = statusOf(a);
        var n = { id: id, depth: depth, st: st, h: st.lines > 1 ? H2 : H1, kids: [], collapsed: isCollapsed(id), y: 0 };
        nodes[id] = n; order.push(id); maxDepth = Math.max(maxDepth, depth);
        var start = cursor;
        if (!n.collapsed && KIDS[id]) KIDS[id].forEach(function (c) { if (!nodes[c]) n.kids.push(place(c, depth + 1)); });
        if (n.kids.length) {
          var first = n.kids[0], last = n.kids[n.kids.length - 1], top = first.y, block = last.y + last.h - top;
          if (block < n.h) { shift(n.kids, (n.h - block) / 2); n.y = start; cursor = start + n.h + GAP; }
          else n.y = top + block / 2 - n.h / 2;
        } else { n.y = cursor; cursor = n.y + n.h + GAP; }
        return n;
      }
      var roots = s.order.filter(function (id) { return isRoot(id); }).map(function (id) { return place(id, 0); });
      var main = roots[0], shiftY = main ? Math.max(24, 104 - main.y) : 24, bottom = 0;
      order.forEach(function (id) { var n = nodes[id]; n.y += shiftY; n.x = PADX + n.depth * PITCH; bottom = Math.max(bottom, n.y + n.h); });
      return { order: order, bottom: bottom, maxDepth: maxDepth, main: main ? main.id : null };
    }

    /* ------------------------------------------------------------ cards */
    function makeCard(id) {
      var c = { id: id, k: {}, x: 0, y: 0, tx: 0, ty: 0, h: H1, alpha: 1 };
      var e = c.el = el('div', 'cd-card', null);
      e.tabIndex = 0; e.setAttribute('role', 'button'); e.dataset.id = id;
      e.innerHTML = '<span class="cd-bar"></span><span class="cd-glyph"></span><div class="cd-body"><div class="cd-row1">' +
        '<span class="cd-name"></span><span class="cd-retry"></span><button type="button" class="cd-tog" tabindex="0"></button></div>' +
        '<div class="cd-row2"><div class="cd-status"></div><span class="cd-chip"></span></div></div><span class="cd-lane"><i></i></span>';
      c.glyph = e.querySelector('.cd-glyph'); c.name = e.querySelector('.cd-name'); c.retry = e.querySelector('.cd-retry'); c.chip = e.querySelector('.cd-chip');
      c.tog = e.querySelector('.cd-tog'); c.status = e.querySelector('.cd-status'); c.lane = e.querySelector('.cd-lane i');
      e.addEventListener('click', function (ev) { if (ev.target.closest && ev.target.closest('.cd-tog')) return; ctx.select(id); });
      e.addEventListener('keydown', function (ev) {
        if (ev.target !== e) return;
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); ctx.select(id); }
        else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); ev.stopPropagation(); var i = lay.order.indexOf(id) + (ev.key === 'ArrowDown' ? 1 : -1), t = cards[lay.order[i]]; if (t) t.el.focus(); }
      });
      c.tog.addEventListener('click', function (ev) { ev.stopPropagation(); toggle(id); });
      c.tog.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); toggle(id); } else ev.stopPropagation(); });
      return c;
    }
    function toggle(id) { toggles[id] = isCollapsed(id); render(); var c = cards[id]; if (c) c.tog.focus(); }

    function setText(node, key, c, v, prop) { if (c.k[key] !== v) { c.k[key] = v; node[prop || 'textContent'] = v; } }

    function chipFor(a, collapsed) {
      var ids = collapsed ? a.outputs.concat(INFO[a.id].outs) : a.outputs;
      if (!ids.length) return { html: '', title: '' };
      var list = ids.map(function (id) { for (var i = S.outputs.length - 1; i >= 0; i--) if (S.outputs[i].id === id) return S.outputs[i]; return { name: id, kind: 'doc' }; });
      var last = list[list.length - 1];
      return { html: kindIcon(last.kind) + '<span>' + esc(list.length === 1 ? last.name : '×' + list.length + ' ' + last.name) + '</span>', title: list.map(function (o) { return o.name; }).join(', ') };
    }

    function updateCard(c, n) {
      var a = S.agents[n.id], inf = INFO[n.id], hasKids = !!(KIDS[n.id] && KIDS[n.id].length), sel = ctx.selected();
      var rel = !!sel && sel !== n.id && relatedTo(sel, n.id);
      var cls = 'cd-card st-' + a.state + (isRoot(n.id) ? '' : ' sub') + (sel === n.id ? ' sel' : '') + (rel ? ' rel' : '') + (n.collapsed ? ' collapsed' : '') + (n.st.lines > 1 ? ' tall' : '');
      if (c.k.cls !== cls) { c.k.cls = cls; c.el.className = cls; }
      if (c.h !== n.h) { c.h = n.h; c.el.style.height = n.h + 'px'; }
      if (c.k.state !== a.state) { if (c.k.state && !snap) { if (a.state === 'done') bloom(c, 'done'); else if (a.state === 'failed') bloom(c, 'fail'); } c.k.state = a.state; }
      setText(c.glyph, 'g', c, glyph(a.state), 'innerHTML');
      setText(c.name, 'n', c, a.name);
      setText(c.retry, 'r', c, a.attempt > 1 ? '↻' + a.attempt : '');
      c.retry.title = a.attempt > 1 ? 'attempt ' + a.attempt : '';
      var ch = chipFor(a, n.collapsed); setText(c.chip, 'chip', c, ch.html, 'innerHTML'); c.chip.title = ch.title;
      var tg = '';
      if (hasKids) {
        var worst = n.collapsed && inf.worstState && inf.worstState !== 'done' ? glyph(inf.worstState, true) : (n.collapsed && inf.all ? glyph('done', true) : '');
        tg = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="' + (n.collapsed ? 'M3 1.5L7.5 5L3 8.5' : 'M1.5 3L5 7.5L8.5 3') + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' + inf.done + '/' + inf.desc + worst;
      }
      setText(c.tog, 'tog', c, tg, 'innerHTML');
      if (hasKids) {
        c.tog.setAttribute('aria-expanded', n.collapsed ? 'false' : 'true');
        c.tog.setAttribute('aria-label', (n.collapsed ? 'Expand ' : 'Collapse ') + a.name + ' subtree, ' + inf.done + ' of ' + inf.desc + ' done' + (n.collapsed && inf.worstState && inf.worstState !== 'done' ? ', worst: ' + inf.worstState : ''));
        c.tog.title = (n.collapsed ? 'Expand' : 'Collapse') + ' subtree (' + inf.desc + ' agents, ' + inf.done + ' done)';
      }
      setText(c.status, 's', c, n.st.text);
      var label = a.name + ': ' + (a.state === 'working' || a.state === 'done' ? a.state + (a.tool ? ', ' + a.tool : '') : n.st.text) + (a.outputs.length ? ', ' + a.outputs.length + ' output' + (a.outputs.length > 1 ? 's' : '') : '');
      if (c.k.aria !== label) { c.k.aria = label; c.el.setAttribute('aria-label', label); c.el.title = a.name + ' · ' + n.st.text; }
      c.el.setAttribute('aria-pressed', sel === n.id ? 'true' : 'false');
      // activity lane: when this agent was active, relative to the run so far (real start/end, nothing estimated)
      var tot = Math.max(S.t, 1), lw = 0, ll = 0;
      if (a.startedAt != null) { ll = a.startedAt / tot * 100; lw = Math.max(1.5, ((a.endedAt != null ? a.endedAt : S.t) - a.startedAt) / tot * 100); }
      var w = Math.round(ll * 10) / 10 + '|' + Math.round(lw * 10) / 10;
      if (c.k.tw !== w) { c.k.tw = w; c.lane.style.left = ll + '%'; c.lane.style.width = lw + '%'; }
    }

    function relatedTo(sel, id) {
      var a = S.agents[sel], b = S.agents[id]; if (!a || !b) return false;
      if (a.dependsOn.indexOf(id) >= 0 || b.dependsOn.indexOf(sel) >= 0) return true;
      return S.messages.some(function (m) { return (m.from === sel && m.to === id) || (m.from === id && m.to === sel); });
    }

    /* a one-shot ring around a card: an agent appearing, finishing or failing (only for changes seen live, never when a record is loaded) */
    function bloom(c, kind) {
      if (ctx.reducedMotion()) return;
      var b = el('span', 'cd-bloom cd-bloom-' + kind, c.el); b.addEventListener('animationend', function () { b.remove(); }); setTimeout(function () { b.remove(); }, 1400);
    }

    function syncCards() {
      var reduced = ctx.reducedMotion();
      Object.keys(cards).forEach(function (id) { if (!nodes[id]) { cards[id].el.remove(); delete cards[id]; } });
      var ref = tail;
      for (var i = lay.order.length - 1; i >= 0; i--) {
        var id = lay.order[i], n = nodes[id], c = cards[id], fresh = false;
        if (!c) { c = cards[id] = makeCard(id); fresh = true; }
        if (!c.el.parentNode) canvas.insertBefore(c.el, ref);
        ref = c.el;
        c.tx = n.x; c.ty = n.y;
        if (fresh) {
          var par = S.agents[id].parentId && cards[S.agents[id].parentId];
          if (snap || reduced || !par) { c.x = c.tx; c.y = c.ty; c.alpha = 1; } else { c.x = par.x + 36; c.y = par.y + (par.h - n.h) / 2; c.alpha = 0; bloom(c, 'spawn'); }
          c.applied = null;
        } else if (snap || reduced) { c.x = c.tx; c.y = c.ty; c.alpha = 1; }
        updateCard(c, n);
      }
      applyTransforms();
    }
    function applyTransforms() {
      Object.keys(cards).forEach(function (id) {
        var c = cards[id], key = c.x.toFixed(1) + ',' + c.y.toFixed(1) + ',' + c.alpha.toFixed(2);
        if (c.applied !== key) { c.applied = key; c.el.style.transform = 'translate3d(' + c.x.toFixed(1) + 'px,' + c.y.toFixed(1) + 'px,0)'; c.el.style.opacity = c.alpha < 1 ? c.alpha.toFixed(2) : ''; }
      });
    }

    /* ------------------------------------------------------------ task header, counts, result card */
    function drawChrome() {
      var root = lay.main && cards[lay.main], rn = lay.main && nodes[lay.main];
      emptyEl.style.display = lay.order.length ? 'none' : '';
      taskEl.style.display = countsEl.style.display = rn ? '' : 'none';
      if (rn) {
        var pct = Math.round(S.progress * 100);
        taskEl.style.left = rn.x + 'px'; taskEl.style.top = (rn.y - 56) + 'px';
        taskTitle.textContent = S.task ? S.task.title : 'Task';
        taskPct.textContent = 'TASK · ' + pct + '%'; taskBar.style.width = pct + '%';
        var c = S.counts, seg = [];
        [['done', 'done'], ['working', 'working'], ['waiting', 'waiting'], ['blocked', 'blocked'], ['failed', 'failed'], ['queued', 'queued']].forEach(function (p) { if (c[p[0]]) seg.push(c[p[0]] + ' ' + p[1]); });
        countsEl.textContent = seg.join(' · ');
        countsEl.style.left = rn.x + 'px'; countsEl.style.top = (rn.y + rn.h + 8) + 'px';
      }
      var width = PADX + (lay.maxDepth + 1) * PITCH + 50, height = lay.bottom + 40;
      if (S.finished && S.finishedInfo) {
        var fi = S.finishedInfo, bad = fi.status !== 'succeeded';
        var key = fi.status + '|' + fi.summary + '|' + fi.outputIds.join(',') + '|' + S.outputs.length;
        if (!resultEl) { resultEl = el('div', 'cd-result', canvas); }
        if (key !== resultKey) {
          resultKey = key; resultEl.className = 'cd-result' + (bad ? ' bad' : '');
          var h = '<div class="cd-result-h">RESULT · ' + esc(fi.status) + ' · ' + fi.outputIds.length + ' output' + (fi.outputIds.length === 1 ? '' : 's') + '</div>' +
            '<div class="cd-result-s">' + esc(fi.summary || '') + '</div><div class="cd-result-list"></div>';
          resultEl.innerHTML = h; var list = resultEl.querySelector('.cd-result-list');
          fi.outputIds.forEach(function (oid) {
            var o = null; S.outputs.forEach(function (x) { if (x.id === oid) o = x; }); if (!o) return;
            var b = el('button', 'cd-out', list); b.type = 'button'; b.title = 'Select ' + agentName(o.agentId);
            b.innerHTML = kindIcon(o.kind) + '<span>' + esc(o.name) + '</span><em>' + esc(agentName(o.agentId)) + '</em>';
            b.addEventListener('click', function () { selectVisible(o.agentId); });
            b.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); selectVisible(o.agentId); } else if (ev.key.indexOf('Arrow') === 0) ev.stopPropagation(); });
          });
        }
        var rw = Math.max(808, (lay.maxDepth + 1) * PITCH - 76);
        resultEl.style.width = rw + 'px'; resultEl.style.left = PADX + 'px'; resultEl.style.top = (lay.bottom + 30) + 'px';
        lay.resultY = lay.bottom + 30; lay.resultH = resultEl.offsetHeight; lay.resultW = rw;
        height = lay.resultY + lay.resultH + 40; width = Math.max(width, PADX + rw + 40);
      } else if (resultEl) { resultEl.remove(); resultEl = null; resultKey = ''; }
      canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
      under.setAttribute('width', width); under.setAttribute('height', height); over.setAttribute('width', width); over.setAttribute('height', height);
    }
    function selectVisible(id) { var g = 0, p = S.agents[id] && S.agents[id].parentId; while (p && g++ < 100) { toggles[p] = true; p = S.agents[p] && S.agents[p].parentId; } ctx.select(id); }

    /* ------------------------------------------------------------ edges */
    function vis(id) { var g = 0; while (id && !nodes[id] && g++ < 100) { var a = S.agents[id]; id = a && a.parentId; } return id && cards[id] ? id : null; }
    function ep(id) { var c = cards[id]; return { x: c.x + W, y: c.y + c.h / 2 }; }
    function arc(a, b, extra) {
      var ca = cards[a], cb = cards[b];
      if (Math.abs(ca.x - cb.x) > W) { // different columns (a report going back to the parent, an instruction going out): travel beside the connection, between the two cards
        var fwd = ca.x < cb.x, off = 9 + (extra % 3) * 3;
        var P = { x: fwd ? ca.x + W : ca.x, y: ca.y + ca.h / 2 + off }, Q = { x: fwd ? cb.x - 2 : cb.x + W + 2, y: cb.y + cb.h / 2 + off }, mx = (P.x + Q.x) / 2;
        return { A: P, B: Q, c1: { x: mx, y: P.y }, c2: { x: mx, y: Q.y } };
      }
      var A = ep(a), B = ep(b), same = Math.abs(A.x - B.x) < 2, bx = (same ? 20 : 46) + Math.min(26, Math.abs(A.y - B.y) / 14) + extra;
      return { A: A, B: B, c1: { x: A.x + bx, y: A.y }, c2: { x: B.x + bx, y: B.y } };
    }
    function pathD(p) { return 'M' + f(p.A.x) + ' ' + f(p.A.y) + 'C' + f(p.c1.x) + ' ' + f(p.c1.y) + ' ' + f(p.c2.x) + ' ' + f(p.c2.y) + ' ' + f(p.B.x) + ' ' + f(p.B.y); }
    function f(v) { return Math.round(v * 10) / 10; }
    function bez(p, u) { var m = 1 - u; return { x: m * m * m * p.A.x + 3 * m * m * u * p.c1.x + 3 * m * u * u * p.c2.x + u * u * u * p.B.x, y: m * m * m * p.A.y + 3 * m * m * u * p.c1.y + 3 * m * u * u * p.c2.y + u * u * u * p.B.y }; }

    function drawEdges() {
      if (!S || !lay) return;
      var sel = ctx.selected(), reduced = ctx.reducedMotion();
      var selVis = sel && vis(sel);
      var pathUp = {}; // ids whose elbow lies on the selection's path to the root
      if (sel) { var g = 0, q = sel; while (q && S.agents[q] && g++ < 100) { pathUp[q] = true; q = S.agents[q].parentId; } }
      var recentDeleg = {};
      S.delegations.forEach(function (d) { if (d.work && S.t - d.t >= 0 && S.t - d.t < 1600) recentDeleg[d.to] = true; });

      /* delegation: one persistent group per parent -> subagent connection (kept between redraws so its flow animation runs smoothly) */
      var live = {};
      lay.order.forEach(function (id) {
        var n = nodes[id], c = cards[id];
        n.kids.forEach(function (k) {
          var kc = cards[k.id]; if (!kc) return;
          var px = c.x + W, py = c.y + c.h / 2, kx = kc.x, ky = kc.y + kc.h / 2, ka = S.agents[k.id];
          var onPath = !!(pathUp[k.id] && sel), hot = !!recentDeleg[k.id] && ka.parentId === id;
          var e = edgeEls[k.id];
          if (!e) {
            e = edgeEls[k.id] = { g: svg('g', {}, gElb), k: {} };
            e.line = svg('path', { 'class': 'cd-edge-line' }, e.g); e.flow = svg('path', { 'class': 'cd-edge-flow' }, e.g);
            e.pa = svg('circle', { 'class': 'cd-port cd-port-a', r: 3 }, e.g); e.pb = svg('circle', { 'class': 'cd-port cd-port-b', r: 3 }, e.g);
          }
          live[k.id] = true;
          var cls = 'cd-edge st-' + ka.state + (hot ? ' hot' : '') + (onPath ? ' on' : sel ? ' dim' : '');
          if (e.k.cls !== cls) { e.k.cls = cls; e.g.setAttribute('class', cls); }
          var gap = kx - px, d = '';
          if (gap > 14) {
            var mid = px + gap / 2, dy = ky - py, r = Math.min(14, Math.abs(dy) / 2, gap / 2 - 2), sg = dy < 0 ? -1 : 1;
            d = r < 1 ? 'M' + f(px) + ' ' + f(py) + 'H' + f(kx)
              : 'M' + f(px) + ' ' + f(py) + 'H' + f(mid - r) + 'Q' + f(mid) + ' ' + f(py) + ' ' + f(mid) + ' ' + f(py + sg * r) + 'V' + f(ky - sg * r) + 'Q' + f(mid) + ' ' + f(ky) + ' ' + f(mid + r) + ' ' + f(ky) + 'H' + f(kx);
          }
          var key = d + '|' + kc.alpha.toFixed(2);
          if (e.k.d !== key) {
            e.k.d = key; e.line.setAttribute('d', d); e.flow.setAttribute('d', d);
            e.pa.setAttribute('cx', f(px)); e.pa.setAttribute('cy', f(py)); e.pb.setAttribute('cx', f(kx)); e.pb.setAttribute('cy', f(ky));
            e.g.style.display = d ? '' : 'none'; e.g.style.opacity = kc.alpha < 1 ? kc.alpha.toFixed(2) : '';
          }
        });
      });
      Object.keys(edgeEls).forEach(function (id) { if (!live[id]) { edgeEls[id].g.remove(); delete edgeEls[id]; } });
      var h = '';
      if (lay.resultY != null && lay.main && cards[lay.main]) { // root -> RESULT
        var rc = cards[lay.main], rx = rc.x + W / 2, bad = S.finishedInfo && S.finishedInfo.status !== 'succeeded';
        h += '<path d="M' + f(rx) + ' ' + f(rc.y + rc.h + 34) + 'V' + f(lay.resultY - 3) + '" stroke="' + (bad ? RUST : MINT) + '" stroke-opacity=".8" stroke-width="1.5" fill="none" marker-end="url(#' + (bad ? 'cd-m-resx' : 'cd-m-res') + ')"/>';
      }

      /* dependencies: dashed arcs in the right gutter, dependency -> dependent */
      var seen = {}, idx = 0;
      S.dependencies.forEach(function (d) {
        var a = vis(d.from), b = vis(d.to); if (!a || !b || a === b) return;
        var key = a + '>' + b; if (seen[key]) return; seen[key] = 1;
        var src = S.agents[d.from], unmet = !(src && src.state === 'done');
        var related = sel && (d.from === sel || d.to === sel || a === selVis || b === selVis);
        var op = sel ? (related ? 1 : 0.14) : (unmet ? 1 : 0.38);
        var p = arc(a, b, (idx++ % 3) * 5);
        h += '<path d="' + pathD(p) + '" stroke="' + (related ? INK : SLATE) + '" stroke-width="' + (related ? 2 : 1.6) + '" stroke-dasharray="5 4" fill="none" opacity="' + op + '" marker-end="url(#' + (related ? 'cd-m-depx' : 'cd-m-dep') + ')"/>';
      });
      gDep.innerHTML = h;

      /* messages: dotted green arcs (+ a label while recent, + a pulse on arrival) */
      h = ''; var oh = '', labels = [], msgs = S.messages.slice(-30);
      msgs.forEach(function (m, i) {
        var a = vis(m.from), b = vis(m.to); if (!a || !b || a === b) return;
        var age = S.t - m.t, related = sel && (m.from === sel || m.to === sel || a === selVis || b === selVis);
        var op = sel ? (related ? 1 : 0.15) : age < 3000 ? 1 : age < 9000 ? 0.7 : 0.4;
        var p = arc(a, b, 12 + (i % 3) * 5);
        h += '<path d="' + pathD(p) + '" stroke="' + ACC + '" stroke-width="' + (age < 3000 || related ? 2.8 : 2.2) + '" stroke-dasharray="0.1 5.5" stroke-linecap="round" fill="none" opacity="' + op + '" marker-end="url(#cd-m-msg)"/>';
        if (age >= 0 && age < LABEL_MS && (!sel || related)) { labels = labels.filter(function (l) { return l.a !== a; }); labels.push({ a: a, m: m }); }
      });
      gMsg.innerHTML = h;
      labels.forEach(function (l) { // a small tag on the top edge of the card that sent it (latest message per sender)
        var sc = cards[l.a], txt = l.m.text.length > 30 ? l.m.text.slice(0, 29) + '…' : l.m.text, w = txt.length * 6.7 + 16;
        oh += '<g transform="translate(' + f(sc.x + 18) + ' ' + f(sc.y - 10) + ')"><rect width="' + f(w) + '" height="19" rx="9.5" fill="' + RAISED + '" stroke="' + ACC + '" stroke-opacity=".7" stroke-width="1"/><text x="8" y="13.5" font-family="Menlo, monospace" font-size="11" fill="#CFE5FF">' + esc(txt) + '</text></g>';
      });
      if (!reduced) pulses.forEach(function (pl) {
        var a = vis(pl.from), b = vis(pl.to); if (!a || !b || a === b) return;
        var u = U.ease(Math.min(1, pl.age / PULSE_MS)), pt = bez(arc(a, b, 12 + (pl.i % 3) * 5), u);
        oh += '<circle cx="' + f(pt.x) + '" cy="' + f(pt.y) + '" r="11" fill="' + ACC + '" opacity=".22"/><circle cx="' + f(pt.x) + '" cy="' + f(pt.y) + '" r="4.5" fill="#EAF4FF" stroke="' + ACC + '" stroke-width="1.5"/>';
      });
      over.innerHTML = oh;
    }

    /* ------------------------------------------------------------ render + scrolling */
    function render() {
      if (!S) return;
      buildInfo(S); lay = doLayout(); syncCards(); drawChrome(); edgesDirty = true;
    }
    function ensureVisible(id) {
      var n = nodes[id]; if (!n) return;
      var top = scroller.scrollTop, left = scroller.scrollLeft, ch = scroller.clientHeight, cw = scroller.clientWidth, ty = null, tx = null;
      if (n.y < top + 8 || n.y + n.h > top + ch - 8) ty = Math.max(0, n.y - ch / 2 + n.h / 2);
      if (n.x + W > left + cw - 40 || n.x < left) tx = Math.max(0, n.x + W + 60 - cw);
      if (ty != null || tx != null) scrollTo = { x: tx == null ? left : tx, y: ty == null ? top : ty };
    }
    function scrollToResult() {
      if (lay.resultY == null) return;
      var ch = scroller.clientHeight;
      scrollTo = { x: 0, y: Math.max(0, Math.min(lay.resultY - 70, lay.resultY + lay.resultH + 36 - ch)) };
    }

    /* ------------------------------------------------------------ chrome hooks */
    return {
      update: function (s, events) {
        S = s;
        var spawned = null, finishedNow = false;
        (events || []).forEach(function (e) {
          if (e.type === 'message_sent' && !ctx.reducedMotion()) pulses.push({ from: e.fromId, to: e.toId, age: 0, i: S.messages.length });
          if (e.type === 'agent_spawned') spawned = e.agentId;
          if (e.type === 'task_finished') finishedNow = true;
        });
        render();
        if (spawned && !snap && performance.now() - lastUser > 6000) ensureVisible(spawned);
        if (S.finished && !prevFinished) { scrollToResult(); if (!finishedNow) scrollTo = scrollTo; }
        prevFinished = S.finished;
        snap = false;
      },
      frame: function (dt) {
        if (!S || !lay) return;
        var reduced = ctx.reducedMotion(), moving = false;
        var k = reduced ? 1 : 1 - Math.exp(-dt / 85);
        Object.keys(cards).forEach(function (id) {
          var c = cards[id];
          if (c.x !== c.tx || c.y !== c.ty) { c.x += (c.tx - c.x) * k; c.y += (c.ty - c.y) * k; if (Math.abs(c.tx - c.x) < 0.3) c.x = c.tx; if (Math.abs(c.ty - c.y) < 0.3) c.y = c.ty; moving = true; }
          if (c.alpha < 1) { c.alpha = reduced ? 1 : Math.min(1, c.alpha + dt / 260); moving = true; }
        });
        if (moving) applyTransforms();
        var pulsing = pulses.length > 0;
        if (pulsing) { pulses.forEach(function (p) { p.age += dt; }); pulses = pulses.filter(function (p) { return p.age < PULSE_MS; }); if (reduced) pulses = []; }
        if (scrollTo) {
          var dx = scrollTo.x - scroller.scrollLeft, dy = scrollTo.y - scroller.scrollTop, kk = reduced ? 1 : 1 - Math.exp(-dt / 140);
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) { scroller.scrollLeft = scrollTo.x; scroller.scrollTop = scrollTo.y; scrollTo = null; }
          else { scroller.scrollLeft += dx * kk; scroller.scrollTop += dy * kk; }
        }
        if (moving || pulsing || edgesDirty) { edgesDirty = false; drawEdges(); }
      },
      onSelect: function (id) { // selection can come from another view (Tool stream, Needs You, inspector): open collapsed ancestors and bring the card into view
        if (id && S && S.agents[id]) { var g = 0, p = S.agents[id].parentId, changed = false; while (p && g++ < 100) { if (isCollapsed(p)) { toggles[p] = true; changed = true; } p = S.agents[p] && S.agents[p].parentId; } render(); if (nodes[id]) ensureVisible(id); } else render();
      },
      onReset: function (s) {
        snap = true; pulses = []; scrollTo = null; prevFinished = false;
        if (!s.order.length) toggles = {};
        Object.keys(cards).forEach(function (id) { cards[id].el.remove(); delete cards[id]; });
        if (resultEl) { resultEl.remove(); resultEl = null; resultKey = ''; }
        S = s; render();
      },
      onMotionChange: function () { motionClass(); if (S) render(); },
      resize: function () { edgesDirty = true; }
    };
  }
});
