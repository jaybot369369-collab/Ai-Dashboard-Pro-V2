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

  /* ── TF + Window config ───────────────────────────────── */
  const TF_LIST    = ['15m', '1h', '4h', 'D'];
  const TF_MS      = { '15m': 900000, '1h': 3600000, '4h': 14400000, 'D': 86400000 };
  const WIN_LIST   = ['7d', '14d', '30d', '90d'];
  const WIN_LABELS = { '7d': '7D', '14d': '14D', '30d': '1M', '90d': '3M' };

  /* ── Tunables ─────────────────────────────────────────── */
  const CVD_BARS     = 24;        // candle bars kept
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
  const LS_TF  = 'ob_tf';
  const LS_WIN = 'ob_win';

  /* ── State ────────────────────────────────────────────── */
  let _sym = (localStorage.getItem(LS_SYM) || 'BTC').toUpperCase();
  let _tf  = localStorage.getItem(LS_TF)  || '1h';
  let _win = localStorage.getItem(LS_WIN) || '30d';

  // WebSocket (aggTrade — CVD only)
  let _ws         = null;
  let _status     = 'idle';
  let _lastMsg    = 0;
  let _reconTimer = null;
  let _reconDelay = 1000;

  // CVD bucketing
  let _cvdBuckets   = [];     // [{t, buy, sell}] oldest first
  let _cvdBucketMs  = TF_MS[_tf] || 3600000;

  // Persistent walls (REST snapshots)
  let _wallTracker = new Map(); // key → {firstSeen, lastSeen, usd, side, price}
  let _lastSnapMid = null;
  let _snapTimer   = null;

  // Liq heatmap (same data shape as liquidity_watcher.js)
  let _liqData      = null;
  let _liqKlines    = null;
  let _liqKlinesKey = null;
  let _liqInFlight  = false;

  // Funding / OI
  let _fundingData = null;    // {rate, oi, price}
  let _prevOI      = null;
  let _prevOI2     = null;
  let _prevPrice   = null;
  let _fundingTimer = null;

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
      if (_cvdBuckets.length > CVD_BARS + 2) _cvdBuckets.shift();
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
     LIQ HEATMAP — fallback: Coinglass proxy → LW → placeholder
     _paintLiqHeatmap logic ported verbatim from liquidity_watcher.js
  ══════════════════════════════════════════════════════ */
  const _LIQ_WIN_CFG = {
    '7d':  { interval: '240', limit: 42,  okxBar: '4H' },
    '14d': { interval: '240', limit: 84,  okxBar: '4H' },
    '30d': { interval: 'D',   limit: 30,  okxBar: '1D' },
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
    const asset = _sym, win = _win;

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
      const tf = { '15m':'15m', '1h':'1h', '4h':'4h', 'D':'D' }[_tf] || '1h';
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
    _paintFundingOI();
    _paintCVDBars();
    _paintWalls();
  }

  function _paintStatus() {
    const el = document.getElementById('ob-ws-status'); if (!el) return;
    if (Date.now() - _lastMsg > 15000 && _status === 'live') _status = 'reconnecting';
    const map = { live: ['● live', 'var(--good)'], connecting: ['○ connecting…', 'var(--muted)'], reconnecting: ['◌ reconnecting…', 'var(--warn)'], idle: ['○ idle', 'var(--muted)'] };
    const [txt, col] = map[_status] || map.idle;
    el.innerHTML = `<span style="color:${col}">${txt}</span>`;
  }

  function _paintFundingOI() {
    const fEl = document.getElementById('ob-fund'), oEl = document.getElementById('ob-oi');
    if (!fEl || !oEl) return;
    if (!_fundingData) { fEl.innerHTML = `<div class="ob-fund-loading">Loading…</div>`; oEl.innerHTML = ''; return; }

    const { rate, oi, price } = _fundingData;
    const ratePct  = (rate * 100).toFixed(4);
    const sign     = rate >= 0 ? '+' : '';
    const rateCol  = Math.abs(rate) > 0.0002 ? (rate > 0 ? '#ef4444' : '#22c55e') : 'var(--text-sub,var(--muted))';
    let rateInterp = '';
    if      (rate > 0.0003) rateInterp = 'Longs paying heavily — market very crowded long. Long-squeeze is path of least resistance.';
    else if (rate > 0.00005) rateInterp = 'Longs paying slightly — mild long bias. Watch for flush before continuation.';
    else if (rate < -0.0002) rateInterp = 'Shorts paying heavily — market crowded short. Short-squeeze potential is high.';
    else if (rate < -0.00005) rateInterp = 'Shorts paying — market net short. Upside wick/squeeze possible before real move.';
    else                     rateInterp = 'Near-zero — no strong positioning bias. Move will be organic, less violent.';

    let oiInterp = 'Watching…';
    if (_prevOI2 != null && oi > 0 && _prevPrice != null) {
      const rising = oi > _prevOI2 * 1.005, falling = oi < _prevOI2 * 0.995;
      const priceUp = price > _prevPrice;
      if      (rising  && priceUp)  oiInterp = 'OI + price rising → new longs entering. Real conviction buying.';
      else if (rising  && !priceUp) oiInterp = 'OI rising, price falling → new shorts entering. Bearish conviction.';
      else if (falling && priceUp)  oiInterp = 'OI falling, price rising → short covering only. Weaker up-move.';
      else if (falling)             oiInterp = 'OI falling — positions closing. Compression or reversal possible.';
      else                          oiInterp = 'OI flat — no new money entering. Range / chop likely.';
    }

    let oiChg = '';
    if (_prevOI != null && oi > 0) {
      const chg = (oi - _prevOI) / _prevOI * 100;
      oiChg = `<span style="color:${chg >= 0 ? '#22c55e' : '#ef4444'};font-size:.75rem;margin-left:6px">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span>`;
    }
    _prevOI2 = _prevOI; _prevOI = oi; _prevPrice = price;

    fEl.innerHTML = `
      <div class="ob-fund-val" style="color:${rateCol}">${sign}${ratePct}% <span class="ob-fund-lbl">8h</span></div>
      <div class="ob-fund-interp">${rateInterp}</div>`;
    oEl.innerHTML = `
      <div class="ob-fund-val">${_fmtUsd(oi)}${oiChg} <span class="ob-fund-lbl">perp OI</span></div>
      <div class="ob-fund-interp">${oiInterp}</div>`;
  }

  function _paintCVDBars() {
    const el = document.getElementById('ob-cvd'); if (!el) return;
    const bkts = _cvdBuckets.slice(-CVD_BARS);
    if (bkts.length < 3) {
      el.innerHTML = `<div class="ob-cvd-head"><span class="ob-cvd-label">CVD — ${esc(_tf)} candles</span> <span class="ob-ws-dot" id="ob-ws-status"></span></div><div class="ob-fund-loading">Building… ${bkts.length}/${CVD_BARS} ${_tf} bars collected</div>`;
      _paintStatus(); return;
    }
    const deltas  = bkts.map(b => b.buy - b.sell);
    const maxAbs  = Math.max(...deltas.map(Math.abs), 1);
    const runCVD  = deltas.reduce((a, d, i) => { a.push((a[i - 1] || 0) + d); return a; }, []);
    const cvdMin  = Math.min(...runCVD), cvdMax = Math.max(...runCVD, 1), cvdRng = (cvdMax - cvdMin) || 1;
    const total   = runCVD[runCVD.length - 1];
    const W = 560, H = 100, bSlot = W / bkts.length, bW = bSlot * 0.82, baseY = 80, lineTop = 16;

    let bars = '', linePts = '';
    bkts.forEach((b, i) => {
      const d = deltas[i], x = i * bSlot;
      const h = Math.max(1, Math.abs(d) / maxAbs * (baseY - lineTop - 4));
      bars += `<rect x="${x.toFixed(1)}" y="${(baseY - h).toFixed(1)}" width="${bW.toFixed(1)}" height="${h.toFixed(1)}" fill="${d >= 0 ? 'rgba(52,211,153,0.85)' : 'rgba(248,113,113,0.85)'}" rx="1"/>`;
      const cv = runCVD[i], ly = lineTop + (1 - (cv - cvdMin) / cvdRng) * (baseY - lineTop - 4);
      const cx = x + bW / 2;
      linePts += (i === 0 ? `M${cx.toFixed(1)},${ly.toFixed(1)}` : ` L${cx.toFixed(1)},${ly.toFixed(1)}`);
    });

    const col = total >= 0 ? 'var(--good)' : 'var(--bad)';
    el.innerHTML = `
      <div class="ob-cvd-head">
        <span class="ob-cvd-label">CVD — ${esc(_tf)} candles</span>
        <strong style="color:${col}">${total >= 0 ? '+' : ''}${_fmtUsd(Math.abs(total))}</strong>
        <span class="ob-cvd-hint">${total >= 0 ? 'net buying' : 'net selling'} · ${bkts.length} bars</span>
        <span class="ob-ws-dot" id="ob-ws-status"></span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" class="ob-cvd-svg" preserveAspectRatio="none">
        <line x1="0" y1="${baseY}" x2="${W}" y2="${baseY}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
        ${bars}
        <path d="${linePts}" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1.5"/>
      </svg>`;
    _paintStatus();
  }

  function _paintWalls() {
    const el = document.getElementById('ob-walls'); if (!el) return;
    const now = Date.now();
    const persistent = [..._wallTracker.values()].filter(w => now - w.firstSeen >= WALL_MIN_MS);
    if (!persistent.length) {
      const watching = [..._wallTracker.values()].filter(w => now - w.firstSeen < WALL_MIN_MS).length;
      el.innerHTML = `<div class="ob-empty">No persistent walls yet — tracking ${watching} level${watching !== 1 ? 's' : ''} (need ≥10 min).</div>`;
      return;
    }
    const mid = _lastSnapMid || 1;
    el.innerHTML = [...persistent].sort((a, b) => b.usd - a.usd).slice(0, 6).map(w => {
      const dist = ((w.price - mid) / mid) * 100;
      const col  = w.side === 'bid' ? 'var(--good)' : 'var(--bad)';
      const icon = w.side === 'bid' ? '↓ Bid' : '↑ Ask';
      const age  = Math.round((now - w.firstSeen) / 60000);
      return `<div class="ob-wall">
        <span class="ob-wall-side" style="color:${col}">${icon}</span>
        <span class="ob-wall-px">${_fmtPx(w.price)}</span>
        <span class="ob-wall-dist" style="color:${col}">${dist >= 0 ? '+' : ''}${dist.toFixed(2)}%</span>
        <span class="ob-wall-usd">${_fmtUsd(w.usd)}</span>
        <span class="ob-wall-age">${age}m</span>
      </div>`;
    }).join('');
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

        <!-- 1. LIQUIDATION HEATMAP — full width -->
        <div class="ob-card">
          <div class="ob-card-h">
            🌡️ Liquidation Heatmap
            <span id="ob-liq-src" class="ob-liq-badge"></span>
            <span class="ob-sub">estimated positions at risk · yellow = largest cluster · not exchange-confirmed</span>
          </div>
          <div class="ob-liq-totals">
            <span class="ob-liq-tot-label">☝ Squeeze above</span><span id="ob-liq-above" class="ob-liq-tot-above">—</span>
            <span class="ob-liq-sep">·</span>
            <span class="ob-liq-tot-label">👇 Flush below</span><span id="ob-liq-below" class="ob-liq-tot-below">—</span>
          </div>
          <div id="ob-liq-chart" class="ob-liq-chart"></div>
        </div>

        <!-- 2. FUNDING + OI — two columns -->
        <div class="ob-two-col">
          <div class="ob-card">
            <div class="ob-card-h">💰 Funding Rate <span class="ob-sub">Bybit 8h · longs pay = positive</span></div>
            <div id="ob-fund" class="ob-fund-panel"></div>
          </div>
          <div class="ob-card">
            <div class="ob-card-h">📦 Open Interest <span class="ob-sub">Bybit perp · rising = new positions</span></div>
            <div id="ob-oi" class="ob-fund-panel"></div>
          </div>
        </div>

        <!-- 3. CVD BARS -->
        <div class="ob-card">
          <div id="ob-cvd" class="ob-cvd-wrap"></div>
        </div>

        <!-- 4. PERSISTENT WALLS -->
        <div class="ob-card">
          <div class="ob-card-h">🧱 Persistent Walls <span class="ob-sub">resting ≥10 min · 30s REST snapshots · Binance spot</span></div>
          <div id="ob-walls"></div>
        </div>

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
    _snapBook();
    _pollFunding();
    _loadLiq();
    _paintAll();
    _snapTimer    = setInterval(_snapBook,    SNAP_INT_MS);
    _fundingTimer = setInterval(_pollFunding, FUND_INT_MS);
    _paintTimer   = setInterval(_paintAll,    PAINT_MS);
    _cgTimer      = setInterval(_cgPoll,      60000);
  }
  function _cleanup() {
    if (_ws) { try { _ws.onclose = null; _ws.close(); } catch(_) {} _ws = null; }
    [_paintTimer, _fundingTimer, _snapTimer, _reconTimer, _cgTimer].forEach(t => {
      if (t != null) { clearInterval(t); clearTimeout(t); }
    });
    _paintTimer = _fundingTimer = _snapTimer = _reconTimer = _cgTimer = null;
  }
  function _resetState() {
    _cvdBuckets = []; _wallTracker = new Map(); _lastSnapMid = null;
    _liqData = null; _liqKlines = null; _liqKlinesKey = null; _liqInFlight = false;
    _fundingData = null; _prevOI = null; _prevOI2 = null; _prevPrice = null;
    _cvdBucketMs = TF_MS[_tf] || 3600000;
    _status = 'idle'; _lastMsg = 0; _reconDelay = 1000;
    _cgNoKey = false; _cgState = 'idle'; _cg = {};
  }

  function _headHTML() {
    const sym = SYMBOLS.map(s => `<button class="ob-pill${s === _sym ? ' active' : ''}" data-sym="${s}">${s}</button>`).join('');
    const tf  = TF_LIST.map(t => `<button class="ob-tf-pill${t === _tf ? ' active' : ''}" data-tf="${t}">${t}</button>`).join('');
    const win = WIN_LIST.map(w => `<button class="ob-win-pill${w === _win ? ' active' : ''}" data-win="${w}">${WIN_LABELS[w]}</button>`).join('');
    return `
      <div class="ob-head">
        <div>
          <div class="ob-title">📖 Level 2 — Swing Context</div>
          <div class="ob-tagline">Liquidation clusters · Funding · OI · CVD · Persistent walls — built for 15m–4h setups</div>
        </div>
        <div class="ob-head-right">
          <div class="ob-pills">${sym}</div>
          <div class="ob-selector-row">
            <span class="ob-sel-lbl">TF</span>${tf}
            <span class="ob-sel-sep">·</span>
            <span class="ob-sel-lbl">Window</span>${win}
          </div>
        </div>
      </div>`;
  }

  function _wireEvents() {
    document.querySelectorAll('#ob-root .ob-pill').forEach(b => b.addEventListener('click', () => _setSym(b.dataset.sym)));
    document.querySelectorAll('#ob-root .ob-tf-pill').forEach(b => b.addEventListener('click', () => _setTF(b.dataset.tf)));
    document.querySelectorAll('#ob-root .ob-win-pill').forEach(b => b.addEventListener('click', () => _setWin(b.dataset.win)));
    document.querySelectorAll('#ob-root .ob-guide-h').forEach(h => h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed')));
  }
  function _setSym(s) {
    if (!s || s === _sym) return;
    _sym = s.toUpperCase(); localStorage.setItem(LS_SYM, _sym);
    document.querySelectorAll('#ob-root .ob-pill').forEach(b => b.classList.toggle('active', b.dataset.sym === _sym));
    _cleanup(); _startAll();
  }
  function _setTF(tf) {
    if (!tf || tf === _tf) return;
    _tf = tf; localStorage.setItem(LS_TF, _tf); _cvdBucketMs = TF_MS[_tf] || 3600000;
    document.querySelectorAll('#ob-root .ob-tf-pill').forEach(b => b.classList.toggle('active', b.dataset.tf === _tf));
    _cvdBuckets = [];
    _liqKlines = null; _liqKlinesKey = null; _liqInFlight = false; _loadLiq();
  }
  function _setWin(w) {
    if (!w || w === _win) return;
    _win = w; localStorage.setItem(LS_WIN, _win);
    document.querySelectorAll('#ob-root .ob-win-pill').forEach(b => b.classList.toggle('active', b.dataset.win === _win));
    _liqKlines = null; _liqKlinesKey = null; _liqInFlight = false; _loadLiq();
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
