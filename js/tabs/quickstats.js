/* ═══════════════════════════════════════════════════════════
   QUICK STATS — Lightweight setup backtester
   Pick a setup type + pair + lookback → get hit rate, avg R,
   profit factor, equity curve. Uses Binance public REST.
════════════════════════════════════════════════════════════ */
const QuickStatsTab = (() => {

  /* ── State ──────────────────────────────────────────── */
  let _pair       = localStorage.getItem('jb_qs_pair')   || 'BTCUSDT';
  let _setup      = localStorage.getItem('jb_qs_setup')  || 'fvg_bull';
  let _tf         = localStorage.getItem('jb_qs_tf')     || '1h';
  let _lookback   = parseInt(localStorage.getItem('jb_qs_lookback') || '60'); // days
  let _rr         = parseFloat(localStorage.getItem('jb_qs_rr') || '2');
  let _kzOnly     = localStorage.getItem('jb_qs_kz') === '1';
  let _running    = false;
  let _chart      = null;
  let _result     = null;

  const SETUPS = {
    fvg_bull:   { label: 'Bullish FVG entry', dir: 1 },
    fvg_bear:   { label: 'Bearish FVG entry', dir: -1 },
    ob_bull:    { label: 'Bullish Order Block tap', dir: 1 },
    ob_bear:    { label: 'Bearish Order Block tap', dir: -1 },
    sweep_bull: { label: 'Buy-side sweep reversal', dir: 1 },
    sweep_bear: { label: 'Sell-side sweep reversal', dir: -1 },
    rsidiv_bull:{ label: 'Bullish RSI divergence', dir: 1 },
    rsidiv_bear:{ label: 'Bearish RSI divergence', dir: -1 },
  };

  const TFS = ['15m','1h','4h','1d'];
  const PAIRS = ['BTCUSDT','ETHUSDT','XRPUSDT','SOLUSDT','BNBUSDT','DOGEUSDT'];

  /* ── Utils ──────────────────────────────────────────── */
  const dp   = s => s.startsWith('BTC') || s.startsWith('ETH') ? 2 : 4;
  const fmtP = (n, sym) => '$' + (+n).toLocaleString('en-US', { minimumFractionDigits: dp(sym), maximumFractionDigits: dp(sym) });
  const fmtPct = n => (n*100).toFixed(1) + '%';
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function save(k, v) { localStorage.setItem('jb_qs_' + k, v); }

  /* ── NY-aware killzone (lifted) ─────────────────────── */
  const KZS_NY = [
    { sNY: 20, eNY: 24 }, { sNY: 2, eNY: 5 },
    { sNY: 7,  eNY: 10 }, { sNY: 10, eNY: 12 },
  ];
  function nyOffset() {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' }).formatToParts(new Date());
      const tz = parts.find(p => p.type === 'timeZoneName').value;
      const m = tz.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
      return m ? (m[1] === '+' ? 1 : -1) * (parseInt(m[2]) + parseInt(m[3]||'0')/60) : -5;
    } catch { return -5; }
  }
  function inKZAt(ts) {
    const off = nyOffset();
    const d = new Date(ts);
    const h = d.getUTCHours() + d.getUTCMinutes()/60;
    return KZS_NY.some(kz => {
      const s = ((kz.sNY - off) + 24) % 24;
      const e = ((kz.eNY - off) + 24) % 24;
      return s > e ? (h >= s || h < e) : (h >= s && h < e);
    });
  }

  /* ── Fetcher (handles Binance 1000-bar cap by paging) ── */
  async function fetchCandles(symbol, interval, lookbackDays) {
    const tfMs = { '15m': 15*60e3, '1h': 60*60e3, '4h': 4*60*60e3, '1d': 24*60*60e3 }[interval];
    const total = Math.ceil(lookbackDays * 24*60*60e3 / tfMs);
    const end = Date.now();
    const start = end - lookbackDays * 24*60*60e3;
    const all = [];
    let cursor = start;
    while (cursor < end && all.length < total + 50) {
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&limit=1000`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Binance ${r.status}`);
      const raw = await r.json();
      if (!raw.length) break;
      all.push(...raw.map(k => ({
        time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
      })));
      cursor = raw[raw.length-1][0] + tfMs;
      if (raw.length < 1000) break;
      await sleep(120);
    }
    return all;
  }

  /* ── Detectors → return entry signals as {idx, entry, sl, dir} ── */
  function detectFVG(c, dir) {
    const sigs = [];
    for (let i = 2; i < c.length - 1; i++) {
      if (dir === 1 && c[i-2].high < c[i].low) {
        // bull FVG: gap between c[i-2].high and c[i].low. Entry on next-bar tap of FVG top.
        const fvgTop = c[i].low;
        const fvgBot = c[i-2].high;
        // Find tap within next 20 bars
        for (let j = i+1; j < Math.min(i+20, c.length); j++) {
          if (c[j].low <= fvgTop) {
            sigs.push({ idx: j, entry: fvgTop, sl: fvgBot * 0.998, dir: 1, time: c[j].time });
            break;
          }
        }
      }
      if (dir === -1 && c[i-2].low > c[i].high) {
        const fvgBot = c[i].high;
        const fvgTop = c[i-2].low;
        for (let j = i+1; j < Math.min(i+20, c.length); j++) {
          if (c[j].high >= fvgBot) {
            sigs.push({ idx: j, entry: fvgBot, sl: fvgTop * 1.002, dir: -1, time: c[j].time });
            break;
          }
        }
      }
    }
    return sigs;
  }

  function detectOB(c, dir) {
    const sigs = [];
    for (let i = 5; i < c.length - 4; i++) {
      const move = (c[i+3].close - c[i].close) / c[i].close;
      if (dir === 1 && move > 0.015 && c[i].close < c[i].open) {
        // Bullish OB = last down candle before strong up. Entry on first re-tap of OB high.
        const obHi = c[i].high, obLo = c[i].low;
        for (let j = i+4; j < Math.min(i+50, c.length); j++) {
          if (c[j].low <= obHi && c[j].low > obLo * 0.99) {
            sigs.push({ idx: j, entry: obHi, sl: obLo * 0.998, dir: 1, time: c[j].time });
            break;
          }
        }
      }
      if (dir === -1 && move < -0.015 && c[i].close > c[i].open) {
        const obHi = c[i].high, obLo = c[i].low;
        for (let j = i+4; j < Math.min(i+50, c.length); j++) {
          if (c[j].high >= obLo && c[j].high < obHi * 1.01) {
            sigs.push({ idx: j, entry: obLo, sl: obHi * 1.002, dir: -1, time: c[j].time });
            break;
          }
        }
      }
    }
    return sigs;
  }

  function detectSweep(c, dir) {
    const sigs = [];
    for (let i = 25; i < c.length - 1; i++) {
      const recent = c.slice(i-25, i);
      const swingHi = Math.max(...recent.map(x=>x.high));
      const swingLo = Math.min(...recent.map(x=>x.low));
      if (dir === -1 && c[i].high > swingHi && c[i].close < swingHi) {
        // Bearish sweep: swept high, closed below. Entry next bar open.
        if (i+1 < c.length) sigs.push({ idx: i+1, entry: c[i+1].open, sl: c[i].high * 1.002, dir: -1, time: c[i+1].time });
      }
      if (dir === 1 && c[i].low < swingLo && c[i].close > swingLo) {
        if (i+1 < c.length) sigs.push({ idx: i+1, entry: c[i+1].open, sl: c[i].low * 0.998, dir: 1, time: c[i+1].time });
      }
    }
    return sigs;
  }

  function rsi14(c) {
    if (c.length < 15) return [];
    const out = new Array(14).fill(50);
    let gain = 0, loss = 0;
    for (let i = 1; i <= 14; i++) {
      const ch = c[i].close - c[i-1].close;
      if (ch >= 0) gain += ch; else loss -= ch;
    }
    gain /= 14; loss /= 14;
    out.push(100 - 100/(1 + gain/(loss||1e-9)));
    for (let i = 15; i < c.length; i++) {
      const ch = c[i].close - c[i-1].close;
      const g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0;
      gain = (gain*13 + g) / 14;
      loss = (loss*13 + l) / 14;
      out.push(100 - 100/(1 + gain/(loss||1e-9)));
    }
    return out;
  }

  function detectRSIDiv(c, dir) {
    const r = rsi14(c);
    if (!r.length) return [];
    const sigs = [];
    const W = 12;
    for (let i = W*2; i < c.length - 1; i++) {
      const seg1 = c.slice(i-W*2, i-W);
      const seg2 = c.slice(i-W, i);
      const r1 = r.slice(i-W*2, i-W);
      const r2 = r.slice(i-W, i);
      if (dir === 1) {
        const lo1 = Math.min(...seg1.map(x=>x.low)), lo2 = Math.min(...seg2.map(x=>x.low));
        const rl1 = Math.min(...r1), rl2 = Math.min(...r2);
        if (lo2 < lo1 && rl2 > rl1 && rl1 < 35) {
          if (i+1 < c.length) sigs.push({ idx: i+1, entry: c[i+1].open, sl: lo2 * 0.995, dir: 1, time: c[i+1].time });
        }
      }
      if (dir === -1) {
        const hi1 = Math.max(...seg1.map(x=>x.high)), hi2 = Math.max(...seg2.map(x=>x.high));
        const rh1 = Math.max(...r1), rh2 = Math.max(...r2);
        if (hi2 > hi1 && rh2 < rh1 && rh1 > 65) {
          if (i+1 < c.length) sigs.push({ idx: i+1, entry: c[i+1].open, sl: hi2 * 1.005, dir: -1, time: c[i+1].time });
        }
      }
    }
    return sigs;
  }

  function detectByKey(key, candles) {
    const dir = SETUPS[key].dir;
    if (key.startsWith('fvg'))    return detectFVG(candles, dir);
    if (key.startsWith('ob'))     return detectOB(candles, dir);
    if (key.startsWith('sweep'))  return detectSweep(candles, dir);
    if (key.startsWith('rsidiv')) return detectRSIDiv(candles, dir);
    return [];
  }

  /* ── Simulation: walk forward from each entry, check TP-first vs SL-first ── */
  function simulate(signals, candles, rr, kzOnly) {
    const trades = [];
    for (const s of signals) {
      if (kzOnly && !inKZAt(s.time)) continue;
      const risk = Math.abs(s.entry - s.sl);
      if (risk <= 0) continue;
      const tp = s.dir === 1 ? s.entry + rr*risk : s.entry - rr*risk;
      let result = null;
      // Walk forward up to 200 bars
      for (let j = s.idx + 1; j < Math.min(s.idx + 200, candles.length); j++) {
        const bar = candles[j];
        if (s.dir === 1) {
          if (bar.low  <= s.sl) { result = { r: -1, exit: s.sl, exitIdx: j }; break; }
          if (bar.high >= tp)   { result = { r: rr,  exit: tp,  exitIdx: j }; break; }
        } else {
          if (bar.high >= s.sl) { result = { r: -1, exit: s.sl, exitIdx: j }; break; }
          if (bar.low  <= tp)   { result = { r: rr,  exit: tp,  exitIdx: j }; break; }
        }
      }
      if (result) trades.push({ ...s, ...result, tp });
    }
    return trades;
  }

  function summarize(trades) {
    if (!trades.length) return { n: 0, wins: 0, losses: 0, winRate: 0, avgR: 0, totalR: 0, pf: 0, equity: [] };
    const wins   = trades.filter(t => t.r > 0).length;
    const losses = trades.length - wins;
    const totalR = trades.reduce((a,t) => a + t.r, 0);
    const grossWin = trades.filter(t=>t.r>0).reduce((a,t)=>a+t.r, 0);
    const grossLoss = -trades.filter(t=>t.r<0).reduce((a,t)=>a+t.r, 0);
    const equity = []; let cum = 0;
    for (const t of trades) { cum += t.r; equity.push({ t: t.time, r: cum }); }
    return {
      n: trades.length, wins, losses,
      winRate: wins / trades.length,
      avgR: totalR / trades.length,
      totalR,
      pf: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 99 : 0),
      equity,
    };
  }

  /* ── Run + render ───────────────────────────────────── */
  async function run() {
    if (_running) return;
    _running = true;
    _result = null;
    updateBody();
    try {
      const candles = await fetchCandles(_pair, _tf, _lookback);
      if (candles.length < 50) throw new Error(`only ${candles.length} candles — try longer lookback`);
      const sigs = detectByKey(_setup, candles);
      const trades = simulate(sigs, candles, _rr, _kzOnly);
      _result = {
        candles, sigs, trades,
        stats: summarize(trades),
      };
    } catch (e) {
      _result = { error: e.message };
    } finally {
      _running = false;
      updateBody();
    }
  }

  function updateBody() {
    const el = document.getElementById('qsBody');
    if (!el) return;
    if (_running) { el.innerHTML = `<div class="loading-state">Fetching ${_lookback}d of ${_tf} candles for ${_pair}…</div>`; return; }
    if (!_result) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div>
        <p>Pick a setup, pair, and lookback → hit <strong>Run Backtest</strong></p>
        <p class="text-dim" style="font-size:.85rem">Walks every signal forward to TP (${_rr}R) vs SL. No fees, no slippage.</p>
      </div>`;
      return;
    }
    if (_result.error) { el.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${_result.error}</p></div>`; return; }

    const s = _result.stats;
    if (s.n === 0) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div>
        <p>No <strong>${SETUPS[_setup].label}</strong> signals found in last ${_lookback}d on ${_pair} ${_tf}.</p>
        <p class="text-dim" style="font-size:.85rem">Try a longer lookback or different setup.</p>
      </div>`;
      return;
    }

    const wrColor = s.winRate >= 0.55 ? 'var(--green)' : s.winRate >= 0.4 ? 'var(--gold)' : 'var(--red)';
    const pfColor = s.pf >= 1.5 ? 'var(--green)' : s.pf >= 1 ? 'var(--gold)' : 'var(--red)';
    const expColor = s.avgR > 0 ? 'var(--green)' : 'var(--red)';

    el.innerHTML = `
      <div class="qs-stats">
        <div class="qs-stat"><div class="qs-stat-lbl">Signals</div><div class="qs-stat-val">${s.n}</div></div>
        <div class="qs-stat"><div class="qs-stat-lbl">Win Rate</div><div class="qs-stat-val" style="color:${wrColor}">${fmtPct(s.winRate)}</div><div class="qs-stat-sub">${s.wins}W · ${s.losses}L</div></div>
        <div class="qs-stat"><div class="qs-stat-lbl">Expectancy</div><div class="qs-stat-val" style="color:${expColor}">${s.avgR.toFixed(2)}R</div><div class="qs-stat-sub">per trade</div></div>
        <div class="qs-stat"><div class="qs-stat-lbl">Profit Factor</div><div class="qs-stat-val" style="color:${pfColor}">${s.pf.toFixed(2)}</div></div>
        <div class="qs-stat"><div class="qs-stat-lbl">Total R</div><div class="qs-stat-val" style="color:${s.totalR>0?'var(--green)':'var(--red)'}">${s.totalR>=0?'+':''}${s.totalR.toFixed(1)}R</div></div>
      </div>

      <div class="qs-chart-wrap">
        <div class="qs-chart-hdr">📈 Equity Curve (cumulative R)</div>
        <canvas id="qsEquityChart" height="80"></canvas>
      </div>

      <div class="qs-trades-wrap">
        <div class="qs-chart-hdr">Last 20 trades</div>
        <table class="qs-trades">
          <thead><tr><th>Date</th><th>Dir</th><th>Entry</th><th>SL</th><th>TP</th><th>Result</th></tr></thead>
          <tbody>${_result.trades.slice(-20).reverse().map(t => `
            <tr>
              <td>${new Date(t.time).toLocaleDateString()}</td>
              <td>${t.dir===1?'<span style="color:var(--green)">LONG</span>':'<span style="color:var(--red)">SHORT</span>'}</td>
              <td>${fmtP(t.entry, _pair)}</td>
              <td>${fmtP(t.sl, _pair)}</td>
              <td>${fmtP(t.tp, _pair)}</td>
              <td style="color:${t.r>0?'var(--green)':'var(--red)'};font-weight:700">${t.r>0?'+':''}${t.r.toFixed(2)}R</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Render equity curve
    setTimeout(() => {
      const ctx = document.getElementById('qsEquityChart');
      if (!ctx) return;
      if (_chart) _chart.destroy();
      const data = s.equity.map(p => ({ x: new Date(p.t).toLocaleDateString(), y: p.r }));
      _chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: data.map(d => d.x),
          datasets: [{
            data: data.map(d => d.y),
            borderColor: s.totalR > 0 ? '#00c896' : '#ff505a',
            backgroundColor: s.totalR > 0 ? 'rgba(0,200,150,0.15)' : 'rgba(255,80,90,0.15)',
            fill: true, tension: 0.2, pointRadius: 0, borderWidth: 2,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#8b949e', maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,0.05)' } },
            y: { ticks: { color: '#8b949e', callback: v => v + 'R' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          },
        },
      });
    }, 50);
  }

  /* ── Inner HTML (controls + body shell) — for embedding ── */
  function _renderHTML() {
    return `<div class="qs-controls">
        <div class="qs-ctrl"><label>Setup</label>
          <select id="qsSetup">${Object.entries(SETUPS).map(([k,v]) => `<option value="${k}"${k===_setup?' selected':''}>${v.label}</option>`).join('')}</select>
        </div>
        <div class="qs-ctrl"><label>Pair</label>
          <select id="qsPair">${PAIRS.map(p => `<option value="${p}"${p===_pair?' selected':''}>${p.replace('USDT','/USDT')}</option>`).join('')}</select>
        </div>
        <div class="qs-ctrl"><label>Timeframe</label>
          <select id="qsTF">${TFS.map(tf => `<option value="${tf}"${tf===_tf?' selected':''}>${tf.toUpperCase()}</option>`).join('')}</select>
        </div>
        <div class="qs-ctrl"><label>Lookback (days)</label>
          <select id="qsLookback">${[7,14,30,60,90,180,365].map(d => `<option value="${d}"${d===_lookback?' selected':''}>${d}d</option>`).join('')}</select>
        </div>
        <div class="qs-ctrl"><label>Reward:Risk</label>
          <select id="qsRR">${[1, 1.5, 2, 2.5, 3, 4, 5].map(r => `<option value="${r}"${r===_rr?' selected':''}>1:${r}</option>`).join('')}</select>
        </div>
        <div class="qs-ctrl qs-ctrl-check">
          <label><input type="checkbox" id="qsKZ"${_kzOnly?' checked':''}> Killzone-only</label>
        </div>
        <button class="btn-primary" id="qsRunBtn" style="margin-left:auto">▶ Run Backtest</button>
      </div>
      <div id="qsBody" style="margin-top:18px"></div>`;
  }

  function _wireUp() {
    document.getElementById('qsSetup')?.addEventListener('change', e => { _setup = e.target.value; save('setup', _setup); });
    document.getElementById('qsPair')?.addEventListener('change',  e => { _pair  = e.target.value; save('pair',  _pair); });
    document.getElementById('qsTF')?.addEventListener('change',    e => { _tf    = e.target.value; save('tf',    _tf); });
    document.getElementById('qsLookback')?.addEventListener('change', e => { _lookback = parseInt(e.target.value); save('lookback', _lookback); });
    document.getElementById('qsRR')?.addEventListener('change',    e => { _rr    = parseFloat(e.target.value); save('rr', _rr); });
    document.getElementById('qsKZ')?.addEventListener('change',    e => { _kzOnly = e.target.checked; save('kz', _kzOnly?'1':'0'); });
    document.getElementById('qsRunBtn')?.addEventListener('click', run);
    updateBody();
  }

  /* ── Standalone tab render (for direct navigation) ──── */
  function render() {
    const content = document.getElementById('content');
    content.innerHTML = `<div class="qs-wrap">${_renderHTML()}</div>`;
    _wireUp();
  }

  return { render, _run: run, _renderHTML, _wireUp };
})();
