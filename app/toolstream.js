/* Tool stream view: a time-ordered list of what the agent(s) did. Built for the common real case of ONE agent making
 * sequential tool calls. Derives everything from state.log (the reducer keeps the last 200 lines). */
(function (g) {
  g.__AppViews.views.push({
    id: 'tools', name: 'Tool stream',
    create: function (stage, ctx) {
      var U = ctx.core.util;
      var wrap = document.createElement('div'); wrap.className = 'ts-wrap'; stage.appendChild(wrap);
      var head = document.createElement('div'); head.className = 'ts-head'; wrap.appendChild(head);
      var list = document.createElement('div'); list.className = 'ts-list'; list.setAttribute('role', 'list'); list.setAttribute('aria-label', 'Actions in time order'); wrap.appendChild(list);
      var ctl = document.createElement('div'); ctl.className = 'ts-ctl'; ctl.setAttribute('role', 'toolbar'); ctl.setAttribute('aria-label', 'Filter actions'); head.after(ctl);
      var note = document.createElement('div'); note.className = 'ts-note'; wrap.appendChild(note);
      var kindF = 'all', agentF = '', grouped = false, ctlSig = '', onlySel = false, internal = false;
      var FILTERS = [['all', 'All'], ['problems', 'Problems'], ['tool', 'Tool calls'], ['message', 'Messages & handoffs']];
      function passKind(l) { if (kindF === 'all') return true; if (kindF === 'problems') return l.kind === 'failed' || l.kind === 'blocked' || l.kind === 'retry' || l.kind === 'unblocked'; if (kindF === 'tool') return l.kind === 'tool'; return l.kind === 'message' || l.kind === 'delegate' || l.kind === 'output'; }
      function renderCtl(s) {
        var sg = FILTERS.map(function (f) { return f[0]; }).join() + '|' + agentF + '|' + grouped + '|' + kindF + '|' + s.order.length + '|' + sel + '|' + onlySel;
        if (sg === ctlSig) return; ctlSig = sg; ctl.innerHTML = '';
        FILTERS.forEach(function (f) { var b = el('button', 'ts-chip' + (kindF === f[0] ? ' on' : ''), f[1], ctl); b.type = 'button'; b.setAttribute('aria-pressed', String(kindF === f[0])); b.onclick = function () { kindF = f[0]; sig = ''; renderCtl(ctx.state()); render(ctx.state()); }; });
        if (s.order.length > 1) {
          var lab = el('label', 'ts-sel', null, ctl); el('span', null, 'Agent', lab); var sel1 = el('select', null, null, lab); sel1.setAttribute('aria-label', 'Show only one agent');
          var o0 = el('option', null, 'All agents', sel1); o0.value = '';
          s.order.forEach(function (id) { var o = el('option', null, s.agents[id].name, sel1); o.value = id; if (id === agentF) o.selected = true; });
          sel1.onchange = function () { agentF = sel1.value; sig = ''; ctlSig = ''; renderCtl(ctx.state()); render(ctx.state()); };
          if (sel && s.agents[sel]) { var os = el('button', 'ts-chip' + (onlySel ? ' on' : ''), 'Only ' + s.agents[sel].name, ctl); os.type = 'button'; os.setAttribute('aria-pressed', String(onlySel)); os.title = 'Show only the selected agent (selection is shared with the Agents view)'; os.onclick = function () { onlySel = !onlySel; sig = ''; ctlSig = ''; renderCtl(ctx.state()); render(ctx.state()); }; }
          var g = el('button', 'ts-chip' + (grouped ? ' on' : ''), 'Group by agent', ctl); g.type = 'button'; g.setAttribute('aria-pressed', String(grouped)); g.onclick = function () { grouped = !grouped; sig = ''; ctlSig = ''; renderCtl(ctx.state()); render(ctx.state()); };
        }
      }
      var sig = '', sel = null;
      var KINDS = { note: 1, tool: 1, failed: 1, retry: 1, blocked: 1, unblocked: 1, delegate: 1, message: 1, output: 1 };
      function el(tag, cls, text, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; }
      function render(s) {
        var all = s.log.filter(function (l) { return KINDS[l.kind]; });
        var rows = all.filter(function (l) { return passKind(l) && (!agentF || l.agentId === agentF) && (!onlySel || !sel || l.agentId === sel); });
        renderCtl(s);
        var key = kindF + agentF + grouped + onlySel + '|' + rows.length + '|' + (rows.length ? rows[rows.length - 1].t + rows[rows.length - 1].text : '') + '|' + sel + '|' + Math.floor(s.t / 500) + '|' + s.order.length;
        if (key === sig) return; sig = key;
        var atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
        var n = { tool: 0, failed: 0, retry: 0, blocked: 0 }; all.forEach(function (l) { if (n[l.kind] != null) n[l.kind]++; });
        head.innerHTML = '';
        var nAg = s.order.length;
        el('b', null, nAg <= 1 ? (nAg ? s.agents[s.order[0]].name : 'No agent yet') : nAg + ' agents', head);
        el('span', null, n.tool + ' tool call' + (n.tool === 1 ? '' : 's'), head);
        if (n.failed) el('span', 'ts-rust', n.failed + ' failed', head);
        if (n.retry) el('span', null, n.retry + ' retried', head);
        if (n.blocked) el('span', 'ts-amber', n.blocked + ' blocked', head);
        list.innerHTML = ''; list.classList.toggle('has-sel', !!(sel && s.agents[sel]));
        if (!rows.length) { el('div', 'ts-empty', all.length ? 'Nothing matches this filter.' : 'Waiting for the first action…', list); }
        var seq = rows;
        if (grouped) { var order = {}; s.order.forEach(function (id, i) { order[id] = i; }); seq = rows.slice().sort(function (a, b) { return (order[a.agentId] || 0) - (order[b.agentId] || 0) || a.t - b.t; }); }
        var lastAgent = null;
        seq.forEach(function (l, i) {
          if (grouped && l.agentId !== lastAgent) { lastAgent = l.agentId; var ga = s.agents[l.agentId]; var mine = rows.filter(function (x) { return x.agentId === l.agentId; }); var gh = el('div', 'ts-grp', null, list); el('b', null, ga ? ga.name : 'Unattributed', gh); el('span', null, mine.filter(function (x) { return x.kind === 'tool'; }).length + ' calls' + (mine.some(function (x) { return x.kind === 'failed'; }) ? ' · ' + mine.filter(function (x) { return x.kind === 'failed'; }).length + ' failed' : ''), gh); }
          var a = l.agentId && s.agents[l.agentId];
          var ai = all.indexOf(l); var next = all[ai + 1]; var gap = Math.max(0, (next ? next.t : s.t) - l.t); var measured = l.durationMs != null; if (measured) gap = l.durationMs;
          var r = el('div', 'ts-row ' + l.kind + (l.agentId && l.agentId === sel ? ' sel' : ''), null, list);
          r.setAttribute('role', 'listitem'); r.dataset.agent = l.agentId || ''; if (a) { r.tabIndex = 0; r.setAttribute('aria-label', a.name + ': ' + l.text); }
          el('span', 'ts-t', U.fmtTime(l.t), r);
          el('span', 'ts-who', a ? (a.label || a.name) : '', r);
          var tool = l.text, input = '';
          if (l.kind === 'tool' && a) { tool = l.text.slice((a.name + ' called ').length); var d = tool.indexOf(' · '); if (d >= 0) { input = tool.slice(d + 3); tool = tool.slice(0, d); } }
          else if (l.kind === 'failed') { tool = '✕ failed'; input = l.text.replace(/^.*? failed: /, ''); }
          else if (l.kind === 'retry') { tool = '↻ retry'; input = l.text.replace(/^.*?retry /, ''); }
          else if (l.kind === 'blocked') { tool = '⏸ blocked'; input = l.text.replace(/^.*? blocked: /, ''); }
          else if (l.kind === 'unblocked') { tool = '▶ unblocked'; input = l.text.replace(/^.*? unblocked ?/, ''); }
          else if (l.kind === 'delegate') { tool = '→ delegated'; input = l.text; }
          else if (l.kind === 'message') { tool = '✉ message'; input = l.text; }
          else if (l.kind === 'note') { tool = '💬 says'; input = l.text.replace(/^.*? said: /, ''); }
          else if (l.kind === 'output') { tool = '▤ output'; input = l.text.replace(/^.*? produced /, ''); }
          el('span', 'ts-tool', tool, r);
          var det = el('span', 'ts-detail', null, r);
          if (l.kind === 'tool' || l.kind === 'failed' || l.kind === 'blocked') { var b = el('span', 'ts-bar', null, det); b.style.width = Math.round(Math.min(gap, 4000) / 4000 * 140 + 3) + 'px'; b.title = (measured ? 'Measured duration: ' : 'Time until the next recorded action: ') + (gap / 1000).toFixed(1) + 's'; if (measured) b.classList.add('measured'); }
          if (input) el('span', 'ts-in', input, det);
          r.title = l.text;
          if (a) { r.onclick = function () { internal = true; ctx.select(l.agentId); internal = false; }; r.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); internal = true; ctx.select(l.agentId); internal = false; } }; }
        });
        var nm = all.filter(function (l) { return l.kind === 'tool' && l.durationMs != null; }).length, nt = all.filter(function (l) { return l.kind === 'tool'; }).length;
        note.textContent = (nm && nm === nt ? 'Bar length = measured tool duration.' : nm ? 'Bar length = measured tool duration where the source reports one (' + nm + ' of ' + nt + '), otherwise time until the next recorded action.' : 'Bar length = time until the next recorded action (this source reports no tool durations).') + (s.log.length >= 200 ? ' Showing the most recent 200 log lines.' : '');
        if (atEnd && !grouped) list.scrollTop = list.scrollHeight;
      }
      return {
        update: function (s) { render(s); }, frame: function () {}, onSelect: function (id) { sel = id; if (!id) onlySel = false; sig = ''; ctlSig = ''; render(ctx.state());
          if (id && !internal) { var mine = [].filter.call(list.querySelectorAll('.ts-row'), function (r) { return r.dataset.agent === id; }); var last = mine[mine.length - 1]; if (last && last.scrollIntoView) last.scrollIntoView({ block: 'center' }); } }, // selection made elsewhere scrolls to that agent's latest row
        onReset: function () { sig = ''; list.innerHTML = ''; list.scrollTop = 0; }, resize: function () {}
      };
    }
  });
})(window);
