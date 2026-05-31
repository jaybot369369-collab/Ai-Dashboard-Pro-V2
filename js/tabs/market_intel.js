/* ═══════════════════════════════════════════════════════════
   MARKET INTEL TAB
   Reads js/data/market_intel.json (generated server-side by
   automation/run_market_intel.py — twice daily on weekdays).

   Strict-sourcing contract: every claim renders inline citations
   linking to the upstream source URL + fetched_at timestamp.
   Claims with empty sources[] are flagged as a hard bug.
════════════════════════════════════════════════════════════ */
const MarketIntelTab = (() => {

  let _data = null;
  let _err  = null;
  let _autoTimer = null;

  const REFRESH_MS = 4 * 60 * 60 * 1000;   // 4h (cron runs 2x/day)
  const CHECK_MS   = 30 * 60 * 1000;       // re-check every 30m while tab open

  // Cloudflare Worker dispatch — set on first use, persist in localStorage
  const LS_WORKER  = 'mi_worker_url';
  const LS_TOKEN   = 'mi_dispatch_token';

  // Local Claude Code shim (automation/market_intel_local_server.py) — used by
  // the "Run Locally" button so the dashboard can refresh market intel via the
  // user's Claude Code subscription instead of burning Anthropic API tokens.
  const LS_LOCAL_URL = 'mi_local_url';
  const LOCAL_DEFAULT = 'http://127.0.0.1:8769';
  let   _localPollTimer = null;

  const REGIME_COLORS = {
    'Risk-On':       'var(--green)',
    'Risk-Off':      'var(--red)',
    'Defensive':     'var(--gold)',
    'Late-Cycle':    'var(--orange)',
    'Indeterminate': 'var(--text-dim)',
  };

  const SECTION_META = [
    { key: 'macro',           title: 'Macro Drivers',              icon: '🏛️', defaultOpen: true  },
    { key: 'rotation',        title: 'Equity Sector Rotation',     icon: '🔄', defaultOpen: true  },
    { key: 'cross_asset',     title: 'Cross-Asset Flows',          icon: '🌐', defaultOpen: true  },
    { key: 'crypto',          title: 'Crypto Market Structure',    icon: '₿',  defaultOpen: false },
    { key: 'crypto_rotation', title: 'Crypto Sector & Chain Rotation', icon: '🔁', defaultOpen: false },
    { key: 'sentiment',       title: 'Sentiment & Positioning',    icon: '🧠', defaultOpen: false },
    { key: 'seasonality',     title: 'Seasonality',                icon: '📅', defaultOpen: false },
    { key: 'narratives',      title: 'Trending Narratives',        icon: '💬', defaultOpen: false },
    { key: 'watch_next',      title: 'What to Watch Next',         icon: '🔭', defaultOpen: false },
  ];

  /* ── Helpers ────────────────────────────────────────── */
  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // Source URLs come from server-generated JSON. Allow http(s) absolute URLs
  // AND same-origin relative paths (e.g. "js/data/market_intel.pdf"). Reject
  // anything that could execute (javascript:/data:/vbscript:) or that contains
  // a colon outside an allowed scheme. esc() escapes characters but does NOT
  // change the URL scheme, so this check is the only safety net.
  function safeHref(u) {
    if (!u || typeof u !== 'string') return '#';
    const s = u.trim();
    if (/^https?:\/\//i.test(s)) return s;
    // Same-origin relative path: must start with "/" or a path segment, must
    // not contain "://" or a control-character scheme. Conservative regex.
    if (/^[a-zA-Z0-9_\-./?#=&%]+$/.test(s) && !/^[a-z]+:/i.test(s)) return s;
    return '#';
  }
  function fmtAge(iso) {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    if (isNaN(ms)) return '—';
    const m = Math.round(ms / 60000);
    if (m < 60)  return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 48)  return `${h}h ago`;
    const d = Math.round(h / 24);
    return `${d}d ago`;
  }
  function ageHours(iso) {
    if (!iso) return Infinity;
    return (Date.now() - new Date(iso).getTime()) / 3600000;
  }
  function oldestSourceAge(claims) {
    let oldest = null;
    (claims || []).forEach(c => (c.sources || []).forEach(s => {
      if (!s.fetched_at) return;
      if (!oldest || new Date(s.fetched_at) < new Date(oldest)) oldest = s.fetched_at;
    }));
    return oldest;
  }

  async function load() {
    _err = null;
    /* Prefer the live /api/market_intel endpoint (reads /data on Railway
       → updates instantly after a server-side refresh). Fall back to the
       V2-bundled static JSON if the API isn't reachable (offline dev). */
    const sources = [
      `${window.location.origin}/api/market_intel?t=${Date.now()}`,
      `js/data/market_intel.json?t=${Date.now()}`,
    ];
    for (const url of sources) {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error('fetch ' + r.status);
        _data = await r.json();
        return;
      } catch (e) {
        _err = e.message;
        continue;
      }
    }
  }

  /* ── Citation rendering ─────────────────────────────── */
  function renderClaim(claim, citeIdxRef) {
    if (!claim || !claim.text) return '';
    const sources = claim.sources || [];
    if (sources.length === 0) {
      return `<div class="mi-claim mi-claim-broken">
        <span class="mi-broken-tag">⚠ MISSING CITATION</span>
        <span>${esc(claim.text)}</span>
        ${claim._validator_error ? `<span class="mi-broken-err">${esc(claim._validator_error)}</span>` : ''}
      </div>`;
    }
    const sups = sources.map(s => {
      const idx = ++citeIdxRef.n;
      citeIdxRef.list.push(s);
      return `<sup class="mi-cite" data-idx="${idx}" title="${esc(s.name || 'source')} · ${esc(fmtAge(s.fetched_at))}">[${idx}]</sup>`;
    }).join('');
    return `<div class="mi-claim"><span>${esc(claim.text)}</span>${sups}</div>`;
  }

  function renderSectionTable(key, section) {
    if (key === 'rotation' && section.sectors?.length) {
      return `<table class="mi-table">
        <thead><tr><th>Sector</th><th>1D</th><th>1W</th><th>1M</th><th>vs SPY (1M)</th></tr></thead>
        <tbody>${section.sectors.map(r => `<tr>
          <td>${esc(r.name || r.symbol || '?')}</td>
          <td class="${(r.d1||'').startsWith('-')?'mi-neg':'mi-pos'}">${esc(r.d1 || '—')}</td>
          <td class="${(r.w1||'').startsWith('-')?'mi-neg':'mi-pos'}">${esc(r.w1 || '—')}</td>
          <td class="${(r.m1||'').startsWith('-')?'mi-neg':'mi-pos'}">${esc(r.m1 || '—')}</td>
          <td class="${(r.rs_spy||'').startsWith('-')?'mi-neg':'mi-pos'}">${esc(r.rs_spy || '—')}</td>
        </tr>`).join('')}</tbody>
      </table>`;
    }
    if (key === 'cross_asset' && section.assets?.length) {
      return `<table class="mi-table">
        <thead><tr><th>Asset</th><th>Last</th><th>1D</th><th>1W</th><th>Source</th></tr></thead>
        <tbody>${section.assets.map(r => `<tr>
          <td>${esc(r.name || r.symbol || '?')}</td>
          <td>${esc(r.last || '—')}</td>
          <td class="${(r.d1||'').startsWith('-')?'mi-neg':'mi-pos'}">${esc(r.d1 || '—')}</td>
          <td class="${(r.w1||'').startsWith('-')?'mi-neg':'mi-pos'}">${esc(r.w1 || '—')}</td>
          <td class="mi-cell-dim">${esc(r.source || '—')}</td>
        </tr>`).join('')}</tbody>
      </table>`;
    }
    if (key === 'crypto' && section.metrics?.length) {
      return `<table class="mi-table">
        <thead><tr><th>Metric</th><th>Value</th><th>Δ</th><th>Source</th></tr></thead>
        <tbody>${section.metrics.map(r => `<tr>
          <td>${esc(r.name || '?')}</td>
          <td>${esc(r.value || '—')}</td>
          <td class="${(r.delta||'').startsWith('-')?'mi-neg':'mi-pos'}">${esc(r.delta || '—')}</td>
          <td class="mi-cell-dim">${esc(r.source || '—')}</td>
        </tr>`).join('')}</tbody>
      </table>`;
    }
    if (key === 'sentiment' && section.gauges?.length) {
      return `<table class="mi-table">
        <thead><tr><th>Gauge</th><th>Reading</th><th>Extreme?</th><th>As of</th></tr></thead>
        <tbody>${section.gauges.map(r => `<tr>
          <td>${esc(r.name || '?')}</td>
          <td>${esc(r.value || '—')}</td>
          <td>${r.extreme ? `<span class="mi-extreme">${esc(r.extreme)}</span>` : '<span class="mi-cell-dim">—</span>'}</td>
          <td class="mi-cell-dim">${esc(r.as_of ? fmtAge(r.as_of) : '—')}</td>
        </tr>`).join('')}</tbody>
      </table>`;
    }
    if (key === 'narratives' && section.items?.length) {
      return `<table class="mi-table">
        <thead><tr><th>Narrative</th><th>Flow Confirms?</th><th>Evidence</th></tr></thead>
        <tbody>${section.items.map(r => `<tr>
          <td>${esc(r.theme || '?')}</td>
          <td>${r.flow_confirms === true ? '<span class="mi-pos">✓ yes</span>' : r.flow_confirms === false ? '<span class="mi-neg">✗ chatter only</span>' : '<span class="mi-cell-dim">—</span>'}</td>
          <td>${esc(r.evidence || '—')}</td>
        </tr>`).join('')}</tbody>
      </table>`;
    }
    if (key === 'crypto_rotation') {
      const sectors = section.sectors || [];
      const chainsArr = section.chains || [];
      let html = '';
      if (sectors.length) {
        html += `<div class="mi-rot-subhdr">Sector flows (DefiLlama categories, 24h $ flow estimate)</div>
        <table class="mi-table">
          <thead><tr><th>Sector</th><th>TVL</th><th>Share</th><th>1d %</th><th>7d %</th><th>24h flow</th><th>Dir</th></tr></thead>
          <tbody>${sectors.map(r => `<tr>
            <td>${esc(r.category || r.name || '?')}</td>
            <td>${esc(r.tvl_usd_str || '—')}</td>
            <td class="mi-cell-dim">${esc(r.share_pct || '—')}</td>
            <td class="${(r.chg_24h_pct||'').startsWith('-')?'mi-neg':'mi-pos'}">${esc(r.chg_24h_pct || '—')}</td>
            <td class="${(r.chg_7d_pct||'').startsWith('-')?'mi-neg':'mi-pos'}">${esc(r.chg_7d_pct || '—')}</td>
            <td>${esc(r.flow_24h_str || '—')}</td>
            <td>${r.flow_direction === 'in' ? '<span class="mi-pos">▲ in</span>' : r.flow_direction === 'out' ? '<span class="mi-neg">▼ out</span>' : '<span class="mi-cell-dim">~ flat</span>'}</td>
          </tr>`).join('')}</tbody>
        </table>`;
      }
      if (chainsArr.length) {
        html += `<div class="mi-rot-subhdr">Top blockchains by TVL</div>
        <table class="mi-table">
          <thead><tr><th>Chain</th><th>TVL</th><th>Dom</th><th>24h %</th><th>7d %</th><th>30d %</th></tr></thead>
          <tbody>${chainsArr.map(r => `<tr>
            <td>${esc(r.name || '?')}</td>
            <td>${esc(r.tvl_usd_str || '—')}</td>
            <td class="mi-cell-dim">${esc(r.dominance_pct || '—')}</td>
            <td class="${(r.chg_24h_pct||'').startsWith('-')?'mi-neg':'mi-pos'}">${esc(r.chg_24h_pct || '—')}</td>
            <td class="${(r.chg_7d_pct||'').startsWith('-')?'mi-neg':'mi-pos'}">${esc(r.chg_7d_pct || '—')}</td>
            <td class="${(r.chg_30d_pct||'').startsWith('-')?'mi-neg':'mi-pos'}">${esc(r.chg_30d_pct || '—')}</td>
          </tr>`).join('')}</tbody>
        </table>`;
      }
      return html;
    }
    if (key === 'watch_next' && section.events?.length) {
      return `<table class="mi-table">
        <thead><tr><th>When</th><th>Event</th><th>Type</th><th>Source</th></tr></thead>
        <tbody>${section.events.map(r => `<tr>
          <td>${esc(r.when || '—')}</td>
          <td>${esc(r.event || '—')}</td>
          <td><span class="mi-event-type">${esc(r.type || '—')}</span></td>
          <td>${r.source_url ? `<a href="${esc(safeHref(r.source_url))}" target="_blank" rel="noopener" class="mi-cell-link">${esc(r.source_name || 'link')}</a>` : '<span class="mi-cell-dim">—</span>'}</td>
        </tr>`).join('')}</tbody>
      </table>`;
    }
    if (key === 'seasonality') {
      return `<div class="mi-seasonality-meta">Lookback: <strong>${section.lookback_years || 0}y</strong> · Sample size: <strong>n=${section.sample_size || 0}</strong></div>`;
    }
    return '';
  }

  function renderSection(meta, section, citeIdxRef) {
    const claims = section.claims || [];
    const unavailable = section.unavailable || [];
    const oldestIso = oldestSourceAge(claims);
    const ageStr = oldestIso ? `oldest ${fmtAge(oldestIso)}` : '';

    const claimsHtml = claims.length
      ? `<ul class="mi-claims">${claims.map(c => `<li>${renderClaim(c, citeIdxRef)}</li>`).join('')}</ul>`
      : '';

    const tableHtml = renderSectionTable(meta.key, section);

    const unavailHtml = unavailable.length
      ? `<div class="mi-unavailable"><div class="mi-unavail-hdr">Not available this run</div>${unavailable.map(u => `<div class="mi-unavail-row">— ${esc(u)}</div>`).join('')}</div>`
      : '';

    if (!claims.length && !tableHtml && !unavailable.length) {
      return ''; // section has no content at all, skip
    }

    return `<details class="mi-section" ${meta.defaultOpen ? 'open' : ''}>
      <summary class="mi-section-hdr">
        <span class="mi-section-icon">${meta.icon}</span>
        <span class="mi-section-title">${meta.title}</span>
        <span class="mi-section-count">${claims.length} claim${claims.length===1?'':'s'}</span>
        ${ageStr ? `<span class="mi-section-age">${ageStr}</span>` : ''}
        <span class="mi-section-chev">▾</span>
      </summary>
      <div class="mi-section-body">
        ${claimsHtml}
        ${tableHtml}
        ${unavailHtml}
      </div>
    </details>`;
  }

  function renderFreshness(freshness) {
    if (!freshness || Object.keys(freshness).length === 0) return '';
    const rows = Object.entries(freshness)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => {
        if (a.ok !== b.ok) return a.ok ? 1 : -1;     // failures first
        return (b.age_hours || 0) - (a.age_hours || 0);
      });
    const total = rows.length;
    const okCount = rows.filter(r => r.ok).length;
    const failCount = total - okCount;
    const oldestOk = rows.filter(r => r.ok && r.age_hours != null)
      .sort((a, b) => (b.age_hours || 0) - (a.age_hours || 0))[0];

    return `<details class="mi-freshness">
      <summary class="mi-freshness-summary">
        <span class="mi-freshness-icon">📊</span>
        <span class="mi-freshness-label">Data Freshness</span>
        <span class="mi-freshness-stat mi-pos">✓ ${okCount}</span>
        <span class="mi-freshness-stat ${failCount ? 'mi-neg' : 'mi-cell-dim'}">✗ ${failCount}</span>
        <span class="mi-freshness-stat mi-cell-dim">of ${total}</span>
        ${oldestOk ? `<span class="mi-freshness-stat mi-cell-dim">oldest ok: ${oldestOk.age_hours.toFixed(1)}h</span>` : ''}
        <span class="mi-section-chev">▾</span>
      </summary>
      <table class="mi-table mi-freshness-table">
        <thead><tr><th>Fetcher</th><th>Source</th><th>Age</th><th>OK</th><th>Note</th></tr></thead>
        <tbody>${rows.map(r => `<tr class="${r.ok ? '' : 'mi-fresh-fail'}">
          <td><code>${esc(r.id)}</code></td>
          <td>${r.source_url ? `<a href="${esc(safeHref(r.source_url))}" target="_blank" rel="noopener" class="mi-cell-link">${esc(r.source || '—')}</a>` : `<span>${esc(r.source || '—')}</span>`}</td>
          <td class="mi-cell-dim">${r.age_hours != null ? `${r.age_hours.toFixed(1)}h` : '—'}</td>
          <td>${r.ok ? '<span class="mi-pos">✓</span>' : '<span class="mi-neg">✗</span>'}</td>
          <td class="mi-cell-dim">${esc(r.note || '')}</td>
        </tr>`).join('')}</tbody>
      </table>
    </details>`;
  }

  function renderCiteDrawer(citations) {
    if (!citations.length) return '';
    return `<aside class="mi-cite-drawer" id="miCiteDrawer" hidden>
      <div class="mi-drawer-hdr">
        <h3>Sources</h3>
        <button class="btn-icon" onclick="MarketIntelTab._closeDrawer()">✕</button>
      </div>
      <ol class="mi-drawer-list">${citations.map((s, i) => `<li id="miCite-${i+1}">
        <div class="mi-drawer-name">${esc(s.name || 'source')}</div>
        <div class="mi-drawer-meta">${esc(fmtAge(s.fetched_at))} · ${s.value ? `value: <code>${esc(s.value)}</code>` : ''}</div>
        <a href="${esc(safeHref(s.url))}" target="_blank" rel="noopener" class="mi-drawer-url">${esc(s.url || '—')}</a>
      </li>`).join('')}</ol>
    </aside>`;
  }

  function _pageHead() {
    return `<div class="page-head">
      <h1>Market Intel</h1>
      <p class="subtitle">News feed · macro events · sentiment</p>
    </div>`;
  }

  /* ── Public render ──────────────────────────────────── */
  async function render() {
    const content = document.getElementById('content');
    content.innerHTML = _pageHead() + `<div class="mi-wrap"><div class="loading-state">Loading Market Intel…</div></div>`;

    if (!_data || ageHours(_data?.generated) > REFRESH_MS / 3600000) {
      await load();
    }
    startAutoRefresh();

    if (_err) {
      content.innerHTML = _pageHead() + `<div class="mi-wrap"><div class="empty-state"><div class="empty-icon">⚠️</div>
        <p>Could not load market intel: ${esc(_err)}</p>
        <p class="text-dim" style="font-size:.85rem">Run <code>python3 automation/run_market_intel.py</code> to generate <code>js/data/market_intel.json</code>.</p>
      </div></div>`;
      return;
    }

    const d = _data || {};
    const isPending = !d.generated;
    if (isPending) {
      content.innerHTML = _pageHead() + `<div class="mi-wrap">
        <div class="mi-hdr">
          <div>
            <h1 class="mi-title">🛰 Market Intel</h1>
            <div class="mi-subtitle">First run pending</div>
          </div>
        </div>
        <div class="empty-state" style="margin-top:24px">
          <div class="empty-icon">⏳</div>
          <p>The market intelligence cron has not produced data yet.</p>
          <p class="text-dim" style="font-size:.85rem;margin-top:8px">
            Trigger the workflow on GitHub Actions, or run<br>
            <code>python3 automation/run_market_intel.py</code> locally.
          </p>
        </div>
      </div>`;
      return;
    }

    const ageH = ageHours(d.generated);
    const isStale = ageH > 24;
    const regimeLabel = d.regime?.label || 'Indeterminate';
    const regimeColor = REGIME_COLORS[regimeLabel] || REGIME_COLORS.Indeterminate;
    const confidence = d.regime?.confidence || 'low';

    // Track all citations across the entire payload so the drawer can list them
    const citeIdxRef = { n: 0, list: [] };
    const heroRationale = renderClaim(d.regime?.rationale, citeIdxRef);

    const sectionsHtml = SECTION_META
      .map(m => renderSection(m, d.sections?.[m.key] || { claims: [], unavailable: [] }, citeIdxRef))
      .join('');

    const pdfBtn = d.pdf_url
      ? `<a href="${esc(safeHref(d.pdf_url))}" target="_blank" rel="noopener" class="btn-ghost btn-sm" title="Download companion PDF">📥 PDF</a>`
      : '';
    const fetchBtn = `<button class="btn-primary btn-sm" id="miFreshFetch" title="Trigger a fresh server-side fetch via Cloudflare Worker (uses Anthropic API tokens, ~3 minutes). Pushes to the V2 repo + Railway redeploys.">☁️ Run Cloud</button>`;
    // "Run Now" — Railway-side runner. Same pipeline as Cloud, but writes
    // JSON straight to the Volume so every viewer sees it on next reload
    // (no V2 redeploy needed). Requires ADMIN_API_SECRET prompt on first use.
    const runNowBtn = `<button class="btn-ghost btn-sm" id="miRunNow" title="Run server-side on Railway and broadcast to all dashboards (~3 minutes). Asks for your admin secret on first use.">🚀 Run Now</button>`;
    // "Run Locally" — only shown when V2 is served from the operator's own Mac
    // (localhost). Hits the local shim on :8769 which runs the pipeline with
    // --backend claude-code (Claude Code subscription, NO Anthropic API tokens).
    const _miIsLocal = ['localhost','127.0.0.1'].includes(window.location.hostname);
    const localRunBtn = _miIsLocal
      ? `<button class="btn-ghost btn-sm" id="miLocalRun" title="Refresh via your local Claude Code subscription — no Anthropic API tokens. Requires the local shim running: cd automation && python3 market_intel_local_server.py">🖥️ Run Locally</button>`
      : '';

    content.innerHTML = _pageHead() + `<div class="mi-wrap">
      ${isStale ? `<div class="mi-stale-banner">⚠ Data may be stale — last refresh ${fmtAge(d.generated)} (cron schedule: 2x/day weekdays).</div>` : ''}

      <div class="mi-hdr">
        <div>
          <h1 class="mi-title">🛰 Market Intel</h1>
          <div class="mi-subtitle">${esc(d.weekday || '')} · ${esc(d.date || '')} · refreshed ${fmtAge(d.generated)}</div>
        </div>
        <div class="mi-hdr-actions">
          ${pdfBtn}
          ${fetchBtn}
          ${runNowBtn}
          ${localRunBtn}
          <button class="btn-ghost btn-sm" onclick="MarketIntelTab._refresh()" title="Re-fetch JSON from server (does NOT call Claude)">↻ Reload</button>
        </div>
        <div class="mi-fetch-status" id="miFetchStatus" hidden></div>
        <div class="mi-fetch-status" id="miLocalStatus" hidden></div>
      </div>

      <div class="mi-hero" style="border-left-color:${regimeColor}">
        <div class="mi-regime-row">
          <span class="mi-regime-pill" style="background:${regimeColor};color:#0d1117">${esc(regimeLabel)}</span>
          <span class="mi-regime-conf mi-regime-conf-${esc(confidence)}">${esc(confidence)} confidence</span>
        </div>
        <div class="mi-regime-rationale">${heroRationale}</div>
      </div>

      <div class="mi-sections">
        ${sectionsHtml}
      </div>

      ${renderFreshness(d.freshness)}

      <div class="mi-footer text-dim">
        Generated by <code>automation/run_market_intel.py</code> · ${esc(d.generated || '')}<br>
        Model: ${esc(d.model?.name || '—')} · in:${d.model?.input_tokens || 0} / out:${d.model?.output_tokens || 0} tokens<br>
        Strict-sourcing: every claim must cite a real, verifiable source. Click <sup>[N]</sup> to inspect the upstream URL.
      </div>

      ${renderCiteDrawer(citeIdxRef.list)}
    </div>`;

    // Wire citation clicks
    document.querySelectorAll('.mi-cite').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        const idx = el.dataset.idx;
        _showDrawer(idx);
      });
    });

    // Wire "Run Fresh Fetch" button
    const fetchBtnEl = document.getElementById('miFreshFetch');
    if (fetchBtnEl) {
      fetchBtnEl.addEventListener('click', () => _runFreshFetch());
    }

    // Wire "Run Now" button (Railway-side server runner)
    const runNowEl = document.getElementById('miRunNow');
    if (runNowEl) {
      runNowEl.addEventListener('click', () => _runNow());
    }

    // Wire "Run Locally" button (local Claude Code shim — only present on localhost)
    const localRunEl = document.getElementById('miLocalRun');
    if (localRunEl) {
      localRunEl.addEventListener('click', () => _runLocal());
    }
  }

  /* ── Server-side run on Railway ──────────────────────────
     POSTs to /api/_admin/run_market_intel with the operator's
     ADMIN_API_SECRET (cached in localStorage). The server spawns the
     vendored runner, writes JSON to /data, and every dashboard fetching
     /api/market_intel picks up the new data on reload — no V2 redeploy.
     Returns immediately; status polls every 5s.
  ──────────────────────────────────────────────────────── */
  const LS_ADMIN_SECRET = 'mi_admin_secret';

  async function _runNow() {
    const btn    = document.getElementById('miRunNow');
    const status = document.getElementById('miLocalStatus');   // reuse the existing status pill
    if (!btn || !status) return;

    let secret = (localStorage.getItem(LS_ADMIN_SECRET) || '').trim();
    if (!secret) {
      secret = (prompt('Enter ADMIN_API_SECRET (set on Railway). Cached locally after first use.') || '').trim();
      if (!secret) return;
      localStorage.setItem(LS_ADMIN_SECRET, secret);
    }

    btn.disabled = true;
    btn.textContent = '🚀 Dispatching…';
    status.hidden = false;
    status.className = 'mi-fetch-status mi-fetch-pending';
    status.textContent = 'Sending request to Railway…';

    try {
      const r = await fetch(`${window.location.origin}/api/_admin/run_market_intel?backend=api`, {
        method: 'POST',
        headers: { 'X-Admin-Secret': secret, 'Content-Type': 'application/json' },
      });
      if (r.status === 403) {
        localStorage.removeItem(LS_ADMIN_SECRET);
        throw new Error('bad admin secret — cleared cache, click again');
      }
      if (r.status === 409) {
        const j = await r.json();
        status.className = 'mi-fetch-status mi-fetch-pending';
        status.textContent = `⏳ another run already in progress (started ${j.started_at}, ${Math.round(j.age_seconds)}s ago)`;
        btn.textContent = '🚀 Run Now';
        btn.disabled = false;
        _pollStatusUntilDone();
        return;
      }
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const j = await r.json();
      status.textContent = `🚀 Run started (pid ${j.pid}). Polling status… ~${Math.round(j.expected_duration_seconds / 60)} min.`;
      btn.textContent = '🚀 Running…';
      _pollStatusUntilDone();
    } catch (e) {
      status.className = 'mi-fetch-status mi-fetch-fail';
      status.textContent = `✗ ${e.message}`;
      btn.disabled = false;
      btn.textContent = '🚀 Run Now';
    }
  }

  async function _pollStatusUntilDone() {
    const status = document.getElementById('miLocalStatus');
    const btn    = document.getElementById('miRunNow');
    if (!status || !btn) return;
    const POLL_MS = 5000;
    const start = Date.now();
    const tick = async () => {
      try {
        const r = await fetch(`${window.location.origin}/api/_admin/market_intel_status?t=${Date.now()}`);
        const j = await r.json();
        if (j.state === 'running') {
          const sec = Math.round((Date.now() - start) / 1000);
          status.className = 'mi-fetch-status mi-fetch-pending';
          status.textContent = `🚀 Server-side run in progress (~${sec}s elapsed)…`;
          setTimeout(tick, POLL_MS);
          return;
        }
        if (j.state === 'done') {
          status.className = 'mi-fetch-status mi-fetch-ok';
          status.textContent = `✓ Run complete. Reloading data — every dashboard will pick this up on next refresh.`;
          await _refresh();
          btn.disabled = false;
          btn.textContent = '🚀 Run Now';
          return;
        }
        if (j.state === 'failed') {
          status.className = 'mi-fetch-status mi-fetch-fail';
          status.textContent = `✗ Run failed (exit ${j.exit_code}). Check Railway logs.`;
          btn.disabled = false;
          btn.textContent = '🚀 Run Now';
          return;
        }
        /* never_run — shouldn't happen post-dispatch, but handle anyway */
        setTimeout(tick, POLL_MS);
      } catch (e) {
        status.className = 'mi-fetch-status mi-fetch-fail';
        status.textContent = `✗ poll error: ${e.message}`;
        btn.disabled = false;
        btn.textContent = '🚀 Run Now';
      }
    };
    setTimeout(tick, POLL_MS);
  }

  /* ── Local Claude Code shim ─────────────────────────────
     POSTs to a local HTTP server (automation/market_intel_local_server.py
     on port 8769) which spawns run_market_intel.py --backend claude-code.
     Then polls /status until the run completes, and reloads the JSON.
     Uses the user's Claude Code subscription — no API tokens burned.
  ───────────────────────────────────────────────────────── */
  async function _runLocal() {
    const btn    = document.getElementById('miLocalRun');
    const status = document.getElementById('miLocalStatus');
    if (!btn || !status) return;

    /* Hard guard — the local shim only exists on the operator's Mac.
       If V2 is served from anywhere else, the button shouldn't have been
       wired at all, but in case some entry point bypasses that check,
       fail loud and clear instead of trying to hit localhost. */
    if (!['localhost','127.0.0.1'].includes(window.location.hostname)) {
      status.hidden = false;
      status.className = 'mi-fetch-status mi-fetch-fail';
      status.textContent = '✗ "Run Locally" only works when V2 is served from your own Mac. Use ☁️ Run Cloud here.';
      return;
    }

    const baseUrl = (localStorage.getItem(LS_LOCAL_URL) || LOCAL_DEFAULT).replace(/\/$/, '');

    btn.disabled = true;
    btn.textContent = '🖥️ Checking…';
    status.hidden = false;
    status.className = 'mi-fetch-status mi-fetch-pending';
    status.textContent = `Checking local shim at ${baseUrl}…`;

    // 1. Health probe — fail fast if server isn't up
    try {
      const h = await fetch(`${baseUrl}/health`, { method: 'GET' });
      if (!h.ok) throw new Error(`HTTP ${h.status}`);
      const hj = await h.json();
      if (!hj.ok) throw new Error('health-not-ok');
    } catch (e) {
      status.className = 'mi-fetch-status mi-fetch-fail';
      status.textContent = `✗ Local shim unreachable at ${baseUrl}. Start it with: ` +
        `cd automation && python3 market_intel_local_server.py`;
      btn.disabled = false;
      btn.textContent = '🖥️ Run Locally';
      return;
    }

    // 2. Kick off the run
    btn.textContent = '🖥️ Dispatching…';
    status.textContent = 'Dispatching run to local Claude Code…';
    try {
      const r = await fetch(`${baseUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        const errMsg = j.error || `HTTP ${r.status}`;
        const isRunning = errMsg.toLowerCase().includes('already in progress');
        status.className = `mi-fetch-status mi-${isRunning ? 'fetch-running' : 'fetch-fail'}`;
        status.textContent = isRunning
          ? '⏳ A local run is already in progress — polling for completion…'
          : `✗ Dispatch failed: ${errMsg}`;
        if (!isRunning) {
          btn.disabled = false;
          btn.textContent = '🖥️ Run Locally';
          return;
        }
      }
    } catch (e) {
      status.className = 'mi-fetch-status mi-fetch-fail';
      status.textContent = `✗ Dispatch error: ${e.message}`;
      btn.disabled = false;
      btn.textContent = '🖥️ Run Locally';
      return;
    }

    // 3. Poll status — local runs typically take 60-180s (fetchers + CLI + PDF)
    btn.textContent = '⏳ Running…';
    status.className = 'mi-fetch-status mi-fetch-running';
    const tStart = Date.now();
    const POLL_MS = 4000;
    const TIMEOUT_MS = 8 * 60 * 1000;
    const startedGen = _data?.generated || null;

    if (_localPollTimer) { clearTimeout(_localPollTimer); _localPollTimer = null; }

    const tick = async () => {
      const elapsed = Math.round((Date.now() - tStart) / 1000);
      try {
        const sr = await fetch(`${baseUrl}/status`);
        const st = await sr.json();
        const lastLog = (st.log_tail && st.log_tail.length) ? st.log_tail[st.log_tail.length - 1] : '';
        status.textContent = `⏳ ${st.status} · ${elapsed}s · ${lastLog.slice(0, 120)}`;

        if (st.status === 'done') {
          // Reload the JSON; check that generated_at actually advanced
          await load();
          const newGen = _data?.generated;
          if (newGen && newGen !== startedGen) {
            status.className = 'mi-fetch-status mi-fetch-ok';
            status.textContent = `✓ Local run finished in ${st.duration_sec}s. Refreshing.`;
            btn.disabled = false;
            btn.textContent = '🖥️ Run Locally';
            setTimeout(() => render(), 600);
            return;
          }
          // Done but the JSON didn't change — surface this; common when claude-cli failed
          status.className = 'mi-fetch-status mi-fetch-fail';
          status.textContent = `⚠ Run completed but JSON did not advance — check log_tail. Last line: ${lastLog.slice(0, 200)}`;
          btn.disabled = false;
          btn.textContent = '🖥️ Run Locally';
          return;
        }
        if (st.status === 'error') {
          status.className = 'mi-fetch-status mi-fetch-fail';
          status.textContent = `✗ Run failed: ${st.error || 'unknown'} — ${lastLog.slice(0, 200)}`;
          btn.disabled = false;
          btn.textContent = '🖥️ Run Locally';
          return;
        }
      } catch (e) {
        // transient — keep polling
      }
      if (Date.now() - tStart > TIMEOUT_MS) {
        status.className = 'mi-fetch-status mi-fetch-fail';
        status.textContent = '✗ Timeout after 8 min — check the local server log (/tmp/mi_local_server.log).';
        btn.disabled = false;
        btn.textContent = '🖥️ Run Locally';
        return;
      }
      _localPollTimer = setTimeout(tick, POLL_MS);
    };
    _localPollTimer = setTimeout(tick, POLL_MS);
  }

  /* ── Fresh-fetch button ─────────────────────────────────
     POSTs to a Cloudflare Worker that triggers the GitHub
     Actions workflow_dispatch. After dispatch, polls the
     dashboard repo's market_intel.json every 30s for up to
     6 minutes; auto-reloads when generated_at advances.
  ───────────────────────────────────────────────────────── */
  async function _runFreshFetch() {
    const btn    = document.getElementById('miFreshFetch');
    const status = document.getElementById('miFetchStatus');
    if (!btn || !status) return;

    let workerUrl = (localStorage.getItem(LS_WORKER) || '').trim();
    let token     = (localStorage.getItem(LS_TOKEN)  || '').trim();
    if (!workerUrl) {
      workerUrl = (window.prompt('Cloudflare Worker URL (one-time setup):\n\nExample: https://market-intel-dispatch.YOUR-SUBDOMAIN.workers.dev', '') || '').trim();
      if (!workerUrl) return;
      localStorage.setItem(LS_WORKER, workerUrl.replace(/\/$/, ''));
    }
    if (!token) {
      token = (window.prompt('Worker DISPATCH_TOKEN (one-time setup; same value as the Worker secret):', '') || '').trim();
      if (!token) return;
      localStorage.setItem(LS_TOKEN, token);
    }
    workerUrl = workerUrl.replace(/\/$/, '');

    btn.disabled = true;
    btn.textContent = '🔄 Dispatching…';
    status.hidden = false;
    status.className = 'mi-fetch-status mi-fetch-pending';
    status.textContent = 'Calling Worker…';

    let dispatchOk = false;
    try {
      const r = await fetch(`${workerUrl}/dispatch/market_intel`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: '{}',
      });
      const j = await r.json().catch(() => ({}));
      dispatchOk = r.ok && j.ok;
      if (!dispatchOk) {
        const msg = j.error || `HTTP ${r.status}`;
        status.className = 'mi-fetch-status mi-fetch-fail';
        status.textContent = `✗ Dispatch failed: ${msg}. ${msg === 'auth' ? 'Token mismatch — clear with MarketIntelTab._resetDispatchAuth() in console.' : 'Check Worker URL and token.'}`;
        btn.disabled = false;
        btn.textContent = '🔄 Run Fresh Fetch';
        return;
      }
    } catch (e) {
      status.className = 'mi-fetch-status mi-fetch-fail';
      status.textContent = `✗ Worker unreachable: ${e.message}. Check the URL — clear with MarketIntelTab._resetDispatchAuth() in console.`;
      btn.disabled = false;
      btn.textContent = '🔄 Run Fresh Fetch';
      return;
    }

    btn.textContent = '⏳ Running cron…';
    status.className = 'mi-fetch-status mi-fetch-running';
    const startedAt = _data?.generated || null;
    const tStart = Date.now();
    const TIMEOUT_MS = 6 * 60 * 1000;
    const POLL_MS   = 30 * 1000;

    const tick = async () => {
      const elapsed = Math.round((Date.now() - tStart) / 1000);
      status.textContent = `⏳ Cron running on GitHub Actions… polled ${elapsed}s ago. JSON should arrive within ~3 min.`;
      try {
        await load();
        const newGen = _data?.generated;
        if (newGen && newGen !== startedAt) {
          status.className = 'mi-fetch-status mi-fetch-ok';
          status.textContent = `✓ Fresh data arrived (${fmtAge(newGen)}). Re-rendering.`;
          btn.disabled = false;
          btn.textContent = '🔄 Run Fresh Fetch';
          setTimeout(() => render(), 600);
          return;
        }
      } catch (_) { /* ignore transient fetch fail */ }
      if (Date.now() - tStart > TIMEOUT_MS) {
        status.className = 'mi-fetch-status mi-fetch-fail';
        status.textContent = '✗ Timeout — no fresh JSON after 6 min. Check the workflow run on GitHub Actions.';
        btn.disabled = false;
        btn.textContent = '🔄 Run Fresh Fetch';
        return;
      }
      setTimeout(tick, POLL_MS);
    };
    setTimeout(tick, POLL_MS);
  }

  function _showDrawer(highlightIdx) {
    const d = document.getElementById('miCiteDrawer');
    if (!d) return;
    d.hidden = false;
    document.querySelectorAll('.mi-drawer-list li').forEach(li => li.classList.remove('mi-drawer-active'));
    if (highlightIdx) {
      const li = document.getElementById(`miCite-${highlightIdx}`);
      if (li) {
        li.classList.add('mi-drawer-active');
        li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }
  function _closeDrawer() {
    const d = document.getElementById('miCiteDrawer');
    if (d) d.hidden = true;
  }

  function startAutoRefresh() {
    if (_autoTimer) return;
    _autoTimer = setInterval(async () => {
      const onTab = document.querySelector('.nav-item.active')?.dataset.tab === 'marketintel';
      if (!onTab) return;
      const age = _data?.generated ? Date.now() - new Date(_data.generated).getTime() : Infinity;
      if (age > REFRESH_MS) {
        await load();
        render();
      }
    }, CHECK_MS);
  }

  return {
    render,
    _refresh: async () => { await load(); render(); },
    _runFreshFetch,
    _runLocal,
    _setLocalUrl: (url) => {
      if (!url) {
        localStorage.removeItem(LS_LOCAL_URL);
        console.log(`Cleared mi_local_url. Default: ${LOCAL_DEFAULT}`);
        return;
      }
      localStorage.setItem(LS_LOCAL_URL, url.replace(/\/$/, ''));
      console.log(`Set mi_local_url = ${url}`);
    },
    _resetDispatchAuth: () => {
      localStorage.removeItem(LS_WORKER);
      localStorage.removeItem(LS_TOKEN);
      console.log('Cleared mi_worker_url + mi_dispatch_token. Click "Run Cloud" to re-enter.');
    },
    _showDrawer,
    _closeDrawer,
  };
})();
