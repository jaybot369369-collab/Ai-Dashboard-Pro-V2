/* ═══════════════════════════════════════════════════════════
   ☀️ MORNING BRIEF CARD — personal pre-market read on the Dashboard tab
   (architecture/morning_brief.md · generator automation/morning_brief.py)

   Answers "what should I do about today?" from the market layers + Jay's
   context. Generated locally (Claude CLI), served by the :8769 shim as
   GET /brief. Localhost-only (Chrome PNA blocks HTTPS→localhost).

   Pattern mirrors Get Free Score / Thesis Scorecards:
   - _cardHTML() returns a synchronous placeholder container.
   - _hydrate() (called after dashboard innerHTML) fetches + fills it.
═══════════════════════════════════════════════════════════ */
const MorningBriefCard = (() => {

  // Generation needs a TCC-capable process (reads ~/Documents) — the normal-context
  // brief_server.py on :8772. The launchd :8769 shim can only serve a mirrored copy
  // (it's TCC-blocked from generating). Static js/data/brief.json is the last resort.
  const RUNNER = 'http://127.0.0.1:8773';
  const SHIM   = 'http://127.0.0.1:8769';
  const STATIC = 'js/data/brief.json';

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  const isLocal = () => ['localhost', '127.0.0.1'].includes(window.location.hostname);

  function _cardHTML() {
    return `
      <div class="card mb-card" id="mbCard">
        <div class="card-head">
          <div>
            <div class="card-title"><span class="card-emoji">☀️</span>Morning Brief</div>
            <div class="card-sub">Your personal pre-market read — what to do about today</div>
          </div>
          <button class="btn-soft" id="mbRunBtn" title="Regenerate now (local, ~1–2 min)">⟳ Run now</button>
        </div>
        <div id="mbBody"><div class="text-dim" style="padding:12px 4px;font-size:.85rem">Loading brief…</div></div>
      </div>`;
  }

  async function _fetchBrief() {
    // Runner (:8772) → shim (:8769) → static file. Localhost-only for the servers.
    if (isLocal()) {
      for (const base of [RUNNER, SHIM]) {
        try {
          const r = await fetch(base + '/brief', { cache: 'no-store',
            signal: AbortSignal.timeout ? AbortSignal.timeout(2500) : undefined });
          if (r.ok) return await r.json();
        } catch (_) {}
      }
    }
    try {
      const r = await fetch(STATIC, { cache: 'no-store' });
      if (r.ok) return await r.json();
    } catch (_) {}
    return null;
  }

  function _pill(status) {
    const map = { intact: ['✓', 'good'], watch: ['◐', 'warn'], threatened: ['⚠', 'bad'],
                  A: ['A', 'good'], B: ['B', 'warn'], watch2: ['◐', 'warn'],
                  confirmed: ['✓', 'good'], likely: ['◐', 'warn'], rumored: ['?', 'bad'] };
    const [g, cls] = map[status] || ['·', ''];
    return `<span class="mb-pill mb-${cls}">${g} ${esc(status)}</span>`;
  }

  function _render(b) {
    const body = document.getElementById('mbBody');
    if (!body) return;
    if (!b) {
      body.innerHTML = `<div class="text-dim" style="padding:12px 4px;font-size:.85rem">
        No brief yet. ${isLocal() ? 'Click <strong>⟳ Run now</strong> to generate one (local, no API cost).'
          : 'Open the dashboard on <strong>localhost:8768</strong> — the brief generator is local-only (Chrome PNA).'}
      </div>`;
      return;
    }

    const qc = b.qc || {};
    const stale = (b.inputs || []).filter(i => i.stale).map(i => i.name);
    const banner = !qc.passed
      ? `<div class="mb-banner mb-bad">⛔ QC did not pass — treat with caution. ${esc((qc.flags||[]).join(' · '))}</div>`
      : (stale.length
        ? `<div class="mb-banner mb-warn">⚠ Stale inputs (flagged, not trusted): ${esc(stale.join(', '))}</div>`
        : `<div class="mb-banner mb-good">✓ ${esc(qc.attestation || 'fresh')}</div>`);

    const dt = b.day_type || {};
    const sec = (title, inner) => inner ? `<div class="mb-sec"><div class="mb-sec-h">${title}</div>${inner}</div>` : '';

    const exposure = (b.exposure || []).map(e =>
      `<div class="mb-row">${_pill(e.status)} <strong>${esc(e.subject)}</strong> — ${esc(e.note)}</div>`).join('')
      || '<div class="mb-empty">No open positions or theses flagged.</div>';

    const _tf = tf => tf ? ` <span style="font-size:.66rem;font-weight:700;letter-spacing:.03em;background:var(--accent-soft);color:var(--accent);padding:1px 5px;border-radius:4px">${esc(String(tf).toUpperCase())}</span>` : '';
    const setups = (b.setups || []).map(s =>
      `<div class="mb-row">${_pill(s.tier === 'watch' ? 'watch2' : s.tier)} <strong>${esc(s.coin)}</strong>${_tf(s.timeframe)} · ${esc(s.setup)} — ${esc(s.condition)}</div>`).join('')
      || '<div class="mb-empty">No swing setups (4H / Daily / Weekly) near their conditions today.</div>';

    const cats = (b.catalysts || []).map(c =>
      `<div class="mb-row">${_pill(c.tier)} <strong>${esc(c.coin)}</strong> · ${esc(c.event)} <span class="text-dim">(${esc(c.when)})</span> — ${esc(c.implication)}</div>`).join('')
      || '<div class="mb-empty">No catalysts on your tickers today.</div>';

    const ch = b.charter || {};
    const charter = `
      ${(ch.no_entry_windows||[]).length ? `<div class="mb-row mb-bad-text">⛔ No-entry: ${esc(ch.no_entry_windows.join(' · '))}</div>` : ''}
      ${ch.breaker_note ? `<div class="mb-row">🧯 ${esc(ch.breaker_note)}</div>` : ''}
      ${(ch.tendency_flags||[]).map(t => `<div class="mb-row">🧠 ${esc(t)}</div>`).join('')}
      ${!(ch.no_entry_windows||[]).length && !ch.breaker_note && !(ch.tendency_flags||[]).length ? '<div class="mb-empty">No charter flags today — trade the plan.</div>' : ''}`;

    body.innerHTML = `
      ${banner}
      <div class="mb-daytype mb-${esc(dt.label||'')}"><strong>${esc((dt.label||'').toUpperCase())}</strong> — ${esc(dt.body||'')}</div>
      ${sec('📌 My exposure & thesis threats', exposure)}
      ${sec('🎯 My setups in play', setups)}
      ${sec('🗓 Catalysts on my tickers', cats)}
      ${sec('📏 Charter flags', charter)}
      <div class="mb-foot text-dim">engine: ${esc(b.engine||'?')} · generated ${esc((b.generated||'').slice(0,16).replace('T',' '))} UTC</div>`;
  }

  async function _run() {
    const btn = document.getElementById('mbRunBtn');
    const body = document.getElementById('mbBody');
    if (!isLocal()) { if (typeof App !== 'undefined' && App.toast) App.toast('Run the brief on localhost:8768 (local-only)', 'warn'); return; }
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }
    if (body) body.innerHTML = `<div class="text-dim" style="padding:12px 4px;font-size:.85rem">⏳ Generating brief locally (~1–2 min)…</div>`;
    try {
      const r = await fetch(RUNNER + '/run-brief', { method: 'POST',
        signal: AbortSignal.timeout ? AbortSignal.timeout(300000) : undefined });
      if (!r.ok) {
        let msg = 'runner ' + r.status;
        try { const j = await r.json(); if (j.error) msg = j.error; } catch (_) {}
        throw new Error(msg);
      }
      const b = await r.json();
      _render(b.brief || b);
    } catch (e) {
      const offline = /Failed to fetch|NetworkError|aborted/i.test(e.message);
      // The generator runs 24/7 as a launchd agent (com.jaybot.brief-runner) — no
      // terminal needed. If it's unreachable the Mac is asleep/off, or the agent
      // isn't loaded. Fall back to showing the latest saved brief, no scary commands.
      if (offline) {
        const saved = await _fetchBrief();
        if (saved) { _render(saved); if (typeof App !== 'undefined' && App.toast) App.toast('Generator offline — showing the latest saved brief', 'warn'); }
        else if (body) body.innerHTML = `<div class="mb-banner mb-warn">The Morning Brief generator isn't reachable right now. It runs automatically on your Mac — if this persists, your Mac may be asleep. Nothing to do in a terminal.</div>`;
      } else if (body) {
        body.innerHTML = `<div class="mb-banner mb-bad">Run failed: ${esc(e.message)}</div>`;
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⟳ Run now'; }
    }
  }

  async function _hydrate() {
    const btn = document.getElementById('mbRunBtn');
    if (btn) btn.addEventListener('click', _run);
    _render(await _fetchBrief());
  }

  return { _cardHTML, _hydrate };
})();
