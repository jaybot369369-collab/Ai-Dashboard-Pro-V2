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

  // Detector → base weight. Setups with a meaningful playbook winRate
  // (tradeCount ≥ 5) scale this by (wr-50)/50.
  const WEIGHTS = {
    bias_4h:   2.0,
    adx_gate:  1.6,
    fvg_15m:   1.2,
    fvg_1h:    1.4,
    ob_15m:    1.4,
    ob_1h:     1.6,
    sweep_15m: 1.3,
    sweep_1h:  1.5,
    cisd_15m:  1.0,
    bos_1h:    1.0,
    near_level:1.3,
    lw_align:  1.2,
  };

  // Maps detector → playbook setup name fragment for weight lookup
  const SETUP_MAP = {
    fvg_15m:'fvg', fvg_1h:'fvg',
    ob_15m:'order block', ob_1h:'order block',
    sweep_15m:'sweep', sweep_1h:'sweep',
    cisd_15m:'cisd',
    bos_1h:'continuation',
  };

  // Manual refresh only by default — data sits in memory until the
  // user clicks "Pull data". Auto-refresh is opt-in via the toggle.
  let _autoOn = localStorage.getItem('jb_conf_auto') === 'on';
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

  /* ── kline fetch (cached) ────────────────────────────── */
  async function _fetchKlines(sym, tf, limit = 220) {
    const key = `${sym}-${tf}`;
    const cached = _klineCache.get(key);
    if (cached && Date.now() - cached.t < KLINE_TTL) return cached.data;
    try {
      const url = `${BINANCE}?symbol=${sym}USDT&interval=${tf}&limit=${limit}`;
      const r = await fetch(url, { mode: 'cors', cache: 'no-store' });
      if (!r.ok) return null;
      const raw = await r.json();
      const data = raw.map(k => ({
        t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5]
      }));
      _klineCache.set(key, { t: Date.now(), data });
      return data;
    } catch (e) { return null; }
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
  function _playbookAdjusted(detectorId) {
    const base = WEIGHTS[detectorId] || 1.0;
    const frag = SETUP_MAP[detectorId];
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
    const [k15, k1h, k4h] = await Promise.all([
      _fetchKlines(sym, '15m'),
      _fetchKlines(sym, '1h'),
      _fetchKlines(sym, '4h'),
    ]);
    if (!k15 || !k1h || !k4h) {
      return { sym, score: null, dir: null, fired: [], missed: [], price: null, error: 'kline fetch failed' };
    }
    const price = k15[k15.length - 1].c;

    const detectors = [];
    function run(id, fn) {
      try { detectors.push({ id, ...fn() }); }
      catch (e) { detectors.push({ id, fired: false, dir: null, strength: 0, evidence: 'err: ' + e.message }); }
    }

    run('bias_4h',   () => ICTDetect.detectBias(k4h));
    run('adx_gate',  () => ICTDetect.detectADXGate(k4h));
    run('fvg_15m',   () => ICTDetect.detectFVG(k15));
    run('fvg_1h',    () => ICTDetect.detectFVG(k1h));
    run('ob_15m',    () => ICTDetect.detectOB(k15));
    run('ob_1h',     () => ICTDetect.detectOB(k1h));
    run('sweep_15m', () => ICTDetect.detectSweep(k15));
    run('sweep_1h',  () => ICTDetect.detectSweep(k1h));
    run('cisd_15m',  () => ICTDetect.detectCISD(k15));
    run('bos_1h',    () => ICTDetect.detectBOS(k1h));

    // near_level (Daily Report)
    const levels = _levelsFromDaily(daily, sym);
    run('near_level', () => ICTDetect.nearLevel(price, levels, 0.5));

    // lw_align: bias from LW
    if (lw?.scores) {
      const row = lw.scores.find(s => (s.asset || '').toUpperCase() === sym);
      if (row && row.bias && ['bull','bear'].includes(row.bias)) {
        detectors.push({
          id: 'lw_align', fired: true, dir: row.bias,
          strength: Math.min(1, Math.abs(50 - (row.score ?? 50)) / 50),
          evidence: `LW 4h bias ${row.bias} (score ${row.score?.toFixed?.(0) ?? '—'})`,
        });
      } else {
        detectors.push({ id: 'lw_align', fired: false, dir: null, strength: 0, evidence: 'LW neutral/unavailable' });
      }
    }

    // aggregate
    let bullSum = 0, bearSum = 0;
    detectors.forEach(d => {
      if (!d.fired || !d.dir) return;
      const w = _playbookAdjusted(d.id);
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

  const PRETTY = {
    bias_4h: 'Bias 4h', adx_gate: 'ADX 4h',
    fvg_15m: 'FVG 15m', fvg_1h: 'FVG 1h',
    ob_15m: 'OB 15m', ob_1h: 'OB 1h',
    sweep_15m: 'Sweep 15m', sweep_1h: 'Sweep 1h',
    cisd_15m: 'CISD 15m', bos_1h: 'BOS 1h',
    near_level: 'Near Level', lw_align: 'LW Align',
  };

  function _topFired(fired) {
    if (!fired.length) return '<span class="muted">—</span>';
    const ranked = [...fired].sort((a, b) => (b.strength || 0) - (a.strength || 0)).slice(0, 4);
    return ranked.map(d => {
      const cls = d.dir === 'bull' ? 'conf-tag-bull' : d.dir === 'bear' ? 'conf-tag-bear' : 'conf-tag-neutral';
      return `<span class="conf-tag ${cls}">${esc(PRETTY[d.id] || d.id)}</span>`;
    }).join(' ');
  }

  function _expandPanel(r) {
    const rows = r.detectors.map(d => {
      const fired = d.fired ? '✓' : '✗';
      const cls = d.fired ? (d.dir === 'bull' ? 'fired-bull' : d.dir === 'bear' ? 'fired-bear' : 'fired-neutral') : 'missed';
      const w = _playbookAdjusted(d.id).toFixed(2);
      const strBar = d.fired
        ? `<div class="conf-strength"><span style="width:${(d.strength*100).toFixed(0)}%"></span></div>`
        : `<div class="conf-strength"></div>`;
      return `
        <tr class="conf-detail-row ${cls}">
          <td class="conf-detail-status">${fired}</td>
          <td>${esc(PRETTY[d.id] || d.id)}</td>
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
        Inputs: Binance klines · ${dailyOk ? 'Daily Report ✓' : 'Daily Report —'} · ${lwOk ? 'Liquidity Watcher ✓' : 'LW —'} · Playbook weights from <code>jb_playbook</code>
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
      <div class="card-title">How to read this tab</div>
      <div class="conf-guide-body">

        <div class="conf-guide-section">
          <div class="conf-guide-h">What it does</div>
          <p>Watches BTC · ETH · XRP · SOL · SUI in real time. Tells you when multiple ICT setups line up in the same direction. Higher confluence = stronger trade signal. Click <strong>Pull Data</strong> any time to refresh — data stays put until you pull again.</p>
        </div>

        <div class="conf-guide-section">
          <div class="conf-guide-h">The 4 KPI cards (top strip)</div>
          <ul>
            <li><strong>Tracked</strong> — how many assets being scored (always 5).</li>
            <li><strong>Aligned ≥65 / ≤35</strong> — how many assets crossed the actionable threshold right now. 0 is normal most of the time.</li>
            <li><strong>Killzone</strong> — which session is currently active (Asia / London / NY AM / NY PM / Off). When active, scores get a 1.15× multiplier.</li>
            <li><strong>Last update</strong> — confirms data freshness.</li>
          </ul>
        </div>

        <div class="conf-guide-section">
          <div class="conf-guide-h">The ranked table</div>
          <p>Sorted by most extreme score first (distance from 50). The asset at the top has the strongest directional signal — bull or bear.</p>
          <ul>
            <li><strong>#</strong> — rank (1 = most aligned right now)</li>
            <li><strong>Asset</strong> — BTC / ETH / XRP / SOL / SUI</li>
            <li><strong>Dir</strong> — ▲ Bull / ▼ Bear / ─ Neutral, direction of the net signal</li>
            <li><strong>Score</strong> — 0–100 confluence score + coloured bar. 50 = neutral. ≥65 = strong bull. ≤35 = strong bear.</li>
            <li><strong>Setups</strong> — "5/11" = 5 of 11 detectors fired</li>
            <li><strong>Top fired</strong> — the highest-strength detectors, colour-coded green=bull, red=bear</li>
            <li><strong>Price</strong> — live spot price from Binance</li>
          </ul>
          <p><strong>Click any row</strong> to expand and see every detector with ✓/✗, strength bar, weight, and a plain-English evidence string.</p>
        </div>

        <div class="conf-guide-section">
          <div class="conf-guide-h">Score → action</div>
          <table class="conf-guide-table">
            <thead><tr><th>Score</th><th>Meaning</th><th>What to do</th></tr></thead>
            <tbody>
              <tr><td><strong>80–100</strong></td><td>Very strong bull alignment</td><td>Hunt for long entries — wait for LTF trigger</td></tr>
              <tr><td><strong>65–80</strong></td><td>Strong bull alignment</td><td>Bias long — only take longs in this asset</td></tr>
              <tr><td><strong>50–65</strong></td><td>Mild bull lean</td><td>No trade — wait</td></tr>
              <tr><td><strong>35–50</strong></td><td>Mild bear lean</td><td>No trade — wait</td></tr>
              <tr><td><strong>20–35</strong></td><td>Strong bear alignment</td><td>Bias short</td></tr>
              <tr><td><strong>0–20</strong></td><td>Very strong bear alignment</td><td>Hunt for short entries</td></tr>
            </tbody>
          </table>
          <p style="margin-top:8px"><strong>Critical rule:</strong> to score above 65 (or below 35), an asset needs at least <strong>3 detectors firing in the dominant direction</strong>. This prevents a single noisy signal from spiking the number.</p>
        </div>

        <div class="conf-guide-section">
          <div class="conf-guide-h">What each detector means</div>
          <table class="conf-guide-table">
            <thead><tr><th>Detector</th><th>TF</th><th>Fires when…</th></tr></thead>
            <tbody>
              <tr><td><strong>Bias 4h</strong></td><td>4h</td><td>EMA50 above/below EMA200 with slope confirming — the dominant trend.</td></tr>
              <tr><td><strong>ADX 4h</strong></td><td>4h</td><td>ADX &gt; 15 and rising 3 bars (same gate the OBxADX live bot uses).</td></tr>
              <tr><td><strong>FVG 15m / 1h</strong></td><td>15m, 1h</td><td>An unfilled Fair Value Gap exists.</td></tr>
              <tr><td><strong>OB 15m / 1h</strong></td><td>15m, 1h</td><td>An unmitigated Order Block exists (last opposite candle before &gt;1×ATR displacement).</td></tr>
              <tr><td><strong>Sweep 15m / 1h</strong></td><td>15m, 1h</td><td>Wick past the 20-bar swing high/low + closed back inside. Turtle Soup.</td></tr>
              <tr><td><strong>CISD 15m</strong></td><td>15m</td><td>Change in State of Delivery — strong opposite candle after a 3-bar run.</td></tr>
              <tr><td><strong>BOS 1h</strong></td><td>1h</td><td>Break of Structure — close beyond the prior 15-bar swing extreme.</td></tr>
              <tr><td><strong>Near Level</strong></td><td>n/a</td><td>Spot price within 0.5% of a level from your Daily Report (R1-R3 / S1-S4).</td></tr>
              <tr><td><strong>LW Align</strong></td><td>n/a</td><td>Liquidity Watcher's 4h bias for the asset. Only fires when LW runs on localhost:8766.</td></tr>
            </tbody>
          </table>
          <p style="margin-top:8px">Detector <strong>weights</strong> are biased by your Playbook tab's backtested winRate when a setup has ≥5 logged trades. As your trading record grows, the engine quietly tilts toward setups your data shows actually work.</p>
        </div>

        <div class="conf-guide-section">
          <div class="conf-guide-h">How to actually use it</div>
          <ol>
            <li><strong>Morning scan:</strong> Pull Data → look at top of table. Any asset ≥65 or ≤35? If yes, click its row.</li>
            <li><strong>Verify on TradingView:</strong> Open the chart at the cited TF and confirm the FVG / OB / sweep actually exists where the evidence says it does. <em>Mirage-number rule.</em></li>
            <li><strong>Killzone alerts:</strong> When the Killzone card flips to London / NY AM / NY PM, pull data. Setups firing inside a KZ are weighted higher.</li>
            <li><strong>Multi-TF stack check:</strong> Look for these stacking — ✓ Bias 4h + ✓ OB 1h + ✓ FVG 15m + ✓ Sweep 15m all in the same direction = textbook A-tier.</li>
            <li><strong>Avoid chop:</strong> If most assets are in the 40–60 neutral band → don't trade. The widget is telling you nothing is set up well.</li>
          </ol>
        </div>

        <div class="conf-guide-section">
          <div class="conf-guide-h">Things to know</div>
          <ul>
            <li><strong>Mirage-number rule:</strong> always verify against TradingView before entering.</li>
            <li><strong>GitHub Pages:</strong> when viewing from <code>github.io</code>, LW Align won't fire (Chrome blocks HTTPS→localhost). Run the dashboard locally at <code>localhost:8768</code> with LW up for that signal.</li>
            <li><strong>Daily Report dependency:</strong> the Near Level detector needs <code>js/data/daily_report.json</code>. If today's report hasn't been generated, this detector shows "no levels".</li>
            <li><strong>No alerts yet:</strong> v1 is on-screen only — no Telegram pings.</li>
            <li><strong>Symmetric:</strong> score 78 bull is exactly as strong as 22 bear.</li>
          </ul>
        </div>

        <div class="conf-guide-section conf-guide-tldr">
          <div class="conf-guide-h">TL;DR</div>
          <p>Open the tab → Pull Data → look at row 1. If score ≥65 or ≤35, expand it. Verify the cited setup on TradingView. Trade in the direction the table says — if the killzone is active and ≥3 detectors agree.</p>
        </div>

      </div>
    </div>`;

  function render() {
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="page-head">
        <div>
          <h1 class="page-title">Confluence</h1>
          <p class="page-sub">Manual ICT alignment scan across BTC · ETH · XRP · SOL · SUI</p>
        </div>
        <div class="page-actions">
          <button class="btn-primary" id="confRefreshBtn">⟳ Pull Data</button>
          <button class="btn-soft" id="confAutoBtn" title="Toggle 60s auto-refresh">${_autoOn ? 'Auto ✓' : 'Auto off'}</button>
        </div>
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

    // If we already have data from a prior session in memory, keep it.
    // Otherwise show the empty state — wait for the user to click Pull Data.
    if (_lastRun) _renderTable();
    else _renderEmpty();

    // Only spin up the auto-refresh interval if the user opted in
    if (_autoOn) _startAutoRefresh();
  }

  return { render, _refresh, _scoreAsset };
})();
