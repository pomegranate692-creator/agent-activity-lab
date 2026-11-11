/* Run panel: submit a REAL task to the local service (server/lab-server.mjs), watch it, browse history, see results.
 * Only active when the page is served by the local service (GET /api/bootstrap works). On GitHub Pages or from disk the
 * app stays in demo mode (simulated scenario only) and says so. Nothing here fakes execution: every control calls the service. */
(function (g) {
  var Lab = g.__Lab = { api: null, info: null, current: null, listeners: [] };
  function el(tag, cls, text, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; }
  function fmtDur(ms) { if (ms == null) return '–'; var s = Math.round(ms / 1000); return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's'; }
  function ago(t) { var s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : new Date(t).toLocaleDateString(); }
  var STATUS = { running: ['Running', 'run'], succeeded: ['Succeeded', 'ok'], failed: ['Failed', 'bad'], stopped: ['Stopped', 'stop'] };

  /* ---- API ---- */
  function call(method, path, body) {
    return fetch(path, { method: method, headers: { 'X-Lab-Token': Lab.info.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.code = j.code; e.status = r.status; throw e; } return j; }); });
  }
  Lab.call = call;
  function bootstrap() {
    // only probe for the local service on a local address; public hosts (GitHub Pages) and file:// are demo mode with no failed request
    if (!/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) return Promise.reject(new Error('no service'));
    return fetch('/api/bootstrap', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('no service'); return r.json(); }).then(function (j) { if (!j || !j.token) throw new Error('no service'); Lab.info = j; return j; });
  }

  /* ---- connect the viewer to a session ---- */
  function connect(meta) {
    Lab.current = meta; notify();
    var base = location.origin + '/s/' + Lab.info.token + '/' + meta.id;
    if (meta.status === 'running') {
      g.__agentlab.connectLive(base, { source: meta.engine === 'test-stub' ? 'test-stub' : 'claude-code', elapsedMs: Date.now() - meta.startedAt, durationMs: 1000 });
      poll(meta.id);
    } else loadSaved(meta);
    if (Lab.afterConnect) Lab.afterConnect();
  }
  function loadSaved(meta) {
    return call('GET', '/api/sessions/' + meta.id + '/events').then(function (r) {
      g.__agentlab.loadEvents(r.events, { source: meta.engine === 'test-stub' ? 'test-stub' : 'claude-code-saved', sourceNote: meta.engine === 'test-stub' ? 'A TEST STUB produced these events. No real Claude Code ran.' : 'Saved events of real Claude Code session ' + meta.id.slice(0, 8) + ' (' + meta.status + ').' });
    });
  }
  var pollTimer = null;
  function poll(id) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(function () {
      call('GET', '/api/sessions/' + id).then(function (m) {
        if (!Lab.current || Lab.current.id !== id) return; var was = Lab.current.status; Lab.current = m; notify();
        if (m.status === 'running') poll(id); else if (was === 'running') loadSaved(m); // switch from live stream to the saved record
      }).catch(function () { poll(id); });
    }, 1000);
  }
  function notify() { Lab.listeners.forEach(function (f) { try { f(Lab.current); } catch (e) {} }); }
  Lab.connect = connect;

  /* ---- UI: command bar, new-task dialog, history ---- */
  Lab.mount = function (root, hooks) {
    var bar = el('div', 'ap-cmd'); root.insertBefore(bar, root.firstChild); bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Task controls');
    var bNew = el('button', 'ap-cbtn ap-cprimary', '＋ New task', bar); bNew.type = 'button';
    var bHist = el('button', 'ap-cbtn', 'History', bar); bHist.type = 'button';
    var chip = el('div', 'ap-cchip', '', bar); chip.setAttribute('role', 'status');
    var bStop = el('button', 'ap-cbtn', 'Stop', bar); bStop.type = 'button'; bStop.hidden = true;
    var bRetry = el('button', 'ap-cbtn', 'Retry', bar); bRetry.type = 'button'; bRetry.hidden = true;
    var bPause = el('button', 'ap-cbtn ap-cdis', 'Pause', bar); bPause.type = 'button'; bPause.disabled = true; bPause.title = 'Not supported: headless Claude Code cannot be paused, only stopped.'; bPause.hidden = true;
    var mode = el('div', 'ap-cmode', '', bar);

    /* new task dialog */
    var dlg = el('dialog', 'ap-dlg', null, document.body); dlg.setAttribute('aria-label', 'New task');
    var form = el('form', null, null, dlg); form.method = 'dialog';
    el('h2', null, 'New task', form);
    el('p', 'ap-dlg-sub', 'Describe what you want done. Claude Code will really run it on this computer under your Claude login. This is not a simulation.', form);
    var warn = el('div', 'ap-dlg-warn', '', form); warn.hidden = true;
    var ta = el('textarea', 'ap-ta', null, form); ta.rows = 5; ta.placeholder = 'e.g. Create a simple Python script that analyzes a CSV file and summarizes the results.'; ta.setAttribute('aria-label', 'Task'); ta.maxLength = 8000;
    var pols = el('div', 'ap-pols', null, form); var polInputs = {};
    function buildPolicies() { pols.innerHTML = ''; Object.keys(Lab.info.policies).forEach(function (k, i) { var p = Lab.info.policies[k]; var lab = el('label', 'ap-pol', null, pols); var r = el('input', null, null, lab); r.type = 'radio'; r.name = 'policy'; r.value = k; r.checked = k === 'workspace'; polInputs[k] = r; var b = el('div', null, null, lab); el('b', null, p.label, b); el('span', null, p.text, b); }); }
    var facts = el('div', 'ap-dlg-facts', '', form);
    var acts = el('div', 'ap-dlg-acts', null, form);
    var bCancel = el('button', 'ap-cbtn', 'Cancel', acts); bCancel.type = 'button'; var bRun = el('button', 'ap-cbtn ap-cprimary', 'Run task', acts); bRun.type = 'submit'; bRun.value = 'run';
    var err = el('div', 'ap-dlg-err', '', form); err.hidden = true;
    bCancel.onclick = function () { dlg.close(); };
    function openNew() {
      if (!Lab.info) return; buildPolicies(); err.hidden = true; var c = Lab.info.claude;
      warn.hidden = c.loggedIn && c.found; if (!warn.hidden) { warn.innerHTML = ''; el('b', null, c.found ? 'Claude Code is not signed in.' : 'Claude Code was not found.', warn); el('div', null, c.found ? 'Run this in a terminal, then press Recheck:' : c.detail, warn); if (c.found) el('code', null, 'claude auth login', warn); var rc = el('button', 'ap-cbtn', 'Recheck', warn); rc.type = 'button'; rc.onclick = function () { call('GET', '/api/claude').then(function (j) { Lab.info.claude = j; setMode(); openNew(); }); }; }
      bRun.disabled = !(c.loggedIn && c.found); var l = Lab.info.limits;
      facts.textContent = 'Workspace: a fresh folder under ' + Lab.info.workspaceRoot + '. Budget cap $' + l.maxBudgetUsd + ' and ' + l.timeoutMin + ' minute limit per task. One task at a time. Denied actions show up as blocked.';
      dlg.showModal(); ta.focus();
    }
    bNew.onclick = openNew;
    form.addEventListener('submit', function (e) {
      e.preventDefault(); err.hidden = true; var prompt = ta.value.trim(); var pol = Object.keys(polInputs).filter(function (k) { return polInputs[k].checked; })[0] || 'workspace';
      if (prompt.length < 3) { err.textContent = 'Write the task first.'; err.hidden = false; return; }
      bRun.disabled = true;
      call('POST', '/api/sessions', { prompt: prompt, policy: pol, confirm: true }).then(function (meta) { dlg.close(); ta.value = ''; if (hooks && hooks.fresh) hooks.fresh(); connect(meta); })
        .catch(function (x) { err.textContent = x.message; err.hidden = false; bRun.disabled = false; });
    });

    /* history drawer */
    var hist = el('aside', 'ap-hist', null, document.body); hist.hidden = true; hist.setAttribute('aria-label', 'Session history');
    function renderHist() {
      hist.innerHTML = ''; var hh = el('div', 'ap-hist-h', null, hist); el('b', null, 'Previous sessions', hh); var x = el('button', 'ap-cbtn', 'Close', hh); x.type = 'button'; x.onclick = function () { hist.hidden = true; };
      var list = el('div', 'ap-hist-l', 'Loading…', hist);
      call('GET', '/api/sessions').then(function (r) {
        list.textContent = ''; if (!r.sessions.length) { el('div', 'ap-empty-s', 'No sessions yet. Run a task and it is saved here.', list); return; }
        r.sessions.forEach(function (m) { var b = el('button', 'ap-hi', null, list); b.type = 'button'; var st = STATUS[m.status] || [m.status, '']; var top = el('div', 'ap-hi-t', null, b); el('span', 'ap-dot ap-d-' + st[1], null, top); el('b', null, st[0], top); el('span', null, ago(m.createdAt) + (m.engine === 'test-stub' ? ' · TEST STUB' : ''), top); el('div', 'ap-hi-p', m.title, b); el('div', 'ap-hi-s', m.stats.toolCalls + ' tool calls · ' + m.stats.subagents + ' subagents · ' + fmtDur(m.stats.durationMs) + ' · ' + (m.files ? m.files.length : 0) + ' files', b); b.onclick = function () { hist.hidden = true; if (hooks && hooks.fresh) hooks.fresh(); connect(m); }; });
      }).catch(function (e) { list.textContent = 'Could not load history: ' + e.message; });
    }
    bHist.onclick = function () { hist.hidden = !hist.hidden; if (!hist.hidden) renderHist(); };

    /* status chip + controls follow the current session */
    function setMode() {
      var c = Lab.info.claude; mode.innerHTML = '';
      el('span', 'ap-mdot ' + (c.loggedIn ? 'ok' : 'bad'), null, mode);
      el('span', null, c.loggedIn ? 'Local service · Claude Code ' + (c.version || '').replace(/ \(.*/, '') + ' signed in' + (Lab.info.engine === 'test-stub' ? ' · TEST STUB' : '') : c.found ? 'Local service · Claude Code NOT signed in' : 'Local service · Claude Code not found', mode);
    }
    function paint(m) {
      if (!m) { chip.textContent = 'No task running. Press New task, or open History.'; chip.className = 'ap-cchip'; bStop.hidden = bRetry.hidden = bPause.hidden = true; return; }
      var st = STATUS[m.status] || [m.status, '']; chip.className = 'ap-cchip ap-cs-' + st[1];
      chip.textContent = st[0] + ' · ' + m.title + ' · ' + m.stats.toolCalls + ' tool calls' + (m.stats.subagents ? ' · ' + m.stats.subagents + ' subagents' : '') + (m.status !== 'running' ? ' · ' + fmtDur(m.stats.durationMs) : '') + (m.engine === 'test-stub' ? ' · TEST STUB' : '');
      bStop.hidden = m.status !== 'running'; bPause.hidden = m.status !== 'running'; bRetry.hidden = m.status === 'running';
    }
    Lab.listeners.push(paint);
    bStop.onclick = function () { if (Lab.current) call('POST', '/api/sessions/' + Lab.current.id + '/stop', {}).catch(function (e) { alert(e.message); }); };
    bRetry.onclick = function () { var m = Lab.current; if (!m) return; if (!confirm('Run this task again with the same policy (' + m.policy + ')? It starts a new real Claude Code run.')) return; call('POST', '/api/sessions/' + m.id + '/retry', { confirm: true }).then(function (n) { if (hooks && hooks.fresh) hooks.fresh(); connect(n); }).catch(function (e) { alert(e.message); }); };
    setMode(); paint(null);
  };

  /* ---- Results view (registered like any other view) ---- */
  g.__AppViews.views.push({
    id: 'results', name: 'Output', tagline: 'Final answer, files and denied actions of a real session',
    create: function (stage, ctx) {
      var wrap = el('div', 'rs-wrap', null, stage); var sig = '';
      function render(m) {
        wrap.innerHTML = '';
        if (!Lab.info) { el('div', 'rs-empty', 'Demo mode: this page is not connected to the local service, so there is nothing real to show. Run node server/lab-server.mjs and open the page it prints.', wrap); return; }
        if (!m) { el('div', 'rs-empty', 'No session selected. Start a task or open one from History to see its answer, generated files and any denied actions.', wrap); return; }
        var st = STATUS[m.status] || [m.status, '']; var h = el('div', 'rs-h', null, wrap); el('span', 'ap-dot ap-d-' + st[1], null, h); el('b', null, st[0], h); el('span', null, m.engine === 'test-stub' ? 'TEST STUB, not Claude' : (m.model || 'Claude Code'), h);
        el('p', 'rs-prompt', m.prompt, wrap);
        var kv = el('div', 'rs-kv', null, wrap); [['Duration', fmtDur(m.stats.durationMs != null ? m.stats.durationMs : (Date.now() - m.startedAt))], ['Tool calls', m.stats.toolCalls], ['Subagents', m.stats.subagents], ['Turns', m.stats.turns == null ? '–' : m.stats.turns], ['Cost', m.stats.costUsd == null ? '–' : '$' + Number(m.stats.costUsd).toFixed(4)], ['Policy', m.policy]].forEach(function (p) { var d = el('div', null, null, kv); el('span', null, p[0], d); el('b', null, String(p[1]), d); });
        if (m.error) el('div', 'rs-err', m.error, wrap);
        if (m.resultText) { el('h3', null, 'Final answer', wrap); el('pre', 'rs-pre', m.resultText, wrap); }
        if (m.status === 'running') el('div', 'rs-note', 'Still running. The answer and files appear here when it finishes.', wrap);
        if (m.denials && m.denials.length) {
          el('h3', null, 'Actions that were denied (' + m.denials.length + ')', wrap); el('p', 'rs-note', 'Claude Code could not do these without permission. Mid-run approval is not supported yet; you can approve and re-run, which starts a new session.', wrap);
          var chosen = {}; m.denials.forEach(function (d) { var l = el('label', 'rs-den', null, wrap); var c = el('input', null, null, l); c.type = 'checkbox'; c.onchange = function () { chosen[d.rule] = c.checked; }; var t = el('span', null, null, l); el('b', null, d.tool, t); el('code', null, ' ' + d.input, t); el('i', null, '  → allows: ' + d.rule, t); });
          var ap = el('button', 'ap-cbtn', 'Approve selected and re-run', wrap); ap.type = 'button'; ap.onclick = function () { var rules = Object.keys(chosen).filter(function (k) { return chosen[k]; }); if (!rules.length) { alert('Tick at least one denied action first.'); return; } if (!confirm('Re-run this task and allow: ' + rules.join(', ') + '?')) return; call('POST', '/api/sessions/' + m.id + '/retry', { confirm: true, approve: rules }).then(function (n) { if (Lab.afterConnect) Lab.afterConnect(true); Lab.connect(n); }).catch(function (e) { alert(e.message); }); };
        }
        el('h3', null, 'Files (' + (m.files ? m.files.length : 0) + ')', wrap); var fl = el('div', 'rs-files', 'Loading…', wrap); var pv = el('pre', 'rs-pre rs-prev', null, wrap); pv.hidden = true;
        call('GET', '/api/sessions/' + m.id + '/files').then(function (r) { fl.textContent = ''; if (!r.files.length) { el('div', 'rs-note', m.status === 'running' ? 'No files yet.' : 'This task produced no files.', fl); return; }
          r.files.forEach(function (f) { var row = el('div', 'rs-file', null, fl); var b = el('button', 'rs-fb', f.path, row); b.type = 'button'; el('span', null, (f.size / 1024).toFixed(1) + ' KB', row); var dl = el('button', 'rs-fb rs-dl', 'Download', row); dl.type = 'button';
            function fetchF(download) { return fetch('/api/sessions/' + m.id + '/file?path=' + encodeURIComponent(f.path) + (download ? '&download=1' : ''), { headers: { 'X-Lab-Token': Lab.info.token } }); }
            b.onclick = function () { fetchF(false).then(function (r2) { return r2.ok ? r2.text() : r2.json().then(function (j) { throw new Error(j.error); }); }).then(function (t) { pv.hidden = false; pv.textContent = '── ' + f.path + ' ──\n' + t.slice(0, 20000) + (t.length > 20000 ? '\n… (truncated)' : ''); }).catch(function (e) { pv.hidden = false; pv.textContent = 'Cannot preview: ' + e.message; }); };
            dl.onclick = function () { fetchF(true).then(function (r2) { return r2.blob(); }).then(function (bl) { var a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = f.path.split('/').pop(); document.body.appendChild(a); a.click(); a.remove(); }); }; });
        }).catch(function (e) { fl.textContent = 'Could not list files: ' + e.message; });
      }
      Lab.listeners.push(function (m) { var s = m ? m.id + m.status + (m.files ? m.files.length : 0) + (m.denials ? m.denials.length : 0) : ''; if (s === sig) return; sig = s; render(m); });
      render(Lab.current);
      return { update: function () {}, frame: function () {}, onSelect: function () {}, onReset: function () {}, resize: function () {} };
    }
  });

  /* ---- boot: find out whether the local service is here ---- */
  Lab.ready = bootstrap().then(function (j) { Lab.available = true; return j; }).catch(function () { Lab.available = false; return null; });
})(window);
