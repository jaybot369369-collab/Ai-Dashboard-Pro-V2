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
  let _refreshTimer = null;
  let _lastRun = null;
  let _klineCache = new Map();   // key `${sym}-${tf}` → { t, data }
  let _expandedSym = null;

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
  async function _scoreAsset(sym, daily, lw) {
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

    // lw_align: bias from LW
    if (lw?.scores) {
      const row = lw.scores.find(s => (s.asset || '').toUpperCase() === sym);
      if (row && row.bias && ['bull','bear'].includes(row.bias)) {
        detectors.push({
          id: 'lw_align', type: 'lw_align', fired: true, dir: row.bias,
          strength: Math.min(1, Math.abs(50 - (row.score ?? 50)) / 50),
          evidence: `LW 4h bias ${row.bias} (score ${row.score?.toFixed?.(0) ?? '—'})`,
        });
      } else {
        detectors.push({ id: 'lw_align', type: 'lw_align', fired: false, dir: null, strength: 0, evidence: 'LW neutral/unavailable' });
      }
    }

    // aggregate
    let bullSum = 0, bearSum = 0;
    detectors.forEach(d => {
      if (!d.fired || !d.dir) return;
      const w = _playbookAdjusted(d.type || d.id);
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

  /* ── refresh cycle ───────────────────────────────────── */
  async function _refresh() {
    const root = document.getElementById('confluenceRoot');
    if (!root) return;
    const lastUpdEl = document.getElementById('confLastUpd');
    if (lastUpdEl) lastUpdEl.textContent = 'fetching…';

    const [daily, lw] = await Promise.all([_fetchDailyReport(), _fetchLW()]);
    const results = await Promise.all(SYMBOLS.map(s => _scoreAsset(s, daily, lw)));

    // sort by most extreme score (distance from 50), tiebreak fired count
    results.sort((a, b) => {
      const da = a.score == null ? -1 : Math.abs(a.score - 50);
      const db = b.score == null ? -1 : Math.abs(b.score - 50);
      if (db !== da) return db - da;
      return (b.fired?.length || 0) - (a.fired?.length || 0);
    });

    _lastRun = { ts: Date.now(), results, lwOk: !!lw, dailyOk: !!daily };
    _renderTable();
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
      near_level: 'Near Level', lw_align: 'LW Align',
    };
    const prefix = PREFIX[type] || id;
    if (type === 'near_level' || type === 'lw_align') return prefix;
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
        <td colspan="7">
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
    const { ts, results, lwOk, dailyOk } = _lastRun;
    const aligned = results.filter(r => r.score != null && (r.score >= 65 || r.score <= 35)).length;
    const kz = ICTDetect.activeKillzone();

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

    const rows = results.map((r, i) => {
      if (r.score == null) {
        return `<tr class="conf-row"><td>${i+1}</td><td>${esc(r.sym)}</td><td colspan="5" class="muted">${esc(r.error || 'no data')}</td></tr>`;
      }
      const isExpanded = _expandedSym === r.sym;
      const mainRow = `
        <tr class="conf-row ${isExpanded ? 'is-open' : ''}" data-sym="${esc(r.sym)}">
          <td class="conf-rank">${i+1}</td>
          <td class="conf-sym">${esc(r.sym)}</td>
          <td>${_dirBadge(r.dir, r.score)}</td>
          <td>${_scoreBar(r.score)}</td>
          <td><span class="conf-count">${r.fired.length}<span class="muted">/${r.totalDetectors}</span></span></td>
          <td class="conf-fired">${_topFired(r.fired)}</td>
          <td class="conf-px">$${fmtPrice(r.price)}</td>
        </tr>`;
      return isExpanded ? mainRow + _expandPanel(r) : mainRow;
    }).join('');

    const sourceLine = `
      <div class="muted" style="font-size:.78rem;margin-top:10px">
        Anchor <strong>${_anchorTF}</strong> (entry ${TF_SETS[_anchorTF].ltf} · mid ${TF_SETS[_anchorTF].mtf} · bias ${TF_SETS[_anchorTF].htf}) · Klines: Bybit→Binance→OKX · ${dailyOk ? 'Daily Report ✓' : 'Daily Report —'} · ${lwOk ? 'LW ✓' : 'LW —'} · Playbook weights from <code>jb_playbook</code>
      </div>`;

    root.innerHTML = `
      ${kpiHtml}
      <div class="card conf-card">
        <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
          <span>Ranked Alignment</span>
          <span class="muted" style="font-size:.78rem;text-transform:none;letter-spacing:0">click row for detector breakdown</span>
        </div>
        <table class="conf-table">
          <thead>
            <tr>
              <th style="width:36px">#</th>
              <th style="width:64px">Asset</th>
              <th style="width:96px">Dir</th>
              <th style="width:140px">Score</th>
              <th style="width:80px">Setups</th>
              <th>Top fired</th>
              <th style="width:110px;text-align:right">Price</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
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
          <button class="btn-soft" id="confAutoBtn" title="Toggle 60s auto-refresh">${_autoOn ? 'Auto ✓' : 'Auto off'}</button>
        </div>
      </div>
      <div class="conf-tf-stack muted" style="font-size:.78rem;margin:-6px 0 10px">
        Scanning: <strong>${ltf}</strong> (entry) · <strong>${mtf}</strong> (mid) · <strong>${htf}</strong> (bias). Switch TF, then Pull Data.
      </div>
      <div id="confluenceRoot"></div>
      ${GUIDE_HTML}`;

    document.getElementById('confRefreshBtn').addEventListener('click', _pullData);
    document.getElementById('confAutoBtn').addEventListener('click', () => {
      _autoOn = !_autoOn;
      localStorage.setItem('jb_conf_auto', _autoOn ? 'on' : 'off');
      document.getElementById('confAutoBtn').textContent = _autoOn ? 'Auto ✓' : 'Auto off';
      if (_autoOn) _startAutoRefresh(); else _stopAutoRefresh();
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
    });
    // Global collapse-all toggle
    const allBtn = document.getElementById('confGuideToggle');
    if (allBtn) {
      allBtn.addEventListener('click', () => {
        const secs = document.querySelectorAll('.conf-guide .conf-guide-section');
        const anyOpen = Array.from(secs).some(s => !s.classList.contains('is-collapsed'));
        secs.forEach(s => s.classList.toggle('is-collapsed', anyOpen));
        allBtn.textContent = anyOpen ? 'Expand all' : 'Collapse all';
      });
    }
  }

  return { render, _refresh, _scoreAsset };
})();
