/* ═══════════════════════════════════════════════════════════
   CRYPTO RADAR — multi-timeframe RSI spider chart wall.
   7 spokes per card (5min/15min/1hr/4hr/Daily/Weekly/Monthly),
   matching the CoinsKid radar aesthetic. Spoke radius = RSI/100.
   Green core = oversold (RSI≤30), red ring = overbought (RSI≥70).
   Universe: top 100 Binance USDT pairs (CoinGecko ranked, stablecoins
   excluded) + editable watchlist + USDT.D macro card.
════════════════════════════════════════════════════════════ */
const CryptoRadarTab = (() => {

  /* ── Config ─────────────────────────────────────────────── */
  // 7 spokes — 1m removed (no reliable free-tier 1m source for any
  // venue that is reachable from Railway). Angles at 360/7 ≈ 51.4° each.
  const TFS       = ['5m', '15m', '1h', '4h', 'D', 'W', 'M'];
  const TF_LABEL  = { '5m':'5min', '15m':'15min', '1h':'1hr', '4h':'4hr', D:'Daily', W:'Weekly', M:'Monthly' };
  const KLINE_LIMIT = 120;
  const KLINE_TTL   = 60_000;        // 60 s kline cache
  const CG_TTL      = 300_000;       // 5 min CoinGecko cache
  const PAGE_SIZE   = 20;
  const LS_SYMS     = 'jb_radar_symbols';
  const LS_BLOCK    = 'jb_radar_blocked';
  const LS_SORT     = 'jb_radar_sort';
  const LS_SEARCH   = 'jb_radar_search';
  const LS_TOPN     = 'jb_radar_topn';
  const SORT_OPTS   = ['mcap', 'overbought', 'oversold'];

  /* USDT.D via CoinGecko tether market_chart (daily only; 4h = n/a) */
  const USDTD_ID    = '__USDTD__';

  /* ── Module state ────────────────────────────────────────── */
  let _cgCache    = null;    // { ts, coins: [{id,sym,name,mcap,price,chg24,chg7}] }
  let _kCache     = new Map();  // key `${sym}-${tf}` → { ts, klines }
  let _scores     = new Map();  // key sym → { '4h':rsi, D:rsi, W:rsi, M:rsi }
  let _usdtdCache = null;    // { ts, closes_d, closes_w, closes_m }
  let _approxUsdtDom = null; // dom % computed from coins/markets — no extra CG call needed
  let _syms       = null;    // null = use top-N from CG; loaded from LS on first render
  let _customSyms = [];      // user-pinned additions (stored in LS_SYMS)
  let _blockedSyms = [];     // user-removed tickers (stored in LS_BLOCK)
  let _sort       = localStorage.getItem(LS_SORT) || 'mcap';
  let _topN       = parseInt(localStorage.getItem(LS_TOPN) || '30');
  let _search     = '';
  let _page       = 1;
  let _pulling    = false;
  let _mountId    = 'content';
  let _lastCgCoins = [];     // last fetched CG full non-stable list (for slicing + add validation)
  let _lastAllCoins = [];    // _lastCgCoins.slice(0,_topN) + custom additions (drives the grid)

  /* ── Kline fetcher (proxy on Railway, else Bybit → Binance → OKX) ── */
  const TF_BYBIT = { '5m':'5', '15m':'15', '1h':'60', '4h':'240', D:'D', W:'W', M:'M' };
  const TF_BIN   = { '5m':'5m', '15m':'15m', '1h':'1h', '4h':'4h',  D:'1d', W:'1w', M:'1M' };
  const TF_OKX   = { '5m':'5m', '15m':'15m', '1h':'1H', '4h':'4H',  D:'1D', W:'1W', M:'1M' };

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

  /* ── USDT.D history — dominance proxy via BTC-normalised USDT mcap ── */
  /* global/market_cap_chart is Pro-only on CoinGecko; raw USDT mcap trends
     monotonically upward (RSI always ~65) giving wrong direction signals.
     Fix: divide USDT mcap by BTC price (already cached from the regular pull).
     USDT_mcap/BTC_price rises when risk-off (BTC drops, stablecoin inflows)
     and falls when risk-on (BTC rallies) — correct inverse correlation.
     3 CoinGecko calls: days=1 (5m), days=14 (1h), days=max (D/W/M). */
  async function _fetchUsdtD() {
    if (_usdtdCache && _usdtdCache.closes_1h && Date.now() - _usdtdCache.ts < CG_TTL) return _usdtdCache;
    try {
      // allSettled: one 429 from CoinGecko doesn't kill the others
      const [r5m, r1h, rDy] = await Promise.allSettled([
        fetch('https://api.coingecko.com/api/v3/coins/tether/market_chart?vs_currency=usd&days=1',
          { signal: AbortSignal.timeout(12000) }),
        fetch('https://api.coingecko.com/api/v3/coins/tether/market_chart?vs_currency=usd&days=14',
          { signal: AbortSignal.timeout(12000) }),
        fetch('https://api.coingecko.com/api/v3/coins/tether/market_chart?vs_currency=usd&days=max&interval=daily',
          { signal: AbortSignal.timeout(12000) }),
      ]);
      const _j = async s => {
        if (s.status !== 'fulfilled' || !s.value.ok) return null;
        try { return await s.value.json(); } catch (_) { return null; }
      };
      const [j5m, j1h, jDy] = await Promise.all([_j(r5m), _j(r1h), _j(rDy)]);

      // CoinGecko free-tier granularity: days=1 → 5m bars; days=14 → 1h bars;
      // days=max&interval=daily → daily bars since ~2015 (3 000+ bars for USDT).
      const usdtFm = j5m ? (j5m.market_caps || []).map(x => x[1]) : [];
      const usdtH  = j1h ? (j1h.market_caps || []).map(x => x[1]) : [];
      const usdtDy = jDy ? (jDy.market_caps || []).map(x => x[1]) : [];

      // Normalise by BTC price from the kline cache (populated during regular coin pull).
      // RSI is scale-invariant under positive scaling, so dividing by BTC price
      // adds the correct inverse relationship without changing the RSI math.
      // Note: arrays are zipped by recency (last N bars from both), not by exact
      // timestamp — off-by-minutes precision, but direction is preserved.
      const normByBtc = (usdtArr, cacheKey) => {
        const entry = _kCache.get(cacheKey);
        if (!entry || !entry.klines || entry.klines.length < 15) return usdtArr;
        const btcCloses = entry.klines.map(k => k.c);
        const len = Math.min(usdtArr.length, btcCloses.length);
        const u = usdtArr.slice(-len);
        const b = btcCloses.slice(-len);
        return u.map((v, i) => b[i] > 0 ? v / b[i] : v);
      };

      const closes5m  = normByBtc(usdtFm, 'BTC-5m');
      const closes1h  = normByBtc(usdtH,  'BTC-1h');
      const closesDay = normByBtc(usdtDy, 'BTC-D');

      // Sub-sampling: approximate candle boundaries (directionally correct;
      // may be misaligned vs exchange 4h/W candle UTC boundaries by ≤3h/6d).
      const closes15m = closes5m.filter((_, i) => i % 3 === 0);
      const closes4h  = closes1h.filter((_, i) => i % 4 === 0);
      const closesW   = closesDay.filter((_, i) => i % 7 === 0);
      const closesM   = closesDay.filter((_, i) => i % 30 === 0);

      let dom = _approxUsdtDom ?? (_usdtdCache?.dom ?? null);
      try {
        const g = await fetch('https://api.coingecko.com/api/v3/global', { signal: AbortSignal.timeout(8000) });
        if (g.ok) dom = (await g.json())?.data?.market_cap_percentage?.usdt ?? dom;
      } catch (_) {}

      _usdtdCache = {
        ts: Date.now(), dom,
        closes_5m:  closes5m,
        closes_15m: closes15m,
        closes_1h:  closes1h,
        closes_4h:  closes4h,
        closes_d:   closesDay,
        closes_w:   closesW,
        closes_m:   closesM,
      };
      return _usdtdCache;
    } catch (_) { return null; }
  }

  /* ── CoinGecko top-N list ────────────────────────────────── */
  async function _fetchCG() {
    if (_cgCache && Date.now() - _cgCache.ts < CG_TTL) return _cgCache.coins;
    try {
      const url = 'https://api.coingecko.com/api/v3/coins/markets' +
        '?vs_currency=usd&order=market_cap_desc&per_page=250&page=1' +
        '&price_change_percentage=1h,24h,7d';
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) return null;
      const raw = await r.json();
      // Exclude stablecoins (fiat-backed, algo, Euro stables) — USDT.D is tracked
      // separately as the macro risk gauge so USDT itself is excluded here too.
      const STABLE = new Set(['usdt','usdc','dai','busd','tusd','usdd','fdusd','pyusd',
        'usdp','frax','usde','susd','gusd','lusd','crvusd','usds','dola','mim','musd',
        'gho','eurc','euri','steur','usdb','usdx','cusd','bfusd','usd1','usdm']);
      // Approximate USDT dominance from this response (no extra API call)
    const tetherRaw  = raw.find(c => c.symbol?.toLowerCase() === 'usdt');
    const top250Total = raw.reduce((s, c) => s + (c.market_cap || 0), 0);
    if (tetherRaw && top250Total > 0)
      _approxUsdtDom = (tetherRaw.market_cap || 0) / top250Total * 100;

    const coins = raw
        .filter(c => !STABLE.has(c.symbol?.toLowerCase()))
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

  /* Quick fetch of live USDT.D % so the card shows immediately on render.
     Falls back to the approx dom computed from the coins/markets response. */
  async function _fetchUsdtDQuick() {
    // Start with the approx already computed (or last known value)
    let dom = _approxUsdtDom ?? (_usdtdCache?.dom ?? null);
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/global',
        { signal: AbortSignal.timeout(8000) });
      if (r.ok) dom = (await r.json())?.data?.market_cap_percentage?.usdt ?? dom;
    } catch (_) {}
    if (dom === null) return;
    if (!_usdtdCache) _usdtdCache = { ts: 0, dom };
    else _usdtdCache.dom = dom;
    _renderGrid();
  }

  async function _scoreUsdtD() {
    const d = await _fetchUsdtD();
    if (!d) return {};
    const rsi14 = arr => {
      if (!arr || arr.length < 15) return null;
      const v = ICTDetect.rsi(arr, 14);
      return v === null ? null : Math.round(v * 10) / 10;
    };
    return {
      '5m':  rsi14(d.closes_5m),
      '15m': rsi14(d.closes_15m),
      '1h':  rsi14(d.closes_1h),
      '4h':  rsi14(d.closes_4h),
      D:     rsi14(d.closes_d),
      W:     rsi14(d.closes_w),
      M:     rsi14(d.closes_m),
    };
  }

  /* CoinsKid spoke positions (deg, 0=right, clockwise). 7 spokes at 360/7
     ≈ 51.4° each, anchored so Monthly sits at the top-left (~10 o'clock). */
  const TF_ANGLE = {
    M:   -112.5, '5m': -61.1, '15m':  -9.6,
    '1h':  41.8, '4h':  93.2, D:    144.6,  W: 196.1,
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

  /* ── Trade-type score badges ────────────────────────────── */
  // Three overlapping TF clusters → one grade + direction each.
  // Grade: A = strong (avg RSI <35 or >65 AND TFs agree), B = moderate, C = mixed/neutral.
  // Direction: LONG (avg <50), SHORT (avg >50), — (avg 48-52).
  const SCORE_CLUSTERS = {
    scalp: { tfs: ['5m','15m','1h'], label: 'Scalp' },
    swing: { tfs: ['1h','4h','D'],        label: 'Swing' },
    long:  { tfs: ['D','W','M'],          label: 'Long'  },
  };

  function _tradeScores(rsiMap) {
    return Object.entries(SCORE_CLUSTERS).map(([key, { tfs, label }]) => {
      const vals = tfs.map(tf => rsiMap[tf]).filter(v => v !== null && v !== undefined);
      if (vals.length === 0) return { label, grade: '?', dir: '—', col: 'var(--muted)' };
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const spread = Math.max(...vals) - Math.min(...vals);
      const strong = spread < 18;  // TFs in rough agreement
      let grade, col;
      if      (avg < 30 && strong) { grade = 'A'; col = 'var(--good)'; }
      else if (avg < 38)           { grade = 'B'; col = '#5eead4'; }
      else if (avg > 70 && strong) { grade = 'A'; col = 'var(--bad)'; }
      else if (avg > 62)           { grade = 'B'; col = '#f97316'; }
      else if (avg < 45)           { grade = 'C'; col = 'var(--muted)'; }
      else if (avg > 55)           { grade = 'C'; col = 'var(--muted)'; }
      else                         { grade = 'D'; col = 'var(--muted)'; }
      const dir = avg < 48 ? '▲ Long' : avg > 52 ? '▼ Short' : '—';
      return { label, grade, dir, col };
    });
  }

  function _scoreBadges(rsiMap) {
    const scores = _tradeScores(rsiMap);
    return `<div class="radar-scores">${scores.map(s =>
      `<span class="radar-score-badge" style="border-color:${s.col};color:${s.col}" title="${s.label}">
        <span class="rsc-label">${s.label[0]}</span><span class="rsc-grade">${s.grade}</span><span class="rsc-dir">${s.dir}</span>
      </span>`
    ).join('')}</div>`;
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
      ${loaded ? _scoreBadges(card.rsiMap) : ''}
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

      // 2. Build full coin list: top-_topN + custom additions
      const allCoins = [...cgCoins.slice(0, _topN)];
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
      : (_lastAllCoins.length ? _lastAllCoins : [..._lastCgCoins.slice(0, _topN)]);
    const q = _search.toLowerCase().trim();

    let cards = [];

    // USDT.D card — always pinned first, even before any data loads
    cards.push({ sym: USDTD_ID, name: 'Tether Dominance', rank: 0,
      dom: _usdtdCache?.dom ?? null, rsiMap: _scores.get(USDTD_ID) || {} });

    coins.forEach(c => {
      if (_blockedSyms.includes(c.sym)) return;  // user removed
      if (q && !c.sym.toLowerCase().includes(q) && !(c.name || '').toLowerCase().includes(q)) return;
      const rsiMap = _scores.get(c.sym) || {};
      cards.push({ ...c, rsiMap });
    });

    cards = _sortCards(cards);

    // Paginate — USDT.D is always pinned first on page 1, outside the page slice
    const usdtdCard = cards.find(c => c.sym === USDTD_ID);
    const coinCards = cards.filter(c => c.sym !== USDTD_ID);
    const totalPages = Math.max(1, Math.ceil(coinCards.length / PAGE_SIZE));
    if (_page > totalPages) _page = totalPages;
    const pageCoins = coinCards.slice((_page - 1) * PAGE_SIZE, _page * PAGE_SIZE);
    const visibleCards = usdtdCard ? [usdtdCard, ...pageCoins] : pageCoins;

    const pager = totalPages > 1 ? `
      <div class="radar-pager">
        <button class="radar-pager-btn" onclick="CryptoRadarTab._goPage(${_page - 1})" ${_page <= 1 ? 'disabled' : ''}>‹ Prev</button>
        <span class="radar-pager-info">Page ${_page} of ${totalPages} · coins ${(_page-1)*PAGE_SIZE+1}–${Math.min(_page*PAGE_SIZE,coinCards.length)} of ${coinCards.length}</span>
        <button class="radar-pager-btn" onclick="CryptoRadarTab._goPage(${_page + 1})" ${_page >= totalPages ? 'disabled' : ''}>Next ›</button>
      </div>` : '';

    gridEl.innerHTML = visibleCards.length
      ? visibleCards.map(_cardHTML).join('') + pager
      : `<div class="radar-empty">No coins to show. ${_blockedSyms.length ? 'You removed them all — ' : ''}<a href="#" id="radarResetInline" onclick="CryptoRadarTab._resetBlocked();return false">reset removed</a>.</div>`;
  }

  /* ── Top-N selector ─────────────────────────────────────── */
  function _topNPills() {
    return [30, 60, 100].map(n =>
      `<button class="radar-sort-pill radar-topn-pill${_topN === n ? ' active' : ''}"
        data-n="${n}" onclick="CryptoRadarTab._setTopN(${n})">Top ${n}</button>`
    ).join('');
  }

  function _setTopN(n) {
    _topN = n;
    localStorage.setItem(LS_TOPN, String(n));
    _page = 1;
    const base = _lastCgCoins.slice(0, _topN);
    _lastAllCoins = [...base];
    for (const sym of _customSyms) {
      if (!_lastAllCoins.find(c => c.sym === sym))
        _lastAllCoins.push({ sym, name: sym, id: sym.toLowerCase(), mcap: 0, price: 0, chg1: null, chg24: null, chg7: null, rank: 999 });
    }
    document.querySelectorAll('.radar-topn-pill').forEach(b =>
      b.classList.toggle('active', +b.dataset.n === n));
    _renderGrid();
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
        <div><strong>Spoke = timeframe</strong><br>5min · 15min · 1hr · 4hr · Daily · Weekly · Monthly.</div>
        <div><strong>Dot position = RSI</strong><br>Center = 0 (max oversold) · outer = 100 (max overbought).</div>
        <div><strong style="color:var(--good)">Green core</strong><br>RSI ≤ 30 — oversold / potential accumulation area.</div>
        <div><strong style="color:var(--bad)">Red ring</strong><br>RSI ≥ 70 — overbought / caution on new longs.</div>
        <div><strong>USDT.D card</strong><br>RSI from USDT mcap ÷ BTC price (free-tier proxy). Direction is correct — rising = risk-off / stablecoin rotation. 4h and W use hourly/daily subsampling, not exchange-candle-aligned. All 7 spokes filled after Pull Data.</div>
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
          <span class="radar-pill-label" style="margin-left:10px">Show</span>${_topNPills()}
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
        _page = 1;
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
        _page = 1;
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

  function _goPage(n) {
    const coinCards = _lastAllCoins.filter(c => !_blockedSyms.includes(c.sym));
    const totalPages = Math.max(1, Math.ceil(coinCards.length / PAGE_SIZE));
    _page = Math.max(1, Math.min(n, totalPages));
    _renderGrid();
    document.getElementById('radarGrid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return { render, _removeSymbol, _blockSymbol, _resetBlocked, _goPage, _setTopN };
})();
