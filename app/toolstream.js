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
      var note = document.createElement('div'); note.className = 'ts-note'; wrap.appendChild(note);
      var sig = '', sel = null;
      var KINDS = { tool: 1, failed: 1, retry: 1, blocked: 1, unblocked: 1, delegate: 1, message: 1, output: 1 };
      function el(tag, cls, text, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; }
      function render(s) {
        var rows = s.log.filter(function (l) { return KINDS[l.kind]; });
        var key = rows.length + '|' + (rows.length ? rows[rows.length - 1].t + rows[rows.length - 1].text : '') + '|' + sel + '|' + Math.floor(s.t / 500) + '|' + s.order.length;
        if (key === sig) return; sig = key;
        var atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
        var n = { tool: 0, failed: 0, retry: 0, blocked: 0 }; rows.forEach(function (l) { if (n[l.kind] != null) n[l.kind]++; });
        head.innerHTML = '';
        var nAg = s.order.length;
        el('b', null, nAg <= 1 ? (nAg ? s.agents[s.order[0]].name : 'No agent yet') : nAg + ' agents', head);
        el('span', null, n.tool + ' tool call' + (n.tool === 1 ? '' : 's'), head);
        if (n.failed) el('span', 'ts-rust', n.failed + ' failed', head);
        if (n.retry) el('span', null, n.retry + ' retried', head);
        if (n.blocked) el('span', 'ts-amber', n.blocked + ' blocked', head);
        list.innerHTML = '';
        if (!rows.length) { el('div', 'ts-empty', 'Waiting for the first action…', list); }
        rows.forEach(function (l, i) {
          var a = l.agentId && s.agents[l.agentId];
          var next = rows[i + 1]; var gap = Math.max(0, (next ? next.t : s.t) - l.t);
          var r = el('div', 'ts-row ' + l.kind + (l.agentId && l.agentId === sel ? ' sel' : ''), null, list);
          r.setAttribute('role', 'listitem'); if (a) { r.tabIndex = 0; r.setAttribute('aria-label', a.name + ': ' + l.text); }
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
          else if (l.kind === 'output') { tool = '▤ output'; input = l.text.replace(/^.*? produced /, ''); }
          el('span', 'ts-tool', tool, r);
          var det = el('span', 'ts-detail', null, r);
          if (l.kind === 'tool' || l.kind === 'failed' || l.kind === 'blocked') { var b = el('span', 'ts-bar', null, det); b.style.width = Math.round(Math.min(gap, 4000) / 4000 * 140 + 3) + 'px'; b.title = 'Time until the next recorded action: ' + (gap / 1000).toFixed(1) + 's'; }
          if (input) el('span', 'ts-in', input, det);
          r.title = l.text;
          if (a) { r.onclick = function () { ctx.select(l.agentId); }; r.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); ctx.select(l.agentId); } }; }
        });
        note.textContent = 'Bar length = time until the next recorded action (the event stream has no tool durations).' + (s.log.length >= 200 ? ' Showing the most recent 200 log lines.' : '');
        if (atEnd) list.scrollTop = list.scrollHeight;
      }
      return {
        update: function (s) { render(s); }, frame: function () {}, onSelect: function (id) { sel = id; sig = ''; render(ctx.state()); },
        onReset: function () { sig = ''; list.innerHTML = ''; list.scrollTop = 0; }, resize: function () {}
      };
    }
  });
})(window);
