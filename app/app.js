/* Unified viewer v0: one shell, four views (Cards, Timeline, Result, Tool stream), a "Needs you" strip.
 * Views are the existing prototypes 09, 07, 05 (code unchanged) plus the new Tool stream view. */
(function (g) {
  var reg = g.__AppViews, byId = {};
  reg.views.forEach(function (v) { byId[v.id] = v; });
  var ORDER = [['09', 'Cards'], ['07', 'Timeline'], ['05', 'Result'], ['tools', 'Tool stream']];
  var params = new URLSearchParams(location.search);
  function el(tag, cls, text, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; }

  g.AgentChrome.mount = reg.realMount;
  g.AgentChrome.mount({
    id: 'AP', name: 'Agent Activity', tagline: 'Unified viewer v0 · Cards, Timeline, Result, Tool stream',
    create: function (stage, ctx) {
      var root = el('div', 'ap-root', null, stage);
      var need = el('div', 'ap-need', null, root); need.setAttribute('role', 'region'); need.setAttribute('aria-label', 'Needs you');
      var tabs = el('div', 'ap-tabs', null, root); tabs.setAttribute('role', 'tablist');
      var viewport = el('div', 'ap-viewport', null, root);
      var inst = {}, boxes = {}, tabEls = {}, active = null, userChose = false;

      ORDER.forEach(function (o) {
        var cfg = byId[o[0]]; if (!cfg) return;
        var box = el('div', 'ap-view', null, viewport); box.setAttribute('role', 'tabpanel'); boxes[o[0]] = box;
        var vctx = Object.assign({}, ctx, { size: function () { var r = box.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; } });
        inst[o[0]] = cfg.create(box, vctx) || {};
        var t = el('button', 'ap-tab', o[1], tabs); t.setAttribute('role', 'tab'); t.type = 'button'; tabEls[o[0]] = t;
        t.onclick = function () { if (t.getAttribute('aria-disabled') === 'true') return; userChose = true; show(o[0]); };
      });
      tabs.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        var ids = ORDER.map(function (o) { return o[0]; }).filter(function (id) { return tabEls[id] && tabEls[id].getAttribute('aria-disabled') !== 'true'; });
        var i = ids.indexOf(active); i = (i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length; userChose = true; show(ids[i]); tabEls[ids[i]].focus(); e.preventDefault();
      });

      function show(id) {
        active = id;
        Object.keys(boxes).forEach(function (k) { boxes[k].classList.toggle('on', k === id); tabEls[k].setAttribute('aria-selected', String(k === id)); tabEls[k].tabIndex = k === id ? 0 : -1; });
        var inst1 = inst[id]; if (inst1.resize) inst1.resize(vsize(id));
        if (inst1.update) inst1.update(ctx.state(), [], 0);
        if (inst1.onSelect) inst1.onSelect(ctx.selected());
      }
      function vsize(id) { var r = boxes[id].getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }

      function renderNeed(s) {
        var items = [];
        s.order.forEach(function (id) { var a = s.agents[id]; if (a.state === 'blocked') items.push({ id: id, k: 'blocked', who: a.label || a.name, why: a.blockedReason || 'blocked' }); else if (a.state === 'failed') items.push({ id: id, k: 'failed', who: a.label || a.name, why: a.error || 'failed' }); });
        var key = items.map(function (i) { return i.id + i.k + i.why; }).join('|') + '|' + ctx.selected();
        if (need.dataset.key === key) return; need.dataset.key = key; need.innerHTML = '';
        el('span', 'ap-need-label', 'NEEDS YOU', need);
        if (!items.length) { el('span', 'ap-need-none', s.finished ? 'Nothing is blocked or failed.' : 'Nothing is blocked or failed right now.', need); return; }
        items.forEach(function (i) {
          var b = el('button', 'ap-pill ap-pill-' + i.k, null, need); b.type = 'button'; b.title = i.who + ' ' + i.k + ': ' + i.why; b.setAttribute('aria-label', i.who + ' ' + i.k + ': ' + i.why);
          el('span', 'ap-glyph', null, b); el('b', null, i.who + (i.k === 'blocked' ? ' BLOCKED' : ' FAILED'), b); el('span', 'ap-why', i.why, b);
          b.onclick = function () { ctx.select(i.id); };
        });
      }
      var lastCounts = '';
      function updateTabs(s) {
        var resultOk = s.outputs.length > 0 || s.finished;
        var rt = tabEls['05']; if (rt) { rt.setAttribute('aria-disabled', String(!resultOk)); rt.title = resultOk ? '' : 'Available once the task has produced outputs or finished'; }
        if (!userChose) {
          var want = s.order.length && s.order.length <= 2 ? 'tools' : '09';
          if (s.order.length && want !== active) show(want);
          else if (!active) show('09');
        }
      }
      show('09');
      return {
        update: function (s, events, dt) {
          renderNeed(s); updateTabs(s);
          Object.keys(inst).forEach(function (k) { if (inst[k].update) inst[k].update(s, k === active ? events : events, dt); });
        },
        frame: function (dt, now, s) { Object.keys(inst).forEach(function (k) { if (inst[k].frame) inst[k].frame(dt, now, s); }); },
        onSelect: function (id) { Object.keys(inst).forEach(function (k) { if (inst[k].onSelect) inst[k].onSelect(id); }); renderNeed(ctx.state()); },
        onReset: function (s) { userChose = userChose; Object.keys(inst).forEach(function (k) { if (inst[k].onReset) inst[k].onReset(s); }); need.dataset.key = ''; },
        onMotionChange: function (r) { Object.keys(inst).forEach(function (k) { if (inst[k].onMotionChange) inst[k].onMotionChange(r); }); },
        resize: function () { Object.keys(inst).forEach(function (k) { if (inst[k].resize) inst[k].resize(vsize(k)); }); }
      };
    }
  });
})(window);
