/* 10 Message Matrix.
 * Rows send, columns receive, same agents on both axes in creation order.
 *   diagonal      : the agent's state glyph (+ a tool chip while a tool call is in flight)
 *   solid outline : delegation (row delegated to column / spawned it)
 *   dashed outline: waits-for (column waits for the row's agent; faded once that agent is done)
 *   green fill    : messages row -> column (darker = more messages); flashes on a new message
 *   right column  : outputs produced by the row's agent
 *   RESULT row    : appears when the task finishes
 * Everything is derived from `state` (see shared/core.js). Layout is computed from the agents present.
 */
AgentChrome.mount({
  id: '10', name: 'Message Matrix', tagline: 'Rows send, columns receive. Same agents on both axes.',
  create: function (stage, ctx) {
    var U = ctx.core.util;
    var GAP = 2, FLASH_MS = 800, POP_MS = 450;
    stage.setAttribute('role', 'group');

    /* ---------- DOM skeleton ---------- */
    var root = el('div', 'mm', stage);
    var head = el('div', 'mm-head', root);
    var scroller = el('div', 'mm-scroll', root);
    var foot = el('div', 'mm-foot', root);
    var tip = el('div', 'mm-tip', root);
    var grid = null;
    function el(tag, cls, parent, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; }
    function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function clip(t, n) { t = String(t == null ? '' : t); return t.length > n ? t.slice(0, n - 1) + '…' : t; }

    /* ---------- state ---------- */
    var size = { w: 960, h: 600 };
    var L = null;            // current layout: { ids, key, cell, compact, ... }
    var R = null;            // element refs for the current layout
    var hov = null;          // {r,c} hovered or focused
    var flashes = {};        // "r|c" -> ms remaining (ids, not indexes, so it survives rebuilds)
    var pops = {};           // agentId -> ms remaining
    var footSig = '';
    var lastTipHtml = '';

    /* ---------- codes: short unique labels ---------- */
    function makeCodes(s) {
      var used = {}, codes = {};
      s.order.forEach(function (id, i) {
        var a = s.agents[id], lab = String(a.label || a.name || id).toUpperCase().replace(/[^A-Z0-9]/g, '') || ('A' + i);
        var cands = [lab.slice(0, 3), lab.charAt(0) + lab.slice(-2), lab.slice(0, 2) + lab.slice(-1), lab.slice(0, 4)];
        var c = null; for (var k = 0; k < cands.length; k++) { if (cands[k] && !used[cands[k]]) { c = cands[k]; break; } }
        if (!c) { var n = i; do { c = lab.charAt(0) + ('0' + n.toString(36)).slice(-2).toUpperCase(); n++; } while (used[c]); }
        used[c] = 1; codes[id] = c;
      });
      return codes;
    }

    /* ---------- layout ---------- */
    function computeLayout(s) {
      var ids = s.order.slice(), n = ids.length, compact = n > 16;
      var rw = compact ? 48 : 98, ow = compact ? 48 : 70, hh = compact ? 26 : 30;
      var reserveFoot = 124, reserveHead = 34;
      var availW = size.w - rw - ow - 6, availH = size.h - reserveHead - reserveFoot - hh;
      var rows = Math.max(n + 1, 1); // + RESULT row slot so the cell size never jumps at the end
      var cw = Math.floor((availW - (n - 1) * GAP) / Math.max(n, 1)), ch = Math.floor((availH - (rows - 1) * GAP) / rows);
      var cell = U.clamp(Math.min(cw, ch), compact ? 22 : 28, 44);
      var codes = makeCodes(s);
      return { ids: ids, n: n, compact: compact, rw: rw, ow: ow, hh: hh, cell: cell, codes: codes, fin: !!s.finished,
        fs: cell < 26 ? 10 : (cell < 34 ? 11 : 12),
        key: ids.join(',') + '|' + (s.finished ? 1 : 0) + '|' + cell + '|' + compact + '|' + ids.map(function (i) { return codes[i]; }).join(',') };
    }

    function build(s) {
      var nl = computeLayout(s);
      if (L && L.key === nl.key) return false;
      L = nl;
      scroller.innerHTML = ''; grid = null; R = { rh: [], ch: [], cells: [], out: [], rcell: [], rout: null };
      root.classList.toggle('compact', L.compact);
      if (!L.n) { el('div', 'mm-empty', scroller, 'No agents yet. Rows and columns are added as agents spawn.'); return true; }
      grid = el('div', 'mm-grid', scroller);
      grid.style.setProperty('--c', L.cell + 'px'); grid.style.setProperty('--rw', L.rw + 'px'); grid.style.setProperty('--ow', L.ow + 'px');
      grid.style.setProperty('--hh', L.hh + 'px'); grid.style.setProperty('--gap', GAP + 'px'); grid.style.setProperty('--fs', L.fs + 'px');
      grid.style.gridTemplateColumns = L.rw + 'px repeat(' + L.n + ', ' + L.cell + 'px) ' + L.ow + 'px';
      grid.style.gridAutoRows = L.cell + 'px'; grid.style.gridTemplateRows = L.hh + 'px';
      grid.style.setProperty('--fs', L.fs + 'px');
      root.style.setProperty('--fs', L.fs + 'px');
      // header row
      var corner = el('div', 'corner', grid, L.compact ? 'FROM╲TO' : 'FROM ╲ TO'); corner.title = 'Rows send, columns receive';
      L.ids.forEach(function (id, c) {
        var b = el('button', 'ch', grid, L.codes[id]); b.type = 'button'; b.tabIndex = -1; b.dataset.k = 'ch'; b.dataset.c = c; b.dataset.r = c;
        b.setAttribute('aria-label', 'Column: receiver ' + id); R.ch.push(b);
      });
      el('div', 'oh', grid, 'OUT').title = 'Outputs produced by the agent in this row';
      // agent rows
      L.ids.forEach(function (id, r) {
        var rh = el('button', 'rh', grid, L.compact ? L.codes[id] : (s.agents[id].label || L.codes[id])); rh.type = 'button'; rh.dataset.k = 'rh'; rh.dataset.r = r; rh.dataset.c = r;
        R.rh.push(rh); R.cells.push([]);
        for (var c = 0; c < L.n; c++) {
          var d = el('div', 'cell', grid); d.dataset.k = 'cell'; d.dataset.r = r; d.dataset.c = c;
          if (r === c) { d.tabIndex = -1; d.setAttribute('role', 'button'); }
          R.cells[r].push(d);
        }
        var o = el('div', 'out none', grid); o.dataset.k = 'out'; o.dataset.r = r; o.dataset.c = r; R.out.push(o);
      });
      // RESULT row
      if (L.fin) {
        el('div', 'rrh', grid, 'RESULT').title = 'Final result of the task';
        for (var cc = 0; cc < L.n; cc++) { var rc = el('div', 'rcell none', grid); rc.dataset.k = 'res'; rc.dataset.c = cc; rc.dataset.r = cc; R.rcell.push(rc); }
        R.rout = el('div', 'rout', grid); R.rout.dataset.k = 'resout';
      }
      return true;
    }

    /* ---------- glyphs ---------- */
    function glyph(st, px) {
      var o = '<svg class="gl" width="' + px + '" height="' + px + '" style="width:' + px + 'px;height:' + px + 'px" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
      if (st === 'working') o += '<circle cx="12" cy="12" r="11.5" stroke="none" fill="#fff" fill-opacity=".2"/><circle cx="12" cy="12" r="6.5"/>';
      else if (st === 'done') o += '<circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.8 2.8L16.2 9.4"/>';
      else if (st === 'blocked') o += '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7M14 8.5v7"/>';
      else if (st === 'failed') o += '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>';
      else if (st === 'waiting') o += '<circle cx="12" cy="12" r="8" stroke="#1F2528" stroke-dasharray="2.6 3"/>';
      else o += '<circle cx="12" cy="12" r="4" stroke="#56636A"/>';
      return o + '</svg>';
    }
    function pageGlyph(h) {
      var w = Math.round(h * 0.8);
      return '<svg width="' + w + '" height="' + h + '" style="width:' + w + 'px;height:' + h + 'px" viewBox="0 0 16 20" aria-hidden="true"><path d="M2 1.5h8l4 4v13H2z" fill="#EAE8E1" stroke="#1F8A7A" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 1.5v4h4" fill="none" stroke="#1F8A7A" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    }

    /* ---------- derive pair maps from state ---------- */
    function pairMaps(s) {
      var idx = {}; L.ids.forEach(function (id, i) { idx[id] = i; });
      var dl = {}, dp = {}, ms = {};
      s.delegations.forEach(function (d) { if (idx[d.from] == null || idx[d.to] == null) return; var k = idx[d.from] + '|' + idx[d.to]; var o = dl[k] || (dl[k] = { n: 0, desc: null, t: 0 }); o.n++; if (d.description) o.desc = d.description; o.t = d.t; });
      s.dependencies.forEach(function (d) { if (idx[d.from] == null || idx[d.to] == null) return; var p = s.agents[d.from]; dp[idx[d.from] + '|' + idx[d.to]] = { met: !!p && p.state === 'done' }; });
      s.messages.forEach(function (m) { if (idx[m.from] == null || idx[m.to] == null) return; var k = idx[m.from] + '|' + idx[m.to]; var o = ms[k] || (ms[k] = { n: 0, last: null }); o.n++; o.last = m; });
      var lastMsg = s.messages.length ? s.messages[s.messages.length - 1] : null;
      return { idx: idx, dl: dl, dp: dp, ms: ms, latestKey: lastMsg && idx[lastMsg.from] != null && idx[lastMsg.to] != null ? idx[lastMsg.from] + '|' + idx[lastMsg.to] : null };
    }
    function toolLive(s, a) { return a.state === 'working' && a.tool && (s.t - (a.toolAt || 0)) <= Math.max(a.toolDuration || 0, 900) + 300; }

    /* ---------- paint ---------- */
    var cur = null; // current pair maps (for tooltips)
    function paint(s) {
      if (!L || !L.n) { paintHead(s); paintFoot(s); return; }
      var P = cur = pairMaps(s), n = L.n, cell = L.cell, gpx = Math.round(Math.min(cell * 0.58, 26));
      var sIdx = ctx.selected() != null && P.idx[ctx.selected()] != null ? P.idx[ctx.selected()] : null;
      var anyHi = sIdx != null || !!hov;
      root.classList.toggle('hi', anyHi);
      for (var r = 0; r < n; r++) {
        var ag = s.agents[L.ids[r]];
        for (var c = 0; c < n; c++) {
          var d = R.cells[r][c], base = 'cell', style = '', html = '', live = false;
          if (r === c) {
            base += ' dg st-' + ag.state;
            var chip = toolLive(s, ag) ? ag.tool : '';
            html = glyph(ag.state, gpx);
            if (chip) html += '<span class="tchip">' + esc(clip(chip, 6)) + '</span>';
            if (ag.attempt > 1 && !L.compact) html += '<span class="rbadge">↻' + ag.attempt + '</span>';
            live = true; d.setAttribute('aria-label', ag.name + ': ' + U.stateWord(ag));
          } else {
            var k = r + '|' + c, a = P.dl[k], b = P.dp[k], m = P.ms[k];
            if (a) base += ' dl'; if (b) base += ' dp' + (b.met ? ' met' : '');
            var mi = 0;
            if (m) { mi = 0.5 + 0.5 * (Math.min(m.n, 5) - 1) / 4; base += ' ms' + (mi < 0.62 ? ' mi-lo' : ''); style = '--mi:' + mi.toFixed(2); if (m.n > 1) html = String(m.n); if (k === P.latestKey) base += ' latest'; }
            live = !!(a || b || m);
          }
          if (live) base += ' live';
          var sig = base + '|' + style + '|' + html;
          if (d._sig !== sig) {
            d._sig = sig; d._base = base; d.innerHTML = html; d.style.cssText = style ? style + ';' : '';
            d._fl = null;
          }
        }
        // outputs column
        var o = R.out[r], outs = ag.outputs, osig = outs.length + '|' + cell;
        if (o._sig !== osig) {
          o._sig = osig; o._base = 'out' + (outs.length ? '' : ' none');
          o.innerHTML = outs.length ? pageGlyph(Math.round(Math.min(cell * 0.5, 20))) + (outs.length > 1 ? '<span>×' + outs.length + '</span>' : '') : '';
        }
      }
      // RESULT row
      if (L.fin && R.rcell.length) {
        var inc = {}; ((s.finishedInfo && s.finishedInfo.outputIds) || []).forEach(function (id) { inc[id] = 1; });
        var total = 0;
        R.rcell.forEach(function (rc, c) {
          var a2 = s.agents[L.ids[c]], cnt = 0; a2.outputs.forEach(function (id) { if (inc[id]) cnt++; });
          total += cnt; var sg = cnt + '|' + cell;
          if (rc._sig !== sg) { rc._sig = sg; rc.className = 'rcell' + (cnt ? '' : ' none'); rc.innerHTML = cnt ? pageGlyph(Math.round(Math.min(cell * 0.5, 20))) : ''; }
        });
        var rsig = 'ro' + total; if (R.rout._sig !== rsig) { R.rout._sig = rsig; R.rout.innerHTML = pageGlyph(Math.round(Math.min(cell * 0.5, 20))) + '<span>' + total + '</span>'; }
      }
      applyHL(s);
      paintHead(s); paintFoot(s);
      if (hov) showTip(); else hideTip();
    }

    function hlFor(r, c, sIdx) {
      var o = '';
      if (sIdx != null) { if (r === sIdx) o += ' sr'; if (c === sIdx) o += ' sc'; }
      if (hov) { if (r === hov.r) o += ' hr'; if (c === hov.c) o += ' hc'; }
      return o;
    }
    function applyHL(s) {
      if (!L || !L.n || !R.cells.length) return;
      var sIdx = ctx.selected() != null && cur && cur.idx[ctx.selected()] != null ? cur.idx[ctx.selected()] : null, anyHi = sIdx != null || !!hov, n = L.n;
      root.classList.toggle('hi', anyHi);
      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) {
          var d = R.cells[r][c], hl = hlFor(r, c, sIdx), cls = d._base + hl + (anyHi && !hl && d._base.indexOf('live') >= 0 ? ' dim' : '') + (d._fl ? ' fl' : '');
          if (d.className !== cls) d.className = cls;
        }
        var o = R.out[r], oc = o._base + ((sIdx === r) ? ' sel' : '') + ((hov && hov.r === r) ? ' hov' : '') + (anyHi && sIdx !== r && !(hov && hov.r === r) && o._base.indexOf('none') < 0 ? ' dim' : '');
        if (o.className !== oc) o.className = oc;
        var rhc = 'rh' + (sIdx === r ? ' sel' : '') + (hov && hov.r === r ? ' hov' : ''); if (R.rh[r].className !== rhc) R.rh[r].className = rhc;
        var chc = 'ch' + (sIdx === r ? ' sel' : '') + (hov && hov.c === r ? ' hov' : ''); if (R.ch[r].className !== chc) R.ch[r].className = chc;
      }
    }

    function paintHead(s) {
      var pct = Math.round(s.progress * 100), total = Math.max(s.plannedTotal || 0, s.order.length);
      var html = '<b>TASK</b> · ' + esc(s.task ? s.task.title : 'waiting for a task') + ' · <b>' + pct + '%</b> · ' + s.counts.done + '/' + total + ' done · <b>MESSAGES SO FAR: ' + s.messages.length + '</b>' + (s.finished ? ' · FINISHED' : '');
      if (head._h !== html) { head._h = html; head.innerHTML = html; }
    }

    function paintFoot(s) {
      var parts = [], sig = [];
      var pills = [];
      s.order.forEach(function (id) {
        var a = s.agents[id], code = (L && L.codes && L.codes[id]) || a.label;
        if (a.state === 'blocked') { var t = (a.blockedReason || 'blocked') + (a.needs ? ' (needs ' + a.needs + ')' : ''); pills.push({ id: id, cls: 'amber', lab: a.label, txt: t, kind: 'BLOCKED' }); }
        else if (a.state === 'failed') pills.push({ id: id, cls: 'rust', lab: a.label, txt: (a.error || 'failed') + (a.attempt > 1 ? ' (attempt ' + a.attempt + ')' : ''), kind: 'FAILED' });
        else if (a.attempt > 1) pills.push({ id: id, cls: 'ok', lab: a.label, txt: 'recovered on retry (attempt ' + a.attempt + ')', kind: 'RETRIED' });
      });
      var lm = s.messages.length ? s.messages[s.messages.length - 1] : null;
      var fi = s.finishedInfo;
      sig = pills.map(function (p) { return p.id + p.cls + p.txt; }).join(';') + '|' + (lm ? lm.t + lm.text : '') + '|' + (s.finished ? 1 : 0) + (fi ? fi.status + fi.summary : '') + '|' + ctx.selected();
      if (sig === footSig) return; footSig = sig;
      foot.innerHTML = '';
      var co = el('div', 'mm-callouts', foot);
      pills.forEach(function (p) {
        var b = el('button', 'pill ' + p.cls, co); b.type = 'button'; b.title = p.kind + ' · ' + p.txt;
        b.innerHTML = '<span class="dot"></span><span class="pl">' + esc(p.lab) + '</span><span class="pt">' + esc(clip(p.txt, 60)) + '</span>';
        b.onclick = function () { ctx.select(ctx.selected() === p.id ? null : p.id); };
      });
      if (lm) {
        var a1 = s.agents[lm.from], a2 = s.agents[lm.to];
        var m = el('span', 'pill msg', co); m.title = 'Latest message';
        m.innerHTML = '<span class="pl">LATEST MSG</span><span class="pt">' + esc((a1 ? a1.label : lm.from) + ' → ' + (a2 ? a2.label : lm.to) + ': ' + lm.text) + '</span>';
      }
      if (!pills.length && !lm) el('span', 'pill ok', co).innerHTML = '<span class="pl">NO BLOCKERS</span><span class="pt">nothing blocked or failed right now</span>';
      var row = el('div', 'mm-row', foot);
      if (s.finished && fi) {
        var res = el('div', 'mm-result' + (fi.status === 'succeeded' ? '' : ' bad'), row);
        res.innerHTML = '<b>RESULT · ' + esc(String(fi.status).toUpperCase()) + '</b><span>' + esc(fi.summary || '') + '</span>';
      }
      var key = el('div', 'mm-key', row);
      key.innerHTML = '<span><i class="k-dl"></i>delegation</span><span><i class="k-dp"></i>waits for</span><span><i class="k-ms"></i><i class="k-ms2"></i>messages (darker = more)</span><span>' + pageGlyph(14) + ' outputs</span><span><i class="k-ch" style="width:18px"></i>tool call in flight</span>';
    }

    /* ---------- tooltip ---------- */
    function nm(s, id) { var a = s.agents[id]; return a ? a.name : id; }
    function tipHtml() {
      var s = ctx.state(); if (!hov || !L || !cur) return '';
      var r = hov.r, c = hov.c, A = s.agents[L.ids[r]], B = s.agents[L.ids[c]]; if (!A || !B) return '';
      var kind = hov.k;
      if (kind === 'out') {
        var names = A.outputs.map(function (id) { var o = s.outputs.filter(function (x) { return x.id === id; })[0]; return o ? o.name : id; });
        return '<div class="t1">' + esc(A.name) + ' · outputs</div><div class="t2">' + (names.length ? names.map(esc).join('<br>') : 'none yet') + '</div>';
      }
      if (kind === 'res' || kind === 'resout') {
        var nm2 = A.outputs.map(function (id) { var o = s.outputs.filter(function (x) { return x.id === id; })[0]; return o ? o.name : id; });
        return '<div class="t1">RESULT ← ' + esc(A.name) + '</div><div class="t2">' + (nm2.length ? 'contributed: ' + nm2.map(esc).join(', ') : 'no output in the result') + '</div>';
      }
      if (r === c || kind === 'rh' || kind === 'ch') {
        var st = U.stateWord(A), o = '<div class="t1">' + esc(A.name) + ' · ' + esc(A.label) + '</div><div class="t2">' + esc(A.role || '') + '</div>';
        o += '<div class="t2 ' + (A.state === 'failed' ? 'tr' : A.state === 'blocked' ? 'ta' : '') + '"><em>state</em> ' + esc(st) + (A.attempt > 1 ? ' · attempt ' + A.attempt : '') + '</div>';
        if (A.state === 'working' && A.tool) o += '<div class="t2"><em>tool</em> ' + esc(A.tool + (A.toolInput ? ' · ' + A.toolInput : '')) + '</div>';
        if (A.work) o += '<div class="t2"><em>task</em> ' + esc(A.work) + '</div>';
        return o;
      }
      var k = r + '|' + c, o2 = '<div class="t1">' + esc(A.label) + ' → ' + esc(B.label) + '</div><div class="t2">' + esc(A.name) + ' sends to ' + esc(B.name) + '</div>', any = false;
      var dl = cur.dl[k], dp = cur.dp[k], ms = cur.ms[k];
      if (dl) { any = true; o2 += '<div class="t2"><em>delegation</em> ' + esc(dl.desc ? dl.desc : 'spawned as a subagent') + '</div>'; }
      if (dp) { any = true; o2 += '<div class="t2"><em>waits for</em> ' + esc(B.name) + ' waits for ' + esc(A.name) + ' (' + (dp.met ? 'done, resolved' : A.state) + ')</div>'; }
      if (ms) { any = true; o2 += '<div class="t2"><em>messages</em> ' + ms.n + ' · latest at ' + U.fmtTime(ms.last.t) + '</div><div class="tq">“' + esc(ms.last.text) + '”</div>'; }
      if (!any) o2 += '<div class="t2">no interaction</div>';
      return o2;
    }
    function showTip(ev, anchor) {
      var h = tipHtml(); if (!h) { hideTip(); return; }
      if (h !== lastTipHtml) { tip.innerHTML = h; lastTipHtml = h; }
      tip.style.display = 'block';
      var rb = root.getBoundingClientRect(), x, y;
      if (ev) { x = ev.clientX - rb.left + 14; y = ev.clientY - rb.top + 16; showTip._x = x; showTip._y = y; }
      else if (anchor) { var ar = anchor.getBoundingClientRect(); x = ar.right - rb.left + 6; y = ar.top - rb.top; showTip._x = x; showTip._y = y; }
      else { x = showTip._x || 0; y = showTip._y || 0; }
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      if (x + tw > rb.width - 6) x = Math.max(6, x - tw - 28);
      if (y + th > rb.height - 6) y = Math.max(6, rb.height - th - 6);
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    }
    function hideTip() { tip.style.display = 'none'; lastTipHtml = ''; }

    /* ---------- interaction ---------- */
    function hovFrom(t) {
      var e = t && t.closest ? t.closest('[data-k]') : null; if (!e || !grid || !grid.contains(e)) return null;
      var k = e.dataset.k; if (k === 'resout') return { r: 0, c: 0, k: k, e: e };
      return { r: Number(e.dataset.r), c: Number(e.dataset.c), k: k, e: e };
    }
    function setHover(h) {
      var same = (!h && !hov) || (h && hov && h.r === hov.r && h.c === hov.c && h.k === hov.k);
      if (same) return false;
      hov = h ? { r: h.r, c: h.c, k: h.k } : null;
      applyHL(ctx.state());
      return true;
    }
    scroller.addEventListener('mousemove', function (e) {
      var h = hovFrom(e.target);
      if (h && h.k === 'resout') h = null;
      setHover(h);
      if (hov) showTip(e); else hideTip();
    });
    scroller.addEventListener('mouseleave', function () { setHover(null); hideTip(); });
    scroller.addEventListener('scroll', function () { hideTip(); });
    scroller.addEventListener('focusin', function (e) { var h = hovFrom(e.target); if (h && (h.k === 'rh' || h.k === 'ch' || (h.k === 'cell' && h.r === h.c))) { setHover(h); showTip(null, h.e); } });
    scroller.addEventListener('focusout', function () { setHover(null); hideTip(); });
    scroller.addEventListener('click', function (e) {
      var h = hovFrom(e.target); if (!h) return;
      var id = null;
      if (h.k === 'rh' || h.k === 'ch' || h.k === 'out' || h.k === 'res') id = L.ids[h.k === 'ch' || h.k === 'res' ? h.c : h.r];
      else if (h.k === 'cell') { var d = R.cells[h.r][h.c]; if (h.r === h.c || (d._base && d._base.indexOf('live') >= 0)) id = L.ids[h.r]; }
      if (id) ctx.select(ctx.selected() === id ? null : id);
    });
    scroller.addEventListener('keydown', function (e) {
      var t = e.target, h = hovFrom(t); if (!h) return;
      var isAgent = h.k === 'rh' || h.k === 'ch' || (h.k === 'cell' && h.r === h.c);
      if (!isAgent) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); var id = L.ids[h.r]; ctx.select(ctx.selected() === id ? null : id); }
      else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && h.k === 'rh') {
        e.preventDefault(); var nx = R.rh[h.r + (e.key === 'ArrowDown' ? 1 : -1)]; if (nx) nx.focus();
      }
    });

    /* ---------- chrome contract ---------- */
    function sizeFromStage() { var sz = ctx.size(); if (sz.w && sz.h) size = sz; }
    return {
      update: function (s, events) {
        events.forEach(function (e) {
          if (ctx.reducedMotion()) return;
          if (e.type === 'message_sent') flashes[e.fromId + '>' + e.toId] = FLASH_MS;
          else if (e.type === 'agent_spawned') pops[e.agentId] = POP_MS;
        });
        build(s); paint(s);
        applyFlashes();
      },
      frame: function (dt) {
        var dirty = false, k;
        for (k in flashes) { flashes[k] -= dt; if (flashes[k] <= 0) { delete flashes[k]; clearFlash(k); } else dirty = true; }
        for (k in pops) { pops[k] -= dt; if (pops[k] <= 0) { delete pops[k]; popStyle(k, 1); } else { dirty = true; popStyle(k, 1 - pops[k] / POP_MS); } }
        if (dirty) applyFlashes();
      },
      onSelect: function () { applyHL(ctx.state()); footSig = ''; paintFoot(ctx.state()); },
      onReset: function (s) { flashes = {}; pops = {}; footSig = ''; hov = null; hideTip(); L = null; build(s); paint(s); },
      onMotionChange: function (reduced) { if (reduced) { flashes = {}; pops = {}; applyFlashes(); } },
      resize: function (sz) { size = sz || size; var s = ctx.state(); L = null; build(s); paint(s); }
    };

    function cellOf(k) { if (!L || !R) return null; var p = k.split('>'), r = L.ids.indexOf(p[0]), c = L.ids.indexOf(p[1]); return r >= 0 && c >= 0 && R.cells[r] ? R.cells[r][c] : null; }
    function clearFlash(k) { var d = cellOf(k); if (!d) return; d._fl = null; d.style.removeProperty('--fl'); if (d.className.indexOf(' fl') >= 0) d.className = d.className.replace(' fl', ''); }
    function applyFlashes() {
      for (var k in flashes) {
        var d = cellOf(k); if (!d) continue;
        d._fl = true; d.style.setProperty('--fl', Math.max(0, flashes[k] / FLASH_MS).toFixed(3));
        if (d.className.indexOf(' fl') < 0) d.className += ' fl';
      }
    }
    function popStyle(id, f) {
      if (!L || !R) return; var i = L.ids.indexOf(id); if (i < 0) return;
      var v = f >= 1 ? '' : String(0.25 + 0.75 * f);
      if (R.rh[i]) R.rh[i].style.opacity = v; if (R.ch[i]) R.ch[i].style.opacity = v; if (R.cells[i] && R.cells[i][i]) R.cells[i][i].style.opacity = v;
    }
  }
});
