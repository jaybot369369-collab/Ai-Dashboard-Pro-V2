/* ═══════════════════════════════════════════════════════════
   DASHBOARD TAB (V3 — Claude.ai design)
════════════════════════════════════════════════════════════ */
const DashboardTab = (() => {

  let calMonth, calYear;
  let dragStart = null;
  let dragEnd   = null;
  let _pnlRange = localStorage.getItem('jb_dash_pnlrange') || '30';
  const _charts = [];

  const PNL_LABEL = { '1': 'Last 24 hours', '7': 'Last 7 days', '30': 'Last 30 days' };

  function destroyCharts() {
    while (_charts.length) {
      try { _charts.pop().destroy(); } catch (e) {}
    }
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 5)  return 'Good evening';
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }
  function todayLabel() {
    const d = new Date();
    return d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short' });
  }

  /* ── ICON SVGs ──────────────────────────────────────── */
  const ICO = {
    wallet:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>`,
    trend:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/></svg>`,
    target:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
    layers:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
    arrowUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg>`,
    arrowDn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
    arrowRt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  };

  /* ── HELPERS ────────────────────────────────────────── */
  function fmt$(n) {
    const v = Number(n) || 0;
    const abs = Math.abs(v);
    const s = abs >= 1000
      ? abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : abs.toFixed(2);
    return (v < 0 ? '-$' : '+$') + s;
  }
  function fmtMoney(n) {
    const v = Number(n) || 0;
    const abs = Math.abs(v);
    if (abs >= 10000) return '$' + (abs / 1000).toFixed(1) + 'K';
    return '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function dirChip(dir) {
    if (!dir) return '—';
    const long = dir === 'Long';
    return `<span class="dir ${long ? 'long' : 'short'}">
      <span class="dir-arrow">${long ? ICO.arrowUp : ICO.arrowDn}</span>
      ${long ? 'Long' : 'Short'}
    </span>`;
  }
  function deltaPill(value, fmtFn, suffix='') {
    const v = Number(value) || 0;
    const cls = v > 0.0001 ? 'up' : v < -0.0001 ? 'down' : 'flat';
    const icon = cls === 'up' ? ICO.arrowUp : cls === 'down' ? ICO.arrowDn : ICO.arrowRt;
    const text = fmtFn ? fmtFn(v) : v.toFixed(2);
    return `<div class="kpi-delta ${cls}">${icon}<span>${text}${suffix}</span></div>`;
  }
  function pctDelta(curr, prev) {
    if (!prev) return curr ? 100 : 0;
    return ((curr - prev) / Math.abs(prev)) * 100;
  }

  /* ── ACCENT COLOUR (read from CSS for charts) ───────── */
  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function hexToRgba(hex, a) {
    const h = hex.replace('#', '');
    const n = h.length === 3
      ? h.split('').map(c => parseInt(c + c, 16))
      : [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
    return `rgba(${n[0]},${n[1]},${n[2]},${a})`;
  }

  /* ── DERIVED METRICS ────────────────────────────────── */
  function accountBalance(trades) {
    const start = 25000;
    const closed = trades.filter(t => t.result !== '' && t.result !== undefined);
    return closed.reduce((s, t) => s + (parseFloat(t.result) || 0), 0) + start;
  }
  function periodSeries(allTrades, days) {
    // Daily P&L series for last N days (oldest → newest)
    const map = {};
    const now = new Date(); now.setHours(0,0,0,0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      map[d.toISOString().slice(0,10)] = 0;
    }
    allTrades.forEach(t => {
      const r = parseFloat(t.result);
      if (isNaN(r)) return;
      const d = (t.dateEnd || t.date || '').slice(0,10);
      if (d in map) map[d] += r;
    });
    return Object.entries(map).map(([date, pl]) => ({ date, pl }));
  }
  function equitySeries(allTrades) {
    return DB.equityCurve(allTrades);
  }

  /* ─────────────────────────────────────────────────────
     RENDER
  ───────────────────────────────────────────────────── */
  function render() {
    destroyCharts();
    const content = document.getElementById('content');
    const allTrades = DB.getTrades();
    const periodDays = parseInt(_pnlRange) || 30;
    const pnlTrades  = DB.filterByRange(allTrades, _pnlRange);
    const stats      = DB.calcStats(pnlTrades);

    // Previous-period stats for deltas
    const prevTrades = DB.filterByRange(
      allTrades.filter(t => {
        const cutoff = new Date(Date.now() - periodDays * 86400000);
        return new Date(t.date) < cutoff;
      }),
      String(periodDays)
    );
    const prev = DB.calcStats(prevTrades);

    const balance     = accountBalance(allTrades);
    const balanceChg  = pctDelta(stats.totalPL, prev.totalPL);
    const netPL       = stats.totalPL;
    const winRate     = stats.closed ? stats.winRate : 0;
    const avgR        = stats.closed ? stats.avgR : 0;
    const pf          = stats.losses ? (stats.wins / Math.max(stats.losses, 1)) : stats.wins;
    const monthTrades = DB.filterByRange(allTrades, '30');
    const monthPL     = DB.calcStats(monthTrades).totalPL;

    /* ── HTML ── */
    content.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Overview</h1>
          <div class="sub">${greeting()} · ${todayLabel()}</div>
        </div>
        <div class="right">
          <div class="pill-select" id="dashPeriod">
            <span>${PNL_LABEL[_pnlRange] || 'Last 30 days'}</span>
            <span class="chev">▾</span>
          </div>
        </div>
      </div>

      <div class="kpi-grid">
        ${kpiCard(1, ICO.wallet,
          fmtMoney(balance), 'Account balance',
          deltaPill(balanceChg, v => (v>=0?'+':'') + v.toFixed(1), '%'))}
        ${kpiCard(2, ICO.trend,
          fmt$(netPL), 'Net P&L',
          `<div class="kpi-delta ${netPL>=0?'up':'down'}">${netPL>=0?ICO.arrowUp:ICO.arrowDn}<span>${netPL>=0?'Profitable':'Unprofitable'}</span></div>`)}
        ${kpiCard(3, ICO.target,
          (stats.closed ? winRate.toFixed(1) : '—') + '%', 'Win rate',
          `<div class="kpi-delta ${winRate>=50?'up':'down'}"><span>${stats.wins}W / ${stats.losses}L</span></div>`)}
        ${kpiCard(4, ICO.layers,
          (stats.closed ? (avgR>=0?'+':'') + avgR.toFixed(2) : '—') + 'R', 'Avg R-multiple',
          `<div class="kpi-delta ${pf>=1?'up':'down'}">${pf>=1?ICO.arrowUp:ICO.arrowDn}<span>PF ${pf.toFixed(2)}</span></div>`)}
      </div>

      <div class="row row-12-8">
        <div class="card">
          <div class="card-head">
            <div>
              <div class="card-title">Equity curve</div>
              <div class="card-sub">Account balance over time</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              <span class="badge accent">${DB.equityCurve(allTrades).length} trades</span>
              <div class="pill-select"><span>All time</span><span class="chev">▾</span></div>
            </div>
          </div>
          <div class="chart-wrap" style="height:280px"><canvas id="equityCanvas"></canvas></div>
        </div>
        <div class="card" style="display:flex;flex-direction:column">
          <div class="card-head">
            <div>
              <div class="card-title">Trading calendar</div>
              <div class="card-sub">Click a day for trades</div>
            </div>
          </div>
          <div id="calendarSection" style="flex:1"></div>
        </div>
      </div>

      <div class="row row-12-8">
        <div class="card">
          <div class="card-head">
            <div>
              <div class="card-title">Recent trades</div>
              <div class="card-sub">Latest 8 entries</div>
            </div>
            <button class="pill-select" onclick="App.navigate('tradelog')">
              <span>View all</span><span class="chev">→</span>
            </button>
          </div>
          ${recentTradesHtml(pnlTrades)}
        </div>

        <div class="card">
          <div class="card-head">
            <div>
              <div class="card-title">Top setups</div>
              <div class="card-sub">By P&amp;L contribution</div>
            </div>
          </div>
          ${topSetupsHtml(pnlTrades)}
        </div>
      </div>
    `;

    /* ── CHARTS ── */
    const accent = cssVar('--accent', '#7c5cff');
    const accent2 = cssVar('--accent-2', '#5b3df0');
    const good    = cssVar('--good', '#16a34a');
    const bad     = cssVar('--bad', '#dc2626');
    const muted   = cssVar('--muted', '#8b90a8');
    const surface = cssVar('--surface', '#fff');

    // KPI sparklines
    const sparkData = periodSeries(allTrades, periodDays).map(p => p.pl);
    let cum = 0;
    const cumData = sparkData.map(v => (cum += v));
    drawSpark('spark-1', cumData,         accent);
    drawSpark('spark-2', sparkData,        netPL>=0 ? good : bad);
    drawSpark('spark-3', rollingWinRate(pnlTrades), winRate>=50 ? good : bad);
    drawSpark('spark-4', rollingAvgR(pnlTrades),    avgR>=0 ? good : bad);

    // Equity curve
    drawEquity('equityCanvas', equitySeries(allTrades), accent, accent2);

    // Top-setups donut
    drawSetupDonut('setupCanvas', _setupLast);

    renderCalendar(DB.dailyPLMap(allTrades));
    wirePeriodPill();
  }

  function kpiCard(idx, icon, value, label, deltaHtml) {
    return `
      <div class="kpi kpi-${idx}">
        <div class="kpi-ic">${icon}</div>
        <div style="flex:1;min-width:0">
          <div class="kpi-num">${value}</div>
          <div class="kpi-lbl">${label}</div>
          ${deltaHtml || ''}
        </div>
        <div class="kpi-spark"><canvas id="spark-${idx}"></canvas></div>
      </div>
    `;
  }

  function rollingWinRate(trades) {
    // 7-trade rolling win rate %
    const sorted = [...trades]
      .filter(t => t.result !== '' && t.result !== undefined)
      .sort((a,b) => new Date(a.date) - new Date(b.date));
    const out = [];
    for (let i = 0; i < sorted.length; i++) {
      const slice = sorted.slice(Math.max(0, i - 6), i + 1);
      const wins = slice.filter(t => parseFloat(t.result) > 0).length;
      out.push((wins / slice.length) * 100);
    }
    return out.length ? out : [0];
  }
  function rollingAvgR(trades) {
    const sorted = [...trades]
      .filter(t => t.result !== '' && t.result !== undefined && t.rMultiple !== '' && t.rMultiple !== undefined)
      .sort((a,b) => new Date(a.date) - new Date(b.date));
    const out = [];
    for (let i = 0; i < sorted.length; i++) {
      const slice = sorted.slice(Math.max(0, i - 6), i + 1);
      const avg = slice.reduce((s, t) => s + parseFloat(t.rMultiple || 0), 0) / slice.length;
      out.push(avg);
    }
    return out.length ? out : [0];
  }

  function drawSpark(canvasId, data, color) {
    const el = document.getElementById(canvasId);
    if (!el || !data || !data.length) return;
    const ctx = el.getContext('2d');
    const c = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map((_, i) => i),
        datasets: [{
          data, borderColor: color, backgroundColor: hexToRgba(color, 0.15),
          fill: true, tension: 0.35, borderWidth: 2, pointRadius: 0,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } },
        elements: { line: { capBezierPoints: true } },
      }
    });
    _charts.push(c);
  }

  function drawEquity(canvasId, series, accent, accent2) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    const ctx = el.getContext('2d');
    const labels = series.map(s => s.date);
    const data   = series.map(s => s.equity);
    const grad = ctx.createLinearGradient(0, 0, 0, 240);
    grad.addColorStop(0, hexToRgba(accent, 0.35));
    grad.addColorStop(1, hexToRgba(accent, 0.02));
    const c = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Equity', data,
          borderColor: accent, backgroundColor: grad,
          fill: true, tension: 0.30, borderWidth: 2.5, pointRadius: 0,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
        scales: {
          x: { display: true, grid: { display: false }, ticks: { color: cssVar('--muted','#888'), maxTicksLimit: 6, font:{size:10} } },
          y: { display: true, grid: { color: cssVar('--border','#eee') }, ticks: { color: cssVar('--muted','#888'), font:{size:10}, callback: v => '$' + (Math.abs(v) >= 1000 ? (v/1000).toFixed(0)+'k' : v.toFixed(0)) } }
        }
      }
    });
    _charts.push(c);
  }

  function drawHeroSpark(canvasId, data) {
    const el = document.getElementById(canvasId);
    if (!el || !data || !data.length) return;
    let cum = 0;
    const cumData = data.map(v => (cum += v));
    const ctx = el.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 80);
    grad.addColorStop(0, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0.02)');
    const c = new Chart(ctx, {
      type: 'line',
      data: {
        labels: cumData.map((_, i) => i),
        datasets: [{
          data: cumData, borderColor: '#fff', backgroundColor: grad,
          fill: true, tension: 0.35, borderWidth: 2.5, pointRadius: 0,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } },
      }
    });
    _charts.push(c);
  }

  let _setupLast = [];
  function topSetupsHtml(trades) {
    // Aggregate $ contribution per setup
    const map = {};
    trades.filter(t => t.result !== '' && t.result !== undefined).forEach(t => {
      const setups = t.setupTypes && t.setupTypes.length ? t.setupTypes
                   : (t.setupType ? [t.setupType] : ['Unspecified']);
      setups.forEach(s => { map[s] = (map[s] || 0) + parseFloat(t.result || 0); });
    });
    const arr = Object.entries(map)
      .map(([label, val]) => ({ label, val }))
      .sort((a, b) => b.val - a.val)
      .slice(0, 5);
    _setupLast = arr;
    const total = arr.reduce((s, x) => s + x.val, 0);

    if (!arr.length) {
      return `<div style="text-align:center;padding:30px;color:var(--muted)">No closed trades in this period yet.</div>`;
    }

    const palette = [
      cssVar('--accent','#7c5cff'),
      '#22d3ee',
      '#f59e0b',
      '#10b981',
      '#f43f5e',
    ];
    return `
      <div class="donut-wrap">
        <div class="donut-canvas-wrap">
          <canvas id="setupCanvas"></canvas>
          <div class="donut-center">
            <div>
              <div class="big">${arr.length}</div>
              <div class="small">setups</div>
            </div>
          </div>
        </div>
        <div class="donut-legend">
          ${arr.map((s, i) => `
            <div class="list-row">
              <span class="list-row-ic" style="background:${hexToRgba(palette[i%palette.length], 0.18)};color:${palette[i%palette.length]}">${esc(s.label).slice(0,3).toUpperCase()}</span>
              <div class="list-row-body">
                <div class="list-row-title">${esc(s.label)}</div>
                <div class="list-row-sub">${total ? ((Math.abs(s.val) / Math.abs(total)) * 100).toFixed(0) : 0}% of total</div>
              </div>
              <div class="list-row-val" style="color:${s.val>=0?'var(--good)':'var(--bad)'}">${fmt$(s.val)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function drawSetupDonut(canvasId, arr) {
    const el = document.getElementById(canvasId);
    if (!el || !arr || !arr.length) return;
    const palette = [
      cssVar('--accent','#7c5cff'),
      '#22d3ee',
      '#f59e0b',
      '#10b981',
      '#f43f5e',
    ];
    const ctx = el.getContext('2d');
    const c = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: arr.map(s => s.label),
        datasets: [{
          data: arr.map(s => Math.abs(s.val) || 0.0001),
          backgroundColor: arr.map((_, i) => palette[i % palette.length]),
          borderColor: cssVar('--surface', '#fff'),
          borderWidth: 2,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '70%',
        plugins: { legend: { display: false }, tooltip: { enabled: true } },
      }
    });
    _charts.push(c);
  }

  function recentTradesHtml(trades) {
    const recent = [...trades]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 8);
    if (!recent.length) {
      return `<div style="text-align:center;padding:30px;color:var(--muted)">No trades in this period.</div>`;
    }
    return `<div class="table-wrap"><table>
      <thead><tr>
        <th>Date</th><th>Symbol</th><th>Dir</th><th>Setup</th><th>R</th><th>P&amp;L</th>
      </tr></thead>
      <tbody>
        ${recent.map(t => {
          const r = parseFloat(t.result);
          const setups = t.setupTypes && t.setupTypes.length ? t.setupTypes
                       : (t.setupType ? [t.setupType] : []);
          const setupLabel = setups[0] || '—';
          return `<tr onclick="App.navigate('tradelog')" style="cursor:pointer">
            <td>${esc((t.date || '').slice(0,10))}</td>
            <td><strong>${esc(t.symbol || '—')}</strong></td>
            <td>${dirChip(t.direction)}</td>
            <td><span class="badge accent">${esc(setupLabel)}</span></td>
            <td>${t.rMultiple !== '' && t.rMultiple !== undefined ? parseFloat(t.rMultiple).toFixed(2) + 'R' : '—'}</td>
            <td class="${!isNaN(r) ? (r>=0 ? 'pnl-pos':'pnl-neg') : ''}">${!isNaN(r) ? fmt$(r) : '—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
  }

  function wirePeriodPill() {
    const el = document.getElementById('dashPeriod');
    if (!el) return;
    el.addEventListener('click', () => {
      const cycle = { '1': '7', '7': '30', '30': '1' };
      _pnlRange = cycle[_pnlRange] || '30';
      localStorage.setItem('jb_dash_pnlrange', _pnlRange);
      render();
    });
  }

  /* ── CALENDAR (unchanged behaviour) ─────────────────── */
  function renderCalendar(dlMap) {
    const sec = document.getElementById('calendarSection');
    if (!sec) return;
    if (calMonth === undefined) {
      calMonth = new Date().getMonth();
      calYear  = new Date().getFullYear();
    }
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    sec.innerHTML = `
      <div class="calendar-wrap">
        <div class="calendar-nav">
          <button onclick="DashboardTab._prevMonth()">&#8249;</button>
          <h3>${monthNames[calMonth]} ${calYear}</h3>
          <button onclick="DashboardTab._nextMonth()">&#8250;</button>
        </div>
        <div class="calendar-grid-header">
          ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<div>${d}</div>`).join('')}
        </div>
        <div class="calendar-grid" id="calGrid"></div>
      </div>
    `;
    buildCalGrid(dlMap);
  }

  function buildCalGrid(dlMap) {
    const grid  = document.getElementById('calGrid');
    if (!grid) return;
    const today = new Date().toISOString().slice(0, 10);
    const first = new Date(calYear, calMonth, 1);
    const last  = new Date(calYear, calMonth + 1, 0);
    const startDay = first.getDay();

    const allTrades = DB.getTrades();
    const tradesByDay = {};
    allTrades.forEach(t => {
      if (!t.date) return;
      const ds = t.date.slice(0, 10);
      if (!tradesByDay[ds]) tradesByDay[ds] = { wins: 0, losses: 0, total: 0 };
      tradesByDay[ds].total++;
      const r = parseFloat(t.result);
      if (!isNaN(r)) {
        if (r > 0) tradesByDay[ds].wins++;
        else if (r < 0) tradesByDay[ds].losses++;
      }
    });
    const dotHtml = (t) => {
      if (!t || !t.total) return '';
      if (t.total <= 6) {
        let dots = '';
        for (let i = 0; i < t.wins;   i++) dots += '<span class="cal-dot win"></span>';
        for (let i = 0; i < t.losses; i++) dots += '<span class="cal-dot loss"></span>';
        return `<div class="cal-dots">${dots}</div>`;
      }
      return `<div class="cal-dots cal-dots-summary">${t.wins}W·${t.losses}L</div>`;
    };

    let html = '';
    for (let i = 0; i < startDay; i++) html += `<div class="cal-day empty"></div>`;
    for (let d = 1; d <= last.getDate(); d++) {
      const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const pnl     = dlMap[dateStr];
      const cls     = calClass(pnl);
      const isToday = dateStr === today ? ' today' : '';
      const tDay    = tradesByDay[dateStr];
      html += `<div class="cal-day ${cls}${isToday}" data-date="${dateStr}"
                    title="${dateStr}${pnl !== undefined ? ': ' + fmt$(pnl) : ''}">
        <span class="cal-num">${d}</span>
        ${pnl !== undefined ? `<span class="cal-pnl">${pnl >= 0 ? '+' : ''}${Math.abs(pnl) >= 1000 ? (pnl / 1000).toFixed(1) + 'k' : pnl.toFixed(0)}</span>` : ''}
        ${dotHtml(tDay)}
      </div>`;
    }
    grid.innerHTML = html;
    wireCalEvents(grid);
  }

  function wireCalEvents(grid) {
    grid.querySelectorAll('.cal-day:not(.empty)').forEach(cell => {
      cell.addEventListener('mousedown', () => {
        dragStart = cell.dataset.date;
        dragEnd   = dragStart;
      });
      cell.addEventListener('mouseenter', () => {
        if (dragStart) { dragEnd = cell.dataset.date; }
      });
      cell.addEventListener('mouseup', () => {
        const startDate = dragStart, endDate = cell.dataset.date;
        dragStart = null; dragEnd = null;
        if (!startDate) return;
        if (startDate === endDate) {
          openDayTradesModal(startDate);
        } else {
          const [d1, d2] = [startDate, endDate].sort();
          App.openTradeModal();
          setTimeout(() => {
            const fDate    = document.getElementById('fDate');
            const fDateEnd = document.getElementById('fDateEnd');
            if (fDate)    fDate.value    = d1;
            if (fDateEnd) fDateEnd.value = d2;
            App.toast(`New multi-day trade: ${d1} → ${d2}`);
          }, 100);
        }
      });
    });
    document.addEventListener('mouseup', () => { dragStart = null; dragEnd = null; }, { once: true });
  }

  function openDayTradesModal(dateStr) {
    const allTrades = DB.getTrades();
    const dayTrades = allTrades.filter(t => {
      if ((t.date || '').slice(0,10) === dateStr) return true;
      if (t.dateEnd && t.date <= dateStr && t.dateEnd >= dateStr) return true;
      return false;
    }).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    const totalPL = dayTrades.reduce((s, t) => {
      const r = parseFloat(t.result);
      return s + (isNaN(r) ? 0 : r);
    }, 0);

    const html = `
      <div class="modal-overlay" id="dayModal" onclick="if(event.target.id==='dayModal')DashboardTab._closeDayModal()">
        <div class="modal modal-sm">
          <div class="modal-header">
            <h2>📅 Trades on ${dateStr}</h2>
            <button class="modal-close" onclick="DashboardTab._closeDayModal()">✕</button>
          </div>
          <div class="modal-body">
            ${dayTrades.length ? `
              <div style="margin-bottom:12px;padding:8px 12px;background:var(--surface2);border-radius:8px;display:flex;justify-content:space-between;">
                <span style="color:var(--muted)">${dayTrades.length} trade${dayTrades.length>1?'s':''}</span>
                <strong style="color:${totalPL >= 0 ? 'var(--good)' : 'var(--bad)'}">${fmt$(totalPL)}</strong>
              </div>
              <div class="day-trades-list">
                ${dayTrades.map(t => `
                  <div class="day-trade-row">
                    <div>
                      <div><strong>${esc(t.symbol || '—')}</strong> ${dirChip(t.direction)}</div>
                      <div style="color:var(--muted);font-size:12px">
                        ${esc(t.setupType) || 'No setup'} · ${esc(t.session) || 'No session'}
                      </div>
                    </div>
                    <div style="text-align:right">
                      <div style="font-weight:700;color:${parseFloat(t.result) >= 0 ? 'var(--good)' : 'var(--bad)'}">
                        ${t.result !== '' && t.result !== undefined ? fmt$(parseFloat(t.result)) : '—'}
                      </div>
                      ${t.rMultiple !== '' && t.rMultiple !== undefined ? `<div style="color:var(--muted);font-size:11px">${parseFloat(t.rMultiple).toFixed(2)}R</div>` : ''}
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : `
              <div style="text-align:center;padding:30px;color:var(--muted)">No trades logged on this day.</div>
            `}
          </div>
          <div class="modal-footer">
            <button class="btn-ghost" onclick="DashboardTab._closeDayModal()">Close</button>
            <button class="btn-primary" onclick="DashboardTab._newTradeForDay('${dateStr}')">＋ New trade</button>
          </div>
        </div>
      </div>
    `;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstElementChild);
  }

  function calClass(pnl) {
    if (pnl === undefined || pnl === null) return 'flat';
    if (pnl === 0) return 'flat';
    if (pnl > 0) {
      if (pnl > 500) return 'win-3';
      if (pnl > 100) return 'win-2';
      return 'win';
    }
    if (pnl < -500) return 'loss-3';
    if (pnl < -100) return 'loss-2';
    return 'loss';
  }

  /* ── Public ──────────────────────────────────────────── */
  return {
    render,
    _setPnlRange: r => { _pnlRange = r; localStorage.setItem('jb_dash_pnlrange', r); render(); },
    _prevMonth: () => {
      calMonth--;
      if (calMonth < 0) { calMonth = 11; calYear--; }
      render();
    },
    _nextMonth: () => {
      calMonth++;
      if (calMonth > 11) { calMonth = 0; calYear++; }
      render();
    },
    _closeDayModal: () => {
      const m = document.getElementById('dayModal');
      if (m) m.remove();
    },
    _newTradeForDay: (dateStr) => {
      const m = document.getElementById('dayModal');
      if (m) m.remove();
      App.openTradeModal();
      setTimeout(() => {
        const fDate = document.getElementById('fDate');
        if (fDate) fDate.value = dateStr;
      }, 100);
    }
  };
})();
