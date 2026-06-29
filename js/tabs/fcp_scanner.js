/* ═══════════════════════════════════════════════════════════
   FCP SCANNER TAB — Float · Catalyst · Price
   Screener for the top ~150 coins by mcap.
   Ranks by promotion-cycle discipline from Penny_Stock_Coaching:
     Float gate first → catalyst confirmation → price action last.
   Data: CoinGecko /coins/markets (1 call, no auth).
         catalysts.json (local, already in repo).
         fcp_unlock_overrides.json (optional manual overrides).
   Scoring: FCPScore engine in js/lib/fcp_score.js.
════════════════════════════════════════════════════════════ */
const FCPScanner = (() => {

  const CG = 'https://api.coingecko.com/api/v3';
  const LS_LAST   = 'jb_fcp_last';
  const LS_TIER   = 'jb_fcp_tier_filter';
  const LS_SORT   = 'jb_fcp_sort';
  const LS_GUIDE  = 'jb_fcp_guide_collapsed';
  const LAST_TTL  = 6 * 3600 * 1000;

  const esc = s => (s == null ? '' : String(s)
    .replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])));
  const _sig = ms => (AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);

  let _tierFilter    = localStorage.getItem(LS_TIER)  || 'all';
  let _sort          = localStorage.getItem(LS_SORT)   || 'composite';
  let _guideCollapsed = localStorage.getItem(LS_GUIDE) !== 'off';
  let _expandedSym   = null;

  let _lastRun = (() => {
    try {
      const raw = localStorage.getItem(LS_LAST);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (p?.ts && Date.now() - p.ts < LAST_TTL) return p;
    } catch (_) {}
    return null;
  })();

  /* ── formatters ─────────────────────────────────────────── */
  function fmtPrice(p) {
    if (p == null) return '—';
    if (p >= 10000) return '$' + p.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (p >= 1000)  return '$' + p.toLocaleString(undefined, { maximumFractionDigits: 1 });
    if (p >= 1)     return '$' + p.toFixed(3);
    if (p >= 0.01)  return '$' + p.toFixed(4);
    return '$' + p.toPrecision(3);
  }
  function fmtUsd(n) {
    if (n == null) return '—';
    if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9)  return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6)  return '$' + (n / 1e6).toFixed(0) + 'M';
    return '$' + n.toFixed(0);
  }
  const fmtPct  = v => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%');
  const pctCls  = v => (v == null ? '' : v > 0 ? 'fcp-up' : v < 0 ? 'fcp-down' : '');

  /* ── data fetch ─────────────────────────────────────────── */
  async function _fetchMarkets() {
    // Two pages → ~300 coins. We score all of them and let the filter trim.
    const pages = [];
    for (const page of [1, 2]) {
      const url = `${CG}/coins/markets?vs_currency=usd&order=market_cap_desc`
        + `&per_page=150&page=${page}&price_change_percentage=24h,7d,30d&sparkline=false`;
      const r = await fetch(url, { mode: 'cors', cache: 'no-store', signal: _sig(15000) });
      if (!r.ok) throw new Error('CoinGecko ' + r.status);
      pages.push(...await r.json());
    }
    return pages;
  }

  async function _fetchCatalysts() {
    try {
      const r = await fetch(`js/data/catalysts.json?_=${Date.now()}`, { signal: _sig(5000) });
      if (!r.ok) return [];
      const j = await r.json();
      return j.events || [];
    } catch (_) { return []; }
  }

  async function _fetchUnlockOverrides() {
    try {
      const r = await fetch(`js/data/fcp_unlock_overrides.json?_=${Date.now()}`, { signal: _sig(5000) });
      if (!r.ok) return [];
      return await r.json();
    } catch (_) { return []; }
  }

  /* ── pull ───────────────────────────────────────────────── */
  async function _pullData() {
    const btn = document.getElementById('fcpScanBtn');
    const prog = document.getElementById('fcpProg');
    if (btn) { btn.disabled = true; btn.textContent = '⟳ Scanning…'; }
    if (prog) prog.textContent = 'Fetching CoinGecko top-300 + catalysts…';

    try {
      const [markets, catalysts, overrides] = await Promise.all([
        _fetchMarkets(),
        _fetchCatalysts(),
        _fetchUnlockOverrides(),
      ]);

      if (prog) prog.textContent = 'Scoring…';

      const rows = [];
      for (const coin of markets) {
        const sym = (coin.symbol || '').toUpperCase();
        if (FCPScore.EXCLUDE.has(sym)) continue;
        if (!coin.market_cap || coin.market_cap < 1e7) continue; // below $10M → skip
        const result = FCPScore.score(coin, catalysts, overrides);
        rows.push({
          sym,
          name: coin.name || sym,
          id: coin.id || '',
          price: coin.current_price,
          mcap: coin.market_cap,
          vol: coin.total_volume,
          c24: coin.price_change_percentage_24h_in_currency,
          c7:  coin.price_change_percentage_7d_in_currency,
          c30: coin.price_change_percentage_30d_in_currency,
          fdvMcap:  result.legs.float.fdvMcap,
          circRatio: result.legs.float.circRatio,
          ...result,
        });
      }

      // Default sort: composite desc
      rows.sort((a, b) => b.composite - a.composite);

      _lastRun = {
        ts: Date.now(),
        rows,
        totalScanned: markets.length,
        catalystCount: catalysts.length,
      };
      try { localStorage.setItem(LS_LAST, JSON.stringify(_lastRun)); } catch (_) {}
      _expandedSym = null;
      _renderTable();
    } catch (e) {
      const root = document.getElementById('fcpRoot');
      if (root) root.innerHTML = `<div class="card fcp-card"><div class="fcp-status fcp-status-err">Scan failed: ${esc(e.message || e)}. CoinGecko may be rate-limiting — wait a moment and retry.</div></div>`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⟳ Scan'; }
      if (prog) prog.textContent = '';
    }
  }

  /* ── rendering helpers ──────────────────────────────────── */
  function _scoreBar(score, cls) {
    const col = score >= 70 ? 'pos' : score <= 45 ? 'neg' : 'flat';
    const pct = Math.max(0, Math.min(100, score));
    return `<div class="fcp-score-cell">
      <div class="fcp-score-num ${col}">${score}</div>
      <div class="fcp-score-bar"><span class="${col}" style="width:${pct}%"></span></div>
    </div>`;
  }

  function _tierBadge(tier) {
    const map = {
      'A+': 'fcp-tier-aplus', 'A': 'fcp-tier-a', 'B': 'fcp-tier-b',
      'C':  'fcp-tier-c',     'F': 'fcp-tier-f',
    };
    return `<span class="fcp-tier ${map[tier] || 'fcp-tier-c'}">${esc(tier)}</span>`;
  }

  function _phaseBadge(phase) {
    const map = {
      'Accumulation': 'fcp-phase-acc',
      'Promotion':    'fcp-phase-promo',
      'Spike':        'fcp-phase-spike',
      'Distribution': 'fcp-phase-dist',
      'Collapse':     'fcp-phase-collapse',
    };
    return `<span class="fcp-phase ${map[phase] || ''}">${esc(phase)}</span>`;
  }

  function _verdictChip(verdict) {
    const map = {
      'ACCUMULATE':       'fcp-verd-acc',
      'WATCH':            'fcp-verd-watch',
      'NEUTRAL':          'fcp-verd-neutral',
      'AVOID LONG':       'fcp-verd-avoid',
      'SHORT EXTENSION':  'fcp-verd-short',
    };
    return `<span class="fcp-verdict ${map[verdict] || ''}">${esc(verdict)}</span>`;
  }

  function _legBar(label, score, detail) {
    const cls = score >= 70 ? 'pos' : score <= 45 ? 'neg' : 'flat';
    return `<div class="fcp-leg">
      <div class="fcp-leg-top"><span class="fcp-leg-label">${esc(label)}</span><span class="fcp-leg-num ${cls}">${score}</span></div>
      <div class="fcp-leg-bar-wrap"><div class="fcp-leg-bar ${cls}" style="width:${Math.max(0,Math.min(100,score))}%"></div></div>
      ${detail ? `<div class="fcp-leg-detail">${detail}</div>` : ''}
    </div>`;
  }

  function _expandPanel(r) {
    const { legs, flags, phase, verdict } = r;
    const { float: fl, catalyst: ca, price: pr } = legs;

    // Float detail
    const fdvStr = fl.fdvMcap >= 3 ? `<span class="fcp-flag-warn">⚠️ FDV ${fl.fdvMcap}× mcap — heavy overhang</span>`
                 : fl.fdvMcap >= 1.5 ? `<span class="fcp-muted">FDV ${fl.fdvMcap}× mcap — moderate</span>`
                 : `<span class="fcp-ok">FDV ${fl.fdvMcap}× mcap — clean</span>`;
    const circStr = `${(fl.circRatio * 100).toFixed(0)}% of max supply circulating`;

    // Catalyst hits
    const catHits = ca.hits.length
      ? ca.hits.map(h => {
          const sign = h.boost >= 0 ? `<span class="fcp-ok">+${h.boost}</span>` : `<span class="fcp-bad">${h.boost}</span>`;
          const datePart = h.date ? ` <span class="fcp-muted">${esc(h.date)}</span>` : '';
          return `<div class="fcp-cat-hit">${sign} <strong>${esc(h.label)}</strong> — ${esc(h.title)}${datePart}</div>`;
        }).join('')
      : `<div class="fcp-muted" style="font-size:.8rem">No catalysts.json match. Score driven by turnover.</div>`;

    // Price flags
    const priceFlagChips = pr.flags.map(f => {
      const labels = {
        'first-green-day': '🌱 First green day off base (+22)',
        'full-alignment': '📈 24h/7d/30d all up (+10)',
        'overextended': '⚠️ Overextended (−30)',
      };
      return `<span class="fcp-pflag">${labels[f] || esc(f)}</span>`;
    }).join('');

    // Phase explanation
    const phaseDesc = {
      'Accumulation': 'Quiet build — whales/insiders positioning. Low turnover, flat/down price.',
      'Promotion':    'Story gaining traction — KOLs, CT threads, rising volume. Trade carefully.',
      'Spike':        'Retail FOMO / CEX listing pop. Late to the party — MMs sell into you here.',
      'Distribution': 'Insiders selling into the buying. High FDV overhang. The definition of a trap.',
      'Collapse':     'Liquidity gone, story dead. No bids. Position sizing = 0.',
    }[phase] || '';

    const flagChips = flags.map(f => {
      const cls = (f === 'DISTRIBUTION MACHINE' || f === 'OVEREXTENDED') ? 'fcp-flag-warn-chip' : 'fcp-flag-info-chip';
      return `<span class="${cls}">${esc(f)}</span>`;
    }).join('');

    return `<tr class="fcp-expand-row"><td colspan="9">
      <div class="fcp-expand-wrap">
        <div class="fcp-expand-head">
          <span><strong>${esc(r.sym)}</strong> · ${esc(r.name)} · ${_verdictChip(verdict)}</span>
          ${flagChips ? `<span>${flagChips}</span>` : ''}
        </div>
        <div class="fcp-legs-grid">
          ${_legBar(`Float (50%)`, fl.score, `${fdvStr} · ${circStr}`)}
          ${_legBar(`Catalyst (30%)`, ca.score, `Turnover ${(ca.turnover*100).toFixed(1)}% of mcap`)}
          ${_legBar(`Price Action (20%)`, pr.score, priceFlagChips || '—')}
        </div>
        <div class="fcp-expand-sect">
          <div class="fcp-expand-sect-h">Catalyst hits</div>
          ${catHits}
        </div>
        <div class="fcp-expand-sect">
          <div class="fcp-expand-sect-h">Phase · ${_phaseBadge(phase)}</div>
          <div class="fcp-muted" style="font-size:.82rem">${esc(phaseDesc)}</div>
        </div>
        <div class="fcp-expand-sect fcp-expand-meta">
          <span>MCap ${fmtUsd(r.mcap)}</span>
          <span>Vol/MC ${(r.vol && r.mcap ? (r.vol/r.mcap*100).toFixed(1) : '—')}%</span>
          <span>24h ${fmtPct(r.c24)}</span>
          <span>7d ${fmtPct(r.c7)}</span>
          <span>30d ${fmtPct(r.c30)}</span>
          <span>Price ${fmtPrice(r.price)}</span>
        </div>
        <div class="fcp-expand-actions">
          <a class="btn-soft" href="https://www.tradingview.com/symbols/${esc(r.sym)}USDT/" target="_blank" rel="noopener">📊 TradingView</a>
          <a class="btn-soft" href="https://www.coingecko.com/en/coins/${esc(r.id)}" target="_blank" rel="noopener">🦎 CoinGecko</a>
          <a class="btn-soft" href="https://tokenomist.ai/${esc(r.sym.toLowerCase())}" target="_blank" rel="noopener" title="Verify unlock schedule (Tokenomist — free to browse)">⚠️ Check Unlocks</a>
        </div>
      </div>
    </td></tr>`;
  }

  function _sortRows(rows) {
    const r = rows.slice();
    if (_sort === 'float')    r.sort((a, b) => b.legs.float.score - a.legs.float.score);
    else if (_sort === 'fdv') r.sort((a, b) => a.fdvMcap - b.fdvMcap);  // cleanest float first
    else if (_sort === 'dist') r.sort((a, b) => b.fdvMcap - a.fdvMcap); // worst overhang first (avoids)
    else                      r.sort((a, b) => b.composite - a.composite);
    return r;
  }

  function _filterRows(rows) {
    if (_tierFilter === 'all')   return rows;
    if (_tierFilter === 'aplus') return rows.filter(r => r.tier === 'A+');
    if (_tierFilter === 'a')     return rows.filter(r => r.tier === 'A+' || r.tier === 'A');
    if (_tierFilter === 'b')     return rows.filter(r => ['A+','A','B'].includes(r.tier));
    if (_tierFilter === 'f')     return rows.filter(r => r.tier === 'F');
    return rows;
  }

  /* ── table render ───────────────────────────────────────── */
  function _renderTable() {
    const root = document.getElementById('fcpRoot');
    if (!root || !_lastRun) { _renderEmpty(); return; }
    const { ts, rows, totalScanned, catalystCount } = _lastRun;
    const ago = Math.round((Date.now() - ts) / 60000);

    const sorted   = _sortRows(rows);
    const filtered = _filterRows(sorted);

    // KPI strip
    const distMachines = rows.filter(r => r.tier === 'F').length;
    const aplusA        = rows.filter(r => r.tier === 'A+' || r.tier === 'A').length;
    const phaseBreak    = ['Accumulation','Promotion','Spike','Distribution','Collapse']
      .map(p => {
        const n = rows.filter(r => r.phase === p).length;
        return n > 0 ? `${p}: ${n}` : null;
      }).filter(Boolean).join(' · ');

    const kpis = `<div class="fcp-kpi-strip">
      <div class="fcp-kpi"><div class="fcp-kpi-v">${totalScanned}</div><div class="fcp-kpi-l">Scanned</div></div>
      <div class="fcp-kpi"><div class="fcp-kpi-v fcp-ok-txt">${aplusA}</div><div class="fcp-kpi-l">A+/A rated</div></div>
      <div class="fcp-kpi"><div class="fcp-kpi-v fcp-bad-txt">${distMachines}</div><div class="fcp-kpi-l">Dist. machines (F)</div></div>
      <div class="fcp-kpi fcp-kpi-wide"><div class="fcp-kpi-v fcp-kpi-phases">${esc(phaseBreak)}</div><div class="fcp-kpi-l">Phase breakdown</div></div>
      <div class="fcp-kpi"><div class="fcp-kpi-v">${ago <= 0 ? 'now' : ago + 'm'}</div><div class="fcp-kpi-l">Last scan</div></div>
    </div>`;

    const body = filtered.map((r, i) => {
      const isOpen = _expandedSym === r.sym;
      const main = `
        <tr class="fcp-row ${isOpen ? 'is-open' : ''}" data-sym="${esc(r.sym)}">
          <td class="fcp-rank">${i + 1}</td>
          <td class="fcp-sym">
            <span class="fcp-sym-name">${esc(r.sym)}</span>
            <span class="fcp-sym-sub">${esc(r.name)}</span>
          </td>
          <td>${_scoreBar(r.composite)}</td>
          <td>${_tierBadge(r.tier)}</td>
          <td>${_phaseBadge(r.phase)}</td>
          <td class="fcp-num ${r.fdvMcap >= 3 ? 'fcp-bad-txt' : r.fdvMcap >= 1.5 ? 'fcp-warn-txt' : 'fcp-ok-txt'}" title="FDV ÷ market cap — higher = more locked supply yet to unlock">${r.fdvMcap.toFixed(2)}×</td>
          <td class="fcp-num ${pctCls(r.c24)}">${fmtPct(r.c24)}</td>
          <td class="fcp-num ${pctCls(r.c7)}">${fmtPct(r.c7)}</td>
          <td class="fcp-verd-col">${_verdictChip(r.verdict)}</td>
        </tr>`;
      return isOpen ? main + _expandPanel(r) : main;
    }).join('');

    const sourceNote = `<div class="fcp-muted" style="font-size:.76rem;margin-top:10px">
      Universe: CoinGecko top-300 · catalysts.json (${catalystCount} events) ·
      <strong>Supply overhang = FDV/mcap proxy</strong>, not exchange-confirmed unlock dates.
      Tap ⚠️ Check Unlocks on any row to verify on Tokenomist before sizing.
      Data as of ${new Date(ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}.
    </div>`;

    root.innerHTML = `
      ${kpis}
      <div class="card fcp-card">
        <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
          <span>Ranked by Float · Catalyst · Price</span>
          <span class="fcp-muted" style="font-size:.76rem;text-transform:none;letter-spacing:0">
            Showing ${filtered.length} of ${rows.length} · click row for breakdown
          </span>
        </div>
        <div class="fcp-table-wrap">
          <table class="fcp-table">
            <thead><tr>
              <th style="width:32px">#</th>
              <th style="width:110px">Coin</th>
              <th style="width:120px">Score</th>
              <th style="width:44px" title="A+ ≥78 · A ≥63 · B ≥50 · C ≥35 · F gated">Tier</th>
              <th style="width:110px">Phase</th>
              <th style="width:68px" title="Fully-diluted valuation ÷ market cap. 1× = all tokens circulating (clean). 3×+ = distribution machine.">FDV/MC</th>
              <th style="width:64px">24h</th>
              <th style="width:64px">7d</th>
              <th>Verdict</th>
            </tr></thead>
            <tbody>${body || `<tr><td colspan="9" class="fcp-muted" style="padding:20px;text-align:center">No coins match this filter.</td></tr>`}</tbody>
          </table>
        </div>
        ${sourceNote}
      </div>`;

    root.querySelectorAll('.fcp-row[data-sym]').forEach(tr => {
      tr.addEventListener('click', () => {
        const sym = tr.dataset.sym;
        _expandedSym = (_expandedSym === sym) ? null : sym;
        _renderTable();
      });
    });
  }

  function _renderEmpty() {
    const root = document.getElementById('fcpRoot');
    if (!root) return;
    root.innerHTML = `<div class="card fcp-card"><div class="fcp-empty">
      <div class="fcp-empty-icon">🔬</div>
      <h3>No scan yet</h3>
      <p class="fcp-muted">Click <strong>⟳ Scan</strong> to screen the top ~300 coins by market cap.<br>
      Uses one CoinGecko call — no API key required.</p>
    </div></div>`;
  }

  /* ── guide ──────────────────────────────────────────────── */
  const GUIDE_HTML = `
    <div class="card fcp-guide">
      <div class="fcp-guide-head">
        <span>📚 How the FCP Scanner works</span>
        <button class="btn-soft btn-sm" id="fcpGuideToggle">Expand</button>
      </div>
      <div class="fcp-guide-body" id="fcpGuideBody">
        <div class="fcp-guide-col">
          <p><strong>The discipline (from the coaching deck):</strong> screen tokenomics first, catalyst second, price action third. A low-circulating-supply coin with no near-term unlocks and a clean catalyst = the sub-5M float penny stock analog. A high-emission coin with a VC cliff in 3 weeks = the 50M float name. <em>Avoid it long.</em></p>
          <p><strong>LEG 1 — Float (50%, the gate):</strong> FDV ÷ mcap is the core metric. FDV/MC 1.0× = every token already circulating (maximum clean). 3.0× = two thirds of supply still locked and coming. floatScore &lt;35 → tier forced to <strong>F</strong> regardless of catalyst or price.</p>
          <p><strong>LEG 2 — Catalyst (30%):</strong> events from catalysts.json ≤30 days away, tiered by the coaching deck's hierarchy: A+ CEX listing/ETF approval → A protocol upgrade with on-chain confirmation → B sector rotation → C CT thread. Token Unlock events score <em>negative</em> — they are distribution, not catalysts. Volume/turnover surge used as a proxy for promotion-phase activity when no event data exists.</p>
          <p><strong>LEG 3 — Price Action (20%, last):</strong> First green day off a declining base is the best signal (+22). Full alignment (24h/7d/30d all up) adds +10. Overextension (7d&gt;40% or 24h&gt;20% with high turnover) is penalised −30 and can flip the verdict to <strong>SHORT EXTENSION</strong>.</p>
        </div>
        <div class="fcp-guide-col">
          <table class="fcp-guide-table">
            <thead><tr><th>Tier</th><th>Score</th><th>Action</th></tr></thead>
            <tbody>
              <tr><td><span class="fcp-tier fcp-tier-aplus">A+</span></td><td>≥78</td><td>Full size — clean float + catalyst + first green day</td></tr>
              <tr><td><span class="fcp-tier fcp-tier-a">A</span></td><td>≥63</td><td>Half size — good float, watch for entry</td></tr>
              <tr><td><span class="fcp-tier fcp-tier-b">B</span></td><td>≥50</td><td>Small size or watchlist only</td></tr>
              <tr><td><span class="fcp-tier fcp-tier-c">C</span></td><td>≥35</td><td>Skip</td></tr>
              <tr><td><span class="fcp-tier fcp-tier-f">F</span></td><td>&lt;35</td><td>Avoid long / short the extension</td></tr>
            </tbody>
          </table>
          <table class="fcp-guide-table" style="margin-top:12px">
            <thead><tr><th>Phase</th><th>What it means</th></tr></thead>
            <tbody>
              <tr><td><span class="fcp-phase fcp-phase-acc">Accum.</span></td><td>Insiders building quietly. Best time to buy if float is clean.</td></tr>
              <tr><td><span class="fcp-phase fcp-phase-promo">Promo</span></td><td>Story gaining traction — KOLs, CT threads. Still tradeable with discipline.</td></tr>
              <tr><td><span class="fcp-phase fcp-phase-spike">Spike</span></td><td>Retail FOMO / listing pop. MMs selling into you. Don't chase.</td></tr>
              <tr><td><span class="fcp-phase fcp-phase-dist">Dist.</span></td><td>VC/team unlocking into the rally. Distribution machine. Avoid long.</td></tr>
              <tr><td><span class="fcp-phase fcp-phase-collapse">Collapse</span></td><td>Story dead, no bids. Avoid entirely.</td></tr>
            </tbody>
          </table>
          <p class="fcp-muted" style="font-size:.78rem;margin-top:10px">Rule #2/#3: Supply overhang is computed from FDV/mcap — not live unlock calendars (all free unlock APIs are now 402 paywalled). Use the ⚠️ Check Unlocks button to verify precise dates on Tokenomist before sizing into any A/A+ name.</p>
        </div>
      </div>
    </div>`;

  function _wireGuide() {
    const body = document.getElementById('fcpGuideBody');
    const btn  = document.getElementById('fcpGuideToggle');
    if (!body || !btn) return;
    const apply = () => {
      body.style.display = _guideCollapsed ? 'none' : '';
      btn.textContent    = _guideCollapsed ? 'Expand' : 'Collapse';
    };
    apply();
    btn.addEventListener('click', () => {
      _guideCollapsed = !_guideCollapsed;
      localStorage.setItem(LS_GUIDE, _guideCollapsed ? 'on' : 'off');
      apply();
    });
  }

  /* ── tier/sort pills ────────────────────────────────────── */
  function _tierPills() {
    const opts = [
      { k: 'all',   l: 'All' },
      { k: 'aplus', l: 'A+ only' },
      { k: 'a',     l: 'A+/A' },
      { k: 'b',     l: 'B+ (watchlist)' },
      { k: 'f',     l: 'F (avoids)' },
    ];
    return opts.map(o =>
      `<button class="fcp-pill ${o.k === _tierFilter ? 'active' : ''}" data-tier="${o.k}">${o.l}</button>`
    ).join('');
  }

  function _sortPills() {
    const opts = [
      { k: 'composite', l: 'FCP score' },
      { k: 'float',     l: 'Float score' },
      { k: 'fdv',       l: 'Cleanest float first' },
      { k: 'dist',      l: 'Worst overhang first' },
    ];
    return opts.map(o =>
      `<button class="fcp-pill ${o.k === _sort ? 'active' : ''}" data-sort="${o.k}">${o.l}</button>`
    ).join('');
  }

  /* ── main render ────────────────────────────────────────── */
  function render(mountId) {
    const content = document.getElementById(mountId || 'content');
    content.innerHTML = `
      <div class="page-head">
        <div>
          <h1 class="page-title">🔬 FCP Scanner</h1>
          <p class="page-sub">Float · Catalyst · Price — promotion-cycle tokenomics screener · CoinGecko top-300, live</p>
        </div>
        <div class="page-actions">
          <button class="btn-primary" id="fcpScanBtn">⟳ Scan</button>
        </div>
      </div>
      <div class="fcp-controls">
        <div class="fcp-pill-row">
          <span class="fcp-pill-label">Tier</span>${_tierPills()}
        </div>
        <div class="fcp-pill-row">
          <span class="fcp-pill-label">Sort</span>${_sortPills()}
        </div>
      </div>
      <div class="fcp-prog-line fcp-muted" id="fcpProg"></div>
      <div id="fcpRoot"></div>
      ${GUIDE_HTML}`;

    document.getElementById('fcpScanBtn').addEventListener('click', _pullData);

    document.querySelectorAll('.fcp-pill[data-tier]').forEach(b => b.addEventListener('click', () => {
      _tierFilter = b.dataset.tier;
      localStorage.setItem(LS_TIER, _tierFilter);
      document.querySelectorAll('.fcp-pill[data-tier]').forEach(x =>
        x.classList.toggle('active', x.dataset.tier === _tierFilter));
      _expandedSym = null;
      _renderTable();
    }));

    document.querySelectorAll('.fcp-pill[data-sort]').forEach(b => b.addEventListener('click', () => {
      _sort = b.dataset.sort;
      localStorage.setItem(LS_SORT, _sort);
      document.querySelectorAll('.fcp-pill[data-sort]').forEach(x =>
        x.classList.toggle('active', x.dataset.sort === _sort));
      _expandedSym = null;
      _renderTable();
    }));

    if (_lastRun) _renderTable();
    else _renderEmpty();

    _wireGuide();
  }

  return { render };
})();
