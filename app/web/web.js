/*
 * Living Web view: the main visualization. Claude Code is the hub, every real subagent is a node around it, strands show who created whom.
 * The picture itself comes from shared/livingweb.js (the same renderer the local service uses for the pane inside the Claude app).
 * This file only: redraws when the state changes, lays an invisible real <button> over every node (click, keyboard, screen reader),
 * fills the "Right now" panel, and shows the task name in the header.
 */
window.__AppViews.views.push({
  id: 'web', name: 'Living Web', tagline: 'Claude Code in the centre, its subagents around it.',
  create: function (stage, ctx) {
    var LW = window.LivingWeb, S = null, dirty = true, lastDraw = 0, sig = '', btns = {}, lastT = 0;
    function el(tag, cls, parent, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; }
    var wrap = el('div', 'lw-wrap', stage), art = el('div', 'lw-art', wrap), hits = el('div', 'lw-hits', wrap);
    art.setAttribute('aria-hidden', 'true');
    wrap.addEventListener('click', function (e) { if (!(e.target.closest && e.target.closest('.lw-node')) && ctx.selected()) ctx.select(null); });
    var taskEl = null;
    function header() { // the task name sits in the header, next to the product name
      if (!taskEl) { var t = document.querySelector('.ac-title'); if (!t) return; taskEl = el('span', 'lw-task', t); }
      var title = S && S.task && S.task.title ? S.task.title : '';
      if (taskEl.textContent !== title) { taskEl.textContent = title; taskEl.title = title; taskEl.style.display = title ? '' : 'none'; }
    }
    function inset() { // keep the web clear of the floating panel (wide screens) and the view switch at the bottom
      var w = wrap.clientWidth, p = document.querySelector('.ac-inspector'), r = 0;
      if (p && w >= 900 && p.offsetWidth && getComputedStyle(p).position === 'absolute') r = p.offsetWidth + 20;
      return { l: 8, r: r, t: 44, b: 50 };
    }
    function signature() {
      var s = S.order.length + '|' + S.messages.length + '|' + S.delegations.length + '|' + (S.finished ? 1 : 0) + '|' + (S.task ? S.task.title : '') + '|' + ctx.selected() + '|';
      for (var i = 0; i < S.order.length; i++) { var a = S.agents[S.order[i]]; s += a.state.charAt(0) + (a.tool || '') + (a.toolAt || 0) + (a.toolInput || '').length + ';'; }
      return s;
    }
    function draw() {
      var w = wrap.clientWidth, h = wrap.clientHeight; if (!S || w < 40 || h < 40) return;
      var res = LW.render(S, { w: w, h: h, inset: inset(), now: Date.now(), t: S.t, selected: ctx.selected(), reduced: ctx.reducedMotion() });
      art.innerHTML = res.svg;
      var L = res.layout, seen = {}, sel = ctx.selected();
      Object.keys(L.nodes).forEach(function (id) {
        var n = L.nodes[id], a = S.agents[id], b = btns[id]; if (!a) return; seen[id] = 1;
        if (!b) { b = btns[id] = el('button', 'lw-node', hits); b.type = 'button'; b.dataset.id = id; b.sr = el('span', 'lw-sr', b); b.onclick = function (e) { e.stopPropagation(); ctx.select(ctx.selected() === id ? null : id); }; }
        var d = Math.round(n.r * 2 + 8), act = LW.activity(S, a), name = LW.titleOf(S, a), label = name + (name !== a.name ? ' (' + a.name + ')' : '') + ' · ' + act;
        b.style.width = b.style.height = d + 'px'; b.style.transform = 'translate(' + Math.round(n.x - d / 2) + 'px,' + Math.round(n.y - d / 2) + 'px)';
        b.className = 'lw-node lw-is-' + n.kind + ' st-' + a.state + (sel === id ? ' sel' : ''); b.setAttribute('aria-pressed', String(sel === id));
        if (b.sr.textContent !== label) { b.sr.textContent = label; b.title = label; }
      });
      Object.keys(btns).forEach(function (id) { if (!seen[id]) { btns[id].remove(); delete btns[id]; } });
      header();
      if (!sel && window.__InspectorIdle) { var panel = document.querySelector('.ac-inspector'); if (panel && !panel.classList.contains('has-sel') && !panel.contains(document.activeElement)) { panel.innerHTML = ''; window.__InspectorIdle(S, panel); } } // keep "Right now" in step with the picture
    }
    /* "Right now": what every agent is doing, in a few words. Shown in the side panel while no agent is selected. */
    window.__InspectorIdle = function (s, box) {
      var sm = LW.summary(s), head = el('div', 'lw-now-h', box, 'Right now');
      if (!sm.agents.length) { el('div', 'lw-now-empty', box, 'Waiting for Claude Code. Give it a task and your agents appear here.'); return; }
      var list = el('div', 'lw-now', box);
      sm.agents.slice(0, 14).forEach(function (a) {
        var row = el('button', 'lw-row lw-t-' + a.tone, list); row.type = 'button'; row.title = a.name + (a.type !== a.name ? ' (' + a.type + ')' : '') + ' · ' + a.text;
        var ic = el('span', 'lw-ic', row); ic.innerHTML = '<svg viewBox="-12 -12 24 24" aria-hidden="true">' + (a.main ? LW.burst(22) : LW.icon(s.agents[a.id], 20, LW.COLORS[a.tone])) + '</svg>';
        var tx = el('span', 'lw-row-x', row); el('b', null, tx, a.name); el('span', 'lw-row-t', tx, a.text);
        row.onclick = function () { ctx.select(a.id); };
      });
      if (sm.agents.length > 14) el('div', 'lw-now-more', box, '+ ' + (sm.agents.length - 14) + ' more');
      head.title = sm.title;
    };
    window.__AgentTitle = function (s, a) { return LW.titleOf(s, a); }; // the details panel names a subagent by its job too; its type is listed there as "Agent type"
    return {
      update: function (s, events) {
        S = s;
        if ((events && events.length) || s.t < lastT) dirty = true; else { var g = signature(); if (g !== sig) dirty = true; }
        lastT = s.t;
      },
      frame: function () {
        if (!dirty || !S) return; var now = performance.now(); if (now - lastDraw < 70) return;
        dirty = false; lastDraw = now; sig = signature(); draw();
      },
      onSelect: function () { dirty = true; lastDraw = 0; },
      onReset: function (s) { S = s; dirty = true; lastDraw = 0; Object.keys(btns).forEach(function (id) { btns[id].remove(); delete btns[id]; }); },
      onMotionChange: function () { dirty = true; },
      resize: function () { dirty = true; }
    };
  }
});
