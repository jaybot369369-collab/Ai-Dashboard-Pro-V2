/* ═══════════════════════════════════════════════════════════
   CRYPTO RADAR — multi-timeframe RSI spider chart wall.
   8 spokes per card (1min/5min/15min/1hr/4hr/Daily/Weekly/Monthly),
   matching the CoinsKid radar aesthetic. Spoke radius = RSI/100.
   Green core = oversold (RSI≤30), red ring = overbought (RSI≥70).
   Universe: CoinGecko top ~24 by mcap + editable watchlist
   + a USDT.D macro card. Monthly shows ? on Railway (no monthly
   bars from CryptoCompare free tier).
════════════════════════════════════════════════════════════ */
const CryptoRadarTab = (() => {

  /* ── Config ─────────────────────────────────────────────── */
  // 8 spokes, matching the CoinsKid radar. Ordered to draw clockwise from
  // the top-left (see _radarSVG angle map). Monthly is best-effort on
  // Railway (CryptoCompare has no monthly aggregation → renders "?").
  const TFS       = ['1m', '5m', '15m', '1h', '4h', 'D', 'W', 'M'];
  const TF_LABEL  = { '1m':'1min', '5m':'5min', '15m':'15min', '1h':'1hr', '4h':'4hr', D:'Daily', W:'Weekly', M:'Monthly' };
  const KLINE_LIMIT = 120;
  const KLINE_TTL   = 60_000;        // 60 s kline cache
  const CG_TTL      = 300_000;       // 5 min CoinGecko cache
  const TOP_N       = 24;
  const LS_SYMS     = 'jb_radar_symbols';
  const LS_BLOCK    = 'jb_radar_blocked';
  const LS_SORT     = 'jb_radar_sort';
  const LS_SEARCH   = 'jb_radar_search';
  const SORT_OPTS   = ['mcap', 'overbought', 'oversold'];

  /* USDT.D via CoinGecko tether market_chart (daily only; 4h = n/a) */
  const USDTD_ID    = '__USDTD__';

  /* ── Module state ────────────────────────────────────────── */
  let _cgCache    = null;    // { ts, coins: [{id,sym,name,mcap,price,chg24,chg7}] }
  let _kCache     = new Map();  // key `${sym}-${tf}` → { ts, klines }
  let _scores     = new Map();  // key sym → { '4h':rsi, D:rsi, W:rsi, M:rsi }
  let _usdtdCache = null;    // { ts, closes_d, closes_w, closes_m }
  let _syms       = null;    // null = use top-N from CG; loaded from LS on first render
  let _customSyms = [];      // user-pinned additions (stored in LS_SYMS)
  let _blockedSyms = [];     // user-removed tickers (stored in LS_BLOCK)
  let _sort       = localStorage.getItem(LS_SORT) || 'mcap';
  let _search     = '';
  let _pulling    = false;
  let _mountId    = 'content';
  let _lastCgCoins = [];     // last fetched CG top list (for add validation)
  let _lastAllCoins = [];    // CG top list + custom additions (drives the grid)

  /* ── Kline fetcher (proxy on Railway, else Bybit → Binance → OKX) ── */
  const TF_BYBIT = { '1m':'1', '5m':'5', '15m':'15', '1h':'60', '4h':'240', D:'D', W:'W', M:'M' };
  const TF_BIN   = { '1m':'1m', '5m':'5m', '15m':'15m', '1h':'1h', '4h':'4h',  D:'1d', W:'1w', M:'1M' };
  const TF_OKX   = { '1m':'1m', '5m':'5m', '15m':'15m', '1h':'1H', '4h':'4H',  D:'1D', W:'1W', M:'1M' };

  async function _fetchKlines(sym, tf) {
    const key = `${sym}-${tf}`;
    const cached = _kCache.get(key);
    if (cached && Date.now() - cached.ts < KLINE_TTL) return cached.klines;

    const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    let klines = null;

    // On Railway/github.io, route through the same-origin fund.api proxy
    // (server-side Binance→Bybit→OKX→CryptoCompare chain). The proxy takes
    // the BASE symbol (it appends USDT itself) and returns { ok, bars: [...] }.
    if (!isLocal) {
      try {
        const r = await fetch(`/api/klines?symbol=${sym}&tf=${tf}&limit=${KLINE_LIMIT}`,
          { cache: 'no-store', signal: AbortSignal.timeout(12000) });
        if (r.ok) {
          const j = await r.json();
          if (j && j.ok && Array.isArray(j.bars)) klines = j.bars;
        }
      } catch (_) {}
    }

    if (!klines) {
      // Bybit
      try {
        const btf = TF_BYBIT[tf];
        const url = `https://api.bybit.com/v5/market/kline?symbol=${sym}USDT&interval=${btf}&limit=${KLINE_LIMIT}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (r.ok) {
          const j = await r.json();
          const raw = j?.result?.list || [];
          klines = raw.reverse().map(b => ({
            t: +b[0], o: +b[1], h: +b[2], l: +b[3], c: +b[4], v: +b[5]
          }));
        }
      } catch (_) {}
    }

    if (!klines) {
      // Binance
      try {
        const btf = TF_BIN[tf];
        const url = `https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=${btf}&limit=${KLINE_LIMIT}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (r.ok) {
          const j = await r.json();
          klines = j.map(b => ({ t: +b[0], o: +b[1], h: +b[2], l: +b[3], c: +b[4], v: +b[5] }));
        }
      } catch (_) {}
    }

    if (!klines) {
      // OKX
      try {
        const btf = TF_OKX[tf];
        const url = `https://www.okx.com/api/v5/market/candles?instId=${sym}-USDT&bar=${btf}&limit=${KLINE_LIMIT}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (r.ok) {
          const j = await r.json();
          const raw = j?.data || [];
          klines = raw.reverse().map(b => ({
            t: +b[0], o: +b[1], h: +b[2], l: +b[3], c: +b[4], v: +b[5]
          }));
        }
      } catch (_) {}
    }

    if (klines && klines.length > 0) {
      _kCache.set(key, { ts: Date.now(), klines });
      return klines;
    }
    return null;
  }

  /* ── USDT.D history via CoinGecko tether market_chart + live dominance ── */
  async function _fetchUsdtD() {
    if (_usdtdCache && Date.now() - _usdtdCache.ts < CG_TTL) return _usdtdCache;
    try {
      const r = await fetch(
        'https://api.coingecko.com/api/v3/coins/tether/market_chart?vs_currency=usd&days=365&interval=daily',
        { signal: AbortSignal.timeout(10000) }
      );
      if (!r.ok) return null;
      const j = await r.json();
      const daily = (j.market_caps || []).map(x => x[1]);
      if (daily.length < 20) return null;
      // resample weekly (every 7 days) and monthly (every 30 days)
      const weekly  = daily.filter((_, i) => i % 7 === 0);
      const monthly = daily.filter((_, i) => i % 30 === 0);
      // Current dominance % from /global (best-effort, non-fatal)
      let dom = null;
      try {
        const g = await fetch('https://api.coingecko.com/api/v3/global', { signal: AbortSignal.timeout(8000) });
        if (g.ok) dom = (await g.json())?.data?.market_cap_percentage?.usdt ?? null;
      } catch (_) {}
      _usdtdCache = { ts: Date.now(), closes_d: daily, closes_w: weekly, closes_m: monthly, dom };
      return _usdtdCache;
    } catch (_) { return null; }
  }

  /* ── CoinGecko top-N list ────────────────────────────────── */
  async function _fetchCG() {
    if (_cgCache && Date.now() - _cgCache.ts < CG_TTL) return _cgCache.coins;
    try {
      const url = 'https://api.coingecko.com/api/v3/coins/markets' +
        '?vs_currency=usd&order=market_cap_desc&per_page=50&page=1' +
        '&price_change_percentage=1h,24h,7d';
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) return null;
      const raw = await r.json();
      const coins = raw
        .filter(c => !['usdt','usdc','dai','busd','tusd','usdd','fdusd','pyusd'].includes(c.symbol?.toLowerCase()))
        .slice(0, TOP_N)
        .map(c => ({
          id: c.id,
          sym: c.symbol.toUpperCase(),
          name: c.name,
          mcap: c.market_cap || 0,
          price: c.current_price || 0,
          chg1:  c.price_change_percentage_1h_in_currency ?? null,
          chg24: c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h ?? null,
          chg7:  c.price_change_percentage_7d_in_currency ?? null,
          rank:  c.market_cap_rank || 99,
        }));
      _cgCache = { ts: Date.now(), coins };
      _lastCgCoins = coins;
      return coins;
    } catch (_) { return null; }
  }

  /* ── RSI scoring ─────────────────────────────────────────── */
  function _rsiForKlines(klines) {
    if (!klines || klines.length < 15) return null;
    const closes = klines.map(k => k.c);
    const v = ICTDetect.rsi(closes, 14);
    return v === null ? null : Math.round(v * 10) / 10;
  }

  async function _scoreSymbol(sym) {
    const tfs = await Promise.all(TFS.map(tf => _fetchKlines(sym, tf)));
    const result = {};
    TFS.forEach((tf, i) => { result[tf] = _rsiForKlines(tfs[i]); });
    return result;
  }

  /* Quick fetch of live USDT.D % so the card shows immediately on render */
  async function _fetchUsdtDQuick() {
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/global',
        { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return;
      const dom = (await r.json())?.data?.market_cap_percentage?.usdt ?? null;
      if (dom === null) return;
      if (!_usdtdCache) _usdtdCache = { ts: 0, closes_d: [], closes_w: [], closes_m: [], dom };
      else _usdtdCache.dom = dom;
      _renderGrid();
    } catch (_) {}
  }

  async function _scoreUsdtD() {
    const d = await _fetchUsdtD();
    if (!d) return { '4h': null, D: null, W: null, M: null };
    return {
      '4h': null,  // no free intraday dominance feed
      D:  ICTDetect.rsi(d.closes_d, 14) !== null ? Math.round(ICTDetect.rsi(d.closes_d, 14) * 10) / 10 : null,
      W:  ICTDetect.rsi(d.closes_w, 14) !== null ? Math.round(ICTDetect.rsi(d.closes_w, 14) * 10) / 10 : null,
      M:  d.closes_m.length >= 5 ? Math.round(ICTDetect.rsi(d.closes_m, Math.min(14, d.closes_m.length - 1)) * 10) / 10 : null,
    };
  }

  /* CoinsKid spoke positions (deg, 0=right, clockwise). Independent of the
     TFS array order so the visual layout stays fixed even if TFS changes. */
  const TF_ANGLE = {
    M:   -112.5, '1m': -67.5, '5m': -22.5, '15m': 22.5,
    '1h': 67.5,  '4h': 112.5, D:    157.5, W:   -157.5,
  };

  /* ── SVG radar card ──────────────────────────────────────── */
  function _radarSVG(rsiMap) {
    const W = 168, CX = 84, CY = 84, R = 54;
    const cs = getComputedStyle(document.documentElement);
    const accent  = (cs.getPropertyValue('--accent')  || '#8b5cf6').trim();
    const surface = (cs.getPropertyValue('--surface2') || '#1e1e2e').trim();
    const border  = (cs.getPropertyValue('--border')   || '#333').trim();
    const textCol = (cs.getPropertyValue('--muted')    || '#888').trim();

    const axes = TFS.map(tf => ({ tf, angle: TF_ANGLE[tf] ?? 0 }));

    function pt(angle, r) {
      const rad = (angle * Math.PI) / 180;
      return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
    }

    // Guide rings: green oversold core → neutral mid → red overbought ring
    const rings = [
      { rsi: 30, col: 'rgba(52,211,153,0.18)' },
      { rsi: 50, col: 'rgba(150,150,150,0.10)' },
      { rsi: 70, col: 'rgba(248,113,113,0.16)' },
    ];

    const p = [];
    p.push(`<svg width="${W}" height="${W}" viewBox="0 0 ${W} ${W}" xmlns="http://www.w3.org/2000/svg">`);
    p.push(`<rect width="${W}" height="${W}" fill="transparent" rx="10"/>`);

    rings.forEach(ring => {
      const rr = (ring.rsi / 100) * R;
      p.push(`<circle cx="${CX}" cy="${CY}" r="${rr.toFixed(1)}" fill="${ring.col}" stroke="none"/>`);
    });

    // Axis spokes
    axes.forEach(ax => {
      const [x2, y2] = pt(ax.angle, R);
      p.push(`<line x1="${CX}" y1="${CY}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${border}" stroke-width="0.7" stroke-dasharray="2,2"/>`);
    });

    // Outer ring border
    p.push(`<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${border}" stroke-width="0.8"/>`);

    // Data polygon — connect ONLY valid points, in angular order (skip n/a)
    const valid = axes
      .map(ax => {
        const rsi = rsiMap[ax.tf];
        if (rsi === null || rsi === undefined) return null;
        return { ax, rsi, pt: pt(ax.angle, Math.max(3, (rsi / 100) * R)) };
      })
      .filter(Boolean);

    if (valid.length >= 3) {
      const polyStr = valid.map(v => `${v.pt[0].toFixed(1)},${v.pt[1].toFixed(1)}`).join(' ');
      p.push(`<polygon points="${polyStr}" fill="${accent}" fill-opacity="0.20" stroke="${accent}" stroke-width="1.4" stroke-linejoin="round"/>`);
    } else if (valid.length === 2) {
      p.push(`<line x1="${valid[0].pt[0].toFixed(1)}" y1="${valid[0].pt[1].toFixed(1)}" x2="${valid[1].pt[0].toFixed(1)}" y2="${valid[1].pt[1].toFixed(1)}" stroke="${accent}" stroke-width="1.4"/>`);
    }

    // Dots
    axes.forEach(ax => {
      const rsi = rsiMap[ax.tf];
      if (rsi === null || rsi === undefined) return;
      const [dx, dy] = pt(ax.angle, Math.max(3, (rsi / 100) * R));
      const dotCol = rsi >= 70 ? '#f87171' : rsi <= 30 ? '#34d399' : accent;
      p.push(`<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="3.2" fill="${dotCol}" stroke="${surface}" stroke-width="1.1"/>`);
    });

    // Axis labels — anchor by horizontal position so long labels don't clip
    axes.forEach(ax => {
      const rsi = rsiMap[ax.tf];
      const [lx, ly] = pt(ax.angle, R + 11);
      const anchor = lx < CX - 6 ? 'end' : lx > CX + 6 ? 'start' : 'middle';
      const naNote = (rsi === null || rsi === undefined) ? '?' : '';
      p.push(`<text x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" text-anchor="${anchor}" font-size="7.5" fill="${textCol}" font-family="monospace">${TF_LABEL[ax.tf]}${naNote}</text>`);
    });

    p.push('</svg>');
    return p.join('');
  }

  /* ── RSI color + label helpers ───────────────────────────── */
  function _rsiLabel(rsi) {
    if (rsi === null || rsi === undefined) return '<span class="radar-rsi-na">—</span>';
    const col = rsi >= 70 ? 'var(--bad)' : rsi <= 30 ? 'var(--good)' : 'var(--muted)';
    return `<span style="color:${col};font-weight:600">${rsi.toFixed(0)}</span>`;
  }

  function _chgSpan(v) {
    if (v === null || v === undefined) return '<span class="muted">—</span>';
    const col = v >= 0 ? 'var(--good)' : 'var(--bad)';
    return `<span style="color:${col}">${v >= 0 ? '+' : ''}${v.toFixed(2)}%</span>`;
  }

  /* Labeled change cell for the clean price line: "1h +0.02%" */
  function _chgCell(label, v) {
    if (v === null || v === undefined)
      return `<span class="radar-chg"><span class="radar-chg-lbl">${label}</span> <span class="muted">—</span></span>`;
    const col = v >= 0 ? 'var(--good)' : 'var(--bad)';
    return `<span class="radar-chg"><span class="radar-chg-lbl">${label}</span> <span style="color:${col}">${v >= 0 ? '+' : ''}${v.toFixed(2)}%</span></span>`;
  }

  function _fmtPrice(p) {
    if (!p) return '—';
    if (p >= 1000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (p >= 1)    return '$' + p.toFixed(2);
    if (p >= 0.01) return '$' + p.toFixed(4);
    return '$' + p.toFixed(6);
  }

  /* ── Sort helpers ────────────────────────────────────────── */
  function _avgRsi(rsiMap) {
    const vals = Object.values(rsiMap).filter(v => v !== null && v !== undefined);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 50;
  }

  function _sortCards(cards) {
    return [...cards].sort((a, b) => {
      // USDT.D always first
      if (a.sym === USDTD_ID) return -1;
      if (b.sym === USDTD_ID) return 1;
      const aRsi = _avgRsi(a.rsiMap);
      const bRsi = _avgRsi(b.rsiMap);
      if (_sort === 'overbought') return bRsi - aRsi;  // highest RSI first
      if (_sort === 'oversold')  return aRsi - bRsi;   // lowest RSI first
      return (a.rank || 99) - (b.rank || 99);           // mcap rank
    });
  }

  /* ── Card HTML ───────────────────────────────────────────── */
  function _cardHTML(card) {
    const isUsdtD = card.sym === USDTD_ID;
    const sym = isUsdtD ? 'USDT.D' : card.sym;
    const name = isUsdtD ? 'Tether Dom.' : (card.name || card.sym);
    const radar = _radarSVG(card.rsiMap);
    // Always show SVG for USDT.D (shows rings even before Pull Data scores it)
    const loaded = isUsdtD || Object.values(card.rsiMap).some(v => v !== null);

    // ✕ removes ANY ticker: custom additions drop from the watchlist,
    // default top-N coins go to the persisted blocklist.
    const rmAction = isUsdtD ? null
      : _customSyms.includes(card.sym) ? `CryptoRadarTab._removeSymbol('${card.sym}')`
      : `CryptoRadarTab._blockSymbol('${card.sym}')`;

    // Clean price line: price · 1h · 24h · 7d. USDT.D shows its dominance %.
    const footer = isUsdtD
      ? `<div class="radar-footer">
          <span class="radar-price">${card.dom != null ? card.dom.toFixed(2) + '%' : '—'}</span>
          <span class="muted" style="font-size:10px">Tether dominance · macro risk gauge</span>
        </div>`
      : `<div class="radar-footer">
          <span class="radar-price">${_fmtPrice(card.price)}</span>
          ${_chgCell('1h', card.chg1)}
          ${_chgCell('24h', card.chg24)}
          ${_chgCell('7d', card.chg7)}
        </div>`;

    return `<div class="radar-card" data-sym="${card.sym}">
      <div class="radar-card-head">
        <span class="radar-sym">${sym}</span>
        <span class="radar-name">${name}</span>
        ${rmAction ? `<button class="radar-rm" title="Remove" onclick="${rmAction}">✕</button>` : ''}
      </div>
      <div class="radar-svg-wrap">
        ${loaded ? radar : `<div class="radar-empty-svg">No data</div>`}
      </div>
      ${footer}
    </div>`;
  }

  /* ── Add-symbol validation ───────────────────────────────── */
  async function _validateSymbol(sym) {
    // Try fetching 4h klines — if we get ≥10 bars it's valid
    try {
      const kl = await _fetchKlines(sym, '4h');
      return kl && kl.length >= 10;
    } catch (_) { return false; }
  }

  /* Public: remove a user-added custom symbol */
  function _removeSymbol(sym) {
    _customSyms = _customSyms.filter(s => s !== sym);
    localStorage.setItem(LS_SYMS, JSON.stringify(_customSyms));
    _scores.delete(sym);
    _renderGrid();
  }

  /* Public: block (hide) a default top-N symbol */
  function _blockSymbol(sym) {
    if (!_blockedSyms.includes(sym)) {
      _blockedSyms.push(sym);
      localStorage.setItem(LS_BLOCK, JSON.stringify(_blockedSyms));
    }
    _renderGrid();
    _updateResetLink();
  }

  /* Public: restore all blocked symbols */
  function _resetBlocked() {
    _blockedSyms = [];
    localStorage.setItem(LS_BLOCK, JSON.stringify(_blockedSyms));
    _renderGrid();
    _updateResetLink();
  }

  function _updateResetLink() {
    const el = document.getElementById('radarResetLink');
    if (el) el.style.display = _blockedSyms.length ? 'inline' : 'none';
  }

  /* ── Main pull ────────────────────────────────────────────── */
  async function _pullData() {
    if (_pulling) return;
    _pulling = true;
    const btn = document.getElementById('radarPullBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⟳ Pulling…'; }
    _setStatus('Fetching market data…');

    try {
      // 1. Fetch CG top list
      const cgCoins = await _fetchCG();
      if (!cgCoins) { _setStatus('CoinGecko unavailable — try again shortly.'); return; }

      // 2. Build full coin list: top-N + custom additions
      const allCoins = [...cgCoins];
      for (const sym of _customSyms) {
        if (!allCoins.find(c => c.sym === sym)) {
          allCoins.push({ sym, name: sym, id: sym.toLowerCase(), mcap: 0, price: 0, chg1: null, chg24: null, chg7: null, rank: 999 });
        }
      }
      _lastAllCoins = allCoins;

      // 3. Score all coins + USDT.D in small batches. With 8 TFs per coin
      //    that's 8 fetches each, so keep concurrency low (3 coins = 24
      //    in-flight) and pause between batches to avoid 429 on the
      //    server-side CryptoCompare chain.
      const BATCH = 3;
      for (let i = 0; i < allCoins.length; i += BATCH) {
        const batch = allCoins.slice(i, i + BATCH);
        const results = await Promise.all(batch.map(c => _scoreSymbol(c.sym)));
        batch.forEach((c, idx) => { _scores.set(c.sym, results[idx]); });
        _setStatus(`Scoring… ${Math.min(i + BATCH, allCoins.length)}/${allCoins.length}`);
        _renderGrid(allCoins);
        if (i + BATCH < allCoins.length) await new Promise(r => setTimeout(r, 400));
      }

      // USDT.D
      _setStatus('Fetching USDT.D…');
      const usdtdRsi = await _scoreUsdtD();
      _scores.set(USDTD_ID, usdtdRsi);
      _renderGrid(allCoins);
      _setStatus('');
    } finally {
      _pulling = false;
      if (btn) { btn.disabled = false; btn.textContent = '⟳ Pull Data'; }
    }
  }

  function _setStatus(msg) {
    const el = document.getElementById('radarStatus');
    if (el) el.textContent = msg;
  }

  /* ── Grid render ─────────────────────────────────────────── */
  function _renderGrid(allCoins) {
    const gridEl = document.getElementById('radarGrid');
    if (!gridEl) return;

    // Default to the last merged list (CG top-N + custom additions)
    const coins = (allCoins && allCoins.length) ? allCoins
      : (_lastAllCoins.length ? _lastAllCoins : [..._lastCgCoins]);
    const q = _search.toLowerCase().trim();

    let cards = [];

    // USDT.D card — always first, shown as soon as dom % is fetched (even before Pull Data)
    const usdtdRsi = _scores.get(USDTD_ID);
    const usdtdDom = _usdtdCache?.dom ?? null;
    if (usdtdRsi || usdtdDom !== null) {
      cards.push({ sym: USDTD_ID, name: 'Tether Dominance', rank: 0, dom: usdtdDom, rsiMap: usdtdRsi || {} });
    }

    coins.forEach(c => {
      if (_blockedSyms.includes(c.sym)) return;  // user removed
      if (q && !c.sym.toLowerCase().includes(q) && !(c.name || '').toLowerCase().includes(q)) return;
      const rsiMap = _scores.get(c.sym) || {};
      cards.push({ ...c, rsiMap });
    });

    cards = _sortCards(cards);
    gridEl.innerHTML = cards.length
      ? cards.map(_cardHTML).join('')
      : `<div class="radar-empty">No coins to show. ${_blockedSyms.length ? 'You removed them all — ' : ''}<a href="#" id="radarResetInline" onclick="CryptoRadarTab._resetBlocked();return false">reset removed</a>.</div>`;
  }

  /* ── Controls HTML ────────────────────────────────────────── */
  function _sortPills() {
    return SORT_OPTS.map(s => {
      const labels = { mcap: 'Market cap', overbought: 'Overbought', oversold: 'Oversold' };
      return `<button class="radar-sort-pill${_sort === s ? ' active' : ''}" data-sort="${s}">${labels[s]}</button>`;
    }).join('');
  }

  /* ── Guide HTML ──────────────────────────────────────────── */
  const GUIDE_HTML = `
    <div class="radar-guide card" style="margin-top:24px">
      <div class="card-title">📡 How to read the Crypto Radar</div>
      <div class="radar-guide-grid">
        <div><strong>Spoke = timeframe</strong><br>1min · 5min · 15min · 1hr · 4hr · Daily · Weekly · Monthly.</div>
        <div><strong>Dot position = RSI</strong><br>Center = 0 (max oversold) · outer = 100 (max overbought).</div>
        <div><strong style="color:var(--good)">Green core</strong><br>RSI ≤ 30 — oversold / potential accumulation area.</div>
        <div><strong style="color:var(--bad)">Red ring</strong><br>RSI ≥ 70 — overbought / caution on new longs.</div>
        <div><strong>USDT.D card</strong><br>Tether dominance — rising = risk-off. Intraday spokes n/a (no free feed).</div>
        <div><strong>Remove a coin</strong><br>Click ✕ on any card; use Sort to surface the most stretched.</div>
      </div>
      <div class="muted" style="font-size:11px;margin-top:10px">Monthly RSI may show <strong>?</strong> on the hosted dashboard — the server-side data feed has no monthly bars. It fills in when run locally.</div>
    </div>`;

  /* ── Main render ─────────────────────────────────────────── */
  function render(mountId) {
    _mountId = mountId || 'content';
    const root = document.getElementById(_mountId);
    if (!root) return;

    // Load custom + blocked syms from localStorage on first render
    if (!_customSyms.length) {
      try { _customSyms = JSON.parse(localStorage.getItem(LS_SYMS) || '[]'); } catch (_) { _customSyms = []; }
    }
    try { _blockedSyms = JSON.parse(localStorage.getItem(LS_BLOCK) || '[]'); } catch (_) { _blockedSyms = []; }

    // Single compact control bar — the parent "Crypto Scanner" header already
    // carries the title, so no duplicate page title/subtitle here.
    root.innerHTML = `
      <div class="radar-bar">
        <div class="radar-bar-left">
          <span class="radar-pill-label">Sort</span>${_sortPills()}
          <a href="#" id="radarResetLink" class="radar-reset-link" style="display:none" onclick="CryptoRadarTab._resetBlocked();return false">Reset removed</a>
        </div>
        <div class="radar-bar-right">
          <input id="radarSearch" class="radar-search-input" type="text" placeholder="Search…" value="${_search}"/>
          <input id="radarAddInput" class="radar-search-input" type="text" placeholder="Add ticker…" style="width:120px"/>
          <button class="btn-ghost" id="radarAddBtn" style="font-size:12px">＋ Add</button>
          <button class="btn-primary" id="radarPullBtn">⟳ Pull Data</button>
        </div>
      </div>
      <div class="radar-substatus">
        <span id="radarAddStatus" class="muted" style="font-size:11px"></span>
        <span class="radar-status muted" id="radarStatus"></span>
      </div>
      <div class="radar-grid" id="radarGrid">
        <div class="radar-empty">Click <strong>⟳ Pull Data</strong> to load the radar.</div>
      </div>
      ${GUIDE_HTML}`;

    // Sort pills
    root.querySelectorAll('.radar-sort-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        _sort = btn.dataset.sort;
        localStorage.setItem(LS_SORT, _sort);
        root.querySelectorAll('.radar-sort-pill').forEach(b => b.classList.toggle('active', b.dataset.sort === _sort));
        _renderGrid();
      });
    });

    // Search
    const searchInput = document.getElementById('radarSearch');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        _search = searchInput.value;
        _renderGrid();
      });
    }

    // Pull button
    document.getElementById('radarPullBtn')?.addEventListener('click', _pullData);

    // Add symbol
    document.getElementById('radarAddBtn')?.addEventListener('click', async () => {
      const inp = document.getElementById('radarAddInput');
      const statusEl = document.getElementById('radarAddStatus');
      if (!inp || !statusEl) return;
      const raw = inp.value.trim().toUpperCase().replace(/USDT$|USDC$|PERP$|USD$/i, '');
      if (!raw) return;
      // If the user previously removed this one, just restore it.
      if (_blockedSyms.includes(raw)) {
        _blockedSyms = _blockedSyms.filter(s => s !== raw);
        localStorage.setItem(LS_BLOCK, JSON.stringify(_blockedSyms));
        inp.value = '';
        statusEl.textContent = `${raw} restored.`;
        _renderGrid(); _updateResetLink();
        return;
      }
      if (_customSyms.includes(raw) || _lastCgCoins.find(c => c.sym === raw)) {
        statusEl.textContent = `${raw} already in list.`; return;
      }
      statusEl.textContent = `Validating ${raw}…`;
      const ok = await _validateSymbol(raw);
      if (!ok) { statusEl.textContent = `${raw} not found or insufficient data.`; return; }
      _customSyms.push(raw);
      localStorage.setItem(LS_SYMS, JSON.stringify(_customSyms));
      inp.value = '';
      statusEl.textContent = `${raw} added — Pull Data to score it.`;
    });

    // If we already have scores, render immediately; always kick off USDT.D quick-fetch
    if (_scores.size > 0) _renderGrid();
    _fetchUsdtDQuick();
    _updateResetLink();
  }

  return { render, _removeSymbol, _blockSymbol, _resetBlocked };
})();
