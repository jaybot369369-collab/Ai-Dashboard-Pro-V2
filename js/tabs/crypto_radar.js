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
  const TF_LABEL  = { '5m':'5m', '15m':'15m', '1h':'1h', '4h':'4h', D:'D', W:'W', M:'M' };
  const KLINE_LIMIT = 120;
  const KLINE_TTL   = 60_000;        // 60 s kline cache
  const CG_TTL      = 300_000;       // 5 min CoinGecko cache
  const PAGE_SIZE   = 20;
  const LS_SYMS     = 'jb_radar_symbols';
  const LS_BLOCK    = 'jb_radar_blocked';
  const LS_SORT     = 'jb_radar_sort';
  const LS_SEARCH   = 'jb_radar_search';
  const LS_TOPN     = 'jb_radar_topn';
  const LS_AUTO     = 'jb_radar_auto';
  const AUTO_MS     = 300_000;       // 5 min auto-refresh cadence
  const SORT_OPTS   = ['mcap', 'overbought', 'oversold'];

  /* Swing signal engine (★ favorites → Telegram / email) */
  const LS_FAVS      = 'jb_radar_favs';        // starred tickers that fire signals
  const LS_SIG_ON    = 'jb_radar_sig_on';      // master toggle (default on)
  const LS_SIG_TG    = 'jb_radar_sig_tg';      // Telegram channel toggle (default on)
  const LS_SIG_EMAIL = 'jb_radar_sig_email';   // email channel toggle (default off — needs server SMTP)
  const LS_SIG_OS    = 'jb_radar_sig_os';      // oversold threshold (default 30)
  const LS_SIG_OB    = 'jb_radar_sig_ob';      // overbought threshold (default 70)
  const LS_SIG_STATE = 'jb_radar_sig_state';   // per-sym episode state + last-alert timestamps
  const LS_ADMIN     = 'mi_admin_secret';      // shared with Market Intel "Push to Railway"
  const SIG_TFS      = ['1h', '4h', 'D'];      // swing cluster — same TFs as the SW badge
  const SIG_COOLDOWN_MS = 6 * 3600 * 1000;     // max one re-alert per coin+direction per 6h

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
  let _autoTimer  = null;    // 5-min auto-refresh interval handle
  let _lastPullTs = 0;       // ms timestamp of last completed pull
  let _mountId    = 'content';
  let _lastCgCoins = [];     // last fetched CG full non-stable list (for slicing + add validation)
  let _lastAllCoins = [];    // _lastCgCoins.slice(0,_topN) + custom additions (drives the grid)
  let _favSyms    = null;    // ★ favorites (lazy-loaded from LS_FAVS)
  let _lastSigCheckTs = 0;   // debounce for the background signal watcher
  let _sigPanelOpen = false; // 🔔 settings panel visibility
  let _emailSrvState = null; // /api/notify/email_status probe result (null = not probed)

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

  /* ── USDT.D history — hybrid sourcing (server proxy → direct CG → rebuild) ──
     USDT_mcap/BTC_price rises risk-off (BTC drops, stablecoin inflows), falls
     risk-on. RSI is scale-invariant so dividing by BTC price adds the inverse
     correlation without changing the math. Sourcing order:
       1. Railway: same-origin /api/usdtd (one cached call, dodges browser 429s)
       2. localhost / proxy-miss: direct CoinGecko market_chart (allSettled)
       3. both fail: reconstruct from the reliable coin klines (_reconstructUsdtD)
     so the "linchpin" card is never blank. `source` tags which path won. */
  function _normByBtc(usdtArr, cacheKey) {
    const entry = _kCache.get(cacheKey);
    if (!entry || !entry.klines || entry.klines.length < 15) return usdtArr;
    const btcCloses = entry.klines.map(k => k.c);
    const len = Math.min(usdtArr.length, btcCloses.length);
    const u = usdtArr.slice(-len);
    const b = btcCloses.slice(-len);
    return u.map((v, i) => b[i] > 0 ? v / b[i] : v);
  }

  /* Reconstruct a USDT.D series for one timeframe from coin klines we already
     fetched reliably. USDT.D ∝ 1 / total-market-cap, so build a mcap-weighted
     total-market index from real candles of that TF and invert. RSI scale-
     invariance drops the ~constant USDT mcap out. Directionally faithful; not
     exchange-confirmed (labeled). Returns [] if <3 coins have ≥15 bars. */
  function _reconIdxTF(tf) {
    const coins = _lastAllCoins.filter(c => c.sym !== USDTD_ID && c.mcap > 0);
    if (coins.length < 3) return [];
    const series = []; let minLen = Infinity;
    for (const c of coins) {
      const e = _kCache.get(`${c.sym}-${tf}`);
      if (!e || !e.klines || e.klines.length < 15) continue;
      series.push({ w: c.mcap, closes: e.klines.map(k => k.c) });
      minLen = Math.min(minLen, e.klines.length);
    }
    if (series.length < 3 || !isFinite(minLen) || minLen < 15) return [];
    const idx = [];
    for (let t = 0; t < minLen; t++) {
      let sum = 0;
      for (const s of series) {
        const a = s.closes.slice(-minLen), last = a[a.length - 1];
        if (last > 0) sum += s.w * (a[t] / last);
      }
      if (sum > 0) idx.push(1 / sum);
    }
    return idx;
  }

  /* Whole-card reconstruction fallback (CoinGecko fully unavailable). */
  function _reconstructUsdtD() {
    const closes5m = _reconIdxTF('5m'), closes1h = _reconIdxTF('1h'), closesDay = _reconIdxTF('D');
    if (!closes5m.length && !closes1h.length && !closesDay.length) return null;
    return { closes5m, closes1h, closesDay };
  }

  async function _fetchUsdtD() {
    if (_usdtdCache && _usdtdCache.closes_1h && _usdtdCache.closes_1h.length
        && Date.now() - _usdtdCache.ts < CG_TTL) return _usdtdCache;

    const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    let usdtFm = [], usdtH = [], usdtDy = [];
    let dom = _approxUsdtDom ?? (_usdtdCache?.dom ?? null);
    let source = 'proxy';

    // 1. Railway/github.io: same-origin cached server proxy
    if (!isLocal) {
      try {
        const r = await fetch('/api/usdtd', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
        if (r.ok) {
          const j = await r.json();
          if (j && j.ok) {
            usdtFm = j.usdt_5m || [];
            usdtH  = j.usdt_1h || [];
            usdtDy = j.usdt_daily || [];
            dom    = j.dom ?? dom;
            source = j.stale ? 'cache' : 'live';
          }
        }
      } catch (_) {}
    }

    // 2. localhost OR proxy returned nothing → direct CoinGecko (allSettled)
    if (!usdtFm.length && !usdtH.length && !usdtDy.length) {
      try {
        // Free-tier: days=1 → 5m, days=14 → hourly, days=365 → daily.
        // (interval=daily / days=max are Pro-only and 401 on the free tier.)
        const [r5m, r1h, rDy] = await Promise.allSettled([
          fetch('https://api.coingecko.com/api/v3/coins/tether/market_chart?vs_currency=usd&days=1',
            { signal: AbortSignal.timeout(12000) }),
          fetch('https://api.coingecko.com/api/v3/coins/tether/market_chart?vs_currency=usd&days=14',
            { signal: AbortSignal.timeout(12000) }),
          fetch('https://api.coingecko.com/api/v3/coins/tether/market_chart?vs_currency=usd&days=365',
            { signal: AbortSignal.timeout(12000) }),
        ]);
        const _j = async s => {
          if (s.status !== 'fulfilled' || !s.value.ok) return null;
          try { return await s.value.json(); } catch (_) { return null; }
        };
        const [j5m, j1h, jDy] = await Promise.all([_j(r5m), _j(r1h), _j(rDy)]);
        usdtFm = j5m ? (j5m.market_caps || []).map(x => x[1]) : [];
        usdtH  = j1h ? (j1h.market_caps || []).map(x => x[1]) : [];
        usdtDy = jDy ? (jDy.market_caps || []).map(x => x[1]) : [];
        if (usdtFm.length || usdtH.length || usdtDy.length) source = 'live';
        try {
          const g = await fetch('https://api.coingecko.com/api/v3/global', { signal: AbortSignal.timeout(8000) });
          if (g.ok) dom = (await g.json())?.data?.market_cap_percentage?.usdt ?? dom;
        } catch (_) {}
      } catch (_) {}
    }

    // 3. Normalise USDT mcap by BTC price
    let closes5m  = _normByBtc(usdtFm, 'BTC-5m');
    let closes1h  = _normByBtc(usdtH,  'BTC-1h');
    let closesDay = _normByBtc(usdtDy, 'BTC-D');

    // 4. Both sources dry → reconstruct from reliable coin klines
    if (!closes5m.length && !closes1h.length && !closesDay.length) {
      const rec = _reconstructUsdtD();
      if (rec) {
        closes5m = rec.closes5m; closes1h = rec.closes1h; closesDay = rec.closesDay;
        source = 'reconstructed';
      }
    }

    // 5. Sub-sample remaining TFs (directionally correct; ≤3h/6d boundary drift)
    const closes15m = closes5m.filter((_, i) => i % 3 === 0);
    const closes4h  = closes1h.filter((_, i) => i % 4 === 0);
    let   closesW   = closesDay.filter((_, i) => i % 7 === 0);
    let   closesM   = closesDay.filter((_, i) => i % 30 === 0);

    // CoinGecko free tier caps at 365 daily bars → ~52 weekly / ~12 monthly
    // subsampled points. Monthly falls below RSI's 15-bar minimum, so rebuild
    // the W/M spokes from the top coins' real weekly/monthly candles (stable
    // closed bars, the most reliable data we have) when subsampling is too thin.
    if (closesW.length < 15) { const w = _reconIdxTF('W'); if (w.length >= 15) closesW = w; }
    if (closesM.length < 15) { const m = _reconIdxTF('M'); if (m.length >= 15) closesM = m; }

    _usdtdCache = {
      ts: Date.now(), dom, source,
      closes_5m:  closes5m,
      closes_15m: closes15m,
      closes_1h:  closes1h,
      closes_4h:  closes4h,
      closes_d:   closesDay,
      closes_w:   closesW,
      closes_m:   closesM,
    };
    return _usdtdCache;
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
  function _radarSVG(rsiMap, sym) {
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

    // Any spoke at RSI ≤ 10 → extreme oversold → yellow center warning
    const hasExtreme = Object.values(rsiMap).some(v => v !== null && v !== undefined && v <= 10);

    const p = [];
    p.push(`<svg width="${W}" height="${W}" viewBox="0 0 ${W} ${W}" xmlns="http://www.w3.org/2000/svg">`);
    p.push(`<rect width="${W}" height="${W}" fill="transparent" rx="10"/>`);

    // Outer red ring (RSI 70–100 annulus only) — evenodd path creates a true ring
    // with a transparent hole in the middle. No red bleeds into the neutral zone.
    const rOuter = R;          // 54 — full spoke length
    const r70    = 0.7 * R;   // 37.8 — overbought boundary
    const ao = `M ${CX - rOuter} ${CY} A ${rOuter} ${rOuter} 0 1 0 ${CX + rOuter} ${CY} A ${rOuter} ${rOuter} 0 1 0 ${CX - rOuter} ${CY}`;
    const ai = `M ${CX - r70}    ${CY} A ${r70}    ${r70}    0 1 1 ${CX + r70}    ${CY} A ${r70}    ${r70}    0 1 1 ${CX - r70}    ${CY}`;
    p.push(`<path d="${ao} ${ai}" fill="rgba(248,113,113,0.24)" fill-rule="evenodd" stroke="none"/>`);

    // Green core (RSI ≤ 30) — transparent middle is "no man's land"; yellow on extreme
    const r30  = 0.3 * R;   // 16.2
    const coreFill = hasExtreme ? 'rgba(250,204,21,0.35)' : 'rgba(52,211,153,0.28)';
    p.push(`<circle cx="${CX}" cy="${CY}" r="${r30.toFixed(1)}" fill="${coreFill}" stroke="none"/>`);

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

    // Dots — yellow for extreme oversold (RSI ≤ 10), green for oversold (≤ 30), red for overbought (≥ 70)
    axes.forEach(ax => {
      const rsi = rsiMap[ax.tf];
      if (rsi === null || rsi === undefined) return;
      const [dx, dy] = pt(ax.angle, Math.max(3, (rsi / 100) * R));
      const dotCol = rsi >= 70 ? '#f87171' : rsi <= 10 ? '#facc15' : rsi <= 30 ? '#34d399' : accent;
      p.push(`<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="3.2" fill="${dotCol}" stroke="${surface}" stroke-width="1.1"/>`);
    });

    // Axis labels — short (D/W/M/1h etc.); anchor by horizontal position
    axes.forEach(ax => {
      const rsi = rsiMap[ax.tf];
      const [lx, ly] = pt(ax.angle, R + 11);
      const anchor = lx < CX - 6 ? 'end' : lx > CX + 6 ? 'start' : 'middle';
      const naNote = (rsi === null || rsi === undefined) ? '?' : '';
      p.push(`<text x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" text-anchor="${anchor}" font-size="8" fill="${textCol}" font-family="monospace">${TF_LABEL[ax.tf]}${naNote}</text>`);
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

  /* ── Swing signal engine — ★ favorites → Telegram / email ──
     SW Long  = 1h & 4h & D RSI(14) ALL ≤ oversold threshold (default 30)
     SW Short = 1h & 4h & D RSI(14) ALL ≥ overbought threshold (default 70)
     Same TF cluster as the SW badge, but stricter: every TF must be in
     the zone, not just the average. Episode-based firing: alerts on
     entering the zone, re-arms when the zone breaks, and never re-alerts
     the same coin+direction more than once per SIG_COOLDOWN_MS.
     Checks run after every pull AND on a module-level 5-min timer, so
     signals keep flowing while the user is on other dashboard tabs —
     the dashboard just has to be open somewhere. */
  function _favs() {
    if (_favSyms === null) {
      try { _favSyms = JSON.parse(localStorage.getItem(LS_FAVS) || '[]'); }
      catch (_) { _favSyms = []; }
    }
    return _favSyms;
  }
  function _isFav(sym) { return _favs().includes(sym); }
  function _toggleFav(sym) {
    const favs = _favs();
    _favSyms = favs.includes(sym) ? favs.filter(s => s !== sym) : [...favs, sym];
    localStorage.setItem(LS_FAVS, JSON.stringify(_favSyms));
    _renderGrid();
    _refreshSigPanel();
  }

  function _sigOn()       { return localStorage.getItem(LS_SIG_ON) !== '0'; }
  function _sigChanOn(ch) {
    if (ch === 'tg') return localStorage.getItem(LS_SIG_TG) !== '0';
    return localStorage.getItem(LS_SIG_EMAIL) === '1';       // email is opt-in
  }
  function _sigThr(kind) {
    const raw = parseFloat(localStorage.getItem(kind === 'os' ? LS_SIG_OS : LS_SIG_OB));
    if (isFinite(raw)) return raw;
    return kind === 'os' ? 30 : 70;
  }

  function _sigState() {
    try { return JSON.parse(localStorage.getItem(LS_SIG_STATE) || '{}'); }
    catch (_) { return {}; }
  }
  function _saveSigState(st) { localStorage.setItem(LS_SIG_STATE, JSON.stringify(st)); }

  function _swingSignal(rsiMap) {
    const vals = SIG_TFS.map(tf => rsiMap[tf]);
    if (vals.some(v => v === null || v === undefined)) return null;
    if (vals.every(v => v <= _sigThr('os'))) return 'long';
    if (vals.every(v => v >= _sigThr('ob'))) return 'short';
    return null;
  }

  async function _checkSignals(opts = {}) {
    if (!_sigOn()) return;
    const favs = _favs();
    if (!favs.length) return;
    // Debounce the background timer; pull-triggered checks ride the fresh
    // 60s kline cache so they're free and always allowed.
    if (!opts.viaPull && !opts.force
        && Date.now() - _lastSigCheckTs < AUTO_MS - 30_000) return;
    _lastSigCheckTs = Date.now();

    const st = _sigState();
    for (const sym of favs) {
      try {
        const kl = await Promise.all(SIG_TFS.map(tf => _fetchKlines(sym, tf)));
        const rsiMap = {};
        SIG_TFS.forEach((tf, i) => { rsiMap[tf] = _rsiForKlines(kl[i]); });
        const kl1h = kl[0];
        const price = kl1h && kl1h.length ? kl1h[kl1h.length - 1].c : null;

        const sig = _swingSignal(rsiMap);
        const cur = st[sym] || { state: null, alerts: {} };
        if (!cur.alerts) cur.alerts = {};
        if (sig && sig !== cur.state
            && Date.now() - (cur.alerts[sig] || 0) > SIG_COOLDOWN_MS) {
          _fireAlert(sym, sig, rsiMap, price);
          cur.alerts[sig] = Date.now();
        }
        cur.state = sig;
        st[sym] = cur;
      } catch (e) {
        console.warn('[radar-signal] check failed for', sym, e);
      }
    }
    _saveSigState(st);
  }

  function _fmtRsiPlain(v) { return (v === null || v === undefined) ? '—' : v.toFixed(0); }

  function _fireAlert(sym, dir, rsiMap, price) {
    const isLong = dir === 'long';
    const emoji  = isLong ? '🟢' : '🔴';
    const word   = isLong ? 'LONG' : 'SHORT';
    const cond   = isLong ? `all oversold (≤${_sigThr('os')})` : `all overbought (≥${_sigThr('ob')})`;
    const rsiLine = `1h ${_fmtRsiPlain(rsiMap['1h'])} · 4h ${_fmtRsiPlain(rsiMap['4h'])} · D ${_fmtRsiPlain(rsiMap.D)}`;
    const priceStr = price != null ? _fmtPrice(price) : '—';
    console.info(`[radar-signal] ${sym} SWING ${word} — RSI ${rsiLine} @ ${priceStr}`);

    // Telegram — existing integration, configured in Pro Tools → Telegram
    if (_sigChanOn('tg') && typeof Telegram !== 'undefined' && Telegram.isEnabled?.()) {
      const msg = `📡 *RADAR SWING ${word}* ${emoji}\n\n` +
        `*${sym}* — 1h · 4h · D ${cond}\n` +
        `RSI: ${rsiLine}\n` +
        `Price: ${priceStr}\n\n` +
        `_Crypto Scanners → Radar · ★ favorites signal_`;
      Telegram.send(msg).catch(e => console.warn('[radar-signal] telegram failed:', e.message));
    }

    // Email — fund API relay (SMTP lives server-side)
    if (_sigChanOn('email')) {
      const subject = `📡 Radar swing ${word} — ${sym}`;
      const body =
`${sym} SWING ${word} signal ${emoji}

1h, 4h and D RSI ${cond}:
  1h: ${_fmtRsiPlain(rsiMap['1h'])}
  4h: ${_fmtRsiPlain(rsiMap['4h'])}
  D:  ${_fmtRsiPlain(rsiMap.D)}

Price: ${priceStr}
Time:  ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC

— Crypto Radar · AI Dashboard Pro V2
${window.location.origin}`;
      _sendEmail(subject, body).catch(e => console.warn('[radar-signal] email failed:', e.message));
    }
  }

  /* Fund API base — same-origin on Railway; localhost falls back to the
     local fund API (8767), honouring the fund_remote_url dev override. */
  function _fundBase() {
    const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    if (!isLocal) return window.location.origin + '/';
    const override = (localStorage.getItem('fund_remote_url') || '').trim();
    if (override) return override.replace(/\/?$/, '/');
    return 'http://127.0.0.1:8767/';
  }

  async function _sendEmail(subject, body) {
    const secret = (localStorage.getItem(LS_ADMIN) || '').trim();
    if (!secret) throw new Error('no admin secret cached — open 🔔 Signals and send a test email once');
    const r = await fetch(_fundBase() + 'api/notify/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': secret },
      body: JSON.stringify({ subject, body }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || `HTTP ${r.status}`);
    return j;
  }

  /* ── 🔔 Signals settings panel ───────────────────────────── */
  function _ensureAdminSecret() {
    let s = (localStorage.getItem(LS_ADMIN) || '').trim();
    if (!s) {
      s = (prompt('Enter the bot-farm admin secret (BOTFARM_KEY on Railway).\nCached locally after first use — needed so email alerts can authenticate.') || '').trim();
      if (s) localStorage.setItem(LS_ADMIN, s);
    }
    return s;
  }

  async function _probeEmailServer() {
    try {
      const r = await fetch(_fundBase() + 'api/notify/email_status',
        { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      _emailSrvState = r.ok ? await r.json() : { ok: false, unreachable: true };
    } catch (_) {
      _emailSrvState = { ok: false, unreachable: true };
    }
    _refreshSigPanel();
  }

  function _sigPanelHTML() {
    const favs = _favs();
    const tgConfigured = (typeof Telegram !== 'undefined') && Telegram.isEnabled?.();
    const tgChip = tgConfigured
      ? '<span class="radar-sig-chip ok">✓ configured</span>'
      : '<span class="radar-sig-chip bad">✗ not configured — Pro Tools → Telegram</span>';
    const emailChip = _emailSrvState === null
      ? '<span class="radar-sig-chip">server: checking…</span>'
      : _emailSrvState.unreachable
        ? '<span class="radar-sig-chip bad">✗ fund API unreachable</span>'
        : _emailSrvState.configured
          ? '<span class="radar-sig-chip ok">✓ server ready</span>'
          : '<span class="radar-sig-chip bad">✗ SMTP not configured on server</span>';
    const osThr = _sigThr('os'), obThr = _sigThr('ob');
    const osOpts = [20, 25, 27, 30].map(v => `<option value="${v}" ${v === osThr ? 'selected' : ''}>≤ ${v}</option>`).join('');
    const obOpts = [70, 73, 75, 80].map(v => `<option value="${v}" ${v === obThr ? 'selected' : ''}>≥ ${v}</option>`).join('');

    return `
      <div class="radar-sig-row">
        <span class="radar-sig-title">🔔 Swing signals — ★ favorites only</span>
        <label><input type="checkbox" ${_sigOn() ? 'checked' : ''}
          onchange="CryptoRadarTab._sigSetToggle('on', this.checked)"/> Enabled</label>
        <span class="muted">Oversold</span>
        <select class="radar-sig-select" onchange="CryptoRadarTab._sigSetThr('os', this.value)">${osOpts}</select>
        <span class="muted">Overbought</span>
        <select class="radar-sig-select" onchange="CryptoRadarTab._sigSetThr('ob', this.value)">${obOpts}</select>
      </div>
      <div class="radar-sig-row">
        <span style="min-width:72px">Telegram</span>
        <label><input type="checkbox" ${_sigChanOn('tg') ? 'checked' : ''}
          onchange="CryptoRadarTab._sigSetToggle('tg', this.checked)"/> on</label>
        ${tgChip}
        <button class="radar-sig-test" onclick="CryptoRadarTab._testTelegram()">Send test</button>
      </div>
      <div class="radar-sig-row">
        <span style="min-width:72px">Email</span>
        <label><input type="checkbox" ${_sigChanOn('email') ? 'checked' : ''}
          onchange="CryptoRadarTab._sigSetToggle('email', this.checked)"/> on</label>
        ${emailChip}
        <button class="radar-sig-test" onclick="CryptoRadarTab._testEmail()">Send test</button>
      </div>
      <div class="radar-sig-row">
        <span style="min-width:72px" class="muted">Favorites</span>
        <span>${favs.length ? favs.join(' · ') : '<span class="muted">none — click ☆ on a card to star it</span>'}</span>
      </div>
      <div class="radar-sig-note">
        Fires when a starred coin's <strong>1h, 4h and D</strong> RSI are ALL in the zone
        (SW Long ${'≤ ' + osThr} / SW Short ${'≥ ' + obThr}). Checks every 5 min while the
        dashboard is open in any tab · re-alerts max once per 6h per coin+direction.
        Email needs SMTP_USER/SMTP_PASS set on Railway.
      </div>
      <div class="radar-sig-row"><span id="radarSigStatus" class="muted" style="font-size:11px"></span></div>`;
  }

  function _refreshSigPanel() {
    const el = document.getElementById('radarSigPanel');
    if (el && _sigPanelOpen) el.innerHTML = _sigPanelHTML();
  }

  function _toggleSigPanel() {
    _sigPanelOpen = !_sigPanelOpen;
    const el = document.getElementById('radarSigPanel');
    if (!el) return;
    el.style.display = _sigPanelOpen ? 'flex' : 'none';
    if (_sigPanelOpen) {
      el.innerHTML = _sigPanelHTML();
      _probeEmailServer();          // fills the email server chip async
    }
  }

  function _sigSetToggle(which, val) {
    const key = which === 'on' ? LS_SIG_ON : which === 'tg' ? LS_SIG_TG : LS_SIG_EMAIL;
    localStorage.setItem(key, val ? '1' : '0');
    if (which === 'email' && val) _ensureAdminSecret();
    _refreshSigPanel();
    _updateSigBtn();
  }

  function _sigSetThr(kind, val) {
    localStorage.setItem(kind === 'os' ? LS_SIG_OS : LS_SIG_OB, String(parseFloat(val)));
    _refreshSigPanel();
  }

  function _updateSigBtn() {
    const btn = document.getElementById('radarSigBtn');
    if (btn) btn.classList.toggle('active', _sigOn());
  }

  function _sigStatus(msg) {
    const el = document.getElementById('radarSigStatus');
    if (el) el.textContent = msg;
  }

  async function _testTelegram() {
    if (typeof Telegram === 'undefined' || !Telegram.isEnabled?.()) {
      _sigStatus('Telegram not configured — set it up in Pro Tools → Telegram first.');
      return;
    }
    _sigStatus('Sending Telegram test…');
    try {
      await Telegram.send('📡 *Radar swing signals* — test alert, wiring OK.');
      _sigStatus('✓ Telegram test sent — check your phone.');
    } catch (e) {
      _sigStatus('✗ Telegram failed: ' + e.message);
    }
  }

  async function _testEmail() {
    const secret = _ensureAdminSecret();
    if (!secret) { _sigStatus('✗ No admin secret — email alerts can\'t authenticate.'); return; }
    _sigStatus('Sending test email…');
    try {
      const res = await _sendEmail('📡 Radar swing signals — test',
        'Test alert from the Crypto Radar swing signal system. Wiring OK.\n\n' + window.location.origin);
      _sigStatus(`✓ Test email sent to ${res.to}.`);
    } catch (e) {
      if (String(e.message).includes('X-Admin-Secret')) localStorage.removeItem(LS_ADMIN);
      _sigStatus('✗ Email failed: ' + e.message);
    }
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
      const dir = avg < 48 ? '▲' : avg > 52 ? '▼' : '—';
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

  /* USDT.D data-source honesty chip (RULE #2/#3) */
  function _usdtdSrcChip() {
    const s = _usdtdCache && _usdtdCache.source;
    if (!s || s === 'proxy') return '';
    const map = {
      live:          ['live',    'var(--good)'],
      cache:         ['cached',  'var(--warn)'],
      reconstructed: ['rebuilt', 'var(--warn)'],
    };
    const [lbl, col] = map[s] || [s, 'var(--muted)'];
    const tip = s === 'reconstructed'
      ? 'Reconstructed from live coin klines (CoinGecko down) — direction sound, not exchange-confirmed'
      : s === 'cache' ? 'Served from last-good server cache (CoinGecko throttled)'
      : 'Live USDT.D from CoinGecko via server cache';
    return `<span class="radar-src-chip" title="${tip}" style="color:${col};border-color:${col}">${lbl}</span>`;
  }

  /* ── Card HTML ───────────────────────────────────────────── */
  function _cardHTML(card) {
    const isUsdtD = card.sym === USDTD_ID;
    const sym = isUsdtD ? 'USDT.D' : card.sym;
    const name = isUsdtD ? 'Tether Dom.' : (card.name || card.sym);
    const radar = _radarSVG(card.rsiMap, card.sym);
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
          ${_usdtdSrcChip()}
        </div>`
      : `<div class="radar-footer">
          <span class="radar-price">${_fmtPrice(card.price)}</span>
          ${_chgCell('1h', card.chg1)}
          ${_chgCell('24h', card.chg24)}
          ${_chgCell('7d', card.chg7)}
        </div>`;

    // ★ favorite — starred coins fire swing signals (🔔 Signals panel)
    const fav = !isUsdtD && _isFav(card.sym);
    const favBtn = isUsdtD ? '' :
      `<button class="radar-fav${fav ? ' active' : ''}" title="${fav ? 'Unstar — stop swing signals' : 'Star — get swing signals'}"
        onclick="CryptoRadarTab._toggleFav('${card.sym}')">${fav ? '★' : '☆'}</button>`;

    return `<div class="radar-card" data-sym="${card.sym}">
      <div class="radar-card-head">
        ${favBtn}
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
      _lastPullTs = Date.now();
      _setStatus(_updatedStatus());
      // Swing signals for ★ favorites — rides the fresh kline cache
      _checkSignals({ viaPull: true }).catch(e => console.warn('[radar-signal]', e));
    } finally {
      _pulling = false;
      if (btn) { btn.disabled = false; btn.textContent = '⟳ Pull Data'; }
    }
  }

  function _updatedStatus() {
    const t = new Date(_lastPullTs || Date.now())
      .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const auto = localStorage.getItem(LS_AUTO) !== 'off';
    return `Updated ${t}${auto ? ' · auto 5m' : ''}`;
  }

  /* ── 5-min auto-refresh (default on; self-cancels when radar unmounts) ── */
  function _autoOn() { return localStorage.getItem(LS_AUTO) !== 'off'; }
  function _stopAuto() { if (_autoTimer) { clearInterval(_autoTimer); _autoTimer = null; } }
  function _startAuto() {
    _stopAuto();
    if (localStorage.getItem(LS_AUTO) === 'off') return;
    _autoTimer = setInterval(() => {
      if (document.hidden) return;                              // tab backgrounded
      if (!document.getElementById('radarGrid')) { _stopAuto(); return; }  // unmounted
      if (_pulling) return;
      _pullData();
    }, AUTO_MS);
  }
  function _toggleAuto() {
    const wasOff = localStorage.getItem(LS_AUTO) === 'off';
    localStorage.setItem(LS_AUTO, wasOff ? 'on' : 'off');
    const btn = document.getElementById('radarAutoBtn');
    if (btn) {
      btn.classList.toggle('active', wasOff);
      btn.textContent = wasOff ? 'Auto 5m ✓' : 'Auto 5m ✗';
    }
    if (wasOff) { _startAuto(); if (!_pulling) _pullData(); }
    else { _stopAuto(); _setStatus(_lastPullTs ? _updatedStatus() : ''); }
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
  function _buildGuideHTML() {
    const exScalpLong  = _radarSVG({'5m':22,'15m':24,'1h':27,'4h':44,D:50,W:52,M:55}, '_ex');
    const exScalpShort = _radarSVG({'5m':76,'15m':78,'1h':73,'4h':58,D:52,W:49,M:47}, '_ex');
    const exSwingLong  = _radarSVG({'5m':50,'15m':46,'1h':28,'4h':25,D:22,W:44,M:50}, '_ex');
    const exSwingShort = _radarSVG({'5m':50,'15m':54,'1h':72,'4h':75,D:78,W:54,M:50}, '_ex');

    return `
    <div class="radar-guide card" style="margin-top:24px">
      <div class="card-title">📡 How to read the Crypto Radar</div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 28px;margin-top:12px;font-size:12px;line-height:1.5">
        <div>
          <strong>Spoke = timeframe</strong> — 5m · 15m · 1h · 4h · D · W · M. Dot distance from center = RSI value (0 = center, 100 = edge).
        </div>
        <div>
          <strong style="color:var(--good)">Green core</strong> RSI ≤ 30 (oversold). &nbsp;<strong style="color:var(--bad)">Red ring</strong> RSI ≥ 70 (overbought). &nbsp;Middle = no man's land. Dots turn <strong style="color:#facc15">yellow</strong> at RSI ≤ 10 (extreme).
        </div>
        <div>
          <strong>USDT.D (top-left)</strong> — RSI of USDT mcap ÷ BTC price. Rising = risk-off / stablecoin rotation. Source chip: <strong style="color:var(--good)">live</strong> / <strong style="color:var(--warn)">cached</strong> / <strong style="color:var(--warn)">rebuilt</strong>.
        </div>
        <div>
          <strong>Grade badges</strong> — <strong style="color:var(--good)">A</strong> avg RSI &lt;30 or &gt;70, TFs agree → full size. <strong style="color:#5eead4">B</strong> &lt;38 or &gt;62 → half. <strong style="color:var(--muted)">C</strong> &lt;45 or &gt;55 → wait. <strong style="color:var(--muted)">D</strong> 45–55 → skip.<br>
          <span style="font-size:10px;color:var(--muted)"><strong>S</strong> 5m·15m·1h &nbsp;·&nbsp; <strong>SW</strong> 1h·4h·D &nbsp;·&nbsp; <strong>L</strong> D·W·M</span>
        </div>
        <div>
          <strong style="color:#facc15">★ + 🔔 Swing signals</strong> — star a coin, and when its <strong>1h · 4h · D</strong> RSI are ALL oversold (SW Long) or ALL overbought (SW Short) you get a Telegram / email alert. Configure in <strong>🔔 Signals</strong>; Telegram creds live in Pro Tools → Telegram.
        </div>
      </div>

      <div style="margin-top:14px">
        <div style="font-size:11px;font-weight:700;margin-bottom:10px;color:var(--text)">Visual examples</div>
        <div class="radar-guide-examples">
          <div class="radar-guide-ex">
            ${exScalpLong}
            <div class="radar-ex-badge" style="color:var(--good)">S A ▲ Long</div>
            <div class="radar-ex-label">Scalp Long<br><span>5m·15m·1h in green core</span><br><span>Entry: 5m–15m · Hold: 1–4h</span></div>
          </div>
          <div class="radar-guide-ex">
            ${exScalpShort}
            <div class="radar-ex-badge" style="color:var(--bad)">S A ▼ Short</div>
            <div class="radar-ex-label">Scalp Short<br><span>5m·15m·1h in red ring</span><br><span>Entry: 5m–15m · Hold: 1–4h</span></div>
          </div>
          <div class="radar-guide-ex">
            ${exSwingLong}
            <div class="radar-ex-badge" style="color:#5eead4">SW A ▲ Long</div>
            <div class="radar-ex-label">Swing Long<br><span>1h·4h·D in green core</span><br><span>Entry: 1h–4h · Hold: 1–5D</span></div>
          </div>
          <div class="radar-guide-ex">
            ${exSwingShort}
            <div class="radar-ex-badge" style="color:var(--bad)">SW A ▼ Short</div>
            <div class="radar-ex-label">Swing Short<br><span>1h·4h·D in red ring</span><br><span>Entry: 1h–4h · Hold: 1–5D</span></div>
          </div>
        </div>
      </div>

      <div class="muted" style="font-size:10px;margin-top:10px">4h/W spokes use subsampling — directionally accurate, ≤3h/6d boundary drift. Auto-refresh every 5 min (toggle in bar).</div>
    </div>`;
  }

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
          <button class="btn-ghost radar-auto-btn${_autoOn() ? ' active' : ''}" id="radarAutoBtn" style="font-size:12px"
            title="Auto-refresh every 5 minutes" onclick="CryptoRadarTab._toggleAuto()">Auto 5m ${_autoOn() ? '✓' : '✗'}</button>
          <button class="btn-ghost radar-sig-btn${_sigOn() ? ' active' : ''}" id="radarSigBtn" style="font-size:12px"
            title="Swing signal alerts for ★ favorites (Telegram / email)" onclick="CryptoRadarTab._toggleSigPanel()">🔔 Signals</button>
          <button class="btn-primary" id="radarPullBtn">⟳ Pull Data</button>
        </div>
      </div>
      <div class="radar-substatus">
        <span id="radarAddStatus" class="muted" style="font-size:11px"></span>
        <span class="radar-status muted" id="radarStatus"></span>
      </div>
      <div id="radarSigPanel" class="radar-sig-panel" style="display:${_sigPanelOpen ? 'flex' : 'none'}">${_sigPanelOpen ? _sigPanelHTML() : ''}</div>
      <div class="radar-grid" id="radarGrid">
        <div class="radar-empty">Click <strong>⟳ Pull Data</strong> to load the radar.</div>
      </div>
      ${_buildGuideHTML()}`;

    // Sort pills (exclude the Top-N pills, which share the .radar-sort-pill class
    // but carry data-n, not data-sort, and handle their own click via _setTopN)
    root.querySelectorAll('.radar-sort-pill:not(.radar-topn-pill)').forEach(btn => {
      btn.addEventListener('click', () => {
        _sort = btn.dataset.sort;
        _page = 1;
        localStorage.setItem(LS_SORT, _sort);
        root.querySelectorAll('.radar-sort-pill:not(.radar-topn-pill)').forEach(b => b.classList.toggle('active', b.dataset.sort === _sort));
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
    if (_lastPullTs) _setStatus(_updatedStatus());

    // Auto-refresh: arm the 5-min timer (self-cancels on unmount); kick an
    // immediate pull when auto is on and data is empty/stale so opening the tab
    // shows fresh spokes without a manual click.
    _startAuto();
    if (_autoOn() && !_pulling && (_scores.size === 0 || Date.now() - _lastPullTs > AUTO_MS)) {
      _pullData();
    }
  }

  function _goPage(n) {
    const coinCards = _lastAllCoins.filter(c => !_blockedSyms.includes(c.sym));
    const totalPages = Math.max(1, Math.ceil(coinCards.length / PAGE_SIZE));
    _page = Math.max(1, Math.min(n, totalPages));
    _renderGrid();
    document.getElementById('radarGrid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ── Background signal watcher ───────────────────────────
     Module-level timer so ★-favorite swing signals keep firing while the
     user is on other dashboard tabs — only needs the dashboard open in
     SOME browser tab. Favorites-only: 3 kline fetches per starred coin
     per 5 min (60s cache dedupes with radar pulls). Note: browsers
     throttle timers in fully backgrounded tabs, so cadence can stretch
     when the dashboard window is hidden for long stretches. */
  setTimeout(() => _checkSignals().catch(() => {}), 25_000);
  setInterval(() => _checkSignals().catch(() => {}), AUTO_MS);

  return { render, _removeSymbol, _blockSymbol, _resetBlocked, _goPage, _setTopN, _toggleAuto,
           _toggleFav, _toggleSigPanel, _sigSetToggle, _sigSetThr, _testTelegram, _testEmail,
           _sigCheckNow: () => _checkSignals({ force: true }) };
})();
