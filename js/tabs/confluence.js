/* ═══════════════════════════════════════════════════════════
   CONFLUENCE TAB v1
   Live ICT alignment scoring across BTC/ETH/XRP/SOL/SUI.
   Fetches Binance public klines (15m/1h/4h), runs the pure
   detectors from ICTDetect, aggregates a 0-100 confluence
   score per asset and renders a ranked alignment table.
════════════════════════════════════════════════════════════ */
const ConfluenceTab = (() => {

  const SYMBOLS = ['BTC', 'ETH', 'XRP', 'SOL', 'SUI'];
  const TFS = ['15m', '1h', '4h'];
  const BINANCE = 'https://api.binance.com/api/v3/klines';
  const LW_API = 'http://127.0.0.1:8766';
  const REFRESH_MS = 60_000;
  const KLINE_TTL = 45_000;

  // Detector base weight, keyed by *type* (TF-independent so anchor selector works).
  // Setups with a meaningful playbook winRate (tradeCount ≥ 5) scale this by (wr-50)/50.
  // LTF = lower (entry) timeframe, MTF = mid, HTF = higher (trend) — relative to anchor.
  const WEIGHTS_BY_TYPE = {
    bias:       2.0,
    adx_gate:   1.6,
    fvg_ltf:    1.2,
    fvg_mtf:    1.4,
    ob_ltf:     1.4,
    ob_mtf:     1.6,
    sweep_ltf:  1.3,
    sweep_mtf:  1.5,
    cisd:       1.0,
    bos:        1.0,
    near_level: 1.3,
    lw_align:   1.2,
    lw_funding: 1.0,
    lw_oi:      0.8,
    lw_liq:     0.9,
  };
  // Detector type → playbook setup name fragment for fuzzy weight lookup
  const SETUP_MAP_BY_TYPE = {
    fvg_ltf:'fvg', fvg_mtf:'fvg',
    ob_ltf:'order block', ob_mtf:'order block',
    sweep_ltf:'sweep', sweep_mtf:'sweep',
    cisd:'cisd',
    bos:'continuation',
  };

  // Anchor → 3-TF set (LTF / MTF / HTF). User picks anchor via TF selector.
  const TF_SETS = {
    '15m': { ltf: '15m', mtf: '1h', htf: '4h' },
    '1h':  { ltf: '1h',  mtf: '4h', htf: 'D'  },
    '4h':  { ltf: '4h',  mtf: 'D',  htf: 'W'  },
    'D':   { ltf: 'D',   mtf: 'W',  htf: 'M'  },
  };
  const TF_OPTIONS = ['15m', '1h', '4h', 'D'];

  // Manual refresh only by default — data sits in memory until the
  // user clicks "Pull data". Auto-refresh is opt-in via the toggle.
  let _autoOn = localStorage.getItem('jb_conf_auto') === 'on';
  let _anchorTF = TF_OPTIONS.includes(localStorage.getItem('jb_conf_tf'))
    ? localStorage.getItem('jb_conf_tf') : '15m';

  // Alerts: fire browser notification + Telegram on threshold crossings
  let _alertsOn  = localStorage.getItem('jb_conf_alerts_on') !== 'off';   // default on
  let _alertThr  = parseInt(localStorage.getItem('jb_conf_alert_thr') || '70', 10);
  // Direction + setup-count filters (UI quick filters on the table)
  let _dirFilter = localStorage.getItem('jb_conf_dir_filter') || 'all';   // all|bull|bear
  let _minSetups = parseInt(localStorage.getItem('jb_conf_min_setups') || '0', 10);
  // Guide starts collapsed by default after first visit
  let _guideCollapsed = localStorage.getItem('jb_conf_guide_collapsed') !== 'off';
  let _refreshTimer = null;
  let _lastRun = null;
  let _klineCache = new Map();   // key `${sym}-${tf}` → { t, data }
  let _expandedSym = null;

  // Chart Scanner state
  let _scanImg  = null;   // { b64, mediaType } — current loaded image
  let _scanBusy = false;

  /* ── tiny helpers ────────────────────────────────────── */
  const esc = s => (s == null ? '' : String(s).replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])));

  function _isActiveTab() {
    return document.querySelector('.nav-item.active')?.dataset.tab === 'confluence';
  }

  function fmtPrice(p) {
    if (!Number.isFinite(p)) return '—';
    if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 1 });
    if (p >= 1)    return p.toFixed(3);
    return p.toFixed(5);
  }

  function timeAgo(ms) {
    if (!ms) return '—';
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    return `${Math.floor(s/3600)}h ago`;
  }

  /* ── kline fetch (cached, multi-source w/ fallback) ──────
     Binance api.binance.com is geo-blocked from many regions
     (and from US ISPs entirely). Bybit and OKX are open.
     Try in order: Bybit → Binance → OKX.                  */
  const TF_BYBIT = { '15m': '15',  '1h': '60', '4h': '240', 'D': 'D',  'W': 'W',  'M': 'M'  };
  const TF_OKX   = { '15m': '15m', '1h': '1H', '4h': '4H',  'D': '1D', 'W': '1W', 'M': '1M' };
  const TF_BIN   = { '15m': '15m', '1h': '1h', '4h': '4h',  'D': '1d', 'W': '1w', 'M': '1M' };

  function _timeoutSignal(ms) {
    return AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
  }

  async function _fetchBybit(sym, tf, limit) {
    const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${sym}USDT&interval=${TF_BYBIT[tf]}&limit=${limit}`;
    const r = await fetch(url, { mode: 'cors', cache: 'no-store', signal: _timeoutSignal(8000) });
    if (!r.ok) throw new Error(`bybit ${r.status}`);
    const j = await r.json();
    if (j.retCode !== 0 || !j.result?.list) throw new Error('bybit bad payload');
    // Bybit returns newest first — reverse for chronological order
    return j.result.list.slice().reverse().map(k => ({
      t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5]
    }));
  }

  async function _fetchBinance(sym, tf, limit) {
    const url = `${BINANCE}?symbol=${sym}USDT&interval=${TF_BIN[tf]}&limit=${limit}`;
    const r = await fetch(url, { mode: 'cors', cache: 'no-store', signal: _timeoutSignal(8000) });
    if (!r.ok) throw new Error(`binance ${r.status}`);
    const raw = await r.json();
    return raw.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
  }

  async function _fetchOKX(sym, tf, limit) {
    const url = `https://www.okx.com/api/v5/market/candles?instId=${sym}-USDT&bar=${TF_OKX[tf]}&limit=${limit}`;
    const r = await fetch(url, { mode: 'cors', cache: 'no-store', signal: _timeoutSignal(8000) });
    if (!r.ok) throw new Error(`okx ${r.status}`);
    const j = await r.json();
    if (j.code !== '0' || !j.data) throw new Error('okx bad payload');
    return j.data.slice().reverse().map(k => ({
      t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5]
    }));
  }

  async function _fetchKlines(sym, tf, limit = 220) {
    const key = `${sym}-${tf}`;
    const cached = _klineCache.get(key);
    if (cached && Date.now() - cached.t < KLINE_TTL) return cached.data;
    const sources = [
      { name: 'bybit',   fn: _fetchBybit },
      { name: 'binance', fn: _fetchBinance },
      { name: 'okx',     fn: _fetchOKX },
    ];
    for (const src of sources) {
      try {
        const data = await src.fn(sym, tf, limit);
        if (data && data.length >= 50) {
          _klineCache.set(key, { t: Date.now(), data, source: src.name });
          return data;
        }
      } catch (e) {
        console.warn(`[confluence] ${src.name} ${sym} ${tf} failed:`, e.message);
      }
    }
    console.error(`[confluence] ALL sources failed for ${sym} ${tf}`);
    return null;
  }

  async function _fetchLW() {
    try {
      const r = await fetch(`${LW_API}/api/scores?tf=4h`, {
        mode: 'cors', cache: 'no-store',
        signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined,
      });
      if (!r.ok) return null;
      return r.json();
    } catch { return null; }
  }

  async function _fetchDailyReport() {
    try {
      const r = await fetch(`js/data/daily_report.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) return null;
      return r.json();
    } catch { return null; }
  }

  /* ── playbook weight adjustment ──────────────────────── */
  function _playbookAdjusted(detectorType) {
    const base = WEIGHTS_BY_TYPE[detectorType] || 1.0;
    const frag = SETUP_MAP_BY_TYPE[detectorType];
    if (!frag) return base;
    try {
      const play = (typeof DB !== 'undefined' ? DB.get(DB.KEYS.play) : null) || [];
      const match = play.find(p =>
        (p.name || '').toLowerCase().includes(frag) && (p.tradeCount || 0) >= 5
      );
      if (!match) return base;
      const wr = match.winRate || 50;
      const factor = 1 + ((wr - 50) / 50) * 0.5;   // ±50% swing
      return base * Math.max(0.3, factor);
    } catch { return base; }
  }

  /* ── parse daily report levels for an asset ──────────── */
  function _levelsFromDaily(daily, sym) {
    if (!daily?.tickers) return [];
    const t = daily.tickers.find(x => (x.sym || '').toUpperCase() === sym);
    if (!t?.levels) return [];
    return t.levels.map(row => {
      // row format: [label, "$1.23", note] or [label, value, note]
      const label = row[0] || '';
      const raw = String(row[1] || '').replace(/[$,]/g, '');
      const value = parseFloat(raw);
      return { label, value };
    }).filter(l => Number.isFinite(l.value));
  }

  /* ── score one asset ─────────────────────────────────── */
  async function _scoreAsset(sym, daily, lw, btcShock = null) {
    const { ltf, mtf, htf } = TF_SETS[_anchorTF];
    const [kLTF, kMTF, kHTF] = await Promise.all([
      _fetchKlines(sym, ltf),
      _fetchKlines(sym, mtf),
      _fetchKlines(sym, htf),
    ]);
    if (!kLTF || !kMTF || !kHTF) {
      return { sym, score: null, dir: null, fired: [], missed: [], price: null, error: 'kline fetch failed' };
    }
    const price = kLTF[kLTF.length - 1].c;

    const detectors = [];
    function run(id, type, fn) {
      try { detectors.push({ id, type, ...fn() }); }
      catch (e) { detectors.push({ id, type, fired: false, dir: null, strength: 0, evidence: 'err: ' + e.message }); }
    }

    run(`bias_${htf}`,    'bias',      () => ICTDetect.detectBias(kHTF));
    run(`adx_gate_${htf}`,'adx_gate',  () => ICTDetect.detectADXGate(kHTF));
    run(`fvg_${ltf}`,     'fvg_ltf',   () => ICTDetect.detectFVG(kLTF));
    run(`fvg_${mtf}`,     'fvg_mtf',   () => ICTDetect.detectFVG(kMTF));
    run(`ob_${ltf}`,      'ob_ltf',    () => ICTDetect.detectOB(kLTF));
    run(`ob_${mtf}`,      'ob_mtf',    () => ICTDetect.detectOB(kMTF));
    run(`sweep_${ltf}`,   'sweep_ltf', () => ICTDetect.detectSweep(kLTF));
    run(`sweep_${mtf}`,   'sweep_mtf', () => ICTDetect.detectSweep(kMTF));
    run(`cisd_${ltf}`,    'cisd',      () => ICTDetect.detectCISD(kLTF));
    run(`bos_${mtf}`,     'bos',       () => ICTDetect.detectBOS(kMTF));

    // near_level (Daily Report)
    const levels = _levelsFromDaily(daily, sym);
    run('near_level', 'near_level', () => ICTDetect.nearLevel(price, levels, 0.5));

    // LW family: bias + funding extremity + OI ROC + liquidation rate
    if (lw?.scores) {
      const row = lw.scores.find(s => (s.asset || '').toUpperCase() === sym);
      if (row) {
        // 1) Bias
        if (row.bias && ['bull','bear'].includes(row.bias)) {
          detectors.push({
            id: 'lw_align', type: 'lw_align', fired: true, dir: row.bias,
            strength: Math.min(1, Math.abs(50 - (row.score ?? 50)) / 50),
            evidence: `LW 4h bias ${row.bias} (score ${row.score?.toFixed?.(0) ?? '—'})`,
          });
        } else {
          detectors.push({ id: 'lw_align', type: 'lw_align', fired: false, dir: null, strength: 0, evidence: 'LW neutral/unavailable' });
        }
        // 2) Funding extremity — positive funding = longs paying = bearish contrarian
        const fz = row.components?.funding_extremity?.z;
        if (typeof fz === 'number' && Math.abs(fz) > 1.5) {
          const dir = fz > 0 ? 'bear' : 'bull';
          detectors.push({
            id: 'lw_funding', type: 'lw_funding', fired: true, dir,
            strength: Math.min(1, (Math.abs(fz) - 1.5) / 1.5),
            evidence: `Funding z ${fz.toFixed(2)} — ${dir === 'bear' ? 'longs paying (squeeze setup)' : 'shorts paying (rip setup)'}`,
          });
        }
        // 3) OI 1h ROC — rapid OI rise = leverage building, neutral dir but adds strength to existing bias
        const oz = row.components?.oi_1h_roc?.z;
        if (typeof oz === 'number' && Math.abs(oz) > 1.5) {
          detectors.push({
            id: 'lw_oi', type: 'lw_oi', fired: true, dir: null,
            strength: Math.min(1, (Math.abs(oz) - 1.5) / 1.5),
            evidence: `OI ROC z ${oz.toFixed(2)} — leverage ${oz > 0 ? 'building' : 'unwinding'}`,
          });
        }
        // 4) Liquidation rate — fresh liqs in direction confirm sweep narrative
        const lz = row.components?.liq_usd_per_hour?.z;
        const lvalue = row.components?.liq_usd_per_hour?.value;
        if (typeof lz === 'number' && lz > 1.5) {
          // Heavy liquidations alone are neutral but we tag with dominant dir of detected fires
          detectors.push({
            id: 'lw_liq', type: 'lw_liq', fired: true, dir: null,
            strength: Math.min(1, (lz - 1.5) / 1.5),
            evidence: `Liquidations z ${lz.toFixed(2)} ($${(lvalue/1e6 || 0).toFixed(1)}M/h) — flush in progress`,
          });
        }
      }
    }

    // aggregate
    let bullSum = 0, bearSum = 0;
    detectors.forEach(d => {
      if (!d.fired || !d.dir) return;
      let w = _playbookAdjusted(d.type || d.id);
      // BTC correlation veto: alts that point opposite to BTC's recent shock get dimmed.
      // BTC itself is exempt. Bias detector exempt (it's already HTF context).
      if (btcShock && sym !== 'BTC' && d.type !== 'bias' && d.dir !== btcShock.dir) {
        w *= 0.5;
      }
      if (d.dir === 'bull') bullSum += d.strength * w;
      else if (d.dir === 'bear') bearSum += d.strength * w;
    });

    const kzActive = ICTDetect.isKillzoneActive();
    const kzMult = kzActive ? 1.15 : 1.0;
    const net = (bullSum - bearSum) * kzMult;
    const SCALE = 7;
    let score = Math.max(0, Math.min(100, 50 + net * SCALE));

    const firedList = detectors.filter(d => d.fired);
    const dirVotes = { bull: firedList.filter(d => d.dir === 'bull').length,
                       bear: firedList.filter(d => d.dir === 'bear').length };
    const dominantDir = dirVotes.bull > dirVotes.bear ? 'bull'
                      : dirVotes.bear > dirVotes.bull ? 'bear' : null;
    const dominantCount = dominantDir ? dirVotes[dominantDir] : 0;

    // cap: ≥3 detectors in dominant dir required to exceed 65 / fall below 35
    if (dominantCount < 3) {
      if (score > 65) score = Math.min(score, 60);
      if (score < 35) score = Math.max(score, 40);
    }

    const dir = score >= 60 ? 'bull' : score <= 40 ? 'bear' : 'neutral';
    return {
      sym, score, dir, price, fired: firedList, missed: detectors.filter(d => !d.fired),
      detectors, kzActive, kzName: ICTDetect.activeKillzone(),
      dominantCount, totalDetectors: detectors.length,
      bullSum, bearSum,
    };
  }

  /* ── persistence: score history + latest per-TF snapshot ───────
     localStorage keys:
       jb_conf_history    — array of last N pulls (any anchor), per-asset score points
       jb_conf_per_tf     — latest per-anchor snapshot for cross-TF agreement
  */
  const HISTORY_CAP = 40;        // total entries across all anchors

  function _loadHistory() {
    try { return JSON.parse(localStorage.getItem('jb_conf_history') || '[]'); }
    catch { return []; }
  }
  function _saveHistory(arr) {
    try { localStorage.setItem('jb_conf_history', JSON.stringify(arr.slice(-HISTORY_CAP))); }
    catch (e) { console.warn('[confluence] history save failed', e); }
  }
  function _loadPerTF() {
    try { return JSON.parse(localStorage.getItem('jb_conf_per_tf') || '{}'); }
    catch { return {}; }
  }
  function _savePerTF(map) {
    try { localStorage.setItem('jb_conf_per_tf', JSON.stringify(map)); }
    catch (e) { console.warn('[confluence] per-tf save failed', e); }
  }

  /* ── Hit-rate tracking ──────────────────────────────────
     localStorage `jb_conf_calls` — array of
       { ts, sym, anchor, score, dir, price, status:'pending'|'hit'|'miss'|'expired', outcome_r?, checked_at? }
     A "call" is logged for every asset crossing actionable on a fresh pull (we
     don't double-log; we only log if the previous pull at this anchor wasn't
     also actionable in the same direction). After 4 hours we check current
     price vs entry — moved ≥1 LTF-ATR in dir → hit, opposite → miss, neither → expired.
  */
  function _loadCalls() {
    try { return JSON.parse(localStorage.getItem('jb_conf_calls') || '[]'); }
    catch { return []; }
  }
  function _saveCalls(arr) {
    try { localStorage.setItem('jb_conf_calls', JSON.stringify(arr.slice(-200))); }
    catch (e) { console.warn('[confluence] calls save failed', e); }
  }

  // Returns { totalChecked, hits, misses, expired, hitRate, lastN }
  function _hitRateSummary() {
    const calls = _loadCalls();
    const checked = calls.filter(c => c.status !== 'pending');
    const hits    = checked.filter(c => c.status === 'hit').length;
    const misses  = checked.filter(c => c.status === 'miss').length;
    const expired = checked.filter(c => c.status === 'expired').length;
    const hitRate = checked.length ? (hits / checked.length) * 100 : null;
    return { totalChecked: checked.length, hits, misses, expired, hitRate, totalCalls: calls.length };
  }

  /* ── Alerts (browser + Telegram) ──────────────────────── */
  function _maybeRequestNotifPermission() {
    try {
      if (typeof Notification === 'undefined') return;
      if (Notification.permission === 'default') Notification.requestPermission();
    } catch {}
  }

  async function _fireAlerts(prevSnap, newResults) {
    if (!_alertsOn) return;
    const prev = prevSnap?.scores || {};
    for (const r of newResults) {
      if (!r || r.score == null) continue;
      const prevScore = prev[r.sym]?.score ?? null;
      const wasActionable = prevScore != null && (prevScore >= _alertThr || prevScore <= (100 - _alertThr));
      const isActionable  = (r.score >= _alertThr || r.score <= (100 - _alertThr));
      // Fire on the transition into actionable
      if (isActionable && !wasActionable) {
        const arrow = r.dir === 'bull' ? '▲' : r.dir === 'bear' ? '▼' : '─';
        const msg = `${arrow} ${r.sym} ${r.score.toFixed(0)} (${_anchorTF}) — ${r.fired.length}/${r.totalDetectors} setups fired`;
        // Browser notification
        try {
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            const n = new Notification('Confluence alert', {
              body: msg, tag: `conf-${r.sym}-${_anchorTF}`, silent: false,
            });
            setTimeout(() => n.close(), 12000);
          }
        } catch (e) { console.warn('[confluence] notif fail', e); }
        // Telegram
        try {
          if (typeof Telegram !== 'undefined' && Telegram.isEnabled?.()) {
            const fired = r.fired.slice(0, 5).map(d => d.id).join(', ');
            const tgMsg = `🎯 *Confluence alert*\n${msg}\nTop fires: ${fired}\nKZ: ${r.kzActive ? r.kzName : 'off'}`;
            Telegram.send(tgMsg, { parse_mode: 'Markdown' }).catch(() => {});
          }
        } catch (e) { console.warn('[confluence] tg fail', e); }
      }
    }
  }

  /* ── BTC dominance shock (correlation veto) ─────────────
     If BTC's last 1h close moved > 2× 1h ATR, dim alt signals
     that point opposite. Returns null if no shock. */
  async function _btcShockCheck() {
    const k1h = await _fetchKlines('BTC', '1h');
    if (!k1h || k1h.length < 30) return null;
    const last = k1h[k1h.length - 1];
    const prev = k1h[k1h.length - 2];
    const atr1h = ICTDetect.atr(k1h, 14);
    if (!atr1h) return null;
    const move = last.c - prev.c;
    const mag = Math.abs(move);
    if (mag < atr1h * 2) return null;
    return {
      dir: move > 0 ? 'bull' : 'bear',
      pct: (move / prev.c) * 100,
      atrMult: mag / atr1h,
    };
  }

  /* ── Macro news guard ───────────────────────────────────
     Returns the nearest high-impact event if it's today (no times in
     dataset, treat date-only as full-day guard). Caller dims signals. */
  function _macroGuardActive() {
    if (typeof MacroEvents === 'undefined') return null;
    const today = new Date().toISOString().slice(0, 10);
    const onToday = MacroEvents.onDate?.(today) || [];
    const hi = onToday.find(e => e.impact === 'high');
    return hi || null;
  }

  // Return ordered list of {ts, score, dir} for a symbol at the current anchor
  function _historyForSym(sym, anchor = _anchorTF, limit = 8) {
    return _loadHistory()
      .filter(h => h.anchor === anchor && h.scores && h.scores[sym])
      .slice(-limit)
      .map(h => ({ ts: h.ts, score: h.scores[sym].score, dir: h.scores[sym].dir }));
  }

  // For each symbol, count actionable anchors (score ≥65 or ≤35 in stored snapshot).
  // Returns { sym: {bull:N, bear:N, neutral:N, totalSeen:N, anchors:{tf:{score,dir,age}}} }
  function _crossTFAgreement() {
    const perTF = _loadPerTF();
    const summary = {};
    for (const sym of SYMBOLS) summary[sym] = { bull: 0, bear: 0, neutral: 0, totalSeen: 0, anchors: {} };
    for (const tf of TF_OPTIONS) {
      const snap = perTF[tf];
      if (!snap || !snap.scores) continue;
      for (const sym of SYMBOLS) {
        const s = snap.scores[sym];
        if (!s || s.score == null) continue;
        summary[sym].totalSeen += 1;
        const ageMs = Date.now() - (snap.ts || 0);
        summary[sym].anchors[tf] = { score: s.score, dir: s.dir, age: ageMs };
        if (s.score >= 65) summary[sym].bull += 1;
        else if (s.score <= 35) summary[sym].bear += 1;
        else summary[sym].neutral += 1;
      }
    }
    return summary;
  }

  /* ── refresh cycle ───────────────────────────────────── */
  async function _refresh() {
    const root = document.getElementById('confluenceRoot');
    if (!root) return;
    const lastUpdEl = document.getElementById('confLastUpd');
    if (lastUpdEl) lastUpdEl.textContent = 'fetching…';

    // Snapshot prev for alert comparison BEFORE we overwrite
    const prevSnap = _loadPerTF()[_anchorTF];

    // Macro + BTC shock context fetched in parallel with data
    const [daily, lw, btcShock] = await Promise.all([
      _fetchDailyReport(), _fetchLW(), _btcShockCheck(),
    ]);
    const macroGuard = _macroGuardActive();

    const results = await Promise.all(SYMBOLS.map(s => _scoreAsset(s, daily, lw, btcShock)));

    // sort by most extreme score (distance from 50), tiebreak fired count
    results.sort((a, b) => {
      const da = a.score == null ? -1 : Math.abs(a.score - 50);
      const db = b.score == null ? -1 : Math.abs(b.score - 50);
      if (db !== da) return db - da;
      return (b.fired?.length || 0) - (a.fired?.length || 0);
    });

    _lastRun = {
      ts: Date.now(), results,
      lwOk: !!lw, dailyOk: !!daily,
      btcShock, macroGuard,
    };

    // Persist history + per-TF snapshot
    const scoreMap = {};
    results.forEach(r => {
      scoreMap[r.sym] = { score: r.score, dir: r.dir, fired: r.fired?.length || 0, price: r.price };
    });
    const history = _loadHistory();
    history.push({ ts: _lastRun.ts, anchor: _anchorTF, scores: scoreMap });
    _saveHistory(history);
    const perTF = _loadPerTF();
    perTF[_anchorTF] = { ts: _lastRun.ts, scores: scoreMap };
    _savePerTF(perTF);

    // Hit-rate: log new actionable calls + check pending ones
    _logActionableCalls(results, prevSnap);
    _checkPendingCalls();

    // Fire browser + telegram alerts on threshold crossings
    _fireAlerts(prevSnap, results);

    _renderTable();
  }

  /* ── Hit-rate: log + follow-up check ──────────────────── */
  function _logActionableCalls(results, prevSnap) {
    const calls = _loadCalls();
    const prevScores = prevSnap?.scores || {};
    let added = 0;
    for (const r of results) {
      if (r.score == null) continue;
      const isAct = r.score >= 70 || r.score <= 30;
      if (!isAct) continue;
      const prev = prevScores[r.sym];
      const prevAct = prev && (prev.score >= 70 || prev.score <= 30) && prev.dir === r.dir;
      if (prevAct) continue; // already logged on prior actionable pull
      calls.push({
        ts: _lastRun.ts, sym: r.sym, anchor: _anchorTF,
        score: r.score, dir: r.dir, price: r.price,
        status: 'pending',
      });
      added += 1;
    }
    if (added) _saveCalls(calls);
  }

  // For each pending call >4h old, fetch current price and decide outcome.
  // Hit  = price moved ≥1× kLTF ATR in the called direction.
  // Miss = price moved ≥1× ATR opposite direction.
  // Else = expired (chop).
  async function _checkPendingCalls() {
    const calls = _loadCalls();
    const FOUR_H = 4 * 3600 * 1000;
    const pending = calls.filter(c => c.status === 'pending' && (Date.now() - c.ts) > FOUR_H);
    if (!pending.length) return;
    for (const c of pending) {
      try {
        const tf = TF_SETS[c.anchor]?.ltf || '1h';
        const klines = await _fetchKlines(c.sym, tf);
        if (!klines || klines.length < 30) continue;
        const a = ICTDetect.atr(klines, 14);
        if (!a) continue;
        const cur = klines[klines.length - 1].c;
        const move = cur - c.price;
        const r = move / a;
        if (c.dir === 'bull') {
          c.status = r >= 1 ? 'hit' : r <= -1 ? 'miss' : 'expired';
        } else if (c.dir === 'bear') {
          c.status = r <= -1 ? 'hit' : r >= 1 ? 'miss' : 'expired';
        } else {
          c.status = 'expired';
        }
        c.outcome_r = +r.toFixed(2);
        c.checked_at = Date.now();
      } catch (e) {
        console.warn('[confluence] call check failed', c.sym, e?.message);
      }
    }
    _saveCalls(calls);
  }

  /* ── Pull All TFs sequentially ────────────────────────── */
  async function _pullAllTFs(progressCb) {
    const original = _anchorTF;
    for (let i = 0; i < TF_OPTIONS.length; i++) {
      const tf = TF_OPTIONS[i];
      _anchorTF = tf;
      progressCb?.(`Pulling ${tf} (${i+1}/${TF_OPTIONS.length})…`);
      try { await _refresh(); }
      catch (e) { console.warn('[confluence] pull-all', tf, e?.message); }
    }
    _anchorTF = original;
    localStorage.setItem('jb_conf_tf', original);
    progressCb?.(`Done — restored ${original}`);
    // Final refresh so the visible table matches active anchor
    await _refresh();
  }

  /* ── render ──────────────────────────────────────────── */
  function _dirBadge(dir, score) {
    if (dir === 'bull') return `<span class="conf-dir conf-dir-bull">▲ Bull</span>`;
    if (dir === 'bear') return `<span class="conf-dir conf-dir-bear">▼ Bear</span>`;
    return `<span class="conf-dir conf-dir-neutral">─ Neutral</span>`;
  }

  function _scoreBar(score) {
    if (score == null) return `<div class="conf-score-cell"><span class="muted">—</span></div>`;
    const cls = score >= 60 ? 'pos' : score <= 40 ? 'neg' : 'flat';
    const pct = Math.max(0, Math.min(100, score));
    return `
      <div class="conf-score-cell">
        <div class="conf-score-num ${cls}">${score.toFixed(0)}</div>
        <div class="conf-score-bar"><span class="${cls}" style="width:${pct}%"></span></div>
      </div>`;
  }

  /* ── inline SVG sparkline of recent scores at this anchor ───── */
  function _sparkline(points) {
    if (!points || points.length < 2) {
      return `<span class="muted" style="font-size:.72rem">—</span>`;
    }
    const w = 78, h = 22, pad = 2;
    const xs = (i) => pad + (i * (w - pad * 2)) / (points.length - 1);
    const ys = (s) => pad + (1 - s / 100) * (h - pad * 2);
    const path = points.map((p, i) =>
      `${i === 0 ? 'M' : 'L'} ${xs(i).toFixed(1)} ${ys(p.score).toFixed(1)}`).join(' ');
    const lastScore = points[points.length - 1].score;
    const stroke = lastScore >= 65 ? 'var(--good,#34d399)'
                 : lastScore <= 35 ? 'var(--bad,#f87171)'
                 : 'var(--muted,#888)';
    const dots = points.map((p, i) => {
      const fill = p.score >= 65 ? 'var(--good,#34d399)'
                 : p.score <= 35 ? 'var(--bad,#f87171)'
                 : 'var(--muted,#888)';
      return `<circle cx="${xs(i).toFixed(1)}" cy="${ys(p.score).toFixed(1)}" r="1.4" fill="${fill}"/>`;
    }).join('');
    const title = points.map(p =>
      `${new Date(p.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: ${Math.round(p.score)}`
    ).join('\n');
    return `<svg class="conf-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-label="score history">
      <title>${esc(title)}</title>
      <line x1="0" y1="${h/2}" x2="${w}" y2="${h/2}" stroke="var(--border)" stroke-width=".5" stroke-dasharray="2,2"/>
      <path d="${path}" fill="none" stroke="${stroke}" stroke-width="1.4" stroke-linecap="round"/>
      ${dots}
    </svg>`;
  }

  /* ── cross-TF agreement chip ───────────────────────────────── */
  function _xtfChip(agr) {
    if (!agr || !agr.totalSeen) {
      return `<span class="muted" style="font-size:.72rem" title="No saved snapshots across TFs yet — pull on multiple anchors">—</span>`;
    }
    const { bull, bear, neutral, totalSeen, anchors } = agr;
    const dom = bull > bear ? 'bull' : bear > bull ? 'bear' : 'neutral';
    const domCount = Math.max(bull, bear);
    const cls = dom === 'bull' ? 'conf-xtf-bull' : dom === 'bear' ? 'conf-xtf-bear' : 'conf-xtf-neutral';
    const arrow = dom === 'bull' ? '▲' : dom === 'bear' ? '▼' : '─';
    const tip = TF_OPTIONS
      .map(tf => anchors[tf] ? `${tf}: ${Math.round(anchors[tf].score)} ${anchors[tf].dir}` : `${tf}: —`)
      .join('\n');
    const isPerfect = (domCount === totalSeen) && totalSeen >= 3;
    return `<span class="conf-xtf-chip ${cls} ${isPerfect ? 'is-perfect' : ''}" title="${esc(tip)}">
      ${arrow} ${domCount}/${totalSeen}
    </span>`;
  }

  // Pretty-print a detector by its (id, type) pair. The id encodes the TF
  // suffix (e.g. "fvg_15m", "bias_D") and the type is TF-independent.
  function _prettyName(d) {
    if (!d) return '—';
    const id = d.id || '';
    const type = d.type || id;
    // Detector type → display prefix
    const PREFIX = {
      bias: 'Bias', adx_gate: 'ADX',
      fvg_ltf: 'FVG', fvg_mtf: 'FVG',
      ob_ltf: 'OB', ob_mtf: 'OB',
      sweep_ltf: 'Sweep', sweep_mtf: 'Sweep',
      cisd: 'CISD', bos: 'BOS',
      near_level: 'Near Level',
      lw_align: 'LW Bias', lw_funding: 'LW Funding', lw_oi: 'LW OI', lw_liq: 'LW Liq',
    };
    const prefix = PREFIX[type] || id;
    if (['near_level','lw_align','lw_funding','lw_oi','lw_liq'].includes(type)) return prefix;
    // Extract TF suffix from id (last _segment)
    const tf = id.split('_').pop();
    return `${prefix} ${tf}`;
  }

  function _topFired(fired) {
    if (!fired.length) return '<span class="muted">—</span>';
    const ranked = [...fired].sort((a, b) => (b.strength || 0) - (a.strength || 0)).slice(0, 4);
    return ranked.map(d => {
      const cls = d.dir === 'bull' ? 'conf-tag-bull' : d.dir === 'bear' ? 'conf-tag-bear' : 'conf-tag-neutral';
      return `<span class="conf-tag ${cls}">${esc(_prettyName(d))}</span>`;
    }).join(' ');
  }

  function _expandPanel(r) {
    const rows = r.detectors.map(d => {
      const fired = d.fired ? '✓' : '✗';
      const cls = d.fired ? (d.dir === 'bull' ? 'fired-bull' : d.dir === 'bear' ? 'fired-bear' : 'fired-neutral') : 'missed';
      const w = _playbookAdjusted(d.type || d.id).toFixed(2);
      const strBar = d.fired
        ? `<div class="conf-strength"><span style="width:${(d.strength*100).toFixed(0)}%"></span></div>`
        : `<div class="conf-strength"></div>`;
      return `
        <tr class="conf-detail-row ${cls}">
          <td class="conf-detail-status">${fired}</td>
          <td>${esc(_prettyName(d))}</td>
          <td class="conf-detail-dir">${d.dir ? esc(d.dir) : '—'}</td>
          <td>${strBar}</td>
          <td class="conf-detail-w">w ${w}</td>
          <td class="conf-detail-ev">${esc(d.evidence || '')}</td>
        </tr>`;
    }).join('');
    return `
      <tr class="conf-expand-row">
        <td colspan="9">
          <div class="conf-expand-wrap">
            <div class="conf-expand-head">
              <span>${esc(r.sym)} detector breakdown</span>
              <span class="muted">${r.fired.length}/${r.totalDetectors} fired · dominant ${r.dominantCount}/${r.totalDetectors} same dir · KZ ${r.kzActive ? esc(r.kzName) : 'off'}</span>
            </div>
            <table class="conf-detail-table">
              <thead><tr><th></th><th>Detector</th><th>Dir</th><th>Strength</th><th>Weight</th><th>Evidence</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </td>
      </tr>`;
  }

  function _renderTable() {
    const root = document.getElementById('confluenceRoot');
    if (!root || !_lastRun) return;
    const { ts, results, lwOk, dailyOk, btcShock, macroGuard } = _lastRun;
    const aligned = results.filter(r => r.score != null && (r.score >= 65 || r.score <= 35)).length;
    const kz = ICTDetect.activeKillzone();
    const hr = _hitRateSummary();

    // Banners
    const banners = [];
    if (macroGuard) {
      banners.push(`<div class="conf-banner conf-banner-warn">⚠️ <strong>Macro guard:</strong> ${esc(macroGuard.icon)} ${esc(macroGuard.name)} today — volatility risk. Confluence signals discounted.</div>`);
    }
    if (btcShock) {
      const arrow = btcShock.dir === 'bull' ? '▲' : '▼';
      banners.push(`<div class="conf-banner conf-banner-shock">🌊 <strong>BTC shock:</strong> ${arrow} ${btcShock.pct.toFixed(2)}% in last 1h (${btcShock.atrMult.toFixed(1)}×ATR) — alt signals opposite to BTC are weighted ×0.5.</div>`);
    }
    const bannersHtml = banners.join('');

    // Filter rendering
    const filterApplies = (r) => {
      if (r.score == null) return true;   // still show error rows
      if (_dirFilter === 'bull' && r.dir !== 'bull') return false;
      if (_dirFilter === 'bear' && r.dir !== 'bear') return false;
      if (_minSetups && (r.fired?.length || 0) < _minSetups) return false;
      return true;
    };
    const filteredResults = results.filter(filterApplies);

    const kpiHtml = `
      <div class="kpi-row" style="margin-bottom:16px">
        <div class="kpi-card">
          <div class="kpi-ic kpi-1">🎯</div>
          <div class="kpi-body"><div class="kpi-val">${results.length}</div><div class="kpi-lbl">Tracked</div></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-ic kpi-2">⚡</div>
          <div class="kpi-body"><div class="kpi-val ${aligned ? 'pos' : ''}">${aligned}</div><div class="kpi-lbl">Aligned ≥65 / ≤35</div></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-ic kpi-3">⏱️</div>
          <div class="kpi-body"><div class="kpi-val">${kz || 'Off'}</div><div class="kpi-lbl">Killzone</div></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-ic kpi-4">🛰</div>
          <div class="kpi-body"><div class="kpi-val" id="confLastUpd">${timeAgo(ts)}</div><div class="kpi-lbl">Last update</div></div>
        </div>
      </div>`;

    const agreement = _crossTFAgreement();

    const rows = filteredResults.map((r, i) => {
      if (r.score == null) {
        return `<tr class="conf-row"><td>${i+1}</td><td>${esc(r.sym)}</td><td colspan="9" class="muted">${esc(r.error || 'no data')}</td></tr>`;
      }
      const isExpanded = _expandedSym === r.sym;
      const hist = _historyForSym(r.sym, _anchorTF, 8);
      const isActionable = r.score >= 70 || r.score <= 30;
      const mainRow = `
        <tr class="conf-row ${isExpanded ? 'is-open' : ''}" data-sym="${esc(r.sym)}">
          <td class="conf-rank">${i+1}</td>
          <td class="conf-sym">
            <span>${esc(r.sym)}</span>
            <a class="conf-tv-link" href="https://www.tradingview.com/symbols/${esc(r.sym)}USDT/" target="_blank" rel="noopener" title="Open ${esc(r.sym)} on TradingView" onclick="event.stopPropagation()">📊</a>
          </td>
          <td>${_dirBadge(r.dir, r.score)}</td>
          <td>${_scoreBar(r.score)}</td>
          <td class="conf-spark-cell">${_sparkline(hist)}</td>
          <td class="conf-xtf">${_xtfChip(agreement[r.sym])}</td>
          <td><span class="conf-count">${r.fired.length}<span class="muted">/${r.totalDetectors}</span></span></td>
          <td class="conf-fired">${_topFired(r.fired)}</td>
          <td class="conf-px">
            <div class="conf-px-cell">
              <span>$${fmtPrice(r.price)}</span>
              ${isActionable ? `<button class="conf-take" data-take="${esc(r.sym)}" title="Log this as a trade in the New Trade modal" onclick="event.stopPropagation();ConfluenceTab._takeTrade('${esc(r.sym)}')">📝 Trade</button>` : ''}
            </div>
          </td>
        </tr>`;
      return isExpanded ? mainRow + _expandPanel(r) : mainRow;
    }).join('');

    const sourceLine = `
      <div class="muted" style="font-size:.78rem;margin-top:10px">
        Anchor <strong>${_anchorTF}</strong> (entry ${TF_SETS[_anchorTF].ltf} · mid ${TF_SETS[_anchorTF].mtf} · bias ${TF_SETS[_anchorTF].htf}) · Klines: Bybit→Binance→OKX · ${dailyOk ? 'Daily Report ✓' : 'Daily Report —'} · ${lwOk ? 'LW ✓' : 'LW —'} · Playbook weights from <code>jb_playbook</code>
      </div>`;

    const hitRatePill = hr.totalChecked >= 5
      ? `<span class="conf-hitrate" title="Calls ≥70 / ≤30 followed-through ≥1×ATR within 4h. Tracked: ${hr.totalChecked}, hits: ${hr.hits}, misses: ${hr.misses}, expired: ${hr.expired}.">📈 Hit-rate ${hr.hitRate.toFixed(0)}% <span class="muted">(${hr.hits}/${hr.totalChecked})</span></span>`
      : `<span class="muted conf-hitrate-dim" title="${hr.totalChecked} of ${hr.totalCalls} actionable calls have been follow-up checked. Need 5+ checked calls for a meaningful hit-rate.">📈 Hit-rate — <span class="muted">(${hr.totalChecked}/${hr.totalCalls})</span></span>`;

    const filterBar = `
      <div class="conf-filterbar">
        <span class="conf-filter-label">Filter</span>
        <button class="conf-filter-pill ${_dirFilter==='all'?'active':''}"  data-dirf="all">All</button>
        <button class="conf-filter-pill ${_dirFilter==='bull'?'active':''} conf-filter-bull" data-dirf="bull">▲ Bulls</button>
        <button class="conf-filter-pill ${_dirFilter==='bear'?'active':''} conf-filter-bear" data-dirf="bear">▼ Bears</button>
        <span class="conf-filter-sep"></span>
        <span class="conf-filter-label">Setups ≥</span>
        ${[0,3,4,5].map(n => `<button class="conf-filter-pill ${_minSetups===n?'active':''}" data-minsetups="${n}">${n||'any'}</button>`).join('')}
        ${hitRatePill}
      </div>`;

    root.innerHTML = `
      ${kpiHtml}
      ${bannersHtml}
      <div class="card conf-card">
        <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
          <span>Ranked Alignment</span>
          <span class="muted" style="font-size:.78rem;text-transform:none;letter-spacing:0">click row for detector breakdown · 📊 opens TradingView · 📝 logs trade</span>
        </div>
        ${filterBar}
        <div class="conf-table-wrap">
          <table class="conf-table">
            <thead>
              <tr>
                <th style="width:36px">#</th>
                <th style="width:108px">Asset</th>
                <th style="width:96px">Dir</th>
                <th style="width:130px">Score</th>
                <th style="width:90px" title="Last 8 pulls at this anchor">History</th>
                <th style="width:90px" title="Agreement across saved anchor TFs">Cross-TF</th>
                <th style="width:74px">Setups</th>
                <th>Top fired</th>
                <th style="width:160px;text-align:right">Price</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${sourceLine}
      </div>`;

    // wire row clicks
    root.querySelectorAll('.conf-row[data-sym]').forEach(tr => {
      tr.addEventListener('click', () => {
        const sym = tr.dataset.sym;
        _expandedSym = (_expandedSym === sym) ? null : sym;
        _renderTable();
      });
    });

    // Filter pills
    root.querySelectorAll('[data-dirf]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        _dirFilter = btn.dataset.dirf;
        localStorage.setItem('jb_conf_dir_filter', _dirFilter);
        _renderTable();
      });
    });
    root.querySelectorAll('[data-minsetups]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        _minSetups = parseInt(btn.dataset.minsetups, 10) || 0;
        localStorage.setItem('jb_conf_min_setups', String(_minSetups));
        _renderTable();
      });
    });
  }

  /* ── Take Trade — pre-fill the New Trade modal ───────── */
  function _takeTrade(sym) {
    if (!_lastRun) return;
    const r = _lastRun.results.find(x => x.sym === sym);
    if (!r) return;
    // Open the modal via the FAB
    const fab = document.getElementById('fab');
    if (fab) fab.click();
    // Defer field population to next tick
    setTimeout(() => {
      const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
      // Symbol — try select first, else custom
      const sel = document.getElementById('fSymbol');
      const symPair = `${sym}/USDT`;
      if (sel) {
        const has = Array.from(sel.options).some(o => o.value === symPair);
        if (has) {
          sel.value = symPair;
        } else {
          sel.value = 'custom';
          set('fSymbolCustom', symPair);
          const grp = document.getElementById('fSymbolCustomGroup');
          if (grp) grp.classList.remove('hidden');
        }
      }
      set('fDirection', r.dir === 'bull' ? 'Long' : r.dir === 'bear' ? 'Short' : 'Long');
      set('fEntry', r.price?.toFixed?.(r.price >= 1000 ? 1 : 4));
      // SL: nearest OB low (bull) / high (bear) from detectors
      const ob = r.detectors.find(d => d.fired && (d.type === 'ob_ltf' || d.type === 'ob_mtf') && d.dir === r.dir);
      if (ob && r.price) {
        // crude — use ATR-distance fallback if no OB level
        const ltfTf = TF_SETS[_anchorTF].ltf;
        // Just use 1× ATR as default SL distance
        const slOffset = r.price * 0.01;   // 1% default
        const sl = r.dir === 'bull' ? r.price - slOffset : r.price + slOffset;
        set('fSl', sl.toFixed(r.price >= 1000 ? 1 : 4));
        const tp = r.dir === 'bull' ? r.price + slOffset * 2 : r.price - slOffset * 2;
        set('fTp', tp.toFixed(r.price >= 1000 ? 1 : 4));
      }
      // Notes — auto-populate with the firing detectors
      const fires = r.fired.map(d => _prettyName(d)).join(', ');
      const notes = document.getElementById('fNotes');
      if (notes) notes.value = `Confluence ${r.score.toFixed(0)} ${r.dir} @ ${_anchorTF} | Fires: ${fires} | KZ: ${r.kzActive ? r.kzName : 'off'}`;
      // Pre-grade fill
      set('fPreGrade', r.score >= 75 || r.score <= 25 ? 'A' : 'B');
    }, 150);
  }

  /* ══════════════════════════════════════════════════════
     CHART SCANNER — upload screenshot → Claude Vision
     analyses visible ICT setups vs saved playbook
  ══════════════════════════════════════════════════════ */

  function _renderChartScanner() {
    return `
      <div class="card conf-scanner-card" style="margin-top:20px">
        <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
          <span>📸 Chart Scanner</span>
          <span class="muted" style="font-size:.78rem;text-transform:none;letter-spacing:0;font-weight:400">Paste or upload a chart · get ICT setup analysis vs your playbook</span>
        </div>
        <div class="conf-scanner-body">
          <div class="conf-scan-row">
            <div id="scanDropZone" class="conf-scan-drop" title="Click to browse, or paste Ctrl+V / Cmd+V">
              <div id="scanThumb" class="conf-scan-thumb-wrap" style="display:none">
                <img id="scanThumbImg" class="conf-scan-thumb" alt="chart preview" />
                <button class="conf-scan-clear" id="scanClearBtn" title="Remove image">✕</button>
              </div>
              <div id="scanDropLabel" class="conf-scan-drop-label">
                <span style="font-size:1.6rem">📷</span>
                <span>Click to browse <span class="muted">or paste</span></span>
                <span class="muted" style="font-size:.76rem">PNG · JPG · WEBP</span>
              </div>
              <input type="file" id="scanFileInput" accept="image/*" style="display:none" />
            </div>
            <div class="conf-scan-controls">
              <div class="conf-scan-field">
                <label>Entry price <span class="muted">(optional)</span></label>
                <input type="number" id="scanEntry" placeholder="e.g. 67500" step="any" class="conf-scan-input" />
              </div>
              <div class="conf-scan-field">
                <label>Symbol <span class="muted">(optional)</span></label>
                <select id="scanSym" class="conf-scan-input">
                  <option value="">Auto-detect</option>
                  ${SYMBOLS.map(s => `<option value="${s}">${s}/USDT</option>`).join('')}
                </select>
              </div>
              <button class="btn-primary" id="scanBtn" disabled style="margin-top:auto;width:100%">
                Scan Chart
              </button>
              <div id="scanStatus" class="muted conf-scan-status" style="display:none"></div>
            </div>
          </div>
          <div id="chartScanResult" style="display:none;margin-top:20px"></div>
        </div>
      </div>`;
  }

  function _initChartScanner() {
    const dropZone  = document.getElementById('scanDropZone');
    const fileInput = document.getElementById('scanFileInput');
    const btn       = document.getElementById('scanBtn');
    const clearBtn  = document.getElementById('scanClearBtn');
    if (!dropZone || !fileInput || !btn) return;

    // Restore image if still in state
    if (_scanImg) _showScanThumb(_scanImg.dataUrl);

    function loadFile(file) {
      if (!file || !file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = e => {
        const dataUrl = e.target.result;
        const m = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (!m) return;
        _scanImg = { mediaType: m[1], b64: m[2], dataUrl };
        _showScanThumb(dataUrl);
        if (btn) btn.disabled = false;
      };
      reader.readAsDataURL(file);
    }

    dropZone.addEventListener('click', (e) => {
      if (e.target === clearBtn || clearBtn?.contains(e.target)) return;
      fileInput.click();
    });
    fileInput.addEventListener('change', () => loadFile(fileInput.files[0]));

    // Drag & drop
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('is-drag'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-drag'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('is-drag');
      loadFile(e.dataTransfer.files[0]);
    });

    // Paste anywhere on the tab
    document.addEventListener('paste', function _onPaste(e) {
      if (!_isActiveTab()) return;
      const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
      if (item) loadFile(item.getAsFile());
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', e => {
        e.stopPropagation();
        _scanImg = null;
        _showScanThumb(null);
        if (btn) btn.disabled = true;
        const res = document.getElementById('chartScanResult');
        if (res) res.style.display = 'none';
      });
    }

    btn.addEventListener('click', () => {
      if (!_scanImg || _scanBusy) return;
      const entry = document.getElementById('scanEntry')?.value || '';
      const sym   = document.getElementById('scanSym')?.value   || '';
      _runChartScan(entry, sym);
    });
  }

  function _showScanThumb(dataUrl) {
    const thumb = document.getElementById('scanThumb');
    const label = document.getElementById('scanDropLabel');
    const img   = document.getElementById('scanThumbImg');
    if (!thumb || !label || !img) return;
    if (dataUrl) {
      img.src = dataUrl;
      thumb.style.display = '';
      label.style.display = 'none';
    } else {
      thumb.style.display = 'none';
      label.style.display = '';
    }
  }

  async function _runChartScan(entryPrice, sym) {
    if (!_scanImg || _scanBusy) return;
    _scanBusy = true;
    const btn    = document.getElementById('scanBtn');
    const status = document.getElementById('scanStatus');
    const result = document.getElementById('chartScanResult');
    if (btn)    { btn.disabled = true; btn.textContent = 'Scanning…'; }
    if (status) { status.style.display = ''; status.textContent = 'Sending to Claude Vision…'; }
    if (result) { result.style.display = 'none'; }

    try {
      // Read playbook setups for context
      const play  = (typeof DB !== 'undefined' && DB.KEYS?.play) ? DB.get(DB.KEYS.play) || [] : [];
      const setupList = play.length
        ? play.map(s => `- ${s.name}${s.notes ? ` (${s.notes})` : ''}`).join('\n')
        : '(no setups saved yet — general ICT analysis)';

      const entryNote = entryPrice ? `The trader is considering an entry at price ${entryPrice}.` : '';
      const symNote   = sym ? `The chart appears to be ${sym}/USDT.` : '';

      const system = `You are an expert ICT (Inner Circle Trader) chart analyst with deep knowledge of order blocks, fair value gaps, liquidity sweeps, CISD, BOS, power of 3/AMD, silver bullet, OTE, and killzone timing.

Analyze the chart screenshot and identify every visible ICT setup. Be specific about price levels if labels are visible on the chart.

The trader's saved playbook setups:
${setupList}

${entryNote} ${symNote}

Return ONLY valid JSON, no markdown, no explanation outside the JSON:
{
  "chart_read": "1-2 sentence overall read of what this chart shows",
  "timeframe_guess": "best guess at TF shown, e.g. '15m' or '1h' or 'unknown'",
  "overall_bias": "bull|bear|neutral",
  "detected": [
    {
      "name": "setup name",
      "dir": "bull|bear|neutral",
      "confidence": "high|medium|low",
      "entry_zone": "price level or zone description",
      "stop_area": "price level or description or null",
      "tp1": "price level or null",
      "tp2": "price level or null",
      "entry_alignment": "aligned|slightly_off|conflicting|n/a",
      "alignment_note": "one sentence on how the proposed entry fits this setup",
      "evidence": "what you see that identifies this setup",
      "in_playbook": true
    }
  ],
  "best_setup": "name of highest-conviction setup or null",
  "comparison_table": [
    { "name": "playbook setup name", "detected": true, "note": "brief note" }
  ],
  "risk_note": "any concern about confluence, invalidation, or entry quality"
}`;

      const { text } = await AICoachTab.callClaude({
        system,
        user: 'Analyze this chart and return JSON.',
        imageData: { b64: _scanImg.b64, mediaType: _scanImg.mediaType },
        maxTokens: 2000,
      });

      // Parse JSON — strip any accidental markdown fences
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      const data = JSON.parse(cleaned);

      if (result) {
        result.style.display = '';
        result.innerHTML = _renderScanResults(data, entryPrice, sym);
      }
      if (status) status.style.display = 'none';

    } catch (err) {
      if (status) {
        status.style.display = '';
        const msg = err.message || '';
        if (msg.includes('API key') || msg.includes('No API')) {
          status.textContent = '⚠ No API key — set one in AI Coach → Settings, or enable Local mode.';
        } else if (msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network')) {
          status.textContent = '⚠ Local AI server not reachable. Run: python3 scripts/local_ai_server.py — then scan again. (Also requires dashboard on localhost:8768, not github.io.)';
        } else if (msg.toLowerCase().includes('credit') || msg.includes('402') || msg.includes('insufficient')) {
          status.textContent = '⚠ API credits exhausted. Enable Local mode in AI Coach → Settings (requires local_ai_server.py running).';
        } else {
          status.textContent = `Error: ${msg}`;
        }
      }
    } finally {
      _scanBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Scan Chart'; }
    }
  }

  function _renderScanResults(d, entryPrice, sym) {
    const biasColor = d.overall_bias === 'bull' ? 'var(--good,#22c55e)'
                    : d.overall_bias === 'bear' ? 'var(--bad,#ef4444)'
                    : 'var(--warn,#fbbf24)';
    const biasLabel = d.overall_bias === 'bull' ? '▲ BULLISH' : d.overall_bias === 'bear' ? '▼ BEARISH' : '◆ NEUTRAL';

    const confBadge = c => c === 'high' ? '<span class="conf-scan-badge conf-badge-hi">HIGH</span>'
                         : c === 'medium' ? '<span class="conf-scan-badge conf-badge-mid">MED</span>'
                         : '<span class="conf-scan-badge conf-badge-lo">LOW</span>';

    const alignBadge = a => {
      if (a === 'aligned')       return '<span class="conf-scan-badge conf-badge-hi">✓ Aligned</span>';
      if (a === 'slightly_off')  return '<span class="conf-scan-badge conf-badge-mid">~ Off</span>';
      if (a === 'conflicting')   return '<span class="conf-scan-badge conf-badge-lo">✗ Conflict</span>';
      return '';
    };

    const detected = (d.detected || []).map(s => `
      <div class="conf-scan-setup">
        <div class="conf-scan-setup-head">
          <span class="conf-scan-setup-name">${esc(s.name)}</span>
          <span class="conf-scan-dir" style="color:${s.dir==='bull'?'var(--good,#22c55e)':s.dir==='bear'?'var(--bad,#ef4444)':'var(--warn,#fbbf24)'}">${s.dir==='bull'?'▲':s.dir==='bear'?'▼':'◆'}</span>
          ${confBadge(s.confidence)}
          ${s.in_playbook ? '<span class="conf-scan-badge conf-badge-pb">📖 In playbook</span>' : ''}
          ${s.entry_alignment && s.entry_alignment !== 'n/a' ? alignBadge(s.entry_alignment) : ''}
        </div>
        <div class="conf-scan-levels">
          ${s.entry_zone ? `<div><span class="muted">Entry:</span> ${esc(s.entry_zone)}</div>` : ''}
          ${s.stop_area  ? `<div><span class="muted">Stop:</span>  ${esc(s.stop_area)}</div>` : ''}
          ${s.tp1        ? `<div><span class="muted">TP1:</span>   ${esc(s.tp1)}</div>` : ''}
          ${s.tp2        ? `<div><span class="muted">TP2:</span>   ${esc(s.tp2)}</div>` : ''}
        </div>
        <div class="conf-scan-evidence muted">${esc(s.evidence)}</div>
        ${s.alignment_note && s.entry_alignment !== 'n/a' ? `<div class="conf-scan-alignment-note">${esc(s.alignment_note)}</div>` : ''}
      </div>`).join('');

    const compTable = (d.comparison_table || []).length ? `
      <div style="margin-top:20px">
        <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted,#888);margin-bottom:10px">Playbook comparison</div>
        <table class="conf-scan-cmp-table">
          <thead><tr><th>Setup</th><th>Detected</th><th>Note</th></tr></thead>
          <tbody>
            ${(d.comparison_table).map(r => `
              <tr>
                <td>${esc(r.name)}</td>
                <td style="text-align:center">${r.detected ? '✓' : '—'}</td>
                <td class="muted">${esc(r.note || '')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '';

    return `
      <div class="conf-scan-results">
        <div class="conf-scan-summary">
          <div class="conf-scan-bias" style="color:${biasColor}">${biasLabel}</div>
          ${d.timeframe_guess && d.timeframe_guess !== 'unknown' ? `<span class="conf-scan-tf-pill">${esc(d.timeframe_guess)}</span>` : ''}
          ${d.best_setup ? `<span class="muted" style="font-size:.82rem">Best setup: <strong style="color:var(--text)">${esc(d.best_setup)}</strong></span>` : ''}
        </div>
        <div class="conf-scan-read">${esc(d.chart_read)}</div>
        ${d.detected?.length ? `
          <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted,#888);margin:16px 0 10px">Setups detected (${d.detected.length})</div>
          <div class="conf-scan-setups">${detected}</div>` : '<div class="muted" style="margin-top:12px">No ICT setups detected in this chart.</div>'}
        ${compTable}
        ${d.risk_note ? `<div class="conf-scan-risk-note">⚠ ${esc(d.risk_note)}</div>` : ''}
      </div>`;
  }

  /* ── Alert settings panel ────────────────────────────── */
  function _renderAlertSettings() {
    const tgEnabled = (typeof Telegram !== 'undefined') && Telegram.isEnabled?.();
    const browserState = typeof Notification === 'undefined' ? 'unsupported'
      : Notification.permission;
    return `
      <div class="card conf-alert-card">
        <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
          <span>🔔 Alerts</span>
          <label class="conf-toggle">
            <input type="checkbox" id="confAlertsOn" ${_alertsOn ? 'checked' : ''}/>
            <span>Enabled</span>
          </label>
        </div>
        <div class="conf-alert-body">
          <div class="conf-alert-row">
            <label>Fire when score crosses</label>
            <select id="confAlertThr">
              ${[65, 70, 75, 80].map(t => `<option value="${t}" ${t===_alertThr?'selected':''}>≥${t} (or ≤${100-t})</option>`).join('')}
            </select>
          </div>
          <div class="conf-alert-row">
            <span class="muted">Browser notifications:</span>
            <span class="conf-alert-status conf-alert-${browserState}">${browserState === 'granted' ? '✓ Granted' : browserState === 'denied' ? '✗ Denied (open browser settings)' : browserState === 'unsupported' ? 'Unsupported' : 'Default — click Test to request'}</span>
            <button class="btn-soft btn-sm" id="confTestNotif" title="Request permission + send a test">Test</button>
          </div>
          <div class="conf-alert-row">
            <span class="muted">Telegram:</span>
            <span class="conf-alert-status ${tgEnabled?'conf-alert-granted':'conf-alert-default'}">${tgEnabled ? '✓ Configured' : '✗ Not configured (Pro Tools → Telegram)'}</span>
            <button class="btn-soft btn-sm" id="confTestTg" title="Send a test message" ${tgEnabled?'':'disabled'}>Test</button>
          </div>
        </div>
      </div>`;
  }

  function _startAutoRefresh() {
    _stopAutoRefresh();
    if (!_autoOn) return;
    _refreshTimer = setInterval(() => {
      if (!_isActiveTab()) return;
      _refresh();
    }, REFRESH_MS);
  }
  function _stopAutoRefresh() {
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
  }

  function _renderEmpty() {
    const root = document.getElementById('confluenceRoot');
    if (!root) return;
    root.innerHTML = `
      <div class="card" style="text-align:center;padding:48px 24px">
        <div style="font-size:2.4rem;margin-bottom:12px">🎯</div>
        <div style="font-size:1rem;font-weight:600;margin-bottom:6px">No data yet</div>
        <div class="muted" style="font-size:.86rem;max-width:420px;margin:0 auto">
          Click <strong>Pull Data</strong> above to fetch fresh klines and compute confluence across BTC · ETH · XRP · SOL · SUI. Data sits here until you pull again.
        </div>
      </div>`;
  }

  function _renderLoading() {
    const root = document.getElementById('confluenceRoot');
    if (!root) return;
    root.innerHTML = `
      <div class="card" style="text-align:center;padding:48px 24px">
        <div class="muted">Fetching klines and computing confluence…</div>
      </div>`;
  }

  // Wrap _refresh so we can show loading state and disable the button mid-fetch
  async function _pullData() {
    const btn = document.getElementById('confRefreshBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⟳ Pulling…'; }
    if (!_lastRun) _renderLoading();
    try {
      await _refresh();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⟳ Pull Data'; }
    }
  }

  const GUIDE_HTML = `
    <div class="card conf-guide" style="margin-top:20px">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>📖 How to use this tab</span>
        <button class="btn-soft conf-guide-toggle" id="confGuideToggle" style="font-size:.74rem;padding:4px 10px">Collapse all</button>
      </div>

      <!-- ─── STEP-BY-STEP at the top ─── -->
      <div class="conf-guide-steps">
        <div class="conf-step">
          <div class="conf-step-num">1</div>
          <div class="conf-step-body">
            <div class="conf-step-h">Click <span class="conf-pill conf-pill-primary">⟳ Pull Data</span></div>
            <div class="conf-step-sub">Fetches fresh klines for all 5 assets. Takes ~5 seconds.</div>
          </div>
        </div>
        <div class="conf-step">
          <div class="conf-step-num">2</div>
          <div class="conf-step-body">
            <div class="conf-step-h">Look at <strong>Row 1</strong> of the table</div>
            <div class="conf-step-sub">It's the most aligned asset right now — bull <span class="conf-tag conf-bull">▲</span> or bear <span class="conf-tag conf-bear">▼</span>.</div>
          </div>
        </div>
        <div class="conf-step">
          <div class="conf-step-num">3</div>
          <div class="conf-step-body">
            <div class="conf-step-h">Check the <strong>Score</strong></div>
            <div class="conf-step-sub">≥65 = trade-worthy bull · ≤35 = trade-worthy bear · 35–65 = wait.</div>
          </div>
        </div>
        <div class="conf-step">
          <div class="conf-step-num">4</div>
          <div class="conf-step-body">
            <div class="conf-step-h">Click the row to expand</div>
            <div class="conf-step-sub">See every detector ✅/❌ + evidence. Verify on TradingView before entering.</div>
          </div>
        </div>
      </div>

      <div class="conf-guide-body">

        <!-- ─── ANALYST: WHICH TF SHOULD I USE? ─── -->
        <div class="conf-guide-section conf-guide-analyst" style="grid-column:1 / -1">
          <div class="conf-guide-h">🎓 Which TF should I actually use?</div>
          <p style="font-size:.86rem;margin:6px 0 14px">Honest take from a qualitative review of how this widget's pieces interact — pattern detectors, killzone multiplier, daily levels, and bias filter.</p>

          <!-- short answer matrix -->
          <div class="conf-rank-grid">
            <div class="conf-rank conf-rank-silver"><div class="conf-rank-medal">🥈</div><div><strong>15m</strong> Silver<div class="muted">Intraday scalping inside killzones</div></div></div>
            <div class="conf-rank conf-rank-gold"><div class="conf-rank-medal">🥇</div><div><strong>1h</strong> Gold — daily driver<div class="muted">Day trading. Best signal/noise for this widget.</div></div></div>
            <div class="conf-rank conf-rank-silver"><div class="conf-rank-medal">🥈</div><div><strong>4h</strong> Silver<div class="muted">Swing positioning. Pull once or twice a day.</div></div></div>
            <div class="conf-rank conf-rank-bronze"><div class="conf-rank-medal">🥉</div><div><strong>D</strong> Bronze<div class="muted">Macro context only — not for entries.</div></div></div>
          </div>

          <!-- why 1h sweet spot -->
          <div class="conf-analyst-card" style="margin-top:14px">
            <div class="conf-analyst-h">🥇 Why 1h is the sweet spot</div>
            <p>The engine has <strong>two opposing forces</strong>:</p>
            <ul>
              <li>📐 Pattern detectors (FVG/OB/sweep) get more reliable as TF goes up — a 4h OB is meaningful; a 15m OB is noise half the time.</li>
              <li>⏰ Killzone multiplier and Near-Level detector are tuned for intraday — Daily Report levels are <em>daily</em>, killzones are 2-hour windows.</li>
            </ul>
            <p>1h sits exactly in the middle: patterns clean enough to trust, daily levels still matter (one full D bar = 24 of your candles), and your bias (D) is the most-respected institutional TF. One new candle every hour — fast enough to feel live, slow enough that you're not babysitting.</p>
          </div>

          <!-- why 15m second -->
          <div class="conf-analyst-card">
            <div class="conf-analyst-h">🥈 Why 15m is second, not first</div>
            <p>Technically the more "ICT-canonical" anchor — Silver Bullet, Turtle Soup, killzone-anchored entries all live here. But:</p>
            <ul>
              <li>❌ More noise — more borderline B/C-tier scores that lead nowhere</li>
              <li>❌ Daily Report levels feel "far away" most of the time → Near Level rarely fires</li>
              <li>✅ Killzone multiplier is most accurate here</li>
            </ul>
            <p><strong>Use when:</strong> actively at the desk inside London Open or NY AM. Outside those windows, drop back to 1h.</p>
          </div>

          <!-- why 4h solid but slow -->
          <div class="conf-analyst-card">
            <div class="conf-analyst-h">🥈 Why 4h is solid but slow</div>
            <p>A 4h alignment is high-conviction by definition — fewer false positives, weekly bias is reliable. But only <strong>6 new candles per day</strong>, so the table rarely changes between pulls.</p>
            <p><strong>Treat 4h as a "scan morning + evening" tool, not a live monitor.</strong></p>
          </div>

          <!-- why D questionable -->
          <div class="conf-analyst-card">
            <div class="conf-analyst-h">🥉 Why D is questionable as an entry anchor</div>
            <ul>
              <li>Monthly bias rarely flips → HTF detector often the same as last week</li>
              <li>Daily sweeps are rare events → most pulls show "no recent sweep"</li>
              <li>Killzone multiplier becomes meaningless (your bar is 24h long)</li>
              <li>Near Level breaks — Daily Report levels are intra-daily relative to a D bar</li>
            </ul>
            <p><strong>D is useful as a check-the-big-picture view</strong> — open once a week to make sure the macro tide isn't fighting your 1h/15m trades. Don't trade off it directly.</p>
          </div>

          <!-- workflow -->
          <div class="conf-analyst-card conf-analyst-workflow">
            <div class="conf-analyst-h">🔄 The workflow I'd actually use</div>
            <p>Top-down, ICT-style, <strong>three pulls</strong>:</p>
            <ol>
              <li><strong>Morning (4h anchor)</strong> → Pull Data → "Is the swing bias bull, bear, or chop right now?" Note the leaders.</li>
              <li><strong>Day (1h anchor)</strong> → Pull Data → "Which of those leaders has a 1h structure aligning with the 4h bias?" Build a trade thesis.</li>
              <li><strong>Entry (15m anchor)</strong> → Pull Data when a killzone opens → "Has my chosen asset hit ≥65 with KZ active?" That's your trigger.</li>
            </ol>
            <div class="conf-callout" style="margin-top:10px;background:rgba(52,211,153,.10);border-left-color:var(--good,#34d399)">
              ✨ <strong>The widget rewards you most when the same asset stays at the top across all three TFs.</strong> Watch the <span class="conf-xtf-chip conf-xtf-bull" style="display:inline-block">▲ 3/3</span> chip in the table — when it goes "perfect" you're seeing real multi-timeframe alignment, not noise.
            </div>
          </div>

          <!-- new features explainer -->
          <div class="conf-analyst-card conf-analyst-newfeats">
            <div class="conf-analyst-h">🆕 Two table columns that make this workflow actually work</div>
            <ul>
              <li><strong>📈 History sparkline</strong> — shows the last 8 score points for each asset <em>at the current anchor</em>. Score climbing toward 65? That's a building bull thesis. Falling toward 35? Building bear. Stays flat in the middle? Chop.</li>
              <li><strong>🎯 Cross-TF chip</strong> — small badge showing how many of your saved anchor pulls have this asset in actionable territory. e.g. <span class="conf-xtf-chip conf-xtf-bull" style="display:inline-block">▲ 3/3</span> means BTC scored ≥65 bull on every TF you've pulled. <span class="conf-xtf-chip conf-xtf-bull is-perfect" style="display:inline-block">▲ 4/4</span> with the gold ring = perfect alignment, hunt entries.</li>
            </ul>
            <p style="font-size:.78rem;margin-top:6px">Both columns require multiple pulls to populate. Persist in <code>localStorage</code> (<code>jb_conf_history</code>, <code>jb_conf_per_tf</code>) across reloads. Last 40 pulls kept.</p>
          </div>
        </div>

        <!-- ─── TIMEFRAME ANCHOR ─── -->
        <div class="conf-guide-section conf-guide-tfs" style="grid-column:1 / -1">
          <div class="conf-guide-h">⏱️ Anchor timeframe selector</div>
          <p style="font-size:.82rem;margin:4px 0 10px">Pick the <strong>entry timeframe</strong> at the top. Every detector adjusts so HTF bias is always 2 steps above your entry. Re-pull data after changing.</p>
          <div class="conf-tf-table">
            <div class="conf-tf-tcell conf-tf-thead">Anchor</div>
            <div class="conf-tf-tcell conf-tf-thead">Entry (LTF)</div>
            <div class="conf-tf-tcell conf-tf-thead">Mid (MTF)</div>
            <div class="conf-tf-tcell conf-tf-thead">Bias (HTF)</div>
            <div class="conf-tf-tcell conf-tf-thead">Best for</div>

            <div class="conf-tf-tcell"><strong>15m</strong></div>
            <div class="conf-tf-tcell">15m</div>
            <div class="conf-tf-tcell">1h</div>
            <div class="conf-tf-tcell">4h</div>
            <div class="conf-tf-tcell">Intraday scalps · ICT killzones</div>

            <div class="conf-tf-tcell"><strong>1h</strong></div>
            <div class="conf-tf-tcell">1h</div>
            <div class="conf-tf-tcell">4h</div>
            <div class="conf-tf-tcell">D</div>
            <div class="conf-tf-tcell">Day-trades · session continuations</div>

            <div class="conf-tf-tcell"><strong>4h</strong></div>
            <div class="conf-tf-tcell">4h</div>
            <div class="conf-tf-tcell">D</div>
            <div class="conf-tf-tcell">W</div>
            <div class="conf-tf-tcell">Multi-day swings</div>

            <div class="conf-tf-tcell"><strong>D</strong></div>
            <div class="conf-tf-tcell">D</div>
            <div class="conf-tf-tcell">W</div>
            <div class="conf-tf-tcell">M</div>
            <div class="conf-tf-tcell">Position trades · macro turns</div>
          </div>
        </div>

        <!-- ─── SCORE BANDS ─── -->
        <div class="conf-guide-section conf-guide-bands">
          <div class="conf-guide-h">🎯 Score → Action</div>
          <div class="conf-band conf-band-vbull">
            <div class="conf-band-score">80–100</div>
            <div class="conf-band-emoji">🟢🟢</div>
            <div class="conf-band-body"><strong>Very strong bull</strong> · Hunt for long entries, wait for LTF trigger</div>
          </div>
          <div class="conf-band conf-band-bull">
            <div class="conf-band-score">65–80</div>
            <div class="conf-band-emoji">🟢</div>
            <div class="conf-band-body"><strong>Strong bull</strong> · Bias long — only take longs in this asset</div>
          </div>
          <div class="conf-band conf-band-neutral">
            <div class="conf-band-score">35–65</div>
            <div class="conf-band-emoji">⚪</div>
            <div class="conf-band-body"><strong>Neutral / mild lean</strong> · No trade — wait for clearer alignment</div>
          </div>
          <div class="conf-band conf-band-bear">
            <div class="conf-band-score">20–35</div>
            <div class="conf-band-emoji">🔴</div>
            <div class="conf-band-body"><strong>Strong bear</strong> · Bias short</div>
          </div>
          <div class="conf-band conf-band-vbear">
            <div class="conf-band-score">0–20</div>
            <div class="conf-band-emoji">🔴🔴</div>
            <div class="conf-band-body"><strong>Very strong bear</strong> · Hunt for short entries</div>
          </div>
          <div class="conf-callout">
            ⚠️ <strong>Critical rule:</strong> Score can't go above 65 (or below 35) unless <strong>≥3 detectors fire in the same direction</strong>. One signal alone never gets you there.
          </div>
        </div>

        <!-- ─── KPI STRIP EXPLAINED ─── -->
        <div class="conf-guide-section">
          <div class="conf-guide-h">📊 The 4 KPI cards (top strip)</div>
          <div class="conf-kpi-grid">
            <div class="conf-kpi-item"><div class="conf-kpi-icon">🎯</div><div><strong>Tracked</strong><div class="muted">5 assets being scored</div></div></div>
            <div class="conf-kpi-item"><div class="conf-kpi-icon">🚨</div><div><strong>Aligned ≥65 / ≤35</strong><div class="muted">How many crossed the actionable line. Often 0 — normal.</div></div></div>
            <div class="conf-kpi-item"><div class="conf-kpi-icon">⏰</div><div><strong>Killzone</strong><div class="muted">Active session. Adds 1.15× score multiplier.</div></div></div>
            <div class="conf-kpi-item"><div class="conf-kpi-icon">🕐</div><div><strong>Last update</strong><div class="muted">Time since last pull.</div></div></div>
          </div>
        </div>

        <!-- ─── DETECTOR DICTIONARY ─── -->
        <div class="conf-guide-section conf-guide-detectors">
          <div class="conf-guide-h">🔍 Detector dictionary</div>
          <div class="conf-det-grid">
            <div class="conf-det"><span class="conf-det-icon">📈</span><div><strong>Bias 4h</strong> <span class="conf-tf">4h</span><div class="muted">EMA50 vs EMA200 + slope. The dominant trend.</div></div></div>
            <div class="conf-det"><span class="conf-det-icon">⚡</span><div><strong>ADX 4h</strong> <span class="conf-tf">4h</span><div class="muted">ADX &gt; 15 rising 3 bars (same as OBxADX bot).</div></div></div>
            <div class="conf-det"><span class="conf-det-icon">📐</span><div><strong>FVG</strong> <span class="conf-tf">15m · 1h</span><div class="muted">Unfilled Fair Value Gap.</div></div></div>
            <div class="conf-det"><span class="conf-det-icon">📦</span><div><strong>Order Block</strong> <span class="conf-tf">15m · 1h</span><div class="muted">Unmitigated OB before &gt;1×ATR move.</div></div></div>
            <div class="conf-det"><span class="conf-det-icon">🌊</span><div><strong>Sweep</strong> <span class="conf-tf">15m · 1h</span><div class="muted">Wick past swing + close back inside. Turtle Soup.</div></div></div>
            <div class="conf-det"><span class="conf-det-icon">🔄</span><div><strong>CISD</strong> <span class="conf-tf">15m</span><div class="muted">Change in State of Delivery — reversal candle.</div></div></div>
            <div class="conf-det"><span class="conf-det-icon">💥</span><div><strong>BOS</strong> <span class="conf-tf">1h</span><div class="muted">Break of Structure — close beyond 15-bar swing.</div></div></div>
            <div class="conf-det"><span class="conf-det-icon">📍</span><div><strong>Near Level</strong> <span class="conf-tf">spot</span><div class="muted">Price within 0.5% of Daily Report R/S level.</div></div></div>
            <div class="conf-det"><span class="conf-det-icon">🌊</span><div><strong>LW Align</strong> <span class="conf-tf">spot</span><div class="muted">Liquidity Watcher's 4h bias (local only).</div></div></div>
          </div>
        </div>

        <!-- ─── ROW ANATOMY ─── -->
        <div class="conf-guide-section">
          <div class="conf-guide-h">🧬 Anatomy of a row</div>
          <div class="conf-anatomy">
            <div><span class="conf-anatomy-key">#</span> rank (1 = most aligned)</div>
            <div><span class="conf-anatomy-key">Asset</span> BTC / ETH / XRP / SOL / SUI</div>
            <div><span class="conf-anatomy-key">Dir</span> <span class="conf-tag conf-bull">▲</span> bull · <span class="conf-tag conf-bear">▼</span> bear · <span class="conf-tag conf-neutral">─</span> neutral</div>
            <div><span class="conf-anatomy-key">Score</span> 0–100 + coloured bar (50 = neutral)</div>
            <div><span class="conf-anatomy-key">Setups</span> "5/11" → 5 of 11 detectors fired</div>
            <div><span class="conf-anatomy-key">Top fired</span> highest-strength signals, <span class="conf-tag conf-bull">green</span>=bull, <span class="conf-tag conf-bear">red</span>=bear</div>
            <div><span class="conf-anatomy-key">Price</span> live spot from Bybit</div>
          </div>
        </div>

        <!-- ─── TIERED EXAMPLES (A/B/C × Bull/Bear) ─── -->
        <div class="conf-guide-section conf-guide-tiers">
          <div class="conf-guide-h">✨ Setup tiers — what to look for</div>
          <p style="font-size:.82rem;margin:4px 0 12px">Three quality grades for each direction. Aim for A. Skip C unless everything else lines up.</p>

          <div class="conf-tier-grid">
            <!-- ───── BULL COLUMN ───── -->
            <div class="conf-tier-col">
              <div class="conf-tier-col-h conf-tier-col-h-bull">▲ BULL setups</div>

              <div class="conf-tier conf-tier-a">
                <div class="conf-tier-badge conf-tier-badge-a">A</div>
                <div class="conf-tier-body">
                  <div class="conf-tier-title">Premium — take it</div>
                  <div class="conf-tier-meta">Score <strong>≥75</strong> · 4+ detectors · killzone active</div>
                  <div class="conf-example">
                    <span class="conf-tag conf-bull">▲ 78</span>
                    <span class="conf-chip-ex">✅ Bias 4h</span>
                    <span class="conf-chip-ex">✅ OB 1h</span>
                    <span class="conf-chip-ex">✅ FVG 15m</span>
                    <span class="conf-chip-ex">✅ Sweep 15m</span>
                    <span class="conf-chip-ex conf-chip-kz">⏰ NY AM</span>
                  </div>
                  <div class="conf-tier-note">HTF trend + LTF entry + active session — full size.</div>
                </div>
              </div>

              <div class="conf-tier conf-tier-b">
                <div class="conf-tier-badge conf-tier-badge-b">B</div>
                <div class="conf-tier-body">
                  <div class="conf-tier-title">Solid — trade with care</div>
                  <div class="conf-tier-meta">Score <strong>68–75</strong> · 3 detectors · KZ optional</div>
                  <div class="conf-example">
                    <span class="conf-tag conf-bull">▲ 71</span>
                    <span class="conf-chip-ex">✅ Bias 4h</span>
                    <span class="conf-chip-ex">✅ FVG 15m</span>
                    <span class="conf-chip-ex">✅ Sweep 15m</span>
                  </div>
                  <div class="conf-tier-note">Half-size. Tighten stop. Wants a clean LTF trigger.</div>
                </div>
              </div>

              <div class="conf-tier conf-tier-c">
                <div class="conf-tier-badge conf-tier-badge-c">C</div>
                <div class="conf-tier-body">
                  <div class="conf-tier-title">Marginal — skip unless</div>
                  <div class="conf-tier-meta">Score <strong>65–68</strong> · barely 3 detectors</div>
                  <div class="conf-example">
                    <span class="conf-tag conf-bull">▲ 66</span>
                    <span class="conf-chip-ex">✅ Bias 4h</span>
                    <span class="conf-chip-ex">✅ OB 1h</span>
                    <span class="conf-chip-ex">✅ CISD 15m</span>
                  </div>
                  <div class="conf-tier-note">Only take if Near Level + KZ active. Otherwise stand down.</div>
                </div>
              </div>
            </div>

            <!-- ───── BEAR COLUMN ───── -->
            <div class="conf-tier-col">
              <div class="conf-tier-col-h conf-tier-col-h-bear">▼ BEAR setups</div>

              <div class="conf-tier conf-tier-a">
                <div class="conf-tier-badge conf-tier-badge-a">A</div>
                <div class="conf-tier-body">
                  <div class="conf-tier-title">Premium — take it</div>
                  <div class="conf-tier-meta">Score <strong>≤25</strong> · 4+ detectors · killzone active</div>
                  <div class="conf-example">
                    <span class="conf-tag conf-bear">▼ 22</span>
                    <span class="conf-chip-ex conf-chip-bear">✅ Bias 4h</span>
                    <span class="conf-chip-ex conf-chip-bear">✅ OB 1h</span>
                    <span class="conf-chip-ex conf-chip-bear">✅ FVG 15m</span>
                    <span class="conf-chip-ex conf-chip-bear">✅ Sweep 15m</span>
                    <span class="conf-chip-ex conf-chip-kz">⏰ London</span>
                  </div>
                  <div class="conf-tier-note">HTF down + LTF reject + active session — full size short.</div>
                </div>
              </div>

              <div class="conf-tier conf-tier-b">
                <div class="conf-tier-badge conf-tier-badge-b">B</div>
                <div class="conf-tier-body">
                  <div class="conf-tier-title">Solid — trade with care</div>
                  <div class="conf-tier-meta">Score <strong>25–32</strong> · 3 detectors · KZ optional</div>
                  <div class="conf-example">
                    <span class="conf-tag conf-bear">▼ 29</span>
                    <span class="conf-chip-ex conf-chip-bear">✅ Bias 4h</span>
                    <span class="conf-chip-ex conf-chip-bear">✅ FVG 15m</span>
                    <span class="conf-chip-ex conf-chip-bear">✅ BOS 1h</span>
                  </div>
                  <div class="conf-tier-note">Half-size short. Wait for retest of OB or FVG fill.</div>
                </div>
              </div>

              <div class="conf-tier conf-tier-c">
                <div class="conf-tier-badge conf-tier-badge-c">C</div>
                <div class="conf-tier-body">
                  <div class="conf-tier-title">Marginal — skip unless</div>
                  <div class="conf-tier-meta">Score <strong>32–35</strong> · barely 3 detectors</div>
                  <div class="conf-example">
                    <span class="conf-tag conf-bear">▼ 34</span>
                    <span class="conf-chip-ex conf-chip-bear">✅ Bias 4h</span>
                    <span class="conf-chip-ex conf-chip-bear">✅ Sweep 1h</span>
                    <span class="conf-chip-ex conf-chip-bear">✅ CISD 15m</span>
                  </div>
                  <div class="conf-tier-note">Only take if Near Level + KZ active. Otherwise stand down.</div>
                </div>
              </div>
            </div>
          </div>

          <div class="conf-callout" style="background:rgba(52,211,153,.10);border-left-color:var(--good,#34d399);margin-top:14px">
            🎓 <strong>Rule of thumb:</strong> If you wouldn't be proud to journal the setup, don't take it. A is full size, B is half size, C is paper-trade or skip.
          </div>
        </div>

        <!-- ─── THINGS TO KNOW ─── -->
        <div class="conf-guide-section">
          <div class="conf-guide-h">💡 Things to know</div>
          <ul class="conf-tips">
            <li>🔍 <strong>Always verify on TradingView</strong> before entering — mirage-number rule.</li>
            <li>🌐 <strong>On github.io:</strong> LW Align won't fire (Chrome blocks HTTPS→localhost). Run locally for that signal.</li>
            <li>📰 <strong>Near Level needs today's Daily Report</strong> — if not generated, this detector sits idle.</li>
            <li>🔔 <strong>No alerts yet</strong> — v1 is on-screen only.</li>
            <li>⚖️ <strong>Symmetric:</strong> score 78 bull = exactly as strong as 22 bear.</li>
          </ul>
        </div>

      </div>

    </div>`;

  function _tfPills() {
    return TF_OPTIONS.map(tf => `
      <button class="conf-tf-pill ${tf === _anchorTF ? 'active' : ''}"
              data-tf="${tf}" type="button">${tf}</button>
    `).join('');
  }

  function render() {
    const { ltf, mtf, htf } = TF_SETS[_anchorTF];
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="page-head">
        <div>
          <h1 class="page-title">Confluence</h1>
          <p class="page-sub">Manual ICT alignment scan · BTC · ETH · XRP · SOL · SUI</p>
        </div>
        <div class="page-actions">
          <div class="conf-tf-row" role="group" aria-label="Anchor timeframe">
            <span class="conf-tf-label">TF</span>${_tfPills()}
          </div>
          <button class="btn-primary" id="confRefreshBtn">⟳ Pull Data</button>
          <button class="btn-soft" id="confPullAllBtn" title="Sequentially fetch all 4 anchor TFs (~30s) so the cross-TF chip is populated from the first scan">⟳⟳ Pull All TFs</button>
          <button class="btn-soft" id="confAutoBtn" title="Toggle 60s auto-refresh">${_autoOn ? 'Auto ✓' : 'Auto off'}</button>
        </div>
      </div>
      <div class="conf-tf-stack muted" style="font-size:.78rem;margin:-6px 0 10px">
        Scanning: <strong>${ltf}</strong> (entry) · <strong>${mtf}</strong> (mid) · <strong>${htf}</strong> (bias). Switch TF, then Pull Data.
      </div>
      <div id="confPullProgress" class="conf-progress muted" style="display:none"></div>
      <div id="confluenceRoot"></div>
      ${_renderChartScanner()}
      ${_renderAlertSettings()}
      ${GUIDE_HTML}`;

    document.getElementById('confRefreshBtn').addEventListener('click', _pullData);
    document.getElementById('confAutoBtn').addEventListener('click', () => {
      _autoOn = !_autoOn;
      localStorage.setItem('jb_conf_auto', _autoOn ? 'on' : 'off');
      document.getElementById('confAutoBtn').textContent = _autoOn ? 'Auto ✓' : 'Auto off';
      if (_autoOn) _startAutoRefresh(); else _stopAutoRefresh();
    });

    // Pull All TFs button
    document.getElementById('confPullAllBtn').addEventListener('click', async () => {
      const btn = document.getElementById('confPullAllBtn');
      const prog = document.getElementById('confPullProgress');
      btn.disabled = true;
      btn.textContent = '⟳⟳ Pulling…';
      if (prog) prog.style.display = '';
      try {
        await _pullAllTFs((m) => { if (prog) prog.textContent = m; });
      } finally {
        btn.disabled = false;
        btn.textContent = '⟳⟳ Pull All TFs';
        if (prog) {
          setTimeout(() => { prog.style.display = 'none'; prog.textContent = ''; }, 2500);
        }
      }
    });

    // Alert settings wiring
    const alertChk = document.getElementById('confAlertsOn');
    if (alertChk) alertChk.addEventListener('change', () => {
      _alertsOn = alertChk.checked;
      localStorage.setItem('jb_conf_alerts_on', _alertsOn ? 'on' : 'off');
      if (_alertsOn) _maybeRequestNotifPermission();
    });
    const alertThr = document.getElementById('confAlertThr');
    if (alertThr) alertThr.addEventListener('change', () => {
      _alertThr = parseInt(alertThr.value, 10) || 70;
      localStorage.setItem('jb_conf_alert_thr', String(_alertThr));
    });
    const testNotif = document.getElementById('confTestNotif');
    if (testNotif) testNotif.addEventListener('click', async () => {
      if (typeof Notification === 'undefined') { alert('Notifications unsupported in this browser'); return; }
      if (Notification.permission === 'default') {
        const r = await Notification.requestPermission();
        if (r !== 'granted') { alert('Permission not granted'); return; }
      }
      if (Notification.permission === 'denied') {
        alert('Permission denied — re-enable in your browser site settings.');
        return;
      }
      const n = new Notification('Confluence test alert', { body: 'You will see this when an asset crosses your threshold.' });
      setTimeout(() => n.close(), 8000);
      render();
    });
    const testTg = document.getElementById('confTestTg');
    if (testTg) testTg.addEventListener('click', async () => {
      try {
        await Telegram.send('🎯 *Confluence test alert* — your widget is wired up correctly.', { parse_mode: 'Markdown' });
        alert('Sent — check Telegram.');
      } catch (e) {
        alert('Telegram send failed: ' + e.message);
      }
    });

    // TF pill clicks — change anchor, persist, clear cache+data, re-render
    document.querySelectorAll('.conf-tf-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const tf = btn.dataset.tf;
        if (!TF_OPTIONS.includes(tf) || tf === _anchorTF) return;
        _anchorTF = tf;
        localStorage.setItem('jb_conf_tf', tf);
        _klineCache.clear();    // old cache is wrong TF set
        _lastRun = null;        // old data is now stale
        render();               // re-render page-head + reset to empty state
      });
    });

    // If we already have data from a prior session in memory, keep it.
    // Otherwise show the empty state — wait for the user to click Pull Data.
    if (_lastRun) _renderTable();
    else _renderEmpty();

    // Only spin up the auto-refresh interval if the user opted in
    if (_autoOn) _startAutoRefresh();

    // Wire Chart Scanner interactions
    _initChartScanner();

    // Collapse / expand wiring on the user-guide panels
    _wireGuideCollapse();
  }

  /* ── Guide collapse logic ─────────────────────────────── */
  function _wireGuideCollapse() {
    // Per-section: click on .conf-guide-h to toggle .is-collapsed on parent
    document.querySelectorAll('.conf-guide .conf-guide-section').forEach(sec => {
      const head = sec.querySelector('.conf-guide-h');
      if (!head) return;
      head.style.cursor = 'pointer';
      head.style.userSelect = 'none';
      // chevron marker
      if (!head.querySelector('.conf-chev')) {
        const chev = document.createElement('span');
        chev.className = 'conf-chev';
        chev.textContent = '▾';
        head.appendChild(chev);
      }
      head.addEventListener('click', () => {
        sec.classList.toggle('is-collapsed');
      });
      // Apply default-collapsed state on first paint
      if (_guideCollapsed) sec.classList.add('is-collapsed');
    });
    // Global collapse-all toggle
    const allBtn = document.getElementById('confGuideToggle');
    if (allBtn) {
      allBtn.textContent = _guideCollapsed ? 'Expand all' : 'Collapse all';
      allBtn.addEventListener('click', () => {
        const secs = document.querySelectorAll('.conf-guide .conf-guide-section');
        const anyOpen = Array.from(secs).some(s => !s.classList.contains('is-collapsed'));
        secs.forEach(s => s.classList.toggle('is-collapsed', anyOpen));
        _guideCollapsed = anyOpen;
        localStorage.setItem('jb_conf_guide_collapsed', _guideCollapsed ? 'on' : 'off');
        allBtn.textContent = _guideCollapsed ? 'Expand all' : 'Collapse all';
      });
    }
    if (_alertsOn && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      // Best-effort prompt on render (browsers may ignore if not user-gesture)
    }
  }

  return {
    render, _refresh, _scoreAsset,
    _takeTrade, _pullAllTFs,
    _hitRateSummary, _crossTFAgreement,
  };
})();
