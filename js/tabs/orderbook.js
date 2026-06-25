/* ═══════════════════════════════════════════════════════════
   JAYBOT DASHBOARD — orderbook.js  (Level 2 / Order Book tab)

   A live, browser-only Level 2 reader for ONE venue (Binance spot,
   Bybit fallback). Maintains a FULL local order book:
     REST snapshot  (/api/v3/depth?limit=5000)  seeds the book
     <sym>@depth@100ms  diff stream keeps it in sync (proper U/u
                        sequence management → real ±2% walls, not a
                        20-level touch slice)
     <sym>@aggTrade     trade tape (CVD + confirmation)

   DOCTRINE (worded into the guide): order-book imbalance has a
   seconds-to-~1-minute half-life — this is an ENTRY-TIMING + TRAP
   detection overlay on ICT setups, never a hold thesis.

   History is in-memory ring buffers (resets on reload) — a live
   monitor, not a recorded archive. No backend, no API key.
   Phase 2 (Coinglass) overlays real aggregated liq clusters + a
   cross-exchange book via the fund-API proxy.
════════════════════════════════════════════════════════════ */

const OrderBookTab = (() => {

  /* ── Universe ─────────────────────────────────────────── */
  const SYMBOLS = ['BTC', 'ETH', 'XRP', 'SOL', 'SUI'];
  const pairOf  = s => s.toUpperCase() + 'USDT';

  /* ── Tunables ─────────────────────────────────────────── */
  const SNAP_LIMIT   = 5000;        // REST snapshot depth
  const BOOK_PCT     = 0.03;        // keep ±3% of mid in the working book
  const BOOK_CAP     = 400;         // hard cap levels/side (perf)
  const LADDER_N     = 20;          // levels shown in the DOM ladder
  const PAINT_MS     = 350;         // UI repaint throttle
  const HEAT_TICK_MS = 1500;        // heatmap downsample cadence
  const HEAT_MAX     = 200;         // heatmap columns kept (~5 min)
  const TAPE_MAX     = 40;          // recent trades kept
  const CVD_MAX      = 240;         // CVD sparkline points
  const WALL_SHARE   = 0.06;        // level ≥ 6% of its ±2% side depth = wall
  const STALE_MS     = 5000;        // no WS msg this long → reconnecting
  const LS_SYM       = 'jb_ob_symbol';
  const LS_ALERTS    = 'jb_ob_alerts_on';
  const REST_BASES   = ['https://api.binance.com', 'https://data-api.binance.vision'];

  /* ── State ────────────────────────────────────────────── */
  let _sym       = (localStorage.getItem(LS_SYM) || 'BTC').toUpperCase();
  let _ws        = null;
  let _wsSource  = 'binance';       // 'binance' | 'bybit'
  let _status    = 'idle';          // idle | connecting | live | reconnecting | error
  let _lastMsg   = 0;
  let _binFails  = 0;

  // Full book: price → qty (source of truth)
  let _bm        = { bids: new Map(), asks: new Map() };
  let _seeded    = false;
  let _seeding   = false;
  let _diffBuf   = [];              // buffered binance diffs pre-seed
  let _lastUid   = 0;               // last applied binance update id
  let _seedTok   = 0;              // cancels stale seed fetches on symbol switch
  // Derived working book (sorted nearest-first, capped) — refreshed per paint/tick
  let _book      = { bids: [], asks: [] };

  let _cvd       = 0;
  let _cvdSeries = [];              // {t, v}
  let _tape      = [];              // {t, price, qty, side}
  let _heatBuf   = [];             // {t, bids, asks, mid}
  let _wallStats = new Map();       // bucketPrice → {seen, pulled, fills, lastWall}
  let _prevWalls = [];

  let _paintTimer  = null;
  let _heatTimer   = null;
  let _reconnTimer = null;
  let _reconnDelay = 1000;

  let _alertsOn = localStorage.getItem(LS_ALERTS) !== 'off';
  let _lastImbState = 'neutral';

  // Coinglass cross-reference (Phase 2) — proxied via fund API, no Coinglass UI rebuilt
  let _cgState = 'idle';   // idle | needs_key | error | ok
  let _cg = {};
  let _cgTimer = null;
  let _cgNoKey = false;

  /* ── Helpers ──────────────────────────────────────────── */
  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function _rootAlive()   { return !!document.getElementById('ob-root'); }
  function _timeoutSig(ms) { return (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(ms) : undefined; }

  /* Coinglass proxy (fund API) — same local/Railway base resolution as fund.js */
  function _fundBase() {
    return ['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://127.0.0.1:8767' : location.origin;
  }
  async function _cgFetch(resource, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const url = `${_fundBase()}/api/coinglass/${resource}${qs ? '?' + qs : ''}`;
    try {
      const r = await fetch(url, { cache: 'no-store', signal: _timeoutSig(12000) });
      const body = await r.json().catch(() => null);
      return { status: r.status, ok: r.ok, body };
    } catch (e) { return { status: 0, ok: false, body: null, err: String(e) }; }
  }
  function _cgRows(resp) {
    const d = resp && resp.data;
    if (Array.isArray(d)) return d;
    if (d && Array.isArray(d.list)) return d.list;
    if (d && typeof d === 'object') return [d];
    return [];
  }

  function _decimals(px) {
    if (!px) return 2;
    if (px >= 1000) return 1;
    if (px >= 100)  return 2;
    if (px >= 1)    return 4;
    return 5;
  }
  function _fmtPx(px) { return px == null ? '—' : px.toLocaleString('en-US', { minimumFractionDigits: _decimals(px), maximumFractionDigits: _decimals(px) }); }
  function _fmtSz(sz) {
    if (sz == null) return '—';
    if (sz >= 1e6) return (sz / 1e6).toFixed(2) + 'M';
    if (sz >= 1e3) return (sz / 1e3).toFixed(1) + 'k';
    if (sz >= 1)   return sz.toFixed(2);
    return sz.toFixed(4);
  }
  function _fmtUsd(v) {
    if (v == null) return '—';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'k';
    return '$' + v.toFixed(0);
  }
  function _bestBid() { return _book.bids[0]?.[0] ?? null; }
  function _bestAsk() { return _book.asks[0]?.[0] ?? null; }
  function _mid() { const b = _bestBid(), a = _bestAsk(); if (b && a) return (b + a) / 2; return b || a || null; }

  /* Heatmap palette (reused from liquidity_watcher.js _heatRgba) */
  function _heatRgba(t, alpha) {
    if (t < 0.12) return `rgba(70,10,120,${((0.35 + t * 3) * alpha).toFixed(2)})`;
    if (t < 0.28) return `rgba(0,90,180,${((0.50 + t * 1.5) * alpha).toFixed(2)})`;
    if (t < 0.48) return `rgba(0,190,200,${((0.60 + t) * alpha).toFixed(2)})`;
    if (t < 0.68) return `rgba(0,230,100,${((0.68 + t * 0.5) * alpha).toFixed(2)})`;
    if (t < 0.85) return `rgba(160,255,0,${((0.75 + t * 0.3) * alpha).toFixed(2)})`;
    return `rgba(255,245,0,${((0.85 + t * 0.15) * alpha).toFixed(2)})`;
  }

  /* ══════════════════════════════════════════════════════
     BOOK MAINTENANCE
  ══════════════════════════════════════════════════════ */
  function _refreshBook() {
    const midGuess = (() => {
      let bb = -Infinity, ba = Infinity;
      for (const p of _bm.bids.keys()) if (p > bb) bb = p;
      for (const p of _bm.asks.keys()) if (p < ba) ba = p;
      if (bb > 0 && ba < Infinity) return (bb + ba) / 2;
      return bb > 0 ? bb : (ba < Infinity ? ba : null);
    })();
    if (midGuess == null) { _book = { bids: [], asks: [] }; return; }
    const lo = midGuess * (1 - BOOK_PCT), hi = midGuess * (1 + BOOK_PCT);
    const bids = [];
    for (const [p, q] of _bm.bids) if (q > 0 && p >= lo) bids.push([p, q]);
    const asks = [];
    for (const [p, q] of _bm.asks) if (q > 0 && p <= hi) asks.push([p, q]);
    bids.sort((a, b) => b[0] - a[0]);
    asks.sort((a, b) => a[0] - b[0]);
    _book = { bids: bids.slice(0, BOOK_CAP), asks: asks.slice(0, BOOK_CAP) };
  }

  function _applyLevels(map, rows) {
    for (const [p, q] of rows) {
      const px = +p, qty = +q;
      if (!(px > 0)) continue;
      if (qty > 0) map.set(px, qty); else map.delete(px);
    }
  }

  async function _seedBinance() {
    if (_seeding) return;
    _seeding = true;
    const tok = ++_seedTok;
    const pair = pairOf(_sym);
    let snap = null;
    for (const base of REST_BASES) {
      try {
        const r = await fetch(`${base}/api/v3/depth?symbol=${pair}&limit=${SNAP_LIMIT}`, { cache: 'no-store', signal: _timeoutSig(8000) });
        if (!r.ok) throw new Error('http ' + r.status);
        snap = await r.json();
        if (snap && snap.lastUpdateId && snap.bids) break;
        snap = null;
      } catch (e) { /* try next base */ }
    }
    if (tok !== _seedTok || !_rootAlive()) { _seeding = false; return; }   // symbol switched mid-fetch
    if (!snap) { _seeding = false; _status = 'reconnecting'; _paintStatus(); return; }

    _bm = { bids: new Map(), asks: new Map() };
    _applyLevels(_bm.bids, snap.bids);
    _applyLevels(_bm.asks, snap.asks);
    _lastUid = snap.lastUpdateId;
    // drain buffered diffs: drop stale, apply the rest in order
    const buf = _diffBuf.filter(d => d.u > _lastUid).sort((a, b) => a.U - b.U);
    for (const d of buf) {
      if (d.U <= _lastUid + 1) { _applyLevels(_bm.bids, d.b); _applyLevels(_bm.asks, d.a); _lastUid = d.u; }
    }
    _diffBuf = [];
    _seeded = true;
    _seeding = false;
    _refreshBook();
  }

  function _onBinanceDiff(d) {
    // d: { e:'depthUpdate', U, u, b, a }
    if (!_seeded) { _diffBuf.push(d); if (_diffBuf.length > 500) _diffBuf.shift(); return; }
    if (d.u <= _lastUid) return;                       // old
    if (d.U > _lastUid + 1) { _seeded = false; _diffBuf = [d]; _seedBinance(); return; }  // gap → re-seed
    _applyLevels(_bm.bids, d.b);
    _applyLevels(_bm.asks, d.a);
    _lastUid = d.u;
  }

  /* ══════════════════════════════════════════════════════
     WEBSOCKET — Binance primary, Bybit fallback
  ══════════════════════════════════════════════════════ */
  function _cleanup() {
    if (_ws) { try { _ws.onclose = null; _ws.close(); } catch (_) {} _ws = null; }
    if (_paintTimer)  { clearInterval(_paintTimer);  _paintTimer = null; }
    if (_heatTimer)   { clearInterval(_heatTimer);   _heatTimer = null; }
    if (_reconnTimer) { clearTimeout(_reconnTimer);  _reconnTimer = null; }
    if (_cgTimer)     { clearInterval(_cgTimer);     _cgTimer = null; }
  }
  function _resetBuffers() {
    _bm = { bids: new Map(), asks: new Map() };
    _book = { bids: [], asks: [] };
    _seeded = false; _seeding = false; _diffBuf = []; _lastUid = 0; _seedTok++;
    _cvd = 0; _cvdSeries = []; _tape = []; _heatBuf = [];
    _wallStats = new Map(); _prevWalls = [];
    _cgNoKey = false; _cgState = 'idle'; _cg = {};
  }

  function _connect() {
    if (!_rootAlive()) return;
    _status = 'connecting'; _paintStatus();
    (_wsSource === 'bybit') ? _connectBybit() : _connectBinance();
  }

  function _connectBinance() {
    const p = pairOf(_sym).toLowerCase();
    const url = `wss://stream.binance.com:9443/stream?streams=${p}@depth@100ms/${p}@aggTrade`;
    let ws;
    try { ws = new WebSocket(url); } catch (e) { return _onWsFail(); }
    _ws = ws;
    ws.onopen = () => { _binFails = 0; _reconnDelay = 1000; _status = 'live'; _lastMsg = Date.now(); _paintStatus(); _seedBinance(); };
    ws.onmessage = (ev) => {
      _lastMsg = Date.now();
      if (_status !== 'live') { _status = 'live'; _paintStatus(); }
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      const d = msg.data; if (!d) return;
      if (d.e === 'depthUpdate') _onBinanceDiff(d);
      else if (d.e === 'aggTrade') _onTrade(+d.p, +d.q, d.m);
    };
    ws.onerror = () => {};
    ws.onclose = () => { if (_ws === ws) _onWsFail(); };
  }

  function _connectBybit() {
    const sym = pairOf(_sym);
    let ws;
    try { ws = new WebSocket('wss://stream.bybit.com/v5/public/spot'); } catch (e) { return _onWsFail(); }
    _ws = ws;
    ws.onopen = () => {
      _reconnDelay = 1000; _status = 'live'; _lastMsg = Date.now(); _paintStatus();
      try { ws.send(JSON.stringify({ op: 'subscribe', args: [`orderbook.50.${sym}`, `publicTrade.${sym}`] })); } catch (_) {}
    };
    ws.onmessage = (ev) => {
      _lastMsg = Date.now();
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg.topic) return;
      if (msg.topic.startsWith('orderbook')) _onBybitBook(msg);
      else if (msg.topic.startsWith('publicTrade') && Array.isArray(msg.data))
        msg.data.forEach(t => _onTrade(+t.p, +t.v, String(t.S).toLowerCase() === 'sell'));
    };
    ws.onerror = () => {};
    ws.onclose = () => { if (_ws === ws) _onWsFail(); };
  }

  function _onBybitBook(msg) {
    const d = msg.data; if (!d) return;
    if (msg.type === 'snapshot') _bm = { bids: new Map(), asks: new Map() };
    _applyLevels(_bm.bids, d.b || []);
    _applyLevels(_bm.asks, d.a || []);
    _seeded = true;
  }

  function _onWsFail() {
    _ws = null;
    if (_wsSource === 'binance') { _binFails++; if (_binFails >= 3) { _wsSource = 'bybit'; _binFails = 0; } }
    _status = 'reconnecting'; _paintStatus();
    if (_reconnTimer) clearTimeout(_reconnTimer);
    _reconnTimer = setTimeout(() => { if (_rootAlive()) _connect(); }, _reconnDelay);
    _reconnDelay = Math.min(_reconnDelay * 1.7, 15000);
  }

  function _onTrade(price, qty, takerIsSeller) {
    if (!(price > 0) || !(qty > 0)) return;
    const side = takerIsSeller ? 'sell' : 'buy';
    _cvd += (side === 'buy' ? qty : -qty) * price;     // CVD in quote ($)
    _tape.unshift({ t: Date.now(), price, qty, side });
    if (_tape.length > TAPE_MAX) _tape.length = TAPE_MAX;
  }

  /* ══════════════════════════════════════════════════════
     DERIVED SIGNALS  (read _book — deep, sorted nearest-first)
  ══════════════════════════════════════════════════════ */
  function _bandDepth(pct) {
    const mid = _mid(); if (!mid) return { bid: 0, ask: 0 };
    const lo = mid * (1 - pct), hi = mid * (1 + pct);
    let bid = 0, ask = 0;
    for (const [p, s] of _book.bids) { if (p < lo) break; bid += p * s; }
    for (const [p, s] of _book.asks) { if (p > hi) break; ask += p * s; }
    return { bid, ask };
  }
  function _imbalance() {
    const b2 = _bandDepth(0.02), b1 = _bandDepth(0.01), b05 = _bandDepth(0.005);
    const bid = b05.bid * 0.45 + b1.bid * 0.35 + b2.bid * 0.20;
    const ask = b05.ask * 0.45 + b1.ask * 0.35 + b2.ask * 0.20;
    const tot = bid + ask;
    const ratio = tot ? bid / tot : 0.5;
    const score = Math.round(ratio * 100);
    const dir = score >= 58 ? 'bull' : score <= 42 ? 'bear' : 'neutral';
    return { score, dir, bid, ask, b05, b1, b2 };
  }
  function _walls() {
    const mid = _mid() || 1;
    const b2 = _bandDepth(0.02);
    const out = [];
    const scan = (rows, side, sideTot) => {
      if (sideTot <= 0) return;
      const lo = mid * 0.98, hi = mid * 1.02;
      for (const [p, s] of rows) {
        if (side === 'bid' && p < lo) break;
        if (side === 'ask' && p > hi) break;
        const usd = p * s, share = usd / sideTot;
        if (share >= WALL_SHARE) out.push({ side, price: p, usd, share, distPct: ((p - mid) / mid) * 100 });
      }
    };
    scan(_book.bids, 'bid', b2.bid);
    scan(_book.asks, 'ask', b2.ask);
    return out.sort((a, b) => b.usd - a.usd).slice(0, 6);
  }
  function _bucket(price) { const mid = _mid() || price || 1; const step = mid * 0.0008; return Math.round(price / step) * step; }
  function _spoofTag(price) {
    const st = _wallStats.get(_bucket(price));
    if (!st || st.seen < 2) return null;
    if (st.pulled >= 2 && st.fills === 0) return { kind: 'bait', label: '⚠ likely bait' };
    if (st.fills > 0 && st.seen >= 3)      return { kind: 'real', label: '✓ defended' };
    return null;
  }

  /* ── Heatmap downsample + spoof stats ─────────────────── */
  function _heatTick() {
    if (!_rootAlive()) { _cleanup(); return; }
    _refreshBook();
    if (!_book.bids.length && !_book.asks.length) return;
    const mid = _mid();
    // keep heatmap to ±2% slice for a readable price axis
    const lo = mid * 0.98, hi = mid * 1.02;
    const hb = _book.bids.filter(([p]) => p >= lo).map(r => r.slice());
    const ha = _book.asks.filter(([p]) => p <= hi).map(r => r.slice());
    _heatBuf.push({ t: Date.now(), bids: hb, asks: ha, mid });
    if (_heatBuf.length > HEAT_MAX) _heatBuf.shift();

    _cvdSeries.push({ t: Date.now(), v: _cvd });
    if (_cvdSeries.length > CVD_MAX) _cvdSeries.shift();

    const walls = _walls();
    const cur = new Set(walls.map(w => _bucket(w.price)));
    const recent = _tape.filter(t => Date.now() - t.t < HEAT_TICK_MS + 200);
    cur.forEach(k => {
      const st = _wallStats.get(k) || { seen: 0, pulled: 0, fills: 0, lastWall: 0 };
      st.seen++; st.lastWall = Date.now();
      if (recent.some(t => Math.abs(_bucket(t.price) - k) < 1e-9)) st.fills++;
      _wallStats.set(k, st);
    });
    _prevWalls.forEach(k => {
      if (!cur.has(k)) {
        const through = recent.some(t => Math.abs(_bucket(t.price) - k) < 1e-9);
        if (!through) { const st = _wallStats.get(k); if (st) { st.pulled++; _wallStats.set(k, st); } }
      }
    });
    _prevWalls = [...cur];
    if (_wallStats.size > 600) { const cut = Date.now() - 5 * 60 * 1000; for (const [k, st] of _wallStats) if (st.lastWall < cut) _wallStats.delete(k); }
  }

  /* ══════════════════════════════════════════════════════
     RENDER — static shell
  ══════════════════════════════════════════════════════ */
  function render() {
    const content = document.getElementById('content');
    if (!content) return;
    _cleanup();
    content.innerHTML = `
      <div id="ob-root" class="ob-wrap">
        ${_headHTML()}
        <div class="ob-grid">
          <div class="ob-col-left">
            <div class="ob-card"><div class="ob-card-h">📊 Order Book <span class="ob-sub">±2% book · top ${LADDER_N} shown</span><span id="ob-status" class="ob-status"></span></div><div id="ob-ladder" class="ob-ladder"></div></div>
            <div class="ob-card"><div class="ob-card-h">⚖️ Imbalance <span class="ob-sub">resting bid vs ask intent</span></div><div id="ob-gauge"></div></div>
          </div>
          <div class="ob-col-right">
            <div class="ob-card"><div class="ob-card-h">🔥 Liquidity heatmap <span class="ob-sub">±2% · walls forming / pulling · live monitor</span></div><div id="ob-heat"></div></div>
            <div class="ob-card"><div class="ob-card-h">🧱 Walls &amp; spoof watch</div><div id="ob-walls"></div></div>
            <div class="ob-card"><div class="ob-card-h">📈 CVD &amp; tape <span class="ob-sub">aggressor flow — confirmation</span></div><div id="ob-cvd"></div></div>
          </div>
        </div>
        <div class="ob-card ob-cg-card"><div class="ob-card-h">🔗 Coinglass cross-reference <span class="ob-sub">cross-exchange funding · OI · liquidation clusters (via fund-API proxy)</span></div><div id="ob-cg"></div></div>
        <div id="ob-metrics" class="ob-metrics"></div>
        ${_guideHTML()}
      </div>`;
    _wireEvents();
    _startStream();
  }
  function teardown() { _cleanup(); }

  function _startStream() {
    _resetBuffers();
    _wsSource = 'binance'; _binFails = 0; _reconnDelay = 1000;
    _connect();
    _paintTimer = setInterval(_paintLoop, PAINT_MS);
    _heatTimer  = setInterval(_heatTick, HEAT_TICK_MS);
    _paintLoop();
    _paintCg(); _cgPoll(); _cgTimer = setInterval(_cgPoll, 60000);
  }

  function _headHTML() {
    const pills = SYMBOLS.map(s => `<button class="ob-pill${s === _sym ? ' active' : ''}" data-sym="${s}">${s}</button>`).join('');
    return `
      <div class="ob-head">
        <div>
          <div class="ob-title">📖 Level 2 / Order Book</div>
          <div class="ob-tagline">Binance spot · live WebSocket · <strong>entry-timing &amp; trap overlay</strong> — not a hold thesis</div>
        </div>
        <div class="ob-head-right">
          <div class="ob-pills">${pills}</div>
          <button id="ob-alerts" class="ob-toggle${_alertsOn ? ' on' : ''}" title="Imbalance-flip alerts (Telegram + browser)">🔔 ${_alertsOn ? 'Alerts on' : 'Alerts off'}</button>
        </div>
      </div>`;
  }
  function _wireEvents() {
    document.querySelectorAll('#ob-root .ob-pill').forEach(b => b.addEventListener('click', () => _setSymbol(b.dataset.sym)));
    const al = document.getElementById('ob-alerts');
    if (al) al.addEventListener('click', () => {
      _alertsOn = !_alertsOn;
      localStorage.setItem(LS_ALERTS, _alertsOn ? 'on' : 'off');
      al.classList.toggle('on', _alertsOn);
      al.innerHTML = `🔔 ${_alertsOn ? 'Alerts on' : 'Alerts off'}`;
    });
    document.querySelectorAll('#ob-root .ob-guide-h').forEach(h => h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed')));
  }
  function _setSymbol(s) {
    if (!s || s === _sym) return;
    _sym = s.toUpperCase();
    localStorage.setItem(LS_SYM, _sym);
    document.querySelectorAll('#ob-root .ob-pill').forEach(b => b.classList.toggle('active', b.dataset.sym === _sym));
    _cleanup();
    _startStream();
  }

  /* ══════════════════════════════════════════════════════
     PAINT
  ══════════════════════════════════════════════════════ */
  function _paintLoop() {
    if (!_rootAlive()) { _cleanup(); return; }
    _refreshBook();
    if (Date.now() - _lastMsg > STALE_MS && _status === 'live') _status = 'reconnecting';
    _paintStatus(); _paintLadder(); _paintGauge(); _paintWalls(); _paintHeat(); _paintCvd(); _paintMetrics(); _checkAlerts();
  }

  function _paintStatus() {
    const el = document.getElementById('ob-status'); if (!el) return;
    const map = { live: ['● live', 'var(--good)'], connecting: ['○ connecting…', 'var(--muted)'], reconnecting: ['◌ reconnecting…', 'var(--warn)'], error: ['● error', 'var(--bad)'], idle: ['○ idle', 'var(--muted)'] };
    const [txt, col] = map[_status] || map.idle;
    const seed = _seeded ? '' : ' · seeding';
    el.innerHTML = `<span style="color:${col}">${txt}${seed}</span> <span class="ob-src">${esc(_wsSource)}</span>`;
  }

  function _paintLadder() {
    const el = document.getElementById('ob-ladder'); if (!el) return;
    const mid = _mid();
    if (!mid || !_seeded) { el.innerHTML = `<div class="ob-empty">${_seeded ? 'Waiting for book…' : 'Seeding order book…'}</div>`; return; }
    const top = _book.bids.slice(0, LADDER_N).concat(_book.asks.slice(0, LADDER_N));
    const maxUsd = Math.max(...top.map(([p, s]) => p * s), 1);
    const rowHtml = ([p, s], side) => {
      const usd = p * s, w = (usd / maxUsd * 100).toFixed(0), spoof = _spoofTag(p);
      return `<div class="ob-row ${side}"><span class="ob-bar" style="width:${w}%"></span><span class="ob-px">${_fmtPx(p)}</span><span class="ob-sz">${_fmtSz(s)}</span><span class="ob-usd">${_fmtUsd(usd)}${spoof ? ` <em class="ob-spoof ${spoof.kind}">${spoof.label}</em>` : ''}</span></div>`;
    };
    const asksHtml = _book.asks.slice(0, LADDER_N).slice().reverse().map(r => rowHtml(r, 'ask')).join('');
    const bidsHtml = _book.bids.slice(0, LADDER_N).map(r => rowHtml(r, 'bid')).join('');
    const spreadBps = ((_bestAsk() - _bestBid()) / mid) * 10000;
    const midHtml = `<div class="ob-mid"><span>${_fmtPx(mid)}</span><span class="ob-spread">spread ${spreadBps.toFixed(1)} bps</span></div>`;
    el.innerHTML = asksHtml + midHtml + bidsHtml;
  }

  function _paintGauge() {
    const el = document.getElementById('ob-gauge'); if (!el) return;
    const im = _imbalance();
    const dirTxt = im.dir === 'bull' ? 'BID-heavy (buyers stacked)' : im.dir === 'bear' ? 'ASK-heavy (sellers stacked)' : 'Balanced';
    const dirCol = im.dir === 'bull' ? 'var(--good)' : im.dir === 'bear' ? 'var(--bad)' : 'var(--muted)';
    el.innerHTML = `
      <div class="ob-gauge-bar"><div class="ob-gauge-fill" style="width:${im.score}%;background:${dirCol}"></div><div class="ob-gauge-mid"></div></div>
      <div class="ob-gauge-row"><span style="color:var(--good)">Bids ${_fmtUsd(im.bid)}</span><strong style="color:${dirCol}">${im.score} · ${dirTxt}</strong><span style="color:var(--bad)">Asks ${_fmtUsd(im.ask)}</span></div>
      <div class="ob-gauge-bands">
        <span>±0.5%: <b style="color:var(--good)">${_fmtUsd(im.b05.bid)}</b>/<b style="color:var(--bad)">${_fmtUsd(im.b05.ask)}</b></span>
        <span>±1%: <b style="color:var(--good)">${_fmtUsd(im.b1.bid)}</b>/<b style="color:var(--bad)">${_fmtUsd(im.b1.ask)}</b></span>
        <span>±2%: <b style="color:var(--good)">${_fmtUsd(im.b2.bid)}</b>/<b style="color:var(--bad)">${_fmtUsd(im.b2.ask)}</b></span>
      </div>`;
  }

  function _paintWalls() {
    const el = document.getElementById('ob-walls'); if (!el) return;
    if (!_seeded) { el.innerHTML = `<div class="ob-empty">Seeding…</div>`; return; }
    const walls = _walls();
    if (!walls.length) { el.innerHTML = `<div class="ob-empty">No outsized walls within ±2%.</div>`; return; }
    el.innerHTML = walls.map(w => {
      const spoof = _spoofTag(w.price);
      const col = w.side === 'bid' ? 'var(--good)' : 'var(--bad)';
      return `<div class="ob-wall"><span class="ob-wall-dot" style="background:${col}"></span><span class="ob-wall-px">${_fmtPx(w.price)}</span><span class="ob-wall-dist">${w.distPct >= 0 ? '+' : ''}${w.distPct.toFixed(2)}%</span><span class="ob-wall-usd">${_fmtUsd(w.usd)} · ${(w.share * 100).toFixed(0)}% of ${w.side}s</span>${spoof ? `<span class="ob-spoof ${spoof.kind}">${spoof.label}</span>` : '<span class="ob-spoof watch">…watching</span>'}</div>`;
    }).join('');
  }

  function _paintHeat() {
    const el = document.getElementById('ob-heat'); if (!el) return;
    if (_heatBuf.length < 2) { el.innerHTML = `<div class="ob-empty">Building heatmap… (needs ~${Math.ceil(HEAT_TICK_MS * 2 / 1000)}s)</div>`; return; }
    const W = 560, H = 240, padR = 58;
    const cols = _heatBuf.length, cw = (W - padR) / cols;
    let pmin = Infinity, pmax = -Infinity;
    _heatBuf.forEach(sn => [...sn.bids, ...sn.asks].forEach(([p]) => { if (p < pmin) pmin = p; if (p > pmax) pmax = p; }));
    if (!isFinite(pmin) || pmax <= pmin) { el.innerHTML = `<div class="ob-empty">Building heatmap…</div>`; return; }
    const yOf = p => H - ((p - pmin) / (pmax - pmin)) * H;
    let smax = 0; _heatBuf.forEach(sn => [...sn.bids, ...sn.asks].forEach(([p, s]) => { if (p * s > smax) smax = p * s; }));
    smax = smax || 1;
    const bandH = Math.max(2, H / 110);
    let cells = '';
    _heatBuf.forEach((sn, ci) => {
      const x = ci * cw;
      const draw = rows => rows.forEach(([p, s]) => {
        const t = Math.min(1, (p * s) / smax);
        if (t < 0.06) return;
        cells += `<rect x="${x.toFixed(1)}" y="${(yOf(p) - bandH / 2).toFixed(1)}" width="${Math.max(1, cw).toFixed(1)}" height="${bandH.toFixed(1)}" fill="${_heatRgba(t, 1)}"/>`;
      });
      draw(sn.bids); draw(sn.asks);
    });
    const mid = _mid();
    let midLine = '';
    if (mid && mid >= pmin && mid <= pmax) {
      const y = yOf(mid);
      midLine = `<line x1="0" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.55)" stroke-dasharray="4 3" stroke-width="1"/><text x="${W - padR + 4}" y="${(y + 3).toFixed(1)}" fill="var(--text)" font-size="11" font-weight="700">${_fmtPx(mid)}</text>`;
    }
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="ob-heat-svg" preserveAspectRatio="none">${cells}${midLine}</svg><div class="ob-heat-legend"><span>← older</span><span>now →</span></div>`;
  }

  function _paintCvd() {
    const el = document.getElementById('ob-cvd'); if (!el) return;
    const series = _cvdSeries;
    let spark = '';
    if (series.length >= 2) {
      const W = 320, H = 56, vs = series.map(p => p.v), lo = Math.min(...vs), hi = Math.max(...vs), rng = (hi - lo) || 1;
      const pts = series.map((p, i) => `${(i / (series.length - 1) * W).toFixed(1)},${(H - ((p.v - lo) / rng) * H).toFixed(1)}`).join(' ');
      spark = `<svg viewBox="0 0 ${W} ${H}" class="ob-cvd-svg" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${_cvd >= 0 ? 'var(--good)' : 'var(--bad)'}" stroke-width="1.5"/></svg>`;
    }
    const cvdCol = _cvd >= 0 ? 'var(--good)' : 'var(--bad)';
    const pxNow = _mid(), pxThen = _heatBuf[0]?.mid;
    let diverge = '';
    if (pxNow && pxThen && series.length > 4) {
      const priceUp = pxNow > pxThen, cvdUp = _cvd > (series[0]?.v ?? 0);
      if (priceUp !== cvdUp) diverge = `<span class="ob-diverge">⚠ CVD/price divergence</span>`;
    }
    const tape = _tape.slice(0, 12).map(t => `<div class="ob-trade ${t.side}"><span>${_fmtPx(t.price)}</span><span>${_fmtSz(t.qty)}</span><span class="ob-trade-side">${t.side === 'buy' ? '▲ buy' : '▼ sell'}</span></div>`).join('');
    el.innerHTML = `<div class="ob-cvd-head"><strong style="color:${cvdCol}">CVD ${_cvd >= 0 ? '+' : '−'}${_fmtUsd(Math.abs(_cvd))}</strong>${diverge}</div>${spark}<div class="ob-tape">${tape || '<div class="ob-empty">Waiting for trades…</div>'}</div>`;
  }

  function _paintMetrics() {
    const el = document.getElementById('ob-metrics'); if (!el) return;
    const mid = _mid(), im = _imbalance(), biggest = _walls()[0];
    const spreadBps = mid ? ((_bestAsk() - _bestBid()) / mid) * 10000 : 0;
    const cells = [
      ['Mid', mid ? _fmtPx(mid) : '—'],
      ['Spread', mid ? spreadBps.toFixed(1) + ' bps' : '—'],
      ['Bid depth ±2%', _fmtUsd(im.b2.bid)],
      ['Ask depth ±2%', _fmtUsd(im.b2.ask)],
      ['Imbalance', `${im.score} (${im.dir})`],
      ['CVD', `${_cvd >= 0 ? '+' : '−'}${_fmtUsd(Math.abs(_cvd))}`],
      ['Biggest wall', biggest ? `${_fmtUsd(biggest.usd)} @ ${biggest.distPct >= 0 ? '+' : ''}${biggest.distPct.toFixed(2)}%` : '—'],
    ];
    el.innerHTML = cells.map(([k, v]) => `<div class="ob-metric"><span class="ob-metric-k">${k}</span><span class="ob-metric-v">${v}</span></div>`).join('');
  }

  /* ── Alerts (imbalance flip → Telegram + browser) ─────── */
  function _checkAlerts() {
    if (!_alertsOn || !_seeded) return;
    const im = _imbalance();
    if (im.dir === 'neutral' || im.dir === _lastImbState) { _lastImbState = im.dir; return; }
    _lastImbState = im.dir;
    const msg = `📖 *Level 2 ${esc(_sym)}* imbalance flipped *${im.dir.toUpperCase()}* (score ${im.score}) — ${im.dir === 'bull' ? 'bids stacking' : 'asks stacking'}`;
    try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') { const n = new Notification(`Level 2 ${_sym} — ${im.dir}`, { body: `Imbalance ${im.score}`, tag: `ob-${_sym}` }); setTimeout(() => n.close(), 9000); } } catch (_) {}
    try { if (typeof Telegram !== 'undefined' && Telegram.isEnabled?.()) Telegram.send(msg, { parse_mode: 'Markdown' }).catch(() => {}); } catch (_) {}
  }

  /* ══════════════════════════════════════════════════════
     COINGLASS CROSS-REFERENCE  (proxied; no Coinglass UI rebuilt)
  ══════════════════════════════════════════════════════ */
  async function _cgPoll() {
    if (!_rootAlive()) { if (_cgTimer) { clearInterval(_cgTimer); _cgTimer = null; } return; }
    if (_cgNoKey) return;                       // key absent → don't hammer the proxy
    const sym = _sym;
    const [f, o, l] = await Promise.all([
      _cgFetch('funding', { symbol: sym }),
      _cgFetch('oi', { symbol: sym }),
      _cgFetch('liq', { symbol: sym, interval: '1h', limit: '24' }),
    ]);
    if (sym !== _sym || !_rootAlive()) return;  // symbol switched mid-fetch
    if ([f, o, l].some(r => r.status === 503 && r.body && r.body.needs_key)) { _cgNoKey = true; _cgState = 'needs_key'; _paintCg(); return; }
    if ([f, o, l].every(r => !r.ok)) { _cgState = 'error'; _paintCg(); return; }
    _cg = { funding: f.body, oi: o.body, liq: l.body }; _cgState = 'ok'; _paintCg();
  }

  function _paintCg() {
    const el = document.getElementById('ob-cg'); if (!el) return;
    if (_cgState === 'idle' || _cgState === 'loading') { el.innerHTML = `<div class="ob-empty">Checking Coinglass…</div>`; return; }
    if (_cgState === 'needs_key') {
      el.innerHTML = `<div class="ob-cg-cta"><div class="ob-cg-cta-t">🔌 Coinglass not connected</div><div class="ob-cg-cta-b">Set <code>COINGLASS_API_KEY</code> in <code>~/.fund_env</code> (and as a Railway env var) to light up cross-exchange <b>funding</b>, <b>open interest</b>, and aggregated <b>liquidation clusters</b> here — overlaid on your live book. Optional; ~$29/mo Hobbyist. Nothing from coinglass.com is rebuilt — this only surfaces their data inside your tab.</div></div>`;
      return;
    }
    if (_cgState === 'error') { el.innerHTML = `<div class="ob-empty">Coinglass fetch failed — proxy or key issue. Retrying each minute.</div>`; return; }
    // ok — confirm flow without rendering numbers we haven't verified (Rule #2);
    // exact field mapping is finalized against the first live response.
    el.innerHTML = `<div class="ob-cg-ok"><span class="ob-cg-badge">● Coinglass connected</span> Data flowing for <b>${esc(_sym)}</b> — funding (${_cgRows(_cg.funding).length}), OI (${_cgRows(_cg.oi).length}), liquidation (${_cgRows(_cg.liq).length}) rows. Field mapping + on-book overlay finalize once the live shape is confirmed.</div>`;
  }

  /* ══════════════════════════════════════════════════════
     GUIDE
  ══════════════════════════════════════════════════════ */
  function _guideHTML() {
    return `
    <div class="ob-card ob-guide">
      <div class="ob-guide-h">📚 How to read &amp; trade Level 2 <span class="ob-sub">click to collapse</span></div>
      <div class="ob-guide-body">
        <div class="ob-guide-doctrine"><strong>This is a timing overlay, not a thesis.</strong> Order-book imbalance has a half-life of <em>seconds to ~1 minute</em>. Use it to time the trigger on a setup you already have — never to pick direction over hours.</div>
        <ol class="ob-guide-steps">
          <li><strong>Find the setup first</strong> with your ICT tools (validated OB, killzone, Confluence score).</li>
          <li><strong>Time the entry</strong>: enter when <em>imbalance</em> tilts your way AND <em>CVD</em> confirms aggressors are on your side. CVD diverging from price = warning.</li>
          <li><strong>Vet the walls</strong> at your stop/target — a big wall is <em>suspect until proven</em>: <span class="ob-spoof bait">⚠ likely bait</span> = appears &amp; pulls with no trades hitting it; <span class="ob-spoof real">✓ defended</span> = persists &amp; refills as trades hit it (iceberg).</li>
          <li><strong>Never hold on imbalance alone</strong> — its edge decays in under a minute.</li>
        </ol>
        <div class="ob-guide-grid">
          <div><b>Imbalance gauge</b> — resting bid vs ask $ across ±0.5/1/2%. >58 bid-heavy, <42 ask-heavy.</div>
          <div><b>Walls</b> — levels ≥ ${(WALL_SHARE * 100).toFixed(0)}% of their ±2% side depth. Distance-from-mid % shown.</div>
          <div><b>Heatmap</b> — ±2% resting size over time; bright horizontal bands = persistent walls, fading streaks = pulled liquidity.</div>
          <div><b>CVD</b> — cumulative taker buy − sell ($). Rising = aggressive buyers in control.</div>
        </div>
        <div class="ob-guide-note">⚠ <b>Limits:</b> single-venue (Binance spot); history is in-memory (resets on reload — a live monitor, not an archive); spoof tags need ~30–60s of book history to settle. Deep liquid books (BTC/ETH) concentrate near the touch — walls read clearest on thinner alts. Phase 2 (Coinglass) overlays real aggregated <em>cross-exchange</em> liq clusters + a deeper book.</div>
      </div>
    </div>`;
  }

  return { render, teardown };
})();
