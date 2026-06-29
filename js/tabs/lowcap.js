/* ═══════════════════════════════════════════════════════════
   LOW-CAP FINDER TAB v1
   Finds liquid, Binance-listed small-caps to accumulate in a dip.
   Research-backed 0-100 score from four pillars:
     • Liquidity   — 24h vol / market-cap ratio (2-10% healthy) + $500k/day floor
     • Dip depth   — pulled back (30d drawdown) but not broken, blended with RSI
     • Strength    — relative strength vs BTC over 7d (leaders bounce first)
     • Momentum    — volume-surge proxy vs the band median (attention/rotation)
   Data: CoinGecko /coins/markets (universe + sparkline) + Binance exchangeInfo
   (which coins are actually buyable). All browser-side fetch, like Confluence.
   Honesty contract (Rule #2/#3): every figure carries its live fetch time;
   heavy future-unlock dilution (FDV/MC) is surfaced; if the Binance list can't
   be fetched the rows stay but availability is badged "unverified".
════════════════════════════════════════════════════════════ */
const LowCapTab = (() => {

  const CG = 'https://api.coingecko.com/api/v3';
  const BINANCE_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];

  // Market-cap bands (USD). Default matches Jay's pick: $100M-$500M.
  const BANDS = {
    '10-100':   { lo: 10e6,  hi: 100e6,  label: '$10M–$100M' },
    '100-500':  { lo: 100e6, hi: 500e6,  label: '$100M–$500M' },
    '500-2000': { lo: 500e6, hi: 2000e6, label: '$500M–$2B' },
    '10-1000':  { lo: 10e6,  hi: 1000e6, label: 'Wide $10M–$1B' },
  };
  const BAND_ORDER = ['10-100', '100-500', '500-2000', '10-1000'];

  // Style → pillar weights (must sum to 1). Balanced = Jay's default.
  const STYLES = {
    balanced:  { liq: 0.30, dip: 0.30, str: 0.25, mom: 0.15, label: 'Balanced' },
    dip:       { liq: 0.20, dip: 0.45, str: 0.20, mom: 0.15, label: 'Dip bounce' },
    altseason: { liq: 0.25, dip: 0.15, str: 0.35, mom: 0.25, label: 'Altseason' },
  };
  const STYLE_ORDER = ['balanced', 'dip', 'altseason'];

  const VOL_FLOOR = 500_000;            // $/24h hard liquidity floor
  const STABLE_WRAP = new Set(['USDT','USDC','DAI','FDUSD','TUSD','USDE','WBTC','WETH',
    'WBETH','STETH','WEETH','BSC-USD','BUSD','PYUSD','USDS','BUIDL','SUSDE','USDD','GUSD']);

  const LS_LAST = 'jb_lowcap_last';
  const LS_BANDK = 'jb_lowcap_bases';   // cached Binance base list (1-day TTL)
  const BASES_TTL = 24 * 3600 * 1000;
  const LAST_TTL  = 6 * 3600 * 1000;

  let _band  = BANDS[localStorage.getItem('jb_lowcap_band')] ? localStorage.getItem('jb_lowcap_band') : '100-500';
  let _style = STYLES[localStorage.getItem('jb_lowcap_style')] ? localStorage.getItem('jb_lowcap_style') : 'balanced';
  let _guideCollapsed = localStorage.getItem('jb_lowcap_guide_collapsed') !== 'off';
  let _expandedSym = null;

  // In-memory raw caches so band/style switches re-screen instantly (no refetch).
  let _marketsCache = null;   // CoinGecko coin array (with sparkline)
  let _basesCache   = null;   // { set:Set<base>, ok:boolean }
  let _hotSectors   = null;

  // Hydrate last computed run (slim) so the table survives a reload.
  let _lastRun = (() => {
    try {
      const raw = localStorage.getItem(LS_LAST);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (p?.ts && Date.now() - p.ts < LAST_TTL) return p;
    } catch (_) {}
    return null;
  })();

  const esc = s => (s == null ? '' : String(s).replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])));

  const _sig = ms => (AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);

  function fmtUsd(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(0) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n.toFixed(0);
  }
  function fmtPrice(p) {
    if (p == null) return '—';
    if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 1 });
    if (p >= 1)    return p.toFixed(3);
    if (p >= 0.01) return p.toFixed(4);
    return p.toPrecision(3);
  }
  const fmtPct = v => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%');
  const pctCls = v => (v == null ? '' : v > 0 ? 'lc-up' : v < 0 ? 'lc-down' : '');

  /* ── data fetchers ─────────────────────────────────────── */

  // Binance USDT-spot base assets = "buyable on Binance". Cached for a day.
  async function _fetchBinanceBases() {
    try {
      const raw = localStorage.getItem(LS_BANDK);
      if (raw) {
        const p = JSON.parse(raw);
        if (p?.ts && Date.now() - p.ts < BASES_TTL && Array.isArray(p.bases) && p.bases.length) {
          return { set: new Set(p.bases), ok: true };
        }
      }
    } catch (_) {}
    for (const host of BINANCE_HOSTS) {
      try {
        const r = await fetch(`${host}/api/v3/exchangeInfo?permissions=SPOT`,
          { mode: 'cors', cache: 'no-store', signal: _sig(12000) });
        if (!r.ok) continue;
        const info = await r.json();
        const set = new Set();
        for (const s of (info.symbols || [])) {
          if (s.quoteAsset === 'USDT' && s.status === 'TRADING') set.add(s.baseAsset.toUpperCase());
        }
        if (set.size) {
          try { localStorage.setItem(LS_BANDK, JSON.stringify({ ts: Date.now(), bases: [...set] })); } catch (_) {}
          return { set, ok: true };
        }
      } catch (_) { /* try next host */ }
    }
    return { set: new Set(), ok: false };   // geo-blocked / offline → unverified
  }

  // CoinGecko markets, top 500 by mcap, with price windows + 7d sparkline.
  async function _fetchMarkets() {
    const out = [];
    for (const page of [1, 2]) {
      const url = `${CG}/coins/markets?vs_currency=usd&order=market_cap_desc`
        + `&per_page=250&page=${page}&price_change_percentage=24h,7d,30d&sparkline=true`;
      const r = await fetch(url, { mode: 'cors', cache: 'no-store', signal: _sig(15000) });
      if (!r.ok) throw new Error('CoinGecko ' + r.status);
      out.push(...await r.json());
    }
    return out;
  }

  // Hot sectors context strip (best-effort, non-fatal).
  async function _fetchCategories() {
    try {
      const r = await fetch(`${CG}/coins/categories`, { mode: 'cors', cache: 'no-store', signal: _sig(12000) });
      if (!r.ok) return null;
      const cats = await r.json();
      return cats
        .filter(c => c.market_cap_change_24h != null && (c.market_cap || 0) > 5e7)
        .sort((a, b) => b.market_cap_change_24h - a.market_cap_change_24h)
        .slice(0, 6)
        .map(c => ({ name: c.name, chg: c.market_cap_change_24h }));
    } catch (_) { return null; }
  }

  /* ── scoring ───────────────────────────────────────────── */

  function _rsi(prices, n = 14) {
    if (!prices || prices.length < n + 1) return null;
    let avgG = 0, avgL = 0;
    for (let i = 1; i <= n; i++) {
      const d = prices[i] - prices[i - 1];
      if (d >= 0) avgG += d; else avgL -= d;
    }
    avgG /= n; avgL /= n;
    for (let i = n + 1; i < prices.length; i++) {
      const d = prices[i] - prices[i - 1];
      avgG = (avgG * (n - 1) + (d > 0 ? d : 0)) / n;
      avgL = (avgL * (n - 1) + (d < 0 ? -d : 0)) / n;
    }
    if (avgL === 0) return 100;
    return 100 - 100 / (1 + avgG / avgL);
  }

  const _clamp = v => Math.max(0, Math.min(100, v));

  function _liqScore(ratio) {        // vol/mcap; 2-10% healthy, >10% heavy
    if (ratio >= 0.10) return 100;
    if (ratio >= 0.05) return 80 + (ratio - 0.05) / 0.05 * 20;
    if (ratio >= 0.02) return 60 + (ratio - 0.02) / 0.03 * 20;
    if (ratio >= 0.01) return 40 + (ratio - 0.01) / 0.01 * 20;
    return Math.max(0, ratio / 0.01 * 40);
  }
  function _dipScore(chg30, rsi) {   // want a pullback, not a freefall
    let base;
    if (chg30 == null) base = 50;
    else if (chg30 >= 0) base = Math.max(10, 40 - chg30);
    else {
      const d = -chg30;
      base = d <= 45 ? 50 + d : Math.max(20, 95 - (d - 45) * 1.5);
    }
    if (rsi != null) {               // nudge by oversold/overbought
      if (rsi < 30) base += 10;
      else if (rsi < 40) base += 5;
      else if (rsi > 70) base -= 12;
      else if (rsi > 60) base -= 5;
    }
    return _clamp(base);
  }
  function _strScore(c7, btc7) {     // relative strength vs BTC over 7d
    if (c7 == null) return 50;
    return _clamp(50 + (c7 - (btc7 || 0)) * 2.5);
  }
  function _momScore(ratio, median) {// volume-surge proxy vs band median
    if (!median) return 50;
    return _clamp(50 + (ratio / median - 1) * 40);
  }

  // Screen the in-memory raw caches into a ranked result set. No network.
  function _applyScreen() {
    if (!_marketsCache || !_basesCache) return null;
    const band = BANDS[_band], w = STYLES[_style];
    const bases = _basesCache.set, binanceOk = _basesCache.ok;
    const btc = _marketsCache.find(c => (c.symbol || '').toLowerCase() === 'btc');
    const btc7 = btc?.price_change_percentage_7d_in_currency || 0;
    const btc30 = btc?.price_change_percentage_30d_in_currency || 0;

    // pass 1: candidates passing band + binance + liquidity floor
    const cand = [];
    let totalInBand = 0;
    for (const c of _marketsCache) {
      const sym = (c.symbol || '').toUpperCase();
      const mcap = c.market_cap || 0;
      if (mcap < band.lo || mcap > band.hi) continue;
      if (STABLE_WRAP.has(sym)) continue;
      totalInBand++;
      if (binanceOk && !bases.has(sym)) continue;       // must be on Binance (when verifiable)
      const vol = c.total_volume || 0;
      if (vol < VOL_FLOOR) continue;
      cand.push(c);
    }
    // band median vol/mcap ratio for the momentum pillar
    const ratios = cand.map(c => (c.total_volume || 0) / (c.market_cap || 1)).sort((a, b) => a - b);
    const median = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 0;

    const rows = cand.map(c => {
      const sym = (c.symbol || '').toUpperCase();
      const mcap = c.market_cap || 0, vol = c.total_volume || 0;
      const ratio = vol / (mcap || 1);
      const c24 = c.price_change_percentage_24h_in_currency;
      const c7  = c.price_change_percentage_7d_in_currency;
      const c30 = c.price_change_percentage_30d_in_currency;
      const fdv = c.fully_diluted_valuation || mcap;
      const dil = mcap ? fdv / mcap : 1;
      const spark = c.sparkline_in_7d?.price || [];
      const rsi = _rsi(spark);
      const ls = _liqScore(ratio), ds = _dipScore(c30, rsi), ss = _strScore(c7, btc7), ms = _momScore(ratio, median);
      let score = ls * w.liq + ds * w.dip + ss * w.str + ms * w.mom;
      if (dil > 3) score -= 6;                            // heavy unlock dilution
      score = _clamp(score);
      return {
        sym, name: c.name, id: c.id, price: c.current_price,
        mcap, vol, ratio, c24, c7, c30, fdv, dil, rsi,
        ls, ds, ss, ms, score,
        // downsampled sparkline (≤30 pts) for the persisted/rendered mini chart
        spark: spark.length > 30 ? spark.filter((_, i) => i % Math.ceil(spark.length / 30) === 0) : spark,
        binanceOk,
      };
    }).sort((a, b) => b.score - a.score);

    return {
      ts: Date.now(), band: _band, style: _style,
      rows: rows.slice(0, 60),
      totalInBand, totalPassing: rows.length,
      binanceOk, btc7, btc30,
      hotSectors: _hotSectors || [],
    };
  }

  function _persist() {
    try { localStorage.setItem(LS_LAST, JSON.stringify(_lastRun)); } catch (_) {}
  }

  async function _pullData() {
    const btn = document.getElementById('lcPullBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⟳ Pulling…'; }
    _renderStatus('Fetching CoinGecko universe + Binance pairs…');
    try {
      const [markets, bases, cats] = await Promise.all([
        _fetchMarkets(),
        _fetchBinanceBases(),
        _fetchCategories(),
      ]);
      _marketsCache = markets;
      _basesCache = bases;
      _hotSectors = cats;
      _lastRun = _applyScreen();
      _expandedSym = null;
      _persist();
      _renderTable();
    } catch (e) {
      _renderStatus(`Pull failed: ${esc(e.message || e)}. CoinGecko may be rate-limiting — wait a moment and retry.`, true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⟳ Pull Data'; }
    }
  }

  // Re-screen from cache on band/style change; refetch only if cache is cold.
  function _reScreen() {
    if (_marketsCache && _basesCache) {
      _lastRun = _applyScreen();
      _expandedSym = null;
      _persist();
      _renderTable();
    } else {
      _pullData();
    }
  }

  /* ── rendering ─────────────────────────────────────────── */

  function _scoreBar(score) {
    const cls = score >= 70 ? 'pos' : score <= 45 ? 'neg' : 'flat';
    const pct = _clamp(score);
    return `<div class="lc-score-cell">
      <div class="lc-score-num ${cls}">${score.toFixed(0)}</div>
      <div class="lc-score-bar"><span class="${cls}" style="width:${pct}%"></span></div>
    </div>`;
  }
  function _tier(score) {
    if (score >= 70) return '<span class="lc-tier lc-tier-a" title="A — full size candidate">A</span>';
    if (score >= 55) return '<span class="lc-tier lc-tier-b" title="B — half size / watch">B</span>';
    return '<span class="lc-tier lc-tier-c" title="C — skip / low conviction">C</span>';
  }
  function _miniSpark(pts) {
    if (!pts || pts.length < 2) return '<span class="muted" style="font-size:.7rem">—</span>';
    const w = 70, h = 20, pad = 2;
    const lo = Math.min(...pts), hi = Math.max(...pts), rng = hi - lo || 1;
    const xs = i => pad + i * (w - pad * 2) / (pts.length - 1);
    const ys = v => pad + (1 - (v - lo) / rng) * (h - pad * 2);
    const path = pts.map((v, i) => `${i ? 'L' : 'M'} ${xs(i).toFixed(1)} ${ys(v).toFixed(1)}`).join(' ');
    const up = pts[pts.length - 1] >= pts[0];
    const stroke = up ? 'var(--good,#34d399)' : 'var(--bad,#f87171)';
    return `<svg class="lc-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <path d="${path}" fill="none" stroke="${stroke}" stroke-width="1.3" stroke-linecap="round"/></svg>`;
  }
  function _subBar(label, v) {
    const cls = v >= 70 ? 'pos' : v <= 45 ? 'neg' : 'flat';
    return `<div class="lc-sub">
      <div class="lc-sub-top"><span>${label}</span><span class="lc-sub-num ${cls}">${v.toFixed(0)}</span></div>
      <div class="lc-sub-bar"><span class="${cls}" style="width:${_clamp(v)}%"></span></div>
    </div>`;
  }

  function _expandPanel(r) {
    const dilNote = r.dil > 3
      ? `<span class="lc-flag-warn">⚠️ FDV ${r.dil.toFixed(1)}× mcap — heavy future unlocks, expect sell pressure</span>`
      : `<span class="muted">FDV ${r.dil.toFixed(1)}× mcap — dilution low</span>`;
    return `<tr class="lc-expand-row"><td colspan="10">
      <div class="lc-expand-wrap">
        <div class="lc-expand-head">
          <span><strong>${esc(r.sym)}</strong> · ${esc(r.name || '')} score breakdown</span>
          <span class="muted">RSI(7d) ${r.rsi == null ? '—' : r.rsi.toFixed(0)}</span>
        </div>
        <div class="lc-sub-grid">
          ${_subBar('Liquidity', r.ls)}
          ${_subBar('Dip depth', r.ds)}
          ${_subBar('Strength vs BTC', r.ss)}
          ${_subBar('Momentum', r.ms)}
        </div>
        <div class="lc-expand-meta">
          ${dilNote}
          <span class="muted">Vol/MC ${(r.ratio * 100).toFixed(1)}% · 24h vol ${fmtUsd(r.vol)}</span>
        </div>
        <div class="lc-expand-actions">
          <a class="btn-soft" href="https://www.tradingview.com/symbols/${esc(r.sym)}USDT/" target="_blank" rel="noopener">📊 TradingView</a>
          <a class="btn-soft" href="https://www.coingecko.com/en/coins/${esc(r.id)}" target="_blank" rel="noopener">🦎 CoinGecko</a>
          <button class="btn-soft lc-take" onclick="LowCapTab._takeTrade('${esc(r.sym)}')">📝 Take Trade</button>
        </div>
      </div>
    </td></tr>`;
  }

  function _renderTable() {
    const root = document.getElementById('lowcapRoot');
    if (!root || !_lastRun) { _renderEmpty(); return; }
    const { ts, rows, totalInBand, totalPassing, binanceOk, btc7, btc30, hotSectors } = _lastRun;
    const band = BANDS[_band], style = STYLES[_style];
    const ago = Math.round((Date.now() - ts) / 60000);

    const kpis = `
      <div class="lc-kpi-strip">
        <div class="lc-kpi"><div class="lc-kpi-v">${totalInBand}</div><div class="lc-kpi-l">In band (${esc(band.label)})</div></div>
        <div class="lc-kpi"><div class="lc-kpi-v">${totalPassing}</div><div class="lc-kpi-l">Pass liquidity floor</div></div>
        <div class="lc-kpi"><div class="lc-kpi-v ${pctCls(btc30)}">${fmtPct(btc30)}</div><div class="lc-kpi-l">BTC 30d (dip gauge)</div></div>
        <div class="lc-kpi"><div class="lc-kpi-v">${ago <= 0 ? 'now' : ago + 'm'}</div><div class="lc-kpi-l">Last pull</div></div>
      </div>`;

    const sectors = (hotSectors && hotSectors.length)
      ? `<div class="lc-sectors"><span class="lc-sectors-h">🔥 Hot sectors (24h)</span>${
          hotSectors.map(s => `<span class="lc-sector ${pctCls(s.chg)}">${esc(s.name)} ${fmtPct(s.chg)}</span>`).join('')
        }</div>`
      : '';

    const binBadge = binanceOk ? '' :
      `<div class="lc-banner lc-banner-warn">⚠️ Binance pair list couldn't be fetched (geo-block/offline) — "on Binance" is <strong>unverified</strong> this pull. Showing all in-band coins; confirm the pair exists before trading.</div>`;

    const body = rows.map((r, i) => {
      const open = _expandedSym === r.sym;
      const main = `
        <tr class="lc-row ${open ? 'is-open' : ''}" data-sym="${esc(r.sym)}">
          <td class="lc-rank">${i + 1}</td>
          <td class="lc-sym">
            <span class="lc-sym-name">${esc(r.sym)}</span>
            <a class="lc-tv" href="https://www.tradingview.com/symbols/${esc(r.sym)}USDT/" target="_blank" rel="noopener" title="TradingView" onclick="event.stopPropagation()">📊</a>
          </td>
          <td>${_scoreBar(r.score)}</td>
          <td>${_tier(r.score)}</td>
          <td class="lc-num">${fmtUsd(r.mcap)}</td>
          <td class="lc-num">${(r.ratio * 100).toFixed(1)}%</td>
          <td class="lc-num ${pctCls(r.c24)}">${fmtPct(r.c24)}</td>
          <td class="lc-num ${pctCls(r.c7)}">${fmtPct(r.c7)}</td>
          <td class="lc-num ${pctCls(r.c30)}">${fmtPct(r.c30)}</td>
          <td class="lc-num">${r.dil > 3 ? `<span class="lc-flag-warn" title="FDV ${r.dil.toFixed(1)}× mcap — heavy unlocks">⚠️ ${r.dil.toFixed(1)}×</span>` : '<span class="muted">' + r.dil.toFixed(1) + '×</span>'}</td>
          <td class="lc-spark-cell">${_miniSpark(r.spark)}</td>
        </tr>`;
      return open ? main + _expandPanel(r) : main;
    }).join('');

    root.innerHTML = `
      ${binBadge}
      ${kpis}
      ${sectors}
      <div class="card lc-card">
        <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
          <span>Ranked Low-Cap Candidates</span>
          <span class="muted" style="font-size:.76rem;text-transform:none;letter-spacing:0">${esc(style.label)} score · click row for breakdown · all figures live as of ${new Date(ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
        </div>
        <div class="lc-table-wrap">
          <table class="lc-table">
            <thead><tr>
              <th style="width:32px">#</th>
              <th style="width:96px">Coin</th>
              <th style="width:120px">Score</th>
              <th style="width:40px" title="A ≥70 full · B ≥55 half · C skip">Tier</th>
              <th style="width:78px">MCap</th>
              <th style="width:62px" title="24h volume ÷ market cap (2-10% healthy)">Vol/MC</th>
              <th style="width:66px">24h</th>
              <th style="width:66px">7d</th>
              <th style="width:66px">30d</th>
              <th style="width:64px" title="Fully-diluted valuation ÷ market cap. >3× = heavy future unlocks">FDV/MC</th>
              <th style="width:78px" title="7-day price">7d trend</th>
            </tr></thead>
            <tbody>${body || `<tr><td colspan="11" class="muted" style="padding:18px;text-align:center">No coins matched. Try a wider cap band.</td></tr>`}</tbody>
          </table>
        </div>
        <div class="muted" style="font-size:.76rem;margin-top:10px">
          Universe: CoinGecko top-500 by mcap · Binance USDT spot ${binanceOk ? '✓' : '— (unverified)'} · BTC ref 7d ${fmtPct(btc7)} / 30d ${fmtPct(btc30)} · weights ${esc(style.label)} (liq ${style.liq} · dip ${style.dip} · str ${style.str} · mom ${style.mom})
        </div>
      </div>`;

    root.querySelectorAll('.lc-row[data-sym]').forEach(tr => {
      tr.addEventListener('click', () => {
        const sym = tr.dataset.sym;
        _expandedSym = (_expandedSym === sym) ? null : sym;
        _renderTable();
      });
    });
  }

  function _renderStatus(msg, isErr) {
    const root = document.getElementById('lowcapRoot');
    if (root) root.innerHTML = `<div class="card lc-card"><div class="lc-status ${isErr ? 'lc-status-err' : ''}">${esc(msg)}</div></div>`;
  }
  function _renderEmpty() {
    const root = document.getElementById('lowcapRoot');
    if (!root) return;
    root.innerHTML = `<div class="card lc-card"><div class="lc-empty">
      <div class="lc-empty-icon">💎</div>
      <h3>No scan yet</h3>
      <p class="muted">Pick a cap band + style above, then click <strong>⟳ Pull Data</strong> to screen the live market for liquid Binance small-caps to accumulate in the dip.</p>
    </div></div>`;
  }

  function _takeTrade(sym) {
    const r = _lastRun?.rows.find(x => x.sym === sym);
    if (!r) return;
    if (typeof App !== 'undefined' && App.openTradeModalPrefilled) {
      App.openTradeModalPrefilled({
        symbol: `${sym}/USDT`,
        direction: 'Long',
        entry: r.price != null ? fmtPrice(r.price) : '',
        notes: `Low-Cap Finder: score ${r.score.toFixed(0)} (${STYLES[_style].label}). Liq ${r.ls.toFixed(0)}/Dip ${r.ds.toFixed(0)}/Str ${r.ss.toFixed(0)}/Mom ${r.ms.toFixed(0)}. MCap ${fmtUsd(r.mcap)}, Vol/MC ${(r.ratio*100).toFixed(1)}%, 30d ${fmtPct(r.c30)}.`,
      });
    } else {
      const fab = document.getElementById('fab');
      if (fab) fab.click();
    }
  }

  /* ── pills + guide ─────────────────────────────────────── */
  function _bandPills() {
    return BAND_ORDER.map(k =>
      `<button class="lc-pill ${k === _band ? 'active' : ''}" data-band="${k}">${esc(BANDS[k].label)}</button>`).join('');
  }
  function _stylePills() {
    return STYLE_ORDER.map(k =>
      `<button class="lc-pill ${k === _style ? 'active' : ''}" data-style="${k}">${esc(STYLES[k].label)}</button>`).join('');
  }

  const GUIDE_HTML = `
    <div class="card lc-guide">
      <div class="lc-guide-head">
        <span>📚 How the Low-Cap Finder works</span>
        <button class="btn-soft" id="lcGuideToggle">Expand</button>
      </div>
      <div class="lc-guide-body">
        <div class="lc-guide-section">
          <p><strong>The play:</strong> find liquid, Binance-listed small-caps to <em>accumulate in a dip</em> and hold into the altseason rotation. Not DEX moonshots — coins you can actually enter and exit size in.</p>
        </div>
        <div class="lc-guide-section">
          <p><strong>Score (0–100) = four research-backed pillars:</strong></p>
          <ul>
            <li><strong>Liquidity</strong> — 24h volume ÷ market cap (2–10% healthy). Coins under $500k/day volume are dropped entirely.</li>
            <li><strong>Dip depth</strong> — pulled back on the month (sweet spot −15% to −45%) but not in freefall; blended with RSI (oversold = better).</li>
            <li><strong>Strength vs BTC</strong> — leaders that hold up best vs BTC over 7d tend to bounce first.</li>
            <li><strong>Momentum</strong> — volume surge vs the band median (where attention/rotation is going).</li>
          </ul>
        </div>
        <div class="lc-guide-section">
          <p><strong>Tiers:</strong> <span class="lc-tier lc-tier-a">A</span> ≥70 full-size candidate · <span class="lc-tier lc-tier-b">B</span> ≥55 half-size/watch · <span class="lc-tier lc-tier-c">C</span> skip.</p>
          <p><strong>⚠️ FDV/MC &gt; 3×</strong> = heavy future token unlocks (dilution) — penalised and flagged. Always check the unlock schedule before sizing.</p>
        </div>
        <div class="lc-guide-section">
          <p class="muted">Rule #2/#3 honesty: all figures are fetched live each pull (timestamp shown). Sector tags are context only. This is a discovery aid, not a buy signal — confirm structure on the chart and never risk more than you can lose on low-caps (5–10% of book max).</p>
        </div>
      </div>
    </div>`;

  function _wireGuide() {
    const body = document.querySelector('.lc-guide .lc-guide-body');
    const btn = document.getElementById('lcGuideToggle');
    if (!body || !btn) return;
    const apply = () => {
      body.style.display = _guideCollapsed ? 'none' : '';
      btn.textContent = _guideCollapsed ? 'Expand' : 'Collapse';
    };
    apply();
    btn.addEventListener('click', () => {
      _guideCollapsed = !_guideCollapsed;
      localStorage.setItem('jb_lowcap_guide_collapsed', _guideCollapsed ? 'on' : 'off');
      apply();
    });
  }

  function render(mountId) {
    const content = document.getElementById(mountId || 'content');
    content.innerHTML = `
      <div class="page-head">
        <div>
          <h1 class="page-title">💎 Low-Cap Finder</h1>
          <p class="page-sub">Liquid Binance small-caps to accumulate in the dip · CoinGecko + Binance, live</p>
        </div>
        <div class="page-actions">
          <button class="btn-primary" id="lcPullBtn">⟳ Pull Data</button>
        </div>
      </div>
      <div class="lc-controls">
        <div class="lc-pill-row" role="group" aria-label="Market cap band">
          <span class="lc-pill-label">Cap band</span>${_bandPills()}
        </div>
        <div class="lc-pill-row" role="group" aria-label="Scoring style">
          <span class="lc-pill-label">Style</span>${_stylePills()}
        </div>
      </div>
      <div id="lowcapRoot"></div>
      ${GUIDE_HTML}`;

    document.getElementById('lcPullBtn').addEventListener('click', _pullData);

    document.querySelectorAll('.lc-pill[data-band]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.band === _band) return;
      _band = b.dataset.band;
      localStorage.setItem('jb_lowcap_band', _band);
      document.querySelectorAll('.lc-pill[data-band]').forEach(x => x.classList.toggle('active', x.dataset.band === _band));
      _reScreen();
    }));
    document.querySelectorAll('.lc-pill[data-style]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.style === _style) return;
      _style = b.dataset.style;
      localStorage.setItem('jb_lowcap_style', _style);
      document.querySelectorAll('.lc-pill[data-style]').forEach(x => x.classList.toggle('active', x.dataset.style === _style));
      _reScreen();
    }));

    if (_lastRun && _lastRun.band === _band && _lastRun.style === _style) _renderTable();
    else _renderEmpty();

    _wireGuide();
  }

  return { render, _takeTrade };
})();
