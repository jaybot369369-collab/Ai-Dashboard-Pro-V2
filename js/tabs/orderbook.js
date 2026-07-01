/* ═══════════════════════════════════════════════════════════
   JAYBOT DASHBOARD — orderbook.js  (Level 2 — Swing Context)

   Redesigned for intraday + swing traders (15m–4h setups).
   No flickering 100ms book. Four swing-relevant panels:

     1. Liquidation heatmap  — where liq clusters sit
        (estimated via LW server, or live via Coinglass key)
     2. Funding rate + OI    — is the market overleveraged?
     3. CVD bars             — taker flow binned by TF candle
     4. Persistent walls     — resting ≥10 min (REST snapshots)

   Data sources (all free unless Coinglass key is set):
     Binance @aggTrade WS          → CVD binning
     Bybit REST /tickers           → funding + OI
     Binance REST /depth (30s)     → persistent walls
     LW server :8766               → estimated liq heatmap
     fund-API proxy /coinglass/*   → live liq + Coinglass funding
════════════════════════════════════════════════════════════ */

const OrderBookTab = (() => {

  /* ── Universe ─────────────────────────────────────────── */
  const SYMBOLS  = ['BTC', 'ETH', 'XRP', 'SOL', 'SUI'];
  const pairOf   = s => s.toUpperCase() + 'USDT';

  /* ── Per-panel window config ──────────────────────────────
     Each chart panel (liq / funding / oi / cvd) has its own
     clickable 7D / 30D / 60D / 90D window.
  ──────────────────────────────────────────────────────────*/
  const WIN_LIST   = ['7d', '30d', '60d', '90d'];
  const WIN_LABELS = { '7d': '7D', '30d': '30D', '60d': '60D', '90d': '90D' };
  // candle granularity + bar count per window (OI / CVD / price overlay / liq)
  //   kIv  = Bybit kline interval   oiIv = Bybit open-interest intervalTime
  //   binIv = Binance kline interval  okx = OKX bar
  const WIN_CFG = {
    '7d':  { kIv: '240', oiIv: '4h', binIv: '4h', okx: '4H', count: 42, ms: 14400000 },
    '30d': { kIv: 'D',   oiIv: '1d', binIv: '1d', okx: '1D', count: 30, ms: 86400000 },
    '60d': { kIv: 'D',   oiIv: '1d', binIv: '1d', okx: '1D', count: 60, ms: 86400000 },
    '90d': { kIv: 'D',   oiIv: '1d', binIv: '1d', okx: '1D', count: 90, ms: 86400000 },
  };
  // funding cadence is 8h (3/day) → points needed per window
  const FUND_PTS = { '7d': 21, '30d': 90, '60d': 180, '90d': 270 };

  /* ── Tunables ─────────────────────────────────────────── */
  const SNAP_INT_MS  = 30000;     // wall REST snapshot interval
  const WALL_MIN_MS  = 600000;    // wall must be present ≥10 min
  const WALL_SHARE   = 0.06;      // ≥6% of ±2% side depth = wall
  const FUND_INT_MS  = 60000;     // funding/OI poll interval
  const PAINT_MS     = 10000;     // UI repaint (10s — no flicker)
  // LW server: localhost dev → :8766 direct; on Railway → same-origin /lw proxy
  // (Chrome PNA blocks HTTPS→localhost, so the direct :8766 only works in local dev)
  function _lwBase() {
    return ['localhost', '127.0.0.1'].includes(location.hostname)
      ? 'http://127.0.0.1:8766' : location.origin + '/lw';
  }

  /* ── Persistence keys ─────────────────────────────────── */
  const LS_SYM = 'jb_ob_symbol';
  // Confluence steadiness — how many 10s cycles a new setup call must hold
  // before it replaces the one on screen (anti-flicker / hysteresis).
  const LS_STEADY = 'jb_ob_steady';
  const STEADY_CYCLES = { fast: 1, balanced: 3, smooth: 6 };
  const STEADY_LABELS = { fast: 'Fast', balanced: 'Balanced', smooth: 'Smooth' };

  /* ── State ────────────────────────────────────────────── */
  let _sym = (localStorage.getItem(LS_SYM) || 'BTC').toUpperCase();
  // Confluence sticky-confirm buffer (see _paintConfluence)
  let _steady      = localStorage.getItem(LS_STEADY) || 'balanced';
  let _cfCommitted = null;   // the setup call currently shown (sticky)
  let _cfPending   = null;   // a candidate new call awaiting confirmation
  let _cfPendingN  = 0;      // how many consecutive cycles it's held
  let _cfRenderSig = null;   // signature of what's on screen (render-on-change)
  // Per-panel windows (each independently clickable + persisted)
  let _pwin = {
    liq:     localStorage.getItem('ob_w_liq')     || '30d',
    funding: localStorage.getItem('ob_w_funding') || '30d',
    oi:      localStorage.getItem('ob_w_oi')      || '30d',
    cvd:     localStorage.getItem('ob_w_cvd')     || '30d',
  };

  // WebSocket (aggTrade — CVD only)
  let _ws         = null;
  let _status     = 'idle';
  let _lastMsg    = 0;
  let _reconTimer = null;
  let _reconDelay = 1000;

  // CVD bucketing
  let _cvdBuckets   = [];     // [{t, buy, sell}] oldest first
  let _cvdBucketMs  = (WIN_CFG[_pwin.cvd] || WIN_CFG['30d']).ms;
  let _cvdMax       = (WIN_CFG[_pwin.cvd] || WIN_CFG['30d']).count;

  // Persistent walls (REST snapshots)
  let _wallTracker = new Map(); // key → {firstSeen, lastSeen, usd, side, price}
  let _lastSnapMid = null;
  let _depthLevels = null;      // {bids:[{price,usd,age}], asks:[...], mid}
  let _snapTimer   = null;

  // Liq heatmap (same data shape as liquidity_watcher.js)
  let _liqData      = null;
  let _liqKlines    = null;
  let _liqKlinesKey = null;
  let _liqInFlight  = false;

  // Funding / OI (live current values)
  let _fundingData = null;    // {rate, oi, price}
  let _fundingTimer = null;

  // 30-day history (for the charts)
  let _fundHist = null;       // [{t, rate}] oldest first
  let _oiHist   = null;       // [{t, oiUsd}] oldest first
  let _oiPxHist = null;       // [{t, close}] oldest first
  let _histKey  = null;       // symbol the history was fetched for
  let _histTimer = null;

  // Timers
  let _paintTimer = null;
  let _cgTimer    = null;

  // Coinglass
  let _cgNoKey  = false;
  let _cgState  = 'idle';
  let _cg       = {};

  /* ── DOM guard ────────────────────────────────────────── */
  function _alive() { return !!document.getElementById('ob-root'); }

  /* ── Generic helpers ──────────────────────────────────── */
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function _sig(ms) {
    return (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(ms) : undefined;
  }
  function _decimals(px) {
    if (!px) return 2;
    if (px >= 1000) return 1;
    if (px >= 100)  return 2;
    if (px >= 1)    return 4;
    return 5;
  }
  function _fmtPx(px) {
    if (px == null) return '—';
    return px.toLocaleString('en-US', { minimumFractionDigits: _decimals(px), maximumFractionDigits: _decimals(px) });
  }
  function _fmtUsd(v) {
    if (v == null) return '—';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'k';
    return '$' + v.toFixed(0);
  }
  function _fmtM(v) {
    if (!v) return '$0';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
    return '$' + v.toFixed(0);
  }

  /* ── Visual helpers — small inline SVG charts ──────────── */
  const C_BULL = '#22c55e', C_BEAR = '#ef4444', C_WARN = '#d97706', C_FLAT = '#9aa0aa';

  // Verdict chip: big colored pill that says bull/bear/chop at a glance
  function _verdict(tone, label, sub) {
    const c = { bull: C_BULL, bear: C_BEAR, warn: C_WARN, flat: C_FLAT }[tone] || C_FLAT;
    const bg = { bull: 'rgba(34,197,94,.12)', bear: 'rgba(239,68,68,.12)', warn: 'rgba(217,119,6,.12)', flat: 'rgba(154,160,170,.12)' }[tone];
    return `<div class="ob-verdict" style="background:${bg};border-color:${c}">
      <span class="ob-verdict-dot" style="background:${c}"></span>
      <span class="ob-verdict-lbl" style="color:${c}">${label}</span>
      ${sub ? `<span class="ob-verdict-sub">${sub}</span>` : ''}
    </div>`;
  }

  // Signed bar chart with a zero line (funding). pos→red, neg→green.
  function _svgSignedBars(vals, posCol, negCol, hiIdx) {
    const W = 600, H = 90, n = vals.length || 1, slot = W / n, bw = Math.max(slot * 0.66, 1);
    const max = Math.max(...vals.map(v => Math.abs(v)), 1e-12), zeroY = H / 2;
    let s = `<svg viewBox="0 0 ${W} ${H}" class="ob-vsvg" preserveAspectRatio="none">`;
    s += `<line x1="0" y1="${zeroY}" x2="${W}" y2="${zeroY}" stroke="rgba(127,127,127,.35)" stroke-width="1"/>`;
    vals.forEach((v, i) => {
      const bh = Math.abs(v) / max * (H / 2 - 5), x = i * slot + (slot - bw) / 2;
      const y = v >= 0 ? zeroY - bh : zeroY;
      const col = v >= 0 ? posCol : negCol, op = (hiIdx != null && i === hiIdx) ? 1 : 0.62;
      s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(bh, 0.6).toFixed(1)}" fill="${col}" opacity="${op}" rx="1"/>`;
      if (hiIdx != null && i === hiIdx) s += `<rect x="${x.toFixed(1)}" y="${(v>=0?y-2:zeroY-2).toFixed(1)}" width="${bw.toFixed(1)}" height="2" fill="${col}"/>`;
    });
    s += `</svg>`;
    return s;
  }

  // Area + line chart (OI), optional normalized overlay line (price).
  function _svgArea(vals, col, overlay) {
    const W = 600, H = 90, PB = 6, PT = 6;
    const min = Math.min(...vals), max = Math.max(...vals), rng = (max - min) || 1;
    const n = vals.length, dx = n > 1 ? W / (n - 1) : W;
    const y = v => PT + (1 - (v - min) / rng) * (H - PT - PB);
    const pts = vals.map((v, i) => `${(i * dx).toFixed(1)},${y(v).toFixed(1)}`);
    let s = `<svg viewBox="0 0 ${W} ${H}" class="ob-vsvg" preserveAspectRatio="none">`;
    s += `<path d="M0,${H} L${pts.join(' L')} L${W},${H} Z" fill="${col}" opacity="0.13"/>`;
    s += `<path d="M${pts.join(' L')}" fill="none" stroke="${col}" stroke-width="2"/>`;
    if (overlay && overlay.length === n) {
      const omin = Math.min(...overlay), omax = Math.max(...overlay), org = (omax - omin) || 1;
      const oy = v => PT + (1 - (v - omin) / org) * (H - PT - PB);
      const op = overlay.map((v, i) => `${(i * dx).toFixed(1)},${oy(v).toFixed(1)}`);
      s += `<path d="M${op.join(' L')}" fill="none" stroke="rgba(127,127,127,.55)" stroke-width="1.3" stroke-dasharray="4,3"/>`;
    }
    s += `</svg>`;
    return s;
  }

  /* ── Heatmap palette (verbatim from liquidity_watcher.js) ─ */
  function _heatRgba(t, alpha) {
    if (t < 0.12) return `rgba(70,10,120,${((0.35 + t * 3) * alpha).toFixed(2)})`;
    if (t < 0.28) return `rgba(0,90,180,${((0.50 + t * 1.5) * alpha).toFixed(2)})`;
    if (t < 0.48) return `rgba(0,190,200,${((0.60 + t) * alpha).toFixed(2)})`;
    if (t < 0.68) return `rgba(0,230,100,${((0.68 + t * 0.5) * alpha).toFixed(2)})`;
    if (t < 0.85) return `rgba(160,255,0,${((0.75 + t * 0.3) * alpha).toFixed(2)})`;
    return `rgba(255,245,0,${((0.85 + t * 0.15) * alpha).toFixed(2)})`;
  }

  /* ── Coinglass proxy (fund API — same pattern as fund.js) ─ */
  function _fundBase() {
    return ['localhost', '127.0.0.1'].includes(location.hostname)
      ? 'http://127.0.0.1:8767' : location.origin;
  }

  async function _cgFetch(resource, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const url = `${_fundBase()}/api/coinglass/${resource}${qs ? '?' + qs : ''}`;
    try {
      const r    = await fetch(url, { cache: 'no-store', signal: _sig(12000) });
      const body = await r.json().catch(() => null);
      return { status: r.status, ok: r.ok, body };
    } catch(e) { return { status: 0, ok: false, body: null }; }
  }
  function _cgRows(resp) {
    const d = resp && resp.data;
    if (Array.isArray(d)) return d;
    if (d && Array.isArray(d.list)) return d.list;
    if (d && typeof d === 'object') return [d];
    return [];
  }

  /* ══════════════════════════════════════════════════════
     CVD — aggTrade WS bins trades into TF-width candles
  ══════════════════════════════════════════════════════ */
  function _bucketTs(now) { return Math.floor(now / _cvdBucketMs) * _cvdBucketMs; }

  function _onTrade(price, qty, takerIsSeller) {
    if (!(price > 0) || !(qty > 0)) return;
    const t = _bucketTs(Date.now());
    const usd = price * qty;
    let b = _cvdBuckets[_cvdBuckets.length - 1];
    if (!b || b.t !== t) {
      b = { t, buy: 0, sell: 0 };
      _cvdBuckets.push(b);
      if (_cvdBuckets.length > _cvdMax + 2) _cvdBuckets.shift();
    }
    if (takerIsSeller) b.sell += usd; else b.buy += usd;
  }

  function _connectWS() {
    if (!_alive()) return;
    _status = 'connecting';
    const p = pairOf(_sym).toLowerCase();
    let ws;
    try { ws = new WebSocket(`wss://stream.binance.com:9443/ws/${p}@aggTrade`); }
    catch(e) { _onWsFail(); return; }
    _ws = ws;
    ws.onopen  = () => { _reconDelay = 1000; _status = 'live'; _lastMsg = Date.now(); };
    ws.onmessage = ev => {
      _lastMsg = Date.now(); _status = 'live';
      let d; try { d = JSON.parse(ev.data); } catch { return; }
      _onTrade(+d.p, +d.q, d.m);
    };
    ws.onerror = () => {};
    ws.onclose = () => { if (_ws === ws) _onWsFail(); };
  }
  function _onWsFail() {
    _ws = null; _status = 'reconnecting';
    if (_reconTimer) clearTimeout(_reconTimer);
    _reconTimer = setTimeout(() => { if (_alive()) _connectWS(); }, _reconDelay);
    _reconDelay = Math.min(_reconDelay * 1.7, 15000);
  }

  /* ══════════════════════════════════════════════════════
     WALLS — REST snapshot every 30s, show ≥10 min only
  ══════════════════════════════════════════════════════ */
  async function _snapBook() {
    if (!_alive()) return;
    const pair = pairOf(_sym);
    try {
      const r = await fetch(`https://api.binance.com/api/v3/depth?symbol=${pair}&limit=200`,
        { cache: 'no-store', signal: _sig(8000) });
      if (!r.ok) return;
      const snap = await r.json();
      if (!snap || !snap.bids || !snap.asks) return;

      const topBid = snap.bids[0] ? +snap.bids[0][0] : 0;
      const topAsk = snap.asks[0] ? +snap.asks[0][0] : 0;
      const mid = topBid && topAsk ? (topBid + topAsk) / 2 : topBid || topAsk;
      if (!mid) return;
      _lastSnapMid = mid;

      const lo = mid * 0.98, hi = mid * 1.02;
      let bidTot = 0, askTot = 0;
      snap.bids.forEach(([p, q]) => { if (+p >= lo) bidTot += +p * +q; });
      snap.asks.forEach(([p, q]) => { if (+p <= hi) askTot += +p * +q; });

      const now = Date.now(), step = mid * 0.001, activeKeys = new Set();
      const checkSide = (rows, side, tot) => {
        if (tot <= 0) return;
        rows.forEach(([p, q]) => {
          const px = +p, qty = +q;
          if (side === 'bid' && px < lo) return;
          if (side === 'ask' && px > hi) return;
          const usd = px * qty;
          if (usd / tot < WALL_SHARE) return;
          const key = Math.round(px / step) * step;
          activeKeys.add(key);
          const ex = _wallTracker.get(key);
          if (ex) { ex.lastSeen = now; ex.usd = usd; }
          else _wallTracker.set(key, { firstSeen: now, lastSeen: now, usd, side, price: px });
        });
      };
      checkSide(snap.bids, 'bid', bidTot);
      checkSide(snap.asks, 'ask', askTot);

      // Prune stale (absent for >3 snapshots)
      const staleMs = SNAP_INT_MS * 3;
      for (const [key, w] of _wallTracker)
        if (!activeKeys.has(key) && now - w.lastSeen > staleMs) _wallTracker.delete(key);

      // Build the visual depth profile: top levels each side within ±2%.
      // Always populated (not gated on 10 min) — persistence shows as an age badge.
      const ageOf = px => {
        const key = Math.round(px / step) * step, w = _wallTracker.get(key);
        return w ? Math.round((now - w.firstSeen) / 60000) : 0;
      };
      const topLevels = (rows, side) => {
        const lvls = [];
        rows.forEach(([p, q]) => {
          const px = +p;
          if (side === 'bid' && px < lo) return;
          if (side === 'ask' && px > hi) return;
          lvls.push({ price: px, usd: px * +q, side, age: ageOf(px) });
        });
        return lvls.sort((a, b) => b.usd - a.usd).slice(0, 6);
      };
      _depthLevels = {
        mid,
        bids: topLevels(snap.bids, 'bid').sort((a, b) => b.price - a.price),
        asks: topLevels(snap.asks, 'ask').sort((a, b) => b.price - a.price),
        bidTot, askTot,
      };
    } catch(e) {}
  }

  /* ══════════════════════════════════════════════════════
     FUNDING / OI — Bybit REST, 60s poll
  ══════════════════════════════════════════════════════ */
  async function _pollFunding() {
    if (!_alive()) return;
    try {
      const r = await fetch(
        `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${pairOf(_sym)}`,
        { signal: _sig(8000) });
      const j = await r.json();
      const t = j && j.result && j.result.list && j.result.list[0];
      if (!t) return;
      _fundingData = { rate: parseFloat(t.fundingRate || 0), oi: parseFloat(t.openInterestValue || 0), price: parseFloat(t.lastPrice || 0) };
    } catch(e) {}
  }

  /* ══════════════════════════════════════════════════════
     FUNDING HISTORY — Bybit 8h, paginated to the panel's window
     (limit caps at 200/call, so 60d/90d need a 2nd page back)
  ══════════════════════════════════════════════════════ */
  async function _loadFunding() {
    if (!_alive()) return;
    const sym = _sym, pair = pairOf(sym), need = FUND_PTS[_pwin.funding] || 90;
    let all = [], endTime;
    try {
      for (let page = 0; all.length < need && page < 3; page++) {
        let url = `https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${pair}&limit=200`;
        if (endTime) url += `&endTime=${endTime}`;
        const r = await fetch(url, { signal: _sig(8000) });
        const j = await r.json();
        const list = (j && j.result && j.result.list) || [];
        if (!list.length) break;
        all = all.concat(list);
        const oldest = Math.min(...list.map(x => +x.fundingRateTimestamp));
        endTime = oldest - 1;
        if (list.length < 200) break;
      }
      const hist = all.map(x => ({ t: +x.fundingRateTimestamp, rate: +x.fundingRate }))
        .sort((a, b) => a.t - b.t).slice(-need);
      if (sym === _sym && _alive()) { _fundHist = hist; _paintFunding(); }
    } catch(e) { _fundHist = null; }
  }

  /* ══════════════════════════════════════════════════════
     OI HISTORY — Bybit OI (base coin) × price → USD, per window
  ══════════════════════════════════════════════════════ */
  async function _loadOIData() {
    if (!_alive()) return;
    const sym = _sym, pair = pairOf(sym), cfg = WIN_CFG[_pwin.oi] || WIN_CFG['30d'];

    // Price klines — for OI USD scaling + divergence overlay
    try {
      const r = await fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${pair}&interval=${cfg.kIv}&limit=${cfg.count}`, { signal: _sig(8000) });
      const j = await r.json();
      const list = (j && j.result && j.result.list) || [];
      _oiPxHist = list.map(c => ({ t: +c[0], close: +c[4] })).reverse();
    } catch(e) { _oiPxHist = null; }

    // OI history (base-coin units → ×price = USD)
    try {
      const r = await fetch(`https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${pair}&intervalTime=${cfg.oiIv}&limit=${cfg.count}`, { signal: _sig(8000) });
      const j = await r.json();
      const list = (j && j.result && j.result.list) || [];
      const pxAt = ts => {
        if (!_oiPxHist || !_oiPxHist.length) return _fundingData ? _fundingData.price : 1;
        let best = _oiPxHist[0]; for (const p of _oiPxHist) if (Math.abs(p.t - ts) < Math.abs(best.t - ts)) best = p;
        return best.close;
      };
      const hist = list.map(x => ({ t: +x.timestamp, oiUsd: +x.openInterest * pxAt(+x.timestamp) })).reverse();
      if (sym === _sym && _alive()) { _oiHist = hist; _paintOI(); }
    } catch(e) { _oiHist = null; }
  }

  /* ══════════════════════════════════════════════════════
     CVD SEED — fill bars from historical klines immediately
     Binance klines carry taker-buy quote volume per candle, so
     we get real signed delta bars without waiting for live trades.
  ══════════════════════════════════════════════════════ */
  async function _seedCVD() {
    if (!_alive()) return;
    const pair = pairOf(_sym), cfg = WIN_CFG[_pwin.cvd] || WIN_CFG['30d'];
    _cvdBucketMs = cfg.ms; _cvdMax = cfg.count;
    try {
      const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${cfg.binIv}&limit=${cfg.count}`, { signal: _sig(8000) });
      const kl = await r.json();
      if (Array.isArray(kl) && kl.length) {
        // [openTime, o,h,l,c, vol, closeTime, quoteVol, trades, takerBuyBase, takerBuyQuote, ...]
        _cvdBuckets = kl.map(c => {
          const quoteVol = +c[7], takerBuyQuote = +c[10];
          return { t: +c[0], buy: takerBuyQuote, sell: Math.max(quoteVol - takerBuyQuote, 0) };
        });
        _paintCVDBars();
      }
    } catch(e) {}
  }

  /* ══════════════════════════════════════════════════════
     LIQ HEATMAP — fallback: Coinglass proxy → LW → placeholder
     _paintLiqHeatmap logic ported verbatim from liquidity_watcher.js
  ══════════════════════════════════════════════════════ */
  const _LIQ_WIN_CFG = {
    '7d':  { interval: '240', limit: 42,  okxBar: '4H' },
    '30d': { interval: 'D',   limit: 30,  okxBar: '1D' },
    '60d': { interval: 'D',   limit: 60,  okxBar: '1D' },
    '90d': { interval: 'D',   limit: 90,  okxBar: '1D' },
  };

  async function _fetchKlinesLiq(asset, win) {
    const key = asset + '-' + win;
    if (_liqKlinesKey === key && _liqKlines) return _liqKlines;
    const cfg = _LIQ_WIN_CFG[win] || _LIQ_WIN_CFG['30d'];
    const sym = asset + 'USDT';
    try {
      const r = await fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}&interval=${cfg.interval}&limit=${cfg.limit}`, { signal: _sig(6000) });
      const j = await r.json();
      if (j.result && j.result.list && j.result.list.length) {
        _liqKlines = j.result.list.reverse().map(c => ({ o:+c[1], h:+c[2], l:+c[3], c:+c[4] }));
        _liqKlinesKey = key; return _liqKlines;
      }
    } catch(e) {}
    try {
      const r = await fetch(`https://www.okx.com/api/v5/market/candles?instId=${sym}-SWAP&bar=${cfg.okxBar}&limit=${cfg.limit}`, { signal: _sig(6000) });
      const j = await r.json();
      if (j.data && j.data.length) {
        _liqKlines = j.data.reverse().map(c => ({ o:+c[1], h:+c[2], l:+c[3], c:+c[4] }));
        _liqKlinesKey = key; return _liqKlines;
      }
    } catch(e) {}
    return null;
  }

  async function _loadLiq() {
    if (_liqInFlight) return;
    _liqInFlight = true;
    const asset = _sym, win = _pwin.liq;

    // 1 — try Coinglass proxy (when key is set)
    if (!_cgNoKey) {
      const r = await _cgFetch('liqmap', { symbol: asset });
      if (r.status === 503 && r.body && r.body.needs_key) { _cgNoKey = true; }
      else if (r.ok && r.body && r.body.data) {
        const d = r.body.data;
        _liqData = (d && d.above && d.below) ? { ...d, asset, source: 'coinglass' }
          : { asset, source: 'coinglass', above: [], below: [], current_price: null, note: 'Confirming field shape from live response…' };
        _liqKlines = await _fetchKlinesLiq(asset, win);
        _liqInFlight = false; _paintLiqHeatmap(); return;
      }
    }

    // 2 — try LW estimated model
    try {
      const tf = win === '7d' ? '4h' : 'D';
      const r = await fetch(`${_lwBase()}/api/asset/${asset}/liquidations?tf=${tf}&window=${win}`,
        { mode: 'cors', cache: 'no-store', signal: _sig(8000) });
      if (r.ok) {
        _liqData = await r.json();
        _liqKlines = await _fetchKlinesLiq(asset, win);
        _liqInFlight = false; _paintLiqHeatmap(); return;
      }
    } catch(e) {}

    // 3 — no data available
    _liqData = null; _liqInFlight = false; _paintLiqHeatmap();
  }

  function _paintLiqHeatmap() {
    const chartEl = document.getElementById('ob-liq-chart');
    const srcEl   = document.getElementById('ob-liq-src');
    const totAEl  = document.getElementById('ob-liq-above');
    const totBEl  = document.getElementById('ob-liq-below');
    if (!chartEl) return;

    if (!_liqData) {
      chartEl.innerHTML = `<div class="ob-liq-ph">
        <div class="ob-liq-ph-icon">🌡️</div>
        <div class="ob-liq-ph-title">Liquidation Heatmap</div>
        <div class="ob-liq-ph-body">Start the <strong>Liquidity Watcher</strong> locally (<code>cd "_CLAUDE PROJECTS/Crypto Liquidity Watcher" && python3 server.py</code>) to see estimated liquidation levels here — or add your <strong>Coinglass API key</strong> for live cross-exchange data.</div>
      </div>`;
      return;
    }

    const data    = _liqData, klines = _liqKlines;
    const above   = data.above || [], below = data.below || [];
    const all     = [...above, ...below];
    const current = data.current_price;
    const live    = (data.source || 'estimated') === 'coinglass';

    if (srcEl) {
      srcEl.textContent = live ? 'live' : 'estimated';
      Object.assign(srcEl.style, {
        background: live ? 'rgba(34,197,94,.16)' : 'rgba(234,179,8,.16)',
        color:      live ? '#22c55e' : '#b8860b',
        border:     '1px solid ' + (live ? 'rgba(34,197,94,.4)' : 'rgba(234,179,8,.45)'),
      });
    }
    if (totAEl) totAEl.textContent = _fmtM(data.total_above || 0);
    if (totBEl) totBEl.textContent = _fmtM(data.total_below || 0);

    if (!all.length || !current) {
      chartEl.innerHTML = `<div style="padding:60px 0;text-align:center;color:var(--muted);font-size:13px">Warming up — zones appear within ~1 min</div>`;
      return;
    }

    const maxUsd = Math.max(...all.map(r => r.liq_usd), 1);
    const W = chartEl.clientWidth || 860;
    const H = 480, PL = 92, PR = 96, PT = 22, PB = 22;
    const cW = W - PL - PR, cH = H - PT - PB;
    const BH = 5, GLOW = 10;

    let pyBand, pyPrice, cy;
    if (klines && klines.length) {
      const rMin = Math.min(...all.map(r => r.price), ...klines.map(k => k.l), current);
      const rMax = Math.max(...all.map(r => r.price), ...klines.map(k => k.h), current);
      const pad  = (rMax - rMin) * 0.04;
      const minP = rMin - pad, maxP = rMax + pad, pR = maxP - minP;
      pyPrice = p => PT + (1 - (p - minP) / pR) * cH;
      pyBand  = r => pyPrice(r.price);
      cy      = pyPrice(current);
    } else {
      const midY = H / 2;
      const maxA = above.length ? Math.max(...above.map(r => r.price)) : current * 1.15;
      const minB = below.length ? Math.min(...below.map(r => r.price)) : current * 0.85;
      const abSet = new Set(above);
      pyBand  = r => abSet.has(r)
        ? midY - ((r.price - current) / (maxA - current)) * (midY - PT - 10)
        : midY + ((current - r.price) / (current - minB)) * (H - PB - midY - 10);
      pyPrice = p => p >= current
        ? midY - ((p - current) / (maxA - current)) * (midY - PT - 10)
        : midY + ((current - p) / (current - minB)) * (H - PB - midY - 10);
      cy = midY;
    }

    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="display:block">`;
    s += `<rect width="${W}" height="${H}" fill="#080612" rx="8"/>`;
    s += `<rect x="${PL}" y="${PT}" width="${cW}" height="${cH}" fill="#0c0a1a"/>`;
    s += `<rect x="${PL}" y="${PT}" width="${cW}" height="${Math.max(0, cy - PT)}" fill="rgba(34,197,94,0.04)"/>`;
    s += `<rect x="${PL}" y="${cy}" width="${cW}" height="${Math.max(0, PT + cH - cy)}" fill="rgba(239,68,68,0.04)"/>`;
    for (let i = 1; i < 5; i++) {
      const gy = PT + (cH / 5) * i;
      s += `<line x1="${PL}" y1="${gy.toFixed(1)}" x2="${PL + cW}" y2="${gy.toFixed(1)}" stroke="#16161e" stroke-width="1"/>`;
    }

    const nk = klines ? klines.length : 0, cuW = nk > 0 ? cW / nk : cW;
    for (const r of all) {
      const y = pyBand(r), t = r.liq_usd / maxUsd;
      let startX = PL;
      if (nk > 0) for (let i = nk - 1; i >= 0; i--)
        if (klines[i].l <= r.price && r.price <= klines[i].h) { startX = PL + i * cuW; break; }
      const bw = PL + cW - startX;
      if (t > 0.12) s += `<rect x="${startX.toFixed(1)}" y="${(y-GLOW/2).toFixed(1)}" width="${bw.toFixed(1)}" height="${GLOW}" fill="${_heatRgba(t,0.18)}" rx="3"/>`;
      if (t > 0.30) s += `<rect x="${startX.toFixed(1)}" y="${(y-BH*1.5).toFixed(1)}" width="${bw.toFixed(1)}" height="${(BH*3).toFixed(1)}" fill="${_heatRgba(t,0.30)}" rx="1"/>`;
      const bh = BH + t * 3;
      s += `<rect x="${startX.toFixed(1)}" y="${(y-bh/2).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${_heatRgba(t,1)}" rx="1"/>`;
      if (t > 0.50) s += `<rect x="${startX.toFixed(1)}" y="${(y-0.5).toFixed(1)}" width="${bw.toFixed(1)}" height="1.5" fill="rgba(255,250,100,0.75)" rx="1"/>`;
    }
    if (klines && klines.length) {
      const n = klines.length, cw2 = cW / n, bHW = Math.max(cw2 * 0.38, 1.5);
      for (let i = 0; i < n; i++) {
        const k = klines[i], xc = PL + (i + 0.5) * cw2;
        const yH = pyPrice(k.h), yL = pyPrice(k.l), yO = pyPrice(k.o), yC = pyPrice(k.c);
        const bull = k.c >= k.o, col = bull ? 'rgba(52,211,153,0.85)' : 'rgba(248,113,113,0.85)';
        s += `<line x1="${xc.toFixed(1)}" y1="${yH.toFixed(1)}" x2="${xc.toFixed(1)}" y2="${yL.toFixed(1)}" stroke="${col}" stroke-width="1" opacity="0.55"/>`;
        s += `<rect x="${(xc-bHW).toFixed(1)}" y="${Math.min(yO,yC).toFixed(1)}" width="${(bHW*2).toFixed(1)}" height="${Math.max(Math.abs(yC-yO),1.5).toFixed(1)}" fill="${col}" rx="1"/>`;
      }
    }
    s += `<line x1="${PL-8}" y1="${cy.toFixed(1)}" x2="${PL+cW}" y2="${cy.toFixed(1)}" stroke="rgba(255,255,255,0.85)" stroke-width="1.5" stroke-dasharray="6,4"/>`;
    s += `<circle cx="${PL-2}" cy="${cy.toFixed(1)}" r="3.5" fill="#fff" opacity="0.9"/>`;
    const usedY = new Set();
    const yFree = y => { for (const uy of usedY) if (Math.abs(uy - y) < 20) return false; return true; };
    [...all].sort((a, b) => b.liq_usd - a.liq_usd).forEach(r => {
      const y = pyBand(r);
      if (Math.abs(y - cy) < 14 || !yFree(y)) return;
      usedY.add(y);
      const col = r.price > current ? 'rgba(110,230,150,0.95)' : 'rgba(248,120,100,0.95)';
      s += `<text x="${PL-6}" y="${(y+4).toFixed(1)}" fill="rgba(190,200,220,0.85)" font-size="11" font-weight="600" text-anchor="end" font-family="monospace">${_fmtPx(r.price)}</text>`;
      s += `<text x="${PL+cW+6}" y="${(y+5).toFixed(1)}" fill="${col}" font-size="13" font-weight="700" font-family="monospace">${_fmtM(r.liq_usd)}</text>`;
    });
    s += `<text x="${PL+cW+6}" y="${(cy+5).toFixed(1)}" fill="#fff" font-size="13" font-weight="bold" font-family="monospace">${_fmtPx(current)}</text>`;
    s += `</svg>`;
    chartEl.innerHTML = s;
  }

  /* ══════════════════════════════════════════════════════
     PAINT — 10s cycle
  ══════════════════════════════════════════════════════ */
  function _paintAll() {
    if (!_alive()) { _cleanup(); return; }
    _paintStatus();
    _paintFunding();
    _paintOI();
    _paintCVDBars();
    _paintWalls();
    _paintConfluence();
  }

  function _paintStatus() {
    const el = document.getElementById('ob-ws-status'); if (!el) return;
    if (Date.now() - _lastMsg > 15000 && _status === 'live') _status = 'reconnecting';
    const map = { live: ['● live', 'var(--good)'], connecting: ['○ connecting…', 'var(--muted)'], reconnecting: ['◌ reconnecting…', 'var(--warn)'], idle: ['○ idle', 'var(--muted)'] };
    const [txt, col] = map[_status] || map.idle;
    el.innerHTML = `<span style="color:${col}">${txt}</span>`;
  }

  /* ══════════════════════════════════════════════════════
     SIGNAL EXTRACTION — pure classifiers (no DOM).
     Single source of truth: both the panels and the top
     Setup Confluence read these, so they can never disagree.
     dir: +1 bullish · −1 bearish · 0 neutral/mixed.
  ══════════════════════════════════════════════════════ */
  const _DIR = { bull: 1, bear: -1, warn: 0, flat: 0 };

  function _sigFunding() {
    if (!_fundingData && !_fundHist) return { ready:false, tone:'flat', lbl:'—', sub:'', dir:0 };
    const rate = _fundingData ? _fundingData.rate
      : (_fundHist && _fundHist.length ? _fundHist[_fundHist.length-1].rate : 0);
    let tone, lbl, sub;
    if      (rate >=  0.0003)  { tone='bear'; lbl='Crowded LONG';  sub='longs paying hard → flush risk'; }
    else if (rate >=  0.00005) { tone='warn'; lbl='Leaning long';  sub='mild long bias'; }
    else if (rate <= -0.0003)  { tone='bull'; lbl='Crowded SHORT'; sub='shorts paying hard → squeeze fuel'; }
    else if (rate <= -0.00005) { tone='bull'; lbl='Leaning short'; sub='mild short bias'; }
    else                       { tone='flat'; lbl='Neutral';       sub='no positioning bias'; }
    return { ready:true, tone, lbl, sub, rate, dir:_DIR[tone] };
  }

  function _sigOI() {
    if (!_oiHist || _oiHist.length < 4 || !_oiPxHist || _oiPxHist.length < 4)
      return { ready:false, tone:'flat', lbl:'—', sub:'', dir:0 };
    const oN = _oiHist.length, pN = _oiPxHist.length;
    const oiChg = (_oiHist[oN-1].oiUsd - _oiHist[oN-4].oiUsd) / (_oiHist[oN-4].oiUsd || 1);
    const pxChg = (_oiPxHist[pN-1].close - _oiPxHist[pN-4].close) / (_oiPxHist[pN-4].close || 1);
    const oiUp = oiChg > 0.01, oiDn = oiChg < -0.01, pxUp = pxChg > 0;
    let tone='flat', lbl='Flat', sub='no new money — range / chop';
    if      (oiUp && pxUp)  { tone='bull'; lbl='New longs';      sub='OI↑ price↑ — trend has fuel'; }
    else if (oiUp && !pxUp) { tone='bear'; lbl='New shorts';     sub='OI↑ price↓ — bearish conviction'; }
    else if (oiDn && pxUp)  { tone='warn'; lbl='Short covering'; sub='OI↓ price↑ — weak rally'; }
    else if (oiDn)          { tone='warn'; lbl='Longs bailing';  sub='OI↓ price↓ — selloff exhausting'; }
    return { ready:true, tone, lbl, sub, dir:_DIR[tone] };
  }

  function _sigCVD() {
    const bkts = _cvdBuckets.slice(-_cvdMax);
    if (bkts.length < 3) return { ready:false, tone:'flat', lbl:'—', sub:'', dir:0 };
    const deltas = bkts.map(b => b.buy - b.sell);
    const runCVD = deltas.reduce((a, d, i) => { a.push((a[i-1] || 0) + d); return a; }, []);
    const total  = runCVD[runCVD.length - 1];
    const recent = deltas.slice(-5).reduce((a, b) => a + b, 0);
    let tone, lbl, sub;
    if      (total > 0 && recent > 0) { tone='bull'; lbl='Buyers in control';  sub='net buying, momentum up'; }
    else if (total < 0 && recent < 0) { tone='bear'; lbl='Sellers in control'; sub='net selling, momentum down'; }
    else if (total > 0 && recent < 0) { tone='warn'; lbl='Buying fading';      sub='net buy but sellers stepping in'; }
    else if (total < 0 && recent > 0) { tone='warn'; lbl='Selling absorbed';   sub='net sell but buyers stepping in'; }
    else                              { tone='flat'; lbl='Balanced';           sub='no dominant aggressor — chop'; }
    return { ready:true, tone, lbl, sub, dir:_DIR[tone] };
  }

  function _sigWalls() {
    if (!_depthLevels || (!_depthLevels.bids.length && !_depthLevels.asks.length))
      return { ready:false, tone:'flat', lbl:'—', sub:'', dir:0 };
    const ratio = _depthLevels.bidTot / (_depthLevels.askTot || 1);
    let tone, lbl, sub;
    if      (ratio > 1.3)  { tone='bull'; lbl='Bids stacked';  sub='heavier support below — buyers defending'; }
    else if (ratio < 0.77) { tone='bear'; lbl='Asks stacked';  sub='heavier supply above — sellers capping'; }
    else                   { tone='flat'; lbl='Balanced book'; sub='no strong wall bias'; }
    return { ready:true, tone, lbl, sub, dir:_DIR[tone] };
  }

  /* ── Confluence: fold the 4 signals into an ICT setup call ── */
  function _confluence() {
    const parts = { funding:_sigFunding(), oi:_sigOI(), cvd:_sigCVD(), walls:_sigWalls() };
    const d = k => parts[k].dir;
    const bull = ['cvd','funding','oi','walls'].filter(k => parts[k].dir > 0);
    const bear = ['cvd','funding','oi','walls'].filter(k => parts[k].dir < 0);
    const ready = parts.funding.ready && (parts.cvd.ready || parts.oi.ready);

    let side='none', setup='No alignment', look='Signals are mixed — stand aside until at least 3 line up in one direction.', aligned=[];

    if (d('cvd') < 0 && d('funding') < 0 && (d('oi') < 0 || d('walls') < 0)) {
      side='short'; setup='Liquidity Sweep → Short';
      look='Longs are crowded and taker flow is selling. Look for a sweep of a recent high (BSL) then a bearish displacement / CISD to short — the trapped longs are the fuel.';
      aligned = ['cvd','funding', ...(d('oi')<0?['oi']:[]), ...(d('walls')<0?['walls']:[])];
    } else if (d('cvd') > 0 && d('funding') > 0 && (d('oi') > 0 || d('walls') > 0)) {
      side='long'; setup='Liquidity Sweep → Long';
      look='Shorts are crowded and taker flow is buying. Look for a sweep of a recent low (SSL) into bid support then a bullish reclaim / CISD to long — short covering is the fuel.';
      aligned = ['cvd','funding', ...(d('oi')>0?['oi']:[]), ...(d('walls')>0?['walls']:[])];
    } else if (d('oi') > 0 && parts.cvd.tone === 'flat') {
      side='wait'; setup='Distribution — wait';
      look='Open interest is building but taker flow is flat: new money with no clear aggressor. Let CVD pick a side before committing.';
      aligned = ['oi'];
    } else if (d('walls') !== 0 && Math.sign(d('walls')) === Math.sign(d('cvd')) && d('funding') === 0) {
      side = d('walls') > 0 ? 'long' : 'short'; setup='Wall reaction';
      look = (d('walls')>0
        ? 'Bids are stacked and flow is buying with neutral funding — the wall should hold. Look for price to test the bid wall and reject up.'
        : 'Asks are stacked and flow is selling with neutral funding — the wall should cap. Look for price to test the ask wall and reject down.');
      aligned = ['walls','cvd'];
    } else if (bull.length >= 3) {
      side='long'; setup='Lean long'; aligned = bull;
      look=`${bull.length}/4 signals lean bullish — a developing long bias, but no clean sweep trigger yet. Wait for a discount sweep to time entry.`;
    } else if (bear.length >= 3) {
      side='short'; setup='Lean short'; aligned = bear;
      look=`${bear.length}/4 signals lean bearish — a developing short bias, but no clean sweep trigger yet. Wait for a premium sweep to time entry.`;
    }
    return { ready, parts, side, setup, look, aligned, bull, bear, conf: aligned.length };
  }

  // A stable fingerprint of a confluence call — changes only when the
  // *meaning* changes, not when underlying numbers jitter within a state.
  function _cfSig(cf) {
    return cf ? cf.setup + '|' + cf.side + '|' + cf.aligned.slice().sort().join(',') : '';
  }

  function _setSteady(mode) {
    if (!STEADY_CYCLES[mode] || mode === _steady) return;
    _steady = mode;
    localStorage.setItem(LS_STEADY, mode);
    _cfCommitted = null; _cfPending = null; _cfPendingN = 0; _cfRenderSig = null;
    _paintConfluence();
  }

  function _paintConfluence() {
    const el = document.getElementById('ob-confluence'); if (!el) return;
    const raw  = _confluence();
    const need = STEADY_CYCLES[_steady] || 3;

    // ── Sticky confirm buffer: a new call must hold `need` cycles before it
    //    replaces the committed one. Kills threshold-chatter flicker. ──
    if (!_cfCommitted) {
      _cfCommitted = raw; _cfPending = null; _cfPendingN = 0;
    } else if (_cfSig(raw) === _cfSig(_cfCommitted)) {
      _cfPending = null; _cfPendingN = 0;                 // back to current → cancel pending
    } else if (_cfPending && _cfSig(raw) === _cfSig(_cfPending)) {
      _cfPendingN++;                                       // candidate persisting
      if (_cfPendingN >= need) { _cfCommitted = raw; _cfPending = null; _cfPendingN = 0; }
    } else {
      _cfPending = raw; _cfPendingN = 1;                  // new candidate
    }
    const cf = _cfCommitted;

    // Glow is idempotent + cheap — always reflect the committed call.
    const glow = cf.side === 'short' ? 'ob-aligned-bear' : 'ob-aligned-bull';
    ['funding','oi','cvd','walls'].forEach(k => {
      const card = document.getElementById('ob-card-' + k); if (!card) return;
      card.classList.remove('ob-aligned-bull', 'ob-aligned-bear');
      if ((cf.side === 'long' || cf.side === 'short') && cf.aligned.includes(k)) card.classList.add(glow);
    });

    // ── Render-on-change: skip the DOM rewrite entirely when nothing the eye
    //    would notice has changed (committed call + steadiness unchanged). ──
    const renderSig = _cfSig(cf) + '|' + _steady;
    if (renderSig === _cfRenderSig) return;
    _cfRenderSig = renderSig;

    const col = cf.side==='long'?C_BULL : cf.side==='short'?C_BEAR : cf.side==='wait'?C_WARN : C_FLAT;
    const badge = cf.side==='long'?'LONG setup' : cf.side==='short'?'SHORT setup' : cf.side==='wait'?'WAIT' : 'NO SETUP';
    const chip = (k, label) => {
      const p = cf.parts[k], on = cf.aligned.includes(k);
      const c = p.dir>0?C_BULL : p.dir<0?C_BEAR : C_FLAT;
      const arrow = p.dir>0?'▲' : p.dir<0?'▼' : '•';
      return `<div class="ob-cf-chip${on?' on':''}" ${on?`style="border-color:${col}"`:''}>
        <span class="ob-cf-chip-k">${label}</span>
        <span class="ob-cf-chip-v" style="color:${c}">${arrow} ${esc(p.ready?p.lbl:'—')}</span></div>`;
    };
    const steadyPills = Object.keys(STEADY_CYCLES).map(m =>
      `<button class="ob-steady-pill${m === _steady ? ' active' : ''}" data-steady="${m}" title="confirm over ${STEADY_CYCLES[m]*10}s">${STEADY_LABELS[m]}</button>`
    ).join('');
    el.innerHTML = `
      <div class="ob-cf-head">
        <div class="ob-cf-title">🎯 Setup Confluence <span class="ob-plain">(what the 4 signals add up to)</span></div>
        <div class="ob-cf-badge" style="background:${col}1a;border-color:${col};color:${col}">${badge} · ${cf.conf}/4</div>
      </div>
      <div class="ob-cf-setup" style="color:${col}">${esc(cf.setup)}</div>
      <div class="ob-cf-look">${esc(cf.look)}</div>
      <div class="ob-cf-chips">${chip('cvd','CVD')}${chip('funding','Funding')}${chip('oi','OI')}${chip('walls','Walls')}</div>
      <div class="ob-cf-foot">
        <span class="ob-cf-steady-lbl">Steadiness</span>
        <div class="ob-steady-row">${steadyPills}</div>
        <span class="ob-cf-steady-hint">holds a new call ${STEADY_CYCLES[_steady]*10}s before switching</span>
      </div>`;
  }

  /* ── Bottom Setup Playbook (static reference) ── */
  function _setupGuideHTML() {
    const rows = [
      ['📉','Sweep → Short','CVD selling + funding crowded-long + OI new-shorts (or asks stacked)','Trapped longs. Sweep a recent high, then short the bearish displacement.'],
      ['📈','Sweep → Long','CVD buying + funding crowded-short + OI new-longs (or bids stacked)','Short-squeeze fuel. Sweep a recent low into bids, then long the reclaim.'],
      ['⏳','Distribution — wait','OI rising while CVD stays flat','New money, no aggressor. Let CVD pick a side before committing.'],
      ['🧱','Wall reaction','A stacked wall + CVD pushing the same way + funding neutral','Fade into the wall — it should hold and reject.'],
    ];
    return `<div class="ob-card ob-setup-guide">
      <div class="ob-card-h">🧭 Setup Playbook <span class="ob-plain">(how the signals combine)</span></div>
      <div class="ob-sg-rows">${rows.map(r => `
        <div class="ob-sg-row"><div class="ob-sg-ico">${r[0]}</div>
          <div class="ob-sg-body"><div class="ob-sg-name">${esc(r[1])}</div>
            <div class="ob-sg-when"><b>When:</b> ${esc(r[2])}</div>
            <div class="ob-sg-do"><b>Look for:</b> ${esc(r[3])}</div></div></div>`).join('')}
      </div>
      <div class="ob-sg-foot">Live read-helper — not an auto-trade signal. Confirm the sweep + entry on your chart. Walls are live-only; historical wall data is being recorded on the server for a future backtest.</div>
    </div>`;
  }

  function _paintFunding() {
    const el = document.getElementById('ob-fund'); if (!el) return;
    if (!_fundingData && !_fundHist) { el.innerHTML = `<div class="ob-fund-loading">Loading…</div>`; return; }
    const rate = _fundingData ? _fundingData.rate : (_fundHist && _fundHist.length ? _fundHist[_fundHist.length-1].rate : 0);

    const { tone, lbl, sub } = _sigFunding();

    const wl = WIN_LABELS[_pwin.funding] || '30D';
    let chart = `<div class="ob-fund-loading">Loading ${wl} history…</div>`, stat = '';
    if (_fundHist && _fundHist.length) {
      const vals   = _fundHist.map(x => x.rate);
      chart        = _svgSignedBars(vals, C_BEAR, C_BULL, vals.length - 1);
      const posPct = Math.round(vals.filter(v => v > 0).length / vals.length * 100);
      const avg    = vals.reduce((a, b) => a + b, 0) / vals.length;
      stat = `<div class="ob-vstat"><span>now <b style="color:${rate>=0?C_BEAR:C_BULL}">${rate>=0?'+':''}${(rate*100).toFixed(4)}%</b></span><span>${wl} avg ${(avg*100).toFixed(4)}%</span><span>${posPct}% of time longs paid</span></div>`;
    }
    el.innerHTML = `
      ${_verdict(tone, lbl, sub)}
      <div class="ob-vchart">${chart}</div>
      <div class="ob-vaxis"><span style="color:${C_BEAR}">▲ longs pay</span><span>← ${wl} →</span><span style="color:${C_BULL}">▼ shorts pay</span></div>
      ${stat}`;
  }

  function _paintOI() {
    const el = document.getElementById('ob-oi'); if (!el) return;
    if (!_fundingData && !_oiHist) { el.innerHTML = `<div class="ob-fund-loading">Loading…</div>`; return; }

    const { tone, lbl, sub } = _sigOI();

    const wl = WIN_LABELS[_pwin.oi] || '30D';
    let chart = `<div class="ob-fund-loading">Loading ${wl} history…</div>`, stat = '';
    if (_oiHist && _oiHist.length) {
      const vals = _oiHist.map(x => x.oiUsd);
      const px   = (_oiPxHist && _oiPxHist.length === vals.length) ? _oiPxHist.map(x => x.close) : null;
      chart      = _svgArea(vals, '#6c63ff', px);
      const cur  = _fundingData ? _fundingData.oi : vals[vals.length - 1];
      const chg  = (vals[vals.length - 1] - vals[0]) / (vals[0] || 1) * 100;
      stat = `<div class="ob-vstat"><span>now <b>${_fmtUsd(cur)}</b></span><span>${wl} ${chg>=0?'+':''}${chg.toFixed(1)}%</span><span>━ OI · ┄ price</span></div>`;
    }
    el.innerHTML = `
      ${_verdict(tone, lbl, sub)}
      <div class="ob-vchart">${chart}</div>
      <div class="ob-vaxis"><span>open interest (USD)</span><span>← ${wl} →</span></div>
      ${stat}`;
  }

  function _paintCVDBars() {
    const el = document.getElementById('ob-cvd'); if (!el) return;
    const barLbl = _pwin.cvd === '7d' ? '4h' : 'daily';
    const bkts = _cvdBuckets.slice(-_cvdMax);
    if (bkts.length < 3) {
      el.innerHTML = `<div class="ob-cvd-head"><span class="ob-ws-dot" id="ob-ws-status"></span></div><div class="ob-fund-loading">Loading ${esc(barLbl)} taker flow…</div>`;
      _paintStatus(); return;
    }
    const deltas  = bkts.map(b => b.buy - b.sell);
    const maxAbs  = Math.max(...deltas.map(Math.abs), 1);
    const runCVD  = deltas.reduce((a, d, i) => { a.push((a[i - 1] || 0) + d); return a; }, []);
    const cvdMin  = Math.min(...runCVD), cvdMax = Math.max(...runCVD, 1), cvdRng = (cvdMax - cvdMin) || 1;
    const total   = runCVD[runCVD.length - 1];

    const { tone, lbl, sub } = _sigCVD();

    const W = 600, H = 110, bSlot = W / bkts.length, bW = bSlot * 0.8, baseY = 92, lineTop = 12;
    let bars = '', linePts = '';
    bkts.forEach((b, i) => {
      const d = deltas[i], x = i * bSlot;
      const h = Math.max(1, Math.abs(d) / maxAbs * (baseY - lineTop - 4));
      bars += `<rect x="${x.toFixed(1)}" y="${(baseY - h).toFixed(1)}" width="${bW.toFixed(1)}" height="${h.toFixed(1)}" fill="${d >= 0 ? C_BULL : C_BEAR}" opacity="0.8" rx="1"/>`;
      const cv = runCVD[i], ly = lineTop + (1 - (cv - cvdMin) / cvdRng) * (baseY - lineTop - 4);
      const cx = x + bW / 2;
      linePts += (i === 0 ? `M${cx.toFixed(1)},${ly.toFixed(1)}` : ` L${cx.toFixed(1)},${ly.toFixed(1)}`);
    });

    el.innerHTML = `
      ${_verdict(tone, lbl, sub)}
      <div class="ob-cvd-head">
        <strong style="color:${total >= 0 ? C_BULL : C_BEAR}">${total >= 0 ? '+' : ''}${_fmtUsd(Math.abs(total))}</strong>
        <span class="ob-cvd-hint">${bkts.length} ${esc(barLbl)} bars · 🟩 buy / 🟥 sell · line = running total</span>
        <span class="ob-ws-dot" id="ob-ws-status"></span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" class="ob-cvd-svg" preserveAspectRatio="none">
        <line x1="0" y1="${baseY}" x2="${W}" y2="${baseY}" stroke="rgba(127,127,127,0.25)" stroke-width="1"/>
        ${bars}
        <path d="${linePts}" fill="none" stroke="rgba(80,80,95,0.7)" stroke-width="1.6"/>
      </svg>`;
    _paintStatus();
  }

  function _paintWalls() {
    const el = document.getElementById('ob-walls'); if (!el) return;
    if (!_depthLevels || (!_depthLevels.bids.length && !_depthLevels.asks.length)) {
      el.innerHTML = `<div class="ob-empty">Reading the order book…</div>`;
      return;
    }
    const { mid, bids, asks, bidTot, askTot } = _depthLevels;
    const maxUsd = Math.max(...[...bids, ...asks].map(l => l.usd), 1);

    const { tone, lbl, sub } = _sigWalls();

    const row = l => {
      const w    = Math.max(l.usd / maxUsd * 100, 4);
      const col  = l.side === 'bid' ? C_BULL : C_BEAR;
      const dist = ((l.price - mid) / mid) * 100;
      const held = l.age >= 10 ? `<span class="ob-dp-age held">✓ ${l.age}m</span>` : `<span class="ob-dp-age">new</span>`;
      return `<div class="ob-dp-row">
        <span class="ob-dp-px">${_fmtPx(l.price)}</span>
        <span class="ob-dp-dist" style="color:${col}">${dist>=0?'+':''}${dist.toFixed(2)}%</span>
        <span class="ob-dp-track"><span class="ob-dp-bar" style="width:${w.toFixed(0)}%;background:${col}"></span></span>
        <span class="ob-dp-usd">${_fmtUsd(l.usd)}</span>
        ${held}
      </div>`;
    };
    el.innerHTML = `
      ${_verdict(tone, lbl, sub)}
      <div class="ob-depth">
        ${asks.map(row).join('')}
        <div class="ob-dp-mid">▬ mid ${_fmtPx(mid)} ▬</div>
        ${bids.map(row).join('')}
      </div>`;
  }

  /* ══════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════ */
  function render() {
    const content = document.getElementById('content');
    if (!content) return;
    _cleanup();
    content.innerHTML = `
      <div id="ob-root" class="ob-wrap">
        ${_headHTML()}

        <!-- 0. SETUP CONFLUENCE — top, folds the 4 signals into a setup call -->
        <div id="ob-confluence" class="ob-card ob-cf-card"></div>

        <!-- 1. LIQUIDATION HEATMAP — full width -->
        <div class="ob-card">
          <div class="ob-card-h">
            🌡️ Liquidation Heatmap
            <span id="ob-liq-src" class="ob-liq-badge"></span>
            <span class="ob-sub">estimated positions at risk · yellow = largest cluster · not exchange-confirmed</span>
            <button class="ob-howto-btn" data-howto="liq">ℹ️ How to read</button>
          </div>
          ${_winPills('liq')}
          <div class="ob-liq-totals">
            <span class="ob-liq-tot-label">☝ Squeeze above</span><span id="ob-liq-above" class="ob-liq-tot-above">—</span>
            <span class="ob-liq-sep">·</span>
            <span class="ob-liq-tot-label">👇 Flush below</span><span id="ob-liq-below" class="ob-liq-tot-below">—</span>
          </div>
          <div id="ob-liq-chart" class="ob-liq-chart"></div>
          ${_matrixHTML('liq')}
        </div>

        <!-- 2. FUNDING + OI — two columns -->
        <div class="ob-two-col">
          <div class="ob-card" id="ob-card-funding">
            <div class="ob-card-h">💰 Funding Rate <span class="ob-plain">(crowded longs or shorts)</span> <span class="ob-sub">Bybit 8h</span><button class="ob-howto-btn" data-howto="funding">ℹ️ How to read</button></div>
            ${_winPills('funding')}
            <div id="ob-fund" class="ob-fund-panel"></div>
            ${_matrixHTML('funding')}
          </div>
          <div class="ob-card" id="ob-card-oi">
            <div class="ob-card-h">📦 Open Interest <span class="ob-plain">(new conviction vs unwinding)</span> <span class="ob-sub">Bybit perp</span><button class="ob-howto-btn" data-howto="oi">ℹ️ How to read</button></div>
            ${_winPills('oi')}
            <div id="ob-oi" class="ob-fund-panel"></div>
            ${_matrixHTML('oi')}
          </div>
        </div>

        <!-- 3. CVD BARS -->
        <div class="ob-card" id="ob-card-cvd">
          <div class="ob-card-h">📈 CVD — Cumulative Volume Delta <span class="ob-plain">(order flow pressure)</span> <span class="ob-sub">Binance taker flow</span><button class="ob-howto-btn" data-howto="cvd">ℹ️ How to read</button></div>
          ${_winPills('cvd')}
          <div id="ob-cvd" class="ob-cvd-wrap"></div>
          ${_matrixHTML('cvd')}
        </div>

        <!-- 4. DEPTH / WALLS -->
        <div class="ob-card" id="ob-card-walls">
          <div class="ob-card-h">🧱 Order-Book Walls <span class="ob-plain">(where stops are clustered)</span> <span class="ob-sub">live depth ±2% · Binance spot · ✓ = held ≥10 min</span><button class="ob-howto-btn" data-howto="walls">ℹ️ How to read</button></div>
          <div id="ob-walls"></div>
          ${_matrixHTML('walls')}
        </div>

        <!-- 5. SETUP PLAYBOOK — how the signals combine -->
        ${_setupGuideHTML()}

        <!-- GUIDE (collapsed by default) -->
        ${_guideHTML()}
      </div>`;

    _wireEvents();
    _startAll();
  }

  function teardown() { _cleanup(); }

  function _startAll() {
    _resetState();
    _connectWS();
    _seedCVD();
    _snapBook();
    _pollFunding();
    _loadFunding();
    _loadOIData();
    _loadLiq();
    _paintAll();
    _snapTimer    = setInterval(_snapBook,    SNAP_INT_MS);
    _fundingTimer = setInterval(_pollFunding, FUND_INT_MS);
    _histTimer    = setInterval(() => { _loadFunding(); _loadOIData(); }, 600000);  // refresh history every 10 min
    _paintTimer   = setInterval(_paintAll,    PAINT_MS);
    _cgTimer      = setInterval(_cgPoll,      60000);
  }
  function _cleanup() {
    if (_ws) { try { _ws.onclose = null; _ws.close(); } catch(_) {} _ws = null; }
    [_paintTimer, _fundingTimer, _snapTimer, _histTimer, _reconTimer, _cgTimer].forEach(t => {
      if (t != null) { clearInterval(t); clearTimeout(t); }
    });
    _paintTimer = _fundingTimer = _snapTimer = _histTimer = _reconTimer = _cgTimer = null;
  }
  function _resetState() {
    _cvdBuckets = []; _wallTracker = new Map(); _lastSnapMid = null; _depthLevels = null;
    _liqData = null; _liqKlines = null; _liqKlinesKey = null; _liqInFlight = false;
    _fundingData = null;
    _fundHist = null; _oiHist = null; _oiPxHist = null; _histKey = null;
    const cc = WIN_CFG[_pwin.cvd] || WIN_CFG['30d'];
    _cvdBucketMs = cc.ms; _cvdMax = cc.count;
    _status = 'idle'; _lastMsg = 0; _reconDelay = 1000;
    _cgNoKey = false; _cgState = 'idle'; _cg = {};
    _cfCommitted = null; _cfPending = null; _cfPendingN = 0; _cfRenderSig = null;
  }

  // Per-panel window pill row (7D / 30D / 60D / 90D)
  function _winPills(panel) {
    return `<div class="ob-winrow">` + WIN_LIST.map(w =>
      `<button class="ob-win-pill${w === _pwin[panel] ? ' active' : ''}" data-panel="${panel}" data-win="${w}">${WIN_LABELS[w]}</button>`
    ).join('') + `</div>`;
  }

  function _headHTML() {
    const sym = SYMBOLS.map(s => `<button class="ob-pill${s === _sym ? ' active' : ''}" data-sym="${s}">${s}</button>`).join('');
    return `
      <div class="ob-head">
        <div>
          <div class="ob-title">📖 Level 2 — Swing Context</div>
          <div class="ob-tagline">Liquidation clusters · Funding · OI · CVD · Walls — pick a timeframe per panel</div>
        </div>
        <div class="ob-head-right">
          <div class="ob-pills">${sym}</div>
        </div>
      </div>`;
  }

  function _wireEvents() {
    document.querySelectorAll('#ob-root .ob-pill').forEach(b => b.addEventListener('click', () => _setSym(b.dataset.sym)));
    document.querySelectorAll('#ob-root .ob-win-pill').forEach(b => b.addEventListener('click', () => _setWin(b.dataset.panel, b.dataset.win)));
    document.querySelectorAll('#ob-root .ob-guide-h').forEach(h => h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed')));
    document.querySelectorAll('#ob-root .ob-howto-btn').forEach(b => b.addEventListener('click', () => _toggleHowto(b.dataset.howto)));
    // steadiness pills are re-rendered dynamically → delegate on the container
    const cfEl = document.getElementById('ob-confluence');
    if (cfEl) cfEl.addEventListener('click', e => {
      const p = e.target.closest('.ob-steady-pill');
      if (p) _setSteady(p.dataset.steady);
    });
  }
  function _toggleHowto(key) {
    const m = document.getElementById('ob-matrix-' + key);
    const btn = document.querySelector(`#ob-root .ob-howto-btn[data-howto="${key}"]`);
    if (!m) return;
    const opening = m.hasAttribute('hidden');
    if (opening) { m.removeAttribute('hidden'); btn && btn.classList.add('on'); }
    else { m.setAttribute('hidden', ''); btn && btn.classList.remove('on'); }
  }
  function _setSym(s) {
    if (!s || s === _sym) return;
    _sym = s.toUpperCase(); localStorage.setItem(LS_SYM, _sym);
    document.querySelectorAll('#ob-root .ob-pill').forEach(b => b.classList.toggle('active', b.dataset.sym === _sym));
    _cleanup(); _startAll();
  }
  function _setWin(panel, w) {
    if (!panel || !w || _pwin[panel] === w) return;
    _pwin[panel] = w; localStorage.setItem('ob_w_' + panel, w);
    document.querySelectorAll(`#ob-root .ob-win-pill[data-panel="${panel}"]`).forEach(b =>
      b.classList.toggle('active', b.dataset.win === w));
    if      (panel === 'funding') _loadFunding();
    else if (panel === 'oi')      _loadOIData();
    else if (panel === 'cvd')   { _cvdBuckets = []; _seedCVD(); }
    else if (panel === 'liq')   { _liqKlines = null; _liqKlinesKey = null; _liqInFlight = false; _loadLiq(); }
  }

  /* ── Coinglass 60s poll ────────────────────────────────── */
  async function _cgPoll() {
    if (!_alive() || _cgNoKey) return;
    const sym = _sym;
    const [f, o] = await Promise.all([_cgFetch('funding', {symbol:sym}), _cgFetch('oi', {symbol:sym})]);
    if (sym !== _sym || !_alive()) return;
    if ([f, o].some(r => r.status === 503 && r.body && r.body.needs_key)) { _cgNoKey = true; return; }
    if ([f, o].every(r => !r.ok)) { _cgState = 'error'; return; }
    _cg = { funding: f.body, oi: o.body }; _cgState = 'ok';
    // Field overlay into funding/OI panels will be added once live response shape is confirmed (Rule #2)
  }

  /* ══════════════════════════════════════════════════════
     PER-PANEL "HOW TO READ" MATRICES
     Inline cheat-sheet attached to each data point. Arrow-grid
     style like the classic Price/Volume/OI interpretation table.
  ══════════════════════════════════════════════════════ */
  const _UP   = '<span class="ob-m-up">▲ Rising</span>';
  const _DN   = '<span class="ob-m-dn">▼ Falling</span>';
  const _BULL = t => `<span class="ob-m-bull">${t}</span>`;
  const _BEAR = t => `<span class="ob-m-bear">${t}</span>`;
  const _WARN = t => `<span class="ob-m-warn">${t}</span>`;

  function _mtable(cols, rows) {
    const head = cols.map(c => `<th>${c}</th>`).join('');
    const body = rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    return `<table class="ob-mtable"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  function _matrixHTML(key) {
    let title = '', tbl = '';
    if (key === 'funding') {
      title = '💰 Reading the funding rate (who is paying whom)';
      tbl = _mtable(['Reading', 'What the crowd is doing', 'What it means for you'], [
        [_BULL('🟢🟢 ≤ −0.02%'), 'Shorts paying hard — heavily short',  _BULL('🚀 Squeeze fuel UP — any bounce forces shorts to cover')],
        [_BULL('🟢 −0.005 to −0.02%'), 'Shorts paying — net short',       'Mild upside lean'],
        ['⚪ −0.005 to +0.005%', 'Balanced — no crowd',                   'Organic move, no squeeze either way'],
        [_BEAR('🔴 +0.005 to +0.02%'), 'Longs paying — net long',         'Flush risk — mild downside lean'],
        [_BEAR('🔴🔴 ≥ +0.02%'), 'Longs paying hard — heavily long',      _BEAR('💥 Flush fuel DOWN — the crowd gets liquidated')],
      ]);
    } else if (key === 'oi') {
      title = '📦 Reading OI = Price + Open Interest together';
      tbl = _mtable(['Price', 'OI', 'What it means', 'Scenario'], [
        [_UP, _UP, 'New longs entering',     _BULL('🟢 Bullish — real conviction, trend has fuel')],
        [_UP, _DN, 'Short covering only',    _WARN('⚠️ Weak rally — up-move losing steam')],
        [_DN, _UP, 'New shorts entering',    _BEAR('🔴 Bearish — real conviction selling')],
        [_DN, _DN, 'Longs bailing out',      _WARN('⚠️ Weak selloff — downtrend exhausting')],
      ]);
    } else if (key === 'cvd') {
      title = '📈 Reading CVD = Price + taker flow together';
      tbl = _mtable(['Price', 'CVD bars', 'What it means', 'Scenario'], [
        [_UP, _BULL('🟢 Green'), 'Buyers driving the move',          _BULL('🟢 Bullish — confirmed buying')],
        [_UP, _BEAR('🔴 Red'),   'Sellers hitting, price still up',  _WARN('⚠️ Bull trap — divergence, fade it')],
        [_DN, _BEAR('🔴 Red'),   'Sellers driving the move',         _BEAR('🔴 Bearish — confirmed selling')],
        [_DN, _BULL('🟢 Green'), 'Buyers absorbing the dump',        _BULL('🟢 Absorption — reversal UP brewing')],
      ]);
    } else if (key === 'liq') {
      title = '🌡️ Reading the heatmap (clusters are price magnets)';
      tbl = _mtable(['Where the big cluster sits', 'What it means', 'Scenario'], [
        [_BEAR('🔴 Big cluster BELOW price'), 'Long stops stacked under price', _BULL('👇 Magnet down — expect a sweep then bounce. LONG the sweep, not before')],
        [_BULL('🟢 Big cluster ABOVE price'), 'Short stops stacked over price',  _BEAR('☝️ Magnet up — expect a sweep then reject. SHORT the sweep, not before')],
        ['⚖️ Equal both sides', 'No clear magnet',                              'Range — wait until one side gets swept'],
        [_WARN('🟡 Cluster on YOUR stop'), 'Your stop is the target',           _WARN('⚠️ Move it — high odds it gets hunted')],
      ]);
    } else if (key === 'walls') {
      title = '🧱 Reading persistent walls (real resting orders)';
      tbl = _mtable(['Wall', 'What it means', 'Scenario'], [
        [_BULL('🟢 Bid wall below price'), 'Real buyer defending the level', 'Support floor — long bias holds while it sits there'],
        [_BEAR('🔴 Ask wall above price'), 'Real seller capping the move',   'Resistance ceiling — short bias / take-profit zone'],
        [_BULL('🟢 Bid wall at your stop'), 'Genuine support behind your SL', _BULL('✅ Safer long — your stop has backing')],
        [_BEAR('🔴 Ask wall at your target'), 'Overhead supply at your TP',   _WARN('⚠️ Bank profit just before it')],
      ]);
    } else return '';
    return `<div class="ob-matrix" id="ob-matrix-${key}" hidden><div class="ob-matrix-title">${title}</div>${tbl}</div>`;
  }

  /* ══════════════════════════════════════════════════════
     GUIDE — collapsible, collapsed by default
  ══════════════════════════════════════════════════════ */
  function _guideHTML() {
    return `
    <div class="ob-card ob-guide collapsed">
      <div class="ob-guide-h">📚 How to read &amp; trade this tab <span class="ob-sub">click to expand</span></div>
      <div class="ob-guide-body">

        <p class="ob-guide-intro">This tab gives <strong>swing and intraday context</strong> for a setup you've already found with ICT tools — a validated OB, inside a killzone, Confluence ≥65. It does not find setups. It tells you whether the <em>market structure behind the price</em> supports or contradicts your thesis before you pull the trigger.</p>

        <div class="ob-guide-panels">
          <div class="ob-guide-prow"><span class="ob-gp-icon">🌡️</span><div><strong>Liq heatmap</strong> — shows where estimated liq clusters sit. <em>Flush zones</em> (below price, red tint) = long-squeeze targets. <em>Squeeze zones</em> (above price, green tint) = short-squeeze targets. These are price magnets — smart money often hunts the nearest cluster before reversing. Bright yellow = largest concentration. Your stop must not sit inside a dense cluster.</div></div>
          <div class="ob-guide-prow"><span class="ob-gp-icon">💰</span><div><strong>Funding rate</strong> — the 8h fee paid between longs and shorts on Bybit perps. <em>Positive</em> = longs paying → market crowded long → a flush becomes likely before any real up-move. <em>Negative</em> = shorts paying → squeeze fuel for upside. Near-zero = no strong positioning bias, moves will be organic.</div></div>
          <div class="ob-guide-prow"><span class="ob-gp-icon">📦</span><div><strong>Open Interest</strong> — total $ in all open perp positions. <em>OI + price both rising</em> = genuine new longs entering (real move). <em>OI rising + price falling</em> = new shorts entering (bearish conviction). <em>OI falling</em> = positions closing, often precedes compression or reversal. Flat OI in a range = chop.</div></div>
          <div class="ob-guide-prow"><span class="ob-gp-icon">📈</span><div><strong>CVD bars</strong> — Cumulative Volume Delta binned into your TF candles. Green bar = net taker buying that candle; red bar = net selling. The white line is the running CVD total. Multiple red bars while price holds a bid-side OB = sellers are aggressive but price won't move — that's <em>absorption</em>, a bullish sign. Multiple green bars while price falls = potential bull trap.</div></div>
          <div class="ob-guide-prow"><span class="ob-gp-icon">🧱</span><div><strong>Persistent walls</strong> — large resting orders that have been at the same level ≥10 min (not 10 seconds — a real commitment). Walls at your TP = real overhead resistance. Walls at your SL = genuine support below. Short-lived phantom walls (appear and vanish) are not shown.</div></div>
        </div>

        <h4 class="ob-scene-title">Scenario examples</h4>

        <!-- BULLISH -->
        <div class="ob-scene ob-scene-bull">
          <div class="ob-scene-h">🟢 Bullish Setup — signals aligned for a long</div>
          <div class="ob-scene-grid">
            <div class="ob-sc-panel">🌡️ Liq heatmap</div>
            <div class="ob-sc-state">Large <strong>flush zone</strong> 2–4% below price</div>
            <div class="ob-sc-why">Smart money will target those stops — sweep down, then reverse hard. Your OB entry is right above the cluster. High-probability bounce zone.</div>

            <div class="ob-sc-panel">💰 Funding</div>
            <div class="ob-sc-state">Slightly <strong>negative</strong> (−0.005 to −0.015%)</div>
            <div class="ob-sc-why">Shorts are paying — market is net short. Any push up forces covering, amplifying the move higher without needing new longs.</div>

            <div class="ob-sc-panel">📦 OI</div>
            <div class="ob-sc-state">Rising with price</div>
            <div class="ob-sc-why">New money entering long. Genuine conviction — not just weak-hand short covering. Real buyers are committed.</div>

            <div class="ob-sc-panel">📈 CVD</div>
            <div class="ob-sc-state">3+ consecutive <strong>green bars</strong>, running line sloping up</div>
            <div class="ob-sc-why">Aggressive buyers in control for multiple candles. The trend has real execution behind it, not just passive buying.</div>

            <div class="ob-sc-panel">🧱 Walls</div>
            <div class="ob-sc-state">Persistent <strong>bid wall</strong> at or near your OB</div>
            <div class="ob-sc-why">Someone is defending this level for 10+ minutes. Your stop is behind real institutional support, not thin air.</div>
          </div>
          <div class="ob-scene-verdict">✅ Take the long. All five signals confirm the thesis — structural backing is there.</div>
        </div>

        <!-- BEARISH -->
        <div class="ob-scene ob-scene-bear">
          <div class="ob-scene-h">🔴 Bearish Setup — signals aligned for a short</div>
          <div class="ob-scene-grid">
            <div class="ob-sc-panel">🌡️ Liq heatmap</div>
            <div class="ob-sc-state">Large <strong>squeeze zone</strong> 2–4% above price — already tapped</div>
            <div class="ob-sc-why">Short-squeeze stops got hunted. Market ran up to those stops, now they've been taken. Distribution zone — reversal probability is high.</div>

            <div class="ob-sc-panel">💰 Funding</div>
            <div class="ob-sc-state">Highly <strong>positive</strong> (+0.02 to +0.05%)</div>
            <div class="ob-sc-why">Longs paying heavily — market is massively overleveraged long. A flush from here wipes out a crowd of buyers all at once. Cascade potential.</div>

            <div class="ob-sc-panel">📦 OI</div>
            <div class="ob-sc-state">Rising as price rolls over (or OI peaked and is now falling)</div>
            <div class="ob-sc-why">New shorts entering on the break — not just weak longs exiting. There's bearish conviction from the other side.</div>

            <div class="ob-sc-panel">📈 CVD</div>
            <div class="ob-sc-state">3+ consecutive <strong>red bars</strong>, running line rolling over</div>
            <div class="ob-sc-why">Sellers are driving this. Price is falling on aggressive selling, not just a lack of buyers — the move is real.</div>

            <div class="ob-sc-panel">🧱 Walls</div>
            <div class="ob-sc-state">Persistent <strong>ask wall</strong> capping the rally at entry</div>
            <div class="ob-sc-why">Distribution — someone is unloading into every pop. The short has real overhead supply. The wall holds until absorbed.</div>
          </div>
          <div class="ob-scene-verdict">🔴 Take the short. Distribution confirmed by funding + CVD rollover + ask wall supply.</div>
        </div>

        <!-- NEUTRAL -->
        <div class="ob-scene ob-scene-neutral">
          <div class="ob-scene-h">⚪ Neutral / Choppy — sit on your hands</div>
          <div class="ob-scene-grid">
            <div class="ob-sc-panel">🌡️ Liq heatmap</div>
            <div class="ob-sc-state">Roughly <strong>equal clusters</strong> above and below price</div>
            <div class="ob-sc-why">No clear magnet pulling price in one direction. The market will range until one side's stops are swept — nobody wins trading inside the range.</div>

            <div class="ob-sc-panel">💰 Funding</div>
            <div class="ob-sc-state">Near-zero (−0.002 to +0.002%)</div>
            <div class="ob-sc-why">Market is not positioned either way. No leveraged crowd to squeeze. Any move will be organic and low-momentum — not a clean trend entry.</div>

            <div class="ob-sc-panel">📦 OI</div>
            <div class="ob-sc-state">Flat or steadily declining</div>
            <div class="ob-sc-why">No new money entering — existing positions being closed. Conviction is absent from both sides. This is a coiling market, not a trending one.</div>

            <div class="ob-sc-panel">📈 CVD</div>
            <div class="ob-sc-state">Alternating green/red bars, flat running line</div>
            <div class="ob-sc-why">No dominant aggressor. Buyers and sellers matching each other tick-for-tick. Classic chop signature — your entries will get chopped in both directions.</div>

            <div class="ob-sc-panel">🧱 Walls</div>
            <div class="ob-sc-state">No persistent walls, or walls on both sides within 1%</div>
            <div class="ob-sc-why">No one taking a strong positional stance. Liquidity is balanced — the book reflects indecision, not conviction.</div>
          </div>
          <div class="ob-scene-verdict">⏸ Wait. No structural edge here. Come back after a killzone opens or one side's stops get swept — that's when the real move starts.</div>
        </div>

        <div class="ob-guide-note">
          <strong>Limits to know:</strong> Funding + OI = Bybit perps only (single venue). Liq heatmap = forward-estimated model until a Coinglass key is set — clusters are projections, not exchange-confirmed fills. CVD resets on page reload. Persistent walls = Binance spot only. TF selector affects CVD bucket width and liq TF; switch TF then wait a few candles before reading CVD. None of this replaces your ICT setup — it <em>confirms</em> it or raises a flag.
        </div>
      </div>
    </div>`;
  }

  return { render, teardown };
})();
