/* ═══════════════════════════════════════════════════════════
   18-YEAR CYCLE TRIPWIRES — js/tabs/cycle_tripwires.js
   Macro crash-factor tracker for the 2026–2028 land-cycle window.
   A curated checklist of the signals that led every big bust
   (1929 · 2000 · 2008), each with a plain-English meaning, a
   dated reading, and a falsifiable TRIPWIRE threshold. Tick each
   one off (armed → watching → tripped) as it fires over the cycle.

   Editorial readings/thresholds + the live HY spread come from
   js/data/cycle_tripwires.json (refresh via
   automation/fetch_cycle_tripwires.py). The user's per-factor
   status + notes are stored in localStorage jb_cycle_tripwires so
   personal ticks survive a data refresh.

   Design note (RULE #2): every reading shows its "as of" date —
   nothing here is presented as live-now except the HY gauge, which
   carries its own fetch date from the JSON.
════════════════════════════════════════════════════════════ */
const CycleTripwires = (() => {

  const KEY = 'jb_cycle_tripwires';
  const DATA_URL = 'js/data/cycle_tripwires.json';
  const CYCLE = ['armed', 'watching', 'tripped'];
  const META = {
    armed:    { lbl: 'armed',    ico: '🟢', hint: 'quiet — no stress on this factor yet' },
    watching: { lbl: 'watching', ico: '🟡', hint: 'stirring — moving toward the tripwire' },
    tripped:  { lbl: 'tripped',  ico: '🔴', hint: 'the threshold has been crossed' },
  };

  let _data = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // ── storage (user overrides only) ────────────────────────
  function _overrides() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
    catch (_) { return {}; }
  }
  function _saveOverrides(o) { localStorage.setItem(KEY, JSON.stringify(o)); }

  // effective status = user override if present, else the JSON default
  function _status(f) {
    const o = _overrides()[f.id];
    return (o && o.status) || f.default_status || 'armed';
  }
  function _note(f) {
    const o = _overrides()[f.id];
    return (o && o.note) || '';
  }

  // ── HY gauge state ───────────────────────────────────────
  function _hyState(hy) {
    if (!hy || typeof hy.value_bps !== 'number') return { cls: 'dim', lbl: 'no data' };
    if (hy.value_bps >= (hy.tripwire_bps || 400)) return { cls: 'bad',  lbl: 'TRIPPED' };
    if (hy.value_bps >= (hy.watch_bps || 350))    return { cls: 'warn', lbl: 'stirring' };
    return { cls: 'good', lbl: 'calm' };
  }

  function _hyGauge(hy) {
    if (!hy) return '';
    const st = _hyState(hy);
    const trip = hy.tripwire_bps || 400;
    // fill relative to the tripwire (cap at 100%)
    const pct = Math.max(4, Math.min(100, Math.round((hy.value_bps / trip) * 100)));
    const barCol = st.cls === 'bad' ? '#dc2626' : st.cls === 'warn' ? '#d97706' : '#16a34a';
    return `
      <div class="cyt-hy">
        <div class="cyt-hy-head">
          <span class="cyt-hy-title">🚨 HY credit spread — the starting gun</span>
          <span class="cyt-badge cyt-${st.cls}">${st.lbl}</span>
        </div>
        <div class="cyt-hy-num">${hy.value_bps}<span class="cyt-hy-unit">bps</span>
          <span class="cyt-hy-asof">as of ${esc(hy.as_of || '?')}</span></div>
        <div class="cyt-bar">
          <div class="cyt-bar-fill" style="width:${pct}%;background:${barCol}"></div>
          <div class="cyt-bar-mark" style="left:${Math.round((350/trip)*100)}%" title="350bp — stirring"></div>
          <div class="cyt-bar-mark cyt-bar-trip" style="left:100%" title="${trip}bp — tripwire"></div>
        </div>
        <div class="cyt-bar-scale"><span>0</span><span>350 watch</span><span>${trip} TRIP</span></div>
        <div class="cyt-hy-note">${esc(hy.note || '')}</div>
      </div>`;
  }

  // ── factor rows ──────────────────────────────────────────
  function _factorRow(f) {
    const stKey = _status(f);
    const m = META[stKey] || META.armed;
    const note = _note(f);
    return `
      <div class="cyt-row cyt-st-${stKey}">
        <button class="cyt-status" type="button"
          title="Click to cycle: armed → watching → tripped (${m.hint})"
          onclick="CycleTripwires._cycle('${f.id}')">${m.ico}<span class="cyt-status-lbl">${m.lbl}</span></button>
        <div class="cyt-body">
          <div class="cyt-name">${esc(f.name)}
            ${f.source_url ? `<a class="cyt-src" href="${esc(f.source_url)}" target="_blank" rel="noopener" title="source">↗</a>` : ''}
          </div>
          <div class="cyt-plain">${esc(f.plain)}</div>
          <div class="cyt-reading"><span class="cyt-k">Reading</span> ${esc(f.reading)}
            <span class="cyt-asof">as of ${esc(f.as_of || '?')}</span></div>
          <div class="cyt-trip"><span class="cyt-k">Tripwire</span> ${esc(f.tripwire)}</div>
          ${note ? `<div class="cyt-usernote">📝 ${esc(note)}</div>` : ''}
          <button class="cyt-note-btn" type="button" onclick="CycleTripwires._editNote('${f.id}')">${note ? 'edit note' : '+ note'}</button>
        </div>
      </div>`;
  }

  function _inner() {
    if (!_data) {
      return `
        <div class="card cyt-card">
          <div class="card-head"><div>
            <div class="card-title">🕰️ 18-Year Cycle Tripwires</div>
            <div class="card-sub">Loading macro crash factors…</div>
          </div></div>
          <div style="padding:12px 18px;color:var(--text-2);font-size:13px">Reading cycle_tripwires.json…</div>
        </div>`;
    }
    const d = _data;
    const trippedN = (d.factors || []).filter(f => _status(f) === 'tripped').length;
    const watchingN = (d.factors || []).filter(f => _status(f) === 'watching').length;
    const total = (d.factors || []).length;
    const summary = trippedN
      ? `<span class="cyt-badge cyt-bad">${trippedN}/${total} tripped</span>`
      : `<span class="cyt-badge cyt-warn">${watchingN}/${total} watching · 0 tripped</span>`;

    return `
      <div class="card cyt-card">
        <div class="card-head">
          <div>
            <div class="card-title">🕰️ 18-Year Cycle Tripwires ${summary}</div>
            <div class="card-sub">Land-cycle window ${esc(d.window || '')} · tick each factor off as it fires · readings dated, not live</div>
          </div>
          <button class="btn-soft cyt-btn-sm" onclick="CycleTripwires._reset()" title="Clear your manual ticks (readings stay)">reset ticks</button>
        </div>
        <div class="cyt-headline">${esc(d.headline || '')}</div>
        ${_hyGauge(d.hy_oas)}
        <div class="cyt-factors">${(d.factors || []).map(_factorRow).join('')}</div>
        <div class="cyt-foot">Updated ${esc(d.updated || '?')} · not investment advice · the skeptics were right in 1929 &amp; 2000 — and 1–3 years early. This tracks the trigger, it doesn't time the trade.</div>
      </div>`;
  }

  function _cardHTML() {
    setTimeout(_load, 0);
    return `<div id="cycleTripMount">${_inner()}</div>`;
  }

  function _rerender() {
    const m = document.getElementById('cycleTripMount');
    if (m) m.innerHTML = _inner();
  }

  async function _load() {
    try {
      const r = await fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) _data = await r.json();
    } catch (e) { console.warn('[cycletripwires] load failed:', e); }
    _rerender();
  }

  // ── actions ──────────────────────────────────────────────
  function _cycle(id) {
    const f = (_data && (_data.factors || []).find(x => x.id === id));
    const cur = f ? _status(f) : 'armed';
    const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
    const o = _overrides();
    o[id] = Object.assign({}, o[id], { status: next });
    _saveOverrides(o);
    _rerender();
  }

  function _editNote(id) {
    const o = _overrides();
    const cur = (o[id] && o[id].note) || '';
    const v = prompt('Note for this factor (what you saw / when it moved):', cur);
    if (v === null) return;
    o[id] = Object.assign({}, o[id], { note: v.trim() });
    _saveOverrides(o);
    _rerender();
  }

  function _reset() {
    if (!confirm('Clear your manual status ticks and notes? (The dated readings and thresholds stay.)')) return;
    localStorage.removeItem(KEY);
    _rerender();
  }

  return { _cardHTML, _cycle, _editNote, _reset };
})();
