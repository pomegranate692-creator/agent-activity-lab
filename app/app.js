/* Unified viewer v0: one shell, four views (Cards, Timeline, Result, Tool stream), a "Needs you" strip.
 * Views are the existing prototypes 09, 07, 05 (code unchanged) plus the new Tool stream view. */
(function (g) {
  var reg = g.__AppViews, byId = {};
  reg.views.forEach(function (v) { byId[v.id] = v; });
  var CFG = g.__AppConfig || {};
  var ORDER = CFG.order || [['09', 'Cards'], ['07', 'Timeline'], ['05', 'Result'], ['one', 'All ten as one'], ['tools', 'Tool stream']];
  var GRID = !!CFG.grid; // "All ten" mode: a live tile grid of every design; click a tile to open it
  var params = new URLSearchParams(location.search);
  function el(tag, cls, text, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; }

  g.AgentChrome.mount = reg.realMount;
  g.AgentChrome.mount({
    id: CFG.num || 'AP', name: CFG.title || 'Agent Activity', tagline: CFG.tagline || 'Unified viewer v0 · Cards, Timeline, Result, Tool stream',
    create: function (stage, ctx) {
      var root = el('div', 'ap-root', null, stage);
      var need = el('div', 'ap-need', null, root); need.setAttribute('role', 'region'); need.setAttribute('aria-label', 'Needs you');
      var tabs = el('div', 'ap-tabs', null, root); tabs.setAttribute('role', 'tablist'); if (CFG.hideTabs) tabs.style.display = 'none';
      var viewport = el('div', 'ap-viewport', null, root);
      var liveUrl = params.get('live');
      var empty = null;
      if (liveUrl) {
        empty = el('div', 'ap-empty', null, viewport); empty.setAttribute('role', 'status');
        el('h2', null, 'Waiting for events…', empty);
        el('p', null, 'Listening to the adapter at ' + liveUrl + '. Nothing is shown until real events arrive, and this page never invents any.', empty);
        var ol = el('ol', null, null, empty);
        ['Run the adapter: node shared/adapter-server.mjs', 'Preview the hook install (writes nothing): node tools/hooks-install.mjs', 'When you are happy with it, add --apply, then start a NEW Claude Code session. The badge will read LIVE · hook events.', 'No Claude Code session handy? Replay a recorded one: node tools/transcript-to-events.mjs <transcript.jsonl> --out replay.json, then POST it to /replay. The badge will read REPLAY · transcript.'].forEach(function (t) { el('li', null, t, ol); });
        el('p', 'ap-empty-note', 'Tool-level hook events are not yet verified against a real session; node tools/hook-coverage.mjs shows exactly what a captured log proves.', empty);
      }
      var inst = {}, boxes = {}, tabEls = {}, active = null, userChose = false, tiles = {}, gridBox = null;
      var TILE_W = 940, TILE_H = 600; // layout size of a design while it sits in a tile; scaled down visually
      if (GRID) { root.classList.add('ap-all'); gridBox = el('div', 'ap-grid', null, viewport); var gt = el('button', 'ap-tab', 'All ten', tabs); gt.setAttribute('role', 'tab'); gt.type = 'button'; tabEls.grid = gt; gt.onclick = function () { userChose = true; show('grid'); }; }

      ORDER.forEach(function (o) {
        var cfg = byId[o[0]]; if (!cfg) return;
        var box = el('div', 'ap-view', null, GRID ? null : viewport); box.setAttribute('role', 'tabpanel'); boxes[o[0]] = box;
        if (GRID) { var tile = el('div', 'ap-tile', null, gridBox); var frame = el('div', 'ap-tile-frame', null, tile); var inner = el('div', 'ap-tile-inner', null, frame); inner.setAttribute('inert', ''); inner.appendChild(box); box.classList.add('on');
          var cap = el('div', 'ap-tile-cap', null, tile); el('b', null, cfg.name, cap); el('span', null, cfg.tagline || '', cap);
          var hit = el('button', 'ap-tile-hit', null, frame); hit.type = 'button'; hit.setAttribute('aria-label', 'Open ' + cfg.name + ' full size'); hit.onclick = function () { userChose = true; show(o[0]); };
          tiles[o[0]] = { tile: tile, frame: frame, inner: inner }; }
        if (GRID) box.getBoundingClientRect = function () { var r = Element.prototype.getBoundingClientRect.call(box), w = box.offsetWidth, h = box.offsetHeight; return { x: r.x, y: r.y, left: r.left, top: r.top, width: w, height: h, right: r.left + w, bottom: r.top + h }; }; // designs that read their own rect get layout size even when the tile is scaled
        var vctx = Object.assign({}, ctx, { size: function () { return { w: box.offsetWidth, h: box.offsetHeight }; } });
        inst[o[0]] = cfg.create(box, vctx) || {};
        var t = el('button', 'ap-tab', o[1], tabs); t.setAttribute('role', 'tab'); t.type = 'button'; tabEls[o[0]] = t;
        t.onclick = function () { if (t.getAttribute('aria-disabled') === 'true') return; userChose = true; show(o[0]); };
      });
      tabs.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        var ids = (GRID ? ['grid'] : []).concat(ORDER.map(function (o) { return o[0]; })).filter(function (id) { return tabEls[id] && tabEls[id].getAttribute('aria-disabled') !== 'true'; });
        var i = ids.indexOf(active); i = (i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length; userChose = true; show(ids[i]); tabEls[ids[i]].focus(); e.preventDefault();
      });

      function layoutTiles() {
        if (!GRID) return; var cols = Math.max(1, Math.floor(gridBox.clientWidth / 300)); gridBox.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
        Object.keys(tiles).forEach(function (k) { var T = tiles[k]; var w = T.frame.clientWidth || 280; var sc = w / TILE_W; T.frame.style.height = Math.round(TILE_H * sc) + 'px'; T.inner.style.transform = 'scale(' + sc + ')'; });
      }
      function show(id) {
        active = id;
        var gridOn = GRID && id === 'grid'; if (gridBox) gridBox.style.display = gridOn ? 'grid' : 'none';
        Object.keys(boxes).forEach(function (k) {
          var b = boxes[k];
          if (GRID) { var want = gridOn ? tiles[k].inner : viewport; if (!gridOn && k !== id) want = tiles[k].inner; if (b.parentNode !== want) want.appendChild(b); }
          b.classList.toggle('on', gridOn || k === id);
        });
        Object.keys(tabEls).forEach(function (k) { tabEls[k].setAttribute('aria-selected', String(k === id)); tabEls[k].tabIndex = k === id ? 0 : -1; });
        if (gridOn) layoutTiles();
        Object.keys(boxes).forEach(function (k) { var i1 = inst[k]; if (!i1) return; if (gridOn || k === id) { if (i1.resize) i1.resize(vsize(k)); if (i1.update) i1.update(ctx.state(), [], 0); if (i1.onSelect) i1.onSelect(ctx.selected()); } });
      }
      function vsize(id) { return { w: boxes[id].offsetWidth, h: boxes[id].offsetHeight }; }
      window.addEventListener('resize', function () { if (active === 'grid') layoutTiles(); });

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
          if (!GRID && inst.tools && inst['09']) { var want = s.order.length && s.order.length <= 2 ? 'tools' : '09'; if (s.order.length && want !== active) show(want); }
        }
      }
      var DEFAULT = inst['09'] ? '09' : ORDER.map(function (o) { return o[0]; }).filter(function (id) { return inst[id]; })[0];
      show(GRID ? 'grid' : DEFAULT);
      return {
        update: function (s, events, dt) {
          if (empty) empty.style.display = s.order.length ? 'none' : '';
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
