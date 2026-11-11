/*
 * AgentChrome: the shared shell around every prototype.
 *   header   : concept name, source badge (cannot be removed by a prototype)
 *   stage    : the prototype draws here
 *   inspector: selected agent's task, state, tool, blocker/error, recent actions, outputs
 *   footer   : play/pause, replay, speed, scrubber, task progress, state legend
 * Controls: Space play/pause, R replay, 1-4 speed (0.5x 1x 2x 4x), Left/Right +-1s, Esc deselect.
 * Reduced motion: honours prefers-color... prefers-reduced-motion and has a visible toggle.
 *
 * A prototype is a factory:  create(stageEl, ctx) -> { update(state, events), frame(dtMs, nowMs, state),
 *                                                      onSelect(id|null), onReset(state), resize() }
 * ctx: { core, select(id), selected(), state(), reducedMotion(), size() }
 *
 * Capture hook (used by tools/capture.mjs): window.__agentlab = { step(dtMs), seek(ms), select(id), ... }
 */
(function (global) {
  'use strict';
  var core = global.AgentCore, U = core.util;
  var SPEEDS = [0.5, 1, 2, 4];

  function h(tag, cls, text, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; }

  function mount(cfg) {
    var P = core.params();
    var scenario = (P.scenario === 'stress' && global.AGENT_SCENARIO_STRESS) || global.AGENT_SCENARIO;
    var src = core.Sources.simulated(scenario);
    var live = P.live; // ?live=http://127.0.0.1:7777  -> use the adapter server instead of the scripted scenario
    var root = document.getElementById('app') || document.body;
    root.innerHTML = '';
    root.classList.add('ac-root');

    /* ---------------- header ---------------- */
    var header = h('header', 'ac-header', null, root);
    var title = h('div', 'ac-title', null, header);
    h('span', 'ac-num', cfg.id, title); h('span', 'ac-name', cfg.name, title); h('span', 'ac-tag', cfg.tagline || '', title);
    var badge = h('div', 'ac-badge', null, header);
    var badgeDot = h('span', 'ac-badge-dot', null, badge); var badgeText = h('span', 'ac-badge-text', '', badge);

    /* ---------------- main ---------------- */
    var main = h('main', 'ac-main', null, root);
    var stage = h('div', 'ac-stage', null, main); stage.setAttribute('role', 'img'); stage.setAttribute('aria-label', cfg.name + ' visualization of agent activity');
    var inspector = h('aside', 'ac-inspector', null, main);

    /* ---------------- footer ---------------- */
    var footer = h('footer', 'ac-footer', null, root);
    var row1 = h('div', 'ac-row', null, footer);
    var btnReplay = h('button', 'ac-btn', 'Replay', row1); btnReplay.title = 'Replay (R)';
    var btnPlay = h('button', 'ac-btn ac-btn-primary', 'Pause', row1); btnPlay.title = 'Play / pause (Space)';
    var speedWrap = h('div', 'ac-speed', null, row1);
    var speedBtns = SPEEDS.map(function (s) { var b = h('button', 'ac-btn ac-btn-sm', s + '×', speedWrap); b.dataset.speed = s; return b; });
    var scrubWrap = h('div', 'ac-scrub', null, row1);
    var markers = h('div', 'ac-markers', null, scrubWrap);
    var scrub = h('input', 'ac-range', null, scrubWrap); scrub.type = 'range'; scrub.min = 0; scrub.max = scenario.meta.durationMs; scrub.step = 10; scrub.value = 0; scrub.setAttribute('aria-label', 'Timeline');
    var timeLbl = h('div', 'ac-time', '0.0s', row1);
    var motionWrap = h('label', 'ac-motion', null, row1);
    var motionBox = h('input', null, null, motionWrap); motionBox.type = 'checkbox'; h('span', null, 'Reduce motion', motionWrap);
    var row2 = h('div', 'ac-row ac-row2', null, footer);
    var taskLine = h('div', 'ac-task', '', row2);
    var legend = h('div', 'ac-legend', null, row2);
    [['working', 'working'], ['waiting', 'waiting'], ['blocked', 'blocked'], ['failed', 'failed'], ['done', 'done']].forEach(function (p) { var i = h('span', 'ac-leg', null, legend); var d = h('span', 'ac-leg-dot ac-st-' + p[0], null, i); h('span', null, p[1], i); });
    var noteLine = h('div', 'ac-note', '', footer);

    /* ---------------- state ---------------- */
    var selectedId = null; var reduced = core.reducedMotion() || P.reduced === '1'; motionBox.checked = reduced;
    var proto = null, player = null, liveConn = null, lastFrame = 0, paused = false;

    var ctx = {
      core: core, select: function (id) { select(id); }, selected: function () { return selectedId; }, state: function () { return player.state; },
      reducedMotion: function () { return reduced; }, size: function () { var r = stage.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }
    };

    function setBadge(kind, text, note) {
      badge.className = 'ac-badge ac-badge-' + kind; badgeText.textContent = text; badge.title = note || '';
    }

    function renderBadge(s) {
      if (s.source === 'simulated') setBadge('sim', 'SIMULATED', s.sourceNote || 'Scripted scenario. No real agents are running.');
      else if (s.source === 'live-hook') setBadge('live', 'LIVE · hook events', s.sourceNote || '');
      else if (s.source === 'transcript') setBadge('replay', 'REPLAY · transcript', s.sourceNote || '');
      else if (s.source === 'self-reported') setBadge('replay', 'SELF-REPORTED · not verified', s.sourceNote || '');
      else setBadge('sim', String(s.source).toUpperCase(), s.sourceNote || '');
      noteLine.textContent = s.source === 'simulated' ? 'Simulated activity: a scripted scenario, not live work. Connect an adapter (README) to show real agents.' : (s.sourceNote || '');
    }

    function renderInspector(s) {
      inspector.innerHTML = '';
      var a = selectedId && s.agents[selectedId];
      var head = h('div', 'ac-ins-head', null, inspector);
      h('div', 'ac-ins-kicker', a ? 'SELECTED AGENT' : 'NO AGENT SELECTED', head);
      if (!a) {
        h('div', 'ac-ins-empty', 'Click an agent in the visualization to see its current task and recent actions.', inspector);
        var act = h('div', 'ac-ins-sec', null, inspector); h('div', 'ac-ins-label', 'Latest activity', act);
        s.log.slice(-9).reverse().forEach(function (l) { var r = h('div', 'ac-log ac-k-' + l.kind, null, act); h('span', 'ac-log-t', U.fmtTime(l.t), r); h('span', 'ac-log-x', l.text, r); });
        return;
      }
      var nm = h('div', 'ac-ins-name', null, head); h('span', 'ac-ins-dot ac-st-' + a.state, null, nm); h('span', null, a.name, nm);
      h('div', 'ac-ins-role', a.role, head);
      var chip = h('div', 'ac-chip ac-chip-' + a.state, a.state.toUpperCase() + (a.attempt > 1 ? ' · attempt ' + a.attempt : ''), head);
      function sec(label, text, cls) { if (!text) return; var d = h('div', 'ac-ins-sec', null, inspector); h('div', 'ac-ins-label', label, d); h('div', 'ac-ins-text ' + (cls || ''), text, d); }
      sec('Current task', a.work || (a.state === 'waiting' ? 'Waiting for: ' + a.dependsOn.map(function (d) { return s.agents[d] ? s.agents[d].name : d; }).join(', ') : ''));
      if (a.state === 'working' && a.tool) sec('Tool in use', a.tool + (a.toolInput ? ' · ' + a.toolInput : ''), 'ac-mono');
      if (a.state === 'blocked') sec('Blocked', a.blockedReason + (a.needs ? ' (needs ' + a.needs + ')' : ''), 'ac-amber');
      if (a.state === 'failed') sec('Failure', a.error, 'ac-rust');
      if (a.state === 'waiting' && a.dependsOn.length) sec('Waits for', a.dependsOn.map(function (d) { return s.agents[d] ? s.agents[d].name + ' (' + s.agents[d].state + ')' : d; }).join(', '));
      if (a.parentId) sec('Spawned by', s.agents[a.parentId] ? s.agents[a.parentId].name : a.parentId);
      if (a.children.length) sec('Subagents', a.children.map(function (c) { return s.agents[c].name + ' (' + s.agents[c].state + ')'; }).join(', '));
      var outs = a.outputs.map(function (id) { var o = s.outputs.filter(function (x) { return x.id === id; })[0]; return o ? o.name : id; });
      if (outs.length) sec('Outputs', outs.join(', '), 'ac-mono');
      var rec = h('div', 'ac-ins-sec', null, inspector); h('div', 'ac-ins-label', 'Recent actions', rec);
      a.recent.slice(-7).reverse().forEach(function (l) { var r = h('div', 'ac-log ac-k-' + l.kind, null, rec); h('span', 'ac-log-t', U.fmtTime(l.t), r); h('span', 'ac-log-x', l.text, r); });
    }

    function renderFooter(s) {
      btnPlay.textContent = player.live ? 'Live' : (player.playing ? 'Pause' : (player.t >= player.duration ? 'Done' : 'Play'));
      btnPlay.disabled = !!player.live;
      speedBtns.forEach(function (b) { b.classList.toggle('on', Number(b.dataset.speed) === player.speed); });
      if (document.activeElement !== scrub) { scrub.max = player.duration; scrub.value = player.t; }
      timeLbl.textContent = (player.t / 1000).toFixed(1) + 's / ' + (player.duration / 1000).toFixed(1) + 's';
      var pct = Math.round(s.progress * 100);
      var c = s.counts;
      taskLine.innerHTML = '';
      h('span', 'ac-task-title', s.task ? s.task.title : 'Waiting for a task…', taskLine);
      var bar = h('span', 'ac-bar', null, taskLine); var fill = h('span', 'ac-bar-fill', null, bar); fill.style.width = pct + '%';
      h('span', 'ac-task-meta', pct + '% · ' + c.done + ' of ' + Math.max(s.plannedTotal, s.order.length) + ' agents done' + (c.working ? ' · ' + c.working + ' working' : '') + (c.waiting ? ' · ' + c.waiting + ' waiting' : '') + (c.blocked ? ' · ' + c.blocked + ' blocked' : '') + (c.failed ? ' · ' + c.failed + ' failed' : '') + (s.finished ? ' · finished' : ''), taskLine);
    }

    function select(id) {
      selectedId = id && player.state.agents[id] ? id : null;
      renderInspector(player.state); if (proto && proto.onSelect) proto.onSelect(selectedId);
    }

    function fullUpdate(s, events, dtSim) {
      renderBadge(s); renderFooter(s);
      if (selectedId) renderInspector(s); else if (events.length || !inspector.firstChild) renderInspector(s);
      if (proto && proto.update) proto.update(s, events, dtSim);
    }

    /* ---------------- build player ---------------- */
    player = new core.Player({
      events: src.events, meta: src.meta, duration: scenario.meta.durationMs,
      onUpdate: function (s, ev, dt) { fullUpdate(s, ev, dt); },
      onReset: function (s) { if (proto && proto.onReset) proto.onReset(s); },
      onEvent: function () {}
    });
    if (live) { player.live = true; player.events = []; player.state = core.initialState({ source: 'live-hook', sourceNote: 'Events streamed from the adapter server at ' + live, agents: [] }); player.meta = { source: 'live-hook' }; }

    // markers on the scrubber for events that matter
    scenario.events.forEach(function (e) {
      var k = e.type === 'agent_blocked' ? 'blocked' : e.type === 'agent_failed' ? 'failed' : e.type === 'task_finished' ? 'done' : e.type === 'output_produced' ? 'out' : null;
      if (!k) return; var m = h('span', 'ac-mark ac-mark-' + k, null, markers); m.style.left = (e.t / scenario.meta.durationMs * 100) + '%'; m.title = e.type.replace('_', ' ') + ' · ' + U.fmtTime(e.t);
    });

    /* ---------------- create prototype ---------------- */
    proto = cfg.create(stage, ctx) || {};
    function onResize() { if (proto.resize) proto.resize(ctx.size()); }
    window.addEventListener('resize', onResize); setTimeout(onResize, 0);

    /* ---------------- wire controls ---------------- */
    btnPlay.onclick = function () { player.toggle(); };
    btnReplay.onclick = function () { player.replay(); select(null); };
    speedBtns.forEach(function (b) { b.onclick = function () { player.setSpeed(Number(b.dataset.speed)); }; });
    scrub.oninput = function () { player.pause(); player.seek(Number(scrub.value)); };
    motionBox.onchange = function () { reduced = motionBox.checked; if (proto.onMotionChange) proto.onMotionChange(reduced); };
    document.addEventListener('keydown', function (e) {
      if (e.target && (e.target.tagName === 'INPUT' && e.target.type === 'range')) { if (e.key === ' ') e.preventDefault(); }
      if (e.key === ' ') { e.preventDefault(); player.toggle(); }
      else if (e.key === 'r' || e.key === 'R') { player.replay(); select(null); }
      else if (e.key >= '1' && e.key <= '4') player.setSpeed(SPEEDS[Number(e.key) - 1]);
      else if (e.key === 'ArrowRight') { player.pause(); player.seek(player.t + 1000); }
      else if (e.key === 'ArrowLeft') { player.pause(); player.seek(player.t - 1000); }
      else if (e.key === 'Escape') select(null);
    });

    /* ---------------- animation loop (visual frames, independent of scenario clock) ---------------- */
    function frameLoop(now) {
      if (!lastFrame) lastFrame = now; var dt = Math.min(now - lastFrame, 100); lastFrame = now;
      if (!global.__agentlab || !global.__agentlab.manual) { if (proto.frame) proto.frame(dt, now, player.state); requestAnimationFrame(frameLoop); }
    }
    requestAnimationFrame(frameLoop);

    /* ---------------- capture / test hook ---------------- */
    global.__agentlab = {
      manual: false, player: player, proto: function () { return proto; },
      beginManual: function () { this.manual = true; player.manual = true; },
      step: function (dtMs) { if (proto.frame) proto.frame(dtMs, performance.now(), player.state); player.step(dtMs); },
      seek: function (ms) { player.seek(ms); }, play: function () { player.playing = true; player.onUpdate(player.state, [], 0); }, pause: function () { player.pause(); },
      setSpeed: function (x) { player.setSpeed(x); }, select: select, state: function () { return player.state; }, ctx: ctx
    };
    if (P.capture === '1') global.__agentlab.beginManual();

    /* ---------------- start ---------------- */
    if (P.speed) player.setSpeed(Number(P.speed));
    fullUpdate(player.state, [], 0);
    if (live) { liveConn = core.Sources.live(live, player, function (st) { noteLine.textContent = 'Adapter: ' + st; }); player.play(); }
    else { player.seek(P.t ? Number(P.t) : 0); if (P.autoplay !== '0' && P.capture !== '1') player.play(); }
    return global.__agentlab;
  }

  global.AgentChrome = { mount: mount };
})(window);
