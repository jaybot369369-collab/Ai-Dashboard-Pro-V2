/* ═══════════════════════════════════════════════════════════
   THESIS SCORECARD — js/tabs/thesis_scorecard.js
   Falsifiable-thesis tracker, rendered at the bottom of the
   Dashboard tab (pattern borrowed from the equity-research
   thesis-tracker skill in Anthropic's financial-services
   plugin). Every thesis must carry an invalidation trigger;
   pillars are scored on/watch/behind/broken; an evidence log
   records supporting AND disconfirming datapoints.
   Storage: localStorage jb_thesis_cards (browser-side only).
════════════════════════════════════════════════════════════ */
const ThesisScorecard = (() => {

  const KEY = 'jb_thesis_cards';
  const PILLAR_CYCLE = ['on', 'watch', 'behind', 'broken'];
  const PILLAR_META = {
    on:     { lbl: 'on track', ico: '🟢' },
    watch:  { lbl: 'watch',    ico: '🟡' },
    behind: { lbl: 'behind',   ico: '🟠' },
    broken: { lbl: 'broken',   ico: '🔴' },
  };
  const IMPACT_META = {
    support: { lbl: 'supports', cls: 'good' },
    against: { lbl: 'against',  cls: 'bad'  },
    neutral: { lbl: 'neutral',  cls: 'dim'  },
  };

  let _adding = false;
  let _editingId = null;
  let _loggingId = null;
  let _showClosed = false;

  // ── storage ──────────────────────────────────────────────
  function _all() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
    catch (_) { return []; }
  }
  function _save(list) { localStorage.setItem(KEY, JSON.stringify(list)); }
  function _find(id) { return _all().find(t => t.id === id); }
  function _today() { return new Date().toISOString().slice(0, 10); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // ── health readout ───────────────────────────────────────
  function _health(t) {
    if (!(t.invalidation || '').trim())
      return { cls: 'warn', txt: '⚠️ not falsifiable — add an invalidation trigger' };
    const p = t.pillars || [];
    const broken = p.filter(x => x.status === 'broken').length;
    const behind = p.filter(x => x.status === 'behind').length;
    const on = p.filter(x => x.status === 'on').length;
    if (broken) return { cls: 'bad', txt: `🔴 ${broken} pillar${broken > 1 ? 's' : ''} broken — is the invalidation triggered?` };
    if (behind) return { cls: 'warn', txt: `🟠 ${behind} behind · ${on}/${p.length} on track` };
    if (p.length && on === p.length) return { cls: 'good', txt: `🟢 all ${p.length} pillars on track` };
    return { cls: 'dim', txt: `${on}/${p.length || 0} pillars on track` };
  }

  // ── renderers ────────────────────────────────────────────
  function _pillarChips(t) {
    return (t.pillars || []).map((p, i) => {
      const m = PILLAR_META[p.status] || PILLAR_META.on;
      return `<button class="ths-pillar ths-p-${p.status}" type="button"
        title="Click to cycle: on track → watch → behind → broken"
        onclick="ThesisScorecard._cyclePillar('${t.id}',${i})">${m.ico} ${esc(p.text)}</button>`;
    }).join('');
  }

  function _logRows(t) {
    const log = (t.log || []).slice(-4).reverse();
    if (!log.length) return '';
    return `<div class="ths-log">` + log.map(e => {
      const m = IMPACT_META[e.impact] || IMPACT_META.neutral;
      return `<div class="ths-log-row"><span class="ths-log-date">${esc(e.date)}</span><span class="ths-log-imp ths-${m.cls}">${m.lbl}</span><span class="ths-log-note">${esc(e.note)}</span></div>`;
    }).join('') + `</div>`;
  }

  function _thesisRow(t) {
    const h = _health(t);
    const dirIco = t.dir === 'long' ? '▲' : t.dir === 'short' ? '▼' : '◆';
    const dirCls = t.dir === 'long' ? 'good' : t.dir === 'short' ? 'bad' : 'dim';
    const logForm = _loggingId === t.id ? `
      <div class="ths-form ths-log-form">
        <select id="thsLogImpact"><option value="support">supports thesis</option><option value="against" selected>against thesis (disconfirming)</option><option value="neutral">neutral</option></select>
        <input id="thsLogNote" type="text" placeholder="What happened? (one line — the disconfirming ones are the valuable ones)" />
        <button class="btn-primary ths-btn-sm" onclick="ThesisScorecard._saveLog('${t.id}')">Save</button>
        <button class="btn-soft ths-btn-sm" onclick="ThesisScorecard._cancelForms()">✕</button>
      </div>` : '';
    const against = (t.log || []).filter(e => e.impact === 'against').length;
    return `
      <div class="ths-row">
        <div class="ths-row-head">
          <span class="ths-sym">${esc(t.sym)}</span>
          <span class="ths-dir ths-${dirCls}">${dirIco} ${esc(t.dir || '')}</span>
          <span class="ths-conv">conviction: ${esc(t.conviction || 'med')}</span>
          <span class="ths-health ths-${h.cls}">${h.txt}</span>
          <span class="ths-actions">
            <button class="ths-ico-btn" title="Log evidence" onclick="ThesisScorecard._openLog('${t.id}')">📓</button>
            <button class="ths-ico-btn" title="Edit" onclick="ThesisScorecard._openEdit('${t.id}')">✏️</button>
            <button class="ths-ico-btn" title="Close thesis (post-mortem)" onclick="ThesisScorecard._close('${t.id}')">✔</button>
            <button class="ths-ico-btn" title="Delete" onclick="ThesisScorecard._del('${t.id}')">🗑</button>
          </span>
        </div>
        <div class="ths-statement">${esc(t.statement)}</div>
        <div class="ths-pillars">${_pillarChips(t)}</div>
        <div class="ths-inval ${!(t.invalidation||'').trim() ? 'ths-inval-missing' : ''}">
          <strong>Invalidation:</strong> ${(t.invalidation||'').trim() ? esc(t.invalidation) : '— none set. A thesis you can’t kill isn’t a thesis, it’s a hope.'}
        </div>
        ${against ? `<div class="ths-against-note">⚔️ ${against} disconfirming datapoint${against > 1 ? 's' : ''} logged — reread them before adding size.</div>` : ''}
        ${_logRows(t)}
        ${logForm}
      </div>`;
  }

  function _editForm(t) {
    const v = k => esc((t && t[k]) || '');
    const pillarsTxt = t ? (t.pillars || []).map(p => p.text).join('\n') : '';
    return `
      <div class="ths-form">
        <div class="ths-form-grid">
          <input id="thsSym" type="text" placeholder="Symbol (e.g. XRP)" value="${v('sym')}" style="max-width:110px" />
          <select id="thsDir">
            ${['long', 'short', 'neutral'].map(d => `<option value="${d}" ${t && t.dir === d ? 'selected' : ''}>${d}</option>`).join('')}
          </select>
          <select id="thsConv">
            ${['high', 'med', 'low'].map(c => `<option value="${c}" ${t && t.conviction === c ? 'selected' : ''}>conviction: ${c}</option>`).join('')}
          </select>
        </div>
        <textarea id="thsStatement" rows="2" placeholder="Thesis statement — one falsifiable sentence (what must happen, by roughly when)">${v('statement')}</textarea>
        <textarea id="thsPillars" rows="3" placeholder="Pillars — one per line (the 2–4 things that must stay true)">${esc(pillarsTxt)}</textarea>
        <input id="thsInval" type="text" placeholder="Invalidation trigger — the specific event/level that kills this thesis (required to be honest)" value="${v('invalidation')}" />
        <div class="ths-form-btns">
          <button class="btn-primary ths-btn-sm" onclick="ThesisScorecard._saveForm('${t ? t.id : ''}')">${t ? 'Save changes' : 'Add thesis'}</button>
          <button class="btn-soft ths-btn-sm" onclick="ThesisScorecard._cancelForms()">Cancel</button>
        </div>
      </div>`;
  }

  function _inner() {
    const all = _all();
    const active = all.filter(t => t.status !== 'closed');
    const closed = all.filter(t => t.status === 'closed');

    const empty = !active.length && !_adding ? `
      <div class="ths-empty">No theses yet. A scorecard forces the question the P&L doesn't ask:
      <em>is the idea still true, or are you just still in the trade?</em></div>` : '';

    const closedBlock = closed.length ? `
      <div class="ths-closed-head" onclick="ThesisScorecard._toggleClosed()">📜 Closed theses (${closed.length}) ${_showClosed ? '▾' : '▸'}</div>
      ${_showClosed ? closed.map(t => `
        <div class="ths-closed-row">
          <span class="ths-sym">${esc(t.sym)}</span>
          <span class="ths-closed-stmt">${esc(t.statement)}</span>
          <span class="ths-closed-note">${esc(t.closedNote || '')}</span>
          <button class="ths-ico-btn" title="Delete" onclick="ThesisScorecard._del('${t.id}')">🗑</button>
        </div>`).join('') : ''}` : '';

    return `
      <div class="card ths-card">
        <div class="card-head">
          <div>
            <div class="card-title">🧭 Thesis Scorecards</div>
            <div class="card-sub">Falsifiable theses only — pillars scored, disconfirming evidence logged, invalidation required</div>
          </div>
          <button class="btn-soft ths-btn-sm" onclick="ThesisScorecard._openAdd()">＋ New thesis</button>
        </div>
        ${_adding ? _editForm(null) : ''}
        ${active.map(t => _editingId === t.id ? _editForm(t) : _thesisRow(t)).join('')}
        ${empty}
        ${closedBlock}
      </div>`;
  }

  function _cardHTML() {
    return `<div id="thesisMount">${_inner()}</div>`;
  }

  function _rerender() {
    const m = document.getElementById('thesisMount');
    if (m) m.innerHTML = _inner();
  }

  // ── actions (wired via onclick) ──────────────────────────
  function _openAdd() { _adding = true; _editingId = null; _loggingId = null; _rerender(); }
  function _openEdit(id) { _editingId = id; _adding = false; _loggingId = null; _rerender(); }
  function _openLog(id) { _loggingId = _loggingId === id ? null : id; _adding = false; _editingId = null; _rerender(); }
  function _cancelForms() { _adding = false; _editingId = null; _loggingId = null; _rerender(); }
  function _toggleClosed() { _showClosed = !_showClosed; _rerender(); }

  function _saveForm(id) {
    const g = x => (document.getElementById(x) || {}).value || '';
    const sym = g('thsSym').trim().toUpperCase();
    const statement = g('thsStatement').trim();
    if (!sym || !statement) { alert('Symbol and thesis statement are required.'); return; }
    const newPillars = g('thsPillars').split('\n').map(s => s.trim()).filter(Boolean);
    const list = _all();
    const old = id ? list.find(t => t.id === id) : null;
    const pillars = newPillars.map(text => {
      const prev = old && (old.pillars || []).find(p => p.text === text);
      return { text, status: prev ? prev.status : 'on' };
    });
    const rec = {
      id: id || 'ths_' + Date.now().toString(36),
      sym, dir: g('thsDir'), conviction: g('thsConv'),
      statement, pillars,
      invalidation: g('thsInval').trim(),
      log: old ? (old.log || []) : [],
      status: old ? old.status : 'active',
      created: old ? old.created : _today(),
      updated: _today(),
    };
    const idx = list.findIndex(t => t.id === rec.id);
    if (idx >= 0) list[idx] = rec; else list.unshift(rec);
    _save(list);
    _cancelForms();
  }

  function _cyclePillar(id, i) {
    const list = _all();
    const t = list.find(x => x.id === id);
    if (!t || !t.pillars || !t.pillars[i]) return;
    const cur = PILLAR_CYCLE.indexOf(t.pillars[i].status);
    t.pillars[i].status = PILLAR_CYCLE[(cur + 1) % PILLAR_CYCLE.length];
    t.updated = _today();
    _save(list);
    _rerender();
  }

  function _saveLog(id) {
    const note = (document.getElementById('thsLogNote') || {}).value || '';
    if (!note.trim()) { alert('Write one line about what happened.'); return; }
    const impact = (document.getElementById('thsLogImpact') || {}).value || 'neutral';
    const list = _all();
    const t = list.find(x => x.id === id);
    if (!t) return;
    (t.log = t.log || []).push({ date: _today(), impact, note: note.trim() });
    t.updated = _today();
    _save(list);
    _loggingId = null;
    _rerender();
  }

  function _close(id) {
    const note = prompt('Post-mortem (one line): did the thesis play out? What did you miss?');
    if (note === null) return;
    const list = _all();
    const t = list.find(x => x.id === id);
    if (!t) return;
    t.status = 'closed';
    t.closedNote = note.trim();
    t.updated = _today();
    _save(list);
    _rerender();
  }

  function _del(id) {
    if (!confirm('Delete this thesis? (Closing keeps the post-mortem; delete removes it forever.)')) return;
    _save(_all().filter(t => t.id !== id));
    _rerender();
  }

  return {
    _cardHTML,
    _openAdd, _openEdit, _openLog, _cancelForms, _toggleClosed,
    _saveForm, _cyclePillar, _saveLog, _close, _del,
  };
})();
