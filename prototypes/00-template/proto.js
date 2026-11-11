/* 00 Template: the smallest possible prototype. Copy this folder to start a new concept.
 *
 * Contract (see shared/chrome.js):
 *   create(stage, ctx) returns { update(state, events), frame(dtMs, nowMs, state), onSelect(id), onReset(state), resize(size) }
 *   - update   : called whenever the scenario state changes (events applied, seek, replay, pause...).
 *   - frame    : called every animation frame; use it for easing/particles. Skip motion if ctx.reducedMotion().
 *   - Click handler: call ctx.select(agentId) so the shared inspector shows that agent.
 * Never hide the source badge or imply the scripted data is live. The chrome handles that for you.
 */
AgentChrome.mount({
  id: '00', name: 'Template', tagline: 'Cards only. Copy me.',
  create: function (stage, ctx) {
    var root = document.createElement('div'); root.className = 'tpl'; stage.appendChild(root);
    var cards = {}; var pops = {};

    function ensure(a) {
      if (cards[a.id]) return cards[a.id];
      var el = document.createElement('button'); el.className = 'tpl-card'; el.type = 'button';
      el.innerHTML = '<div class="tpl-name"><span class="ac-ins-dot"></span><span class="n"></span></div><div class="tpl-sub"></div>';
      el.onclick = function () { ctx.select(a.id); };
      root.appendChild(el); cards[a.id] = el; return el;
    }
    function render(s) {
      var any = false;
      s.order.forEach(function (id) {
        any = true; var a = s.agents[id], el = ensure(a);
        var cls = 'tpl-card ' + a.state + (ctx.selected() === id ? ' sel' : '') + (pops[id] > 0 ? ' pop' : '');
        if (el.className !== cls) el.className = cls;
        el.querySelector('.ac-ins-dot').className = 'ac-ins-dot ac-st-' + a.state;
        el.querySelector('.n').textContent = a.name;
        el.querySelector('.tpl-sub').textContent = a.state === 'working' ? (a.tool || 'delegating') : a.state === 'blocked' ? 'needs ' + (a.needs || 'help') : a.state === 'failed' ? a.error : a.state === 'waiting' ? 'waits for ' + a.dependsOn.join(', ') : a.state;
      });
      Object.keys(cards).forEach(function (id) { if (!s.agents[id]) { cards[id].remove(); delete cards[id]; } });
    }
    return {
      update: function (s, events) { events.forEach(function (e) { if (e.type === 'agent_spawned' && !ctx.reducedMotion()) pops[e.agentId] = 400; }); render(s); },
      frame: function (dt) { var dirty = false; Object.keys(pops).forEach(function (k) { if (pops[k] > 0) { pops[k] -= dt; dirty = true; } }); if (dirty) render(ctx.state()); },
      onSelect: function () { render(ctx.state()); },
      onReset: function (s) { pops = {}; Object.keys(cards).forEach(function (k) { cards[k].remove(); delete cards[k]; }); render(s); }
    };
  }
});
