/* ═══════════════════════════════════════════════════════════
   TENDENCIES — Analytics + Mistakes/Strengths
   Analytics section: P&L by DOW, By Session, By Setup, Direction
   Below: sub-nav switches Mistakes / Strengths (existing CRUD).
════════════════════════════════════════════════════════════ */
const TendenciesTab = (() => {

  let _sub = localStorage.getItem('jb_tend_sub') || 'mistakes';
  let _hmMode = localStorage.getItem('jb_tend_hm_mode') || 'session';  // 'session' | 'hour'
  const _safeId = id => /^[A-Za-z0-9_-]+$/.test(id) ? id : '';

  // Chart instances — destroyed before recreating
  let _dowChart = null;
  let _dirChart = null;

  // When renderInto() is active, store the container id so CRUD actions
  // re-render the embedded section in-place instead of overwriting #content.
  let _embedId = null;

  function _rerenderCurrent() {
    if (_embedId) renderInto(_embedId); else render();
  }

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function saveSub(s) { _sub = s; localStorage.setItem('jb_tend_sub', s); }

  /* ── Data helpers ───────────────────────────────────────── */
  function _groupByDOW(trades) {
    const map = {};
    trades.forEach(t => {
      if (!t.date) return;
      const d = new Date(t.date + 'T12:00:00Z');
      const day = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()];
      if (!map[day]) map[day] = 0;
      map[day] += parseFloat(t.result || 0);
    });
    return ['Mon','Tue','Wed','Thu','Fri'].map(d => ({ day: d, pl: map[d] || 0 }));
  }

  function _groupBySession(trades) {
    const map = {};
    trades.forEach(t => {
      const k = t.session || 'Other';
      if (!map[k]) map[k] = { pl: 0, wins: 0, count: 0 };
      const r = parseFloat(t.result || 0);
      map[k].pl += r; map[k].count++;
      if (r > 0) map[k].wins++;
    });
    return Object.entries(map)
      .map(([s, v]) => ({ session: s, pl: v.pl, wr: v.count ? Math.round((v.wins/v.count)*100) : 0 }))
      .sort((a, b) => b.pl - a.pl);
  }

  function _groupBySetup(trades) {
    const map = {};
    trades.forEach(t => {
      const k = t.setupType || t.setupTypes?.[0] || 'Untagged';
      if (!map[k]) map[k] = 0;
      map[k] += parseFloat(t.result || 0);
    });
    return Object.entries(map).map(([s, pl]) => ({ setup: s, pl })).sort((a, b) => b.pl - a.pl).slice(0, 6);
  }

  function _groupByDir(trades) {
    const longs = trades.filter(t => t.direction === 'Long');
    const shorts = trades.filter(t => t.direction === 'Short');
    const lPL = longs.reduce((s, t) => s + parseFloat(t.result || 0), 0);
    const sPL = shorts.reduce((s, t) => s + parseFloat(t.result || 0), 0);
    const tot = longs.length + shorts.length;
    return { longs: longs.length, shorts: shorts.length, lPL, sPL, longPct: tot ? Math.round(longs.length/tot*100) : 0 };
  }

  function fmtPL(n) {
    return (n >= 0 ? '+$' : '-$') + Math.abs(n).toFixed(2);
  }
  // compact money for tight heatmap cells: +$1.2k / -$340 / +$18
  function fmtCompact(n) {
    const a = Math.abs(n), s = n < 0 ? '-$' : '+$';
    if (a >= 1000) return s + (a / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k';
    return s + Math.round(a);
  }

  /* ═══ Day × Time P&L heatmap (roadmap #5) ═══════════════════
     Scoped to manually-logged closed trades — imported Notion/Binance
     history has no session/time tags, so it would swamp the grid with a
     single "Other" column (RULE #2). Rows = weekday (from the trade date),
     columns = trading session (default, populated today) OR hour-of-day
     block (fills in as trades get a Time logged). */
  const _HM_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const _HM_DOW_IDX = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 0: 'Sun' };
  const _HM_SESSIONS = ['Asian', 'London', 'NY', 'Other'];
  const _HM_HOURS = ['00', '03', '06', '09', '12', '15', '18', '21']; // 3-hour UTC blocks

  function _manualClosed() {
    const raw = (typeof DB.filterByMode === 'function') ? DB.filterByMode(DB.getTrades(), 'new') : DB.getTrades();
    return raw.filter(t => t.result !== undefined && t.result !== null && t.result !== '');
  }

  function _hmSessionCol(t) {
    const s = (t.session || '').toLowerCase();
    if (s.startsWith('asia')) return 'Asian';
    if (s.startsWith('lond')) return 'London';
    if (s === 'ny' || s.startsWith('new')) return 'NY';
    return 'Other';
  }

  /* Hour column. A logged Time (HH:MM) wins. Otherwise use the cached
     ESTIMATE: the UTC hour of the first bar in the trade's date window whose
     range traded through the logged entry — same price-containment rule as
     the Trade View chart markers. Estimates are computed lazily by
     _hmFillHours() and cached in localStorage keyed by id:date:entry so an
     edited trade re-estimates. 'na' = price never touched the entry that day
     (bad datum) — excluded, never guessed. */
  const _HM_CACHE_KEY = 'jb_hm_hours';
  function _hmKey(t) { return `${t.id}:${t.date}:${t.entry}`; }
  function _hmCache() { try { return JSON.parse(localStorage.getItem(_HM_CACHE_KEY) || '{}'); } catch { return {}; } }
  function _hourFor(t) {
    const m = /^(\d{2}):/.exec(t.time || '');
    if (m) {
      const h = parseInt(m[1], 10);
      if (h >= 0 && h <= 23) return { col: _HM_HOURS[Math.floor(h / 3)], est: false };
    }
    const v = _hmCache()[_hmKey(t)];
    if (typeof v === 'number' && v >= 0 && v <= 23) return { col: _HM_HOURS[Math.floor(v / 3)], est: true };
    return null;  // 'na' or not yet estimated
  }

  let _hmFillBusy = false;
  async function _hmFillHours() {
    if (_hmFillBusy) return;
    if (typeof TradeView === 'undefined' || !TradeView._klines) return;
    _hmFillBusy = true;
    try {
      const cache = _hmCache();
      const todo = _manualClosed().filter(t =>
        t.date && isFinite(parseFloat(t.entry)) &&
        !/^\d{2}:/.test(t.time || '') && cache[_hmKey(t)] === undefined);
      let done = 0;
      for (const t of todo) {
        const start = Date.parse(t.date + 'T00:00:00Z');
        const end = Date.parse((t.dateEnd || t.date) + 'T23:59:59Z');
        try {
          const res = await TradeView._klines(t.symbol, '1h', start, end);
          const entry = parseFloat(t.entry);
          const bar = (res.bars || []).find(b => b.t >= start && b.t <= end && b.l <= entry && entry <= b.h);
          // no bar traded through the entry → stable data-level 'na';
          // fetch FAILURES are not cached, so they retry next time
          cache[_hmKey(t)] = bar ? new Date(bar.t).getUTCHours() : 'na';
          localStorage.setItem(_HM_CACHE_KEY, JSON.stringify(cache));
        } catch (e) { /* network/source failure — retry on a later pass */ }
        done++;
        const note = document.querySelector('#tendHeatmap .hm-note');
        if (note && _hmMode === 'hour') note.textContent = `Estimating entry hours from price data… ${done}/${todo.length}`;
      }
      const el = document.getElementById('tendHeatmap');
      if (el && _hmMode === 'hour') el.outerHTML = _heatmapCard();
    } finally { _hmFillBusy = false; }
  }

  // → { cols, cells:{day:{col:{pl,n,wins,rSum,rN}}}, maxAbs, counted, total, estimated, pending }
  function _heatData(mode) {
    const cols = mode === 'hour' ? _HM_HOURS : _HM_SESSIONS;
    const cells = {};
    _HM_DAYS.forEach(d => { cells[d] = {}; cols.forEach(c => cells[d][c] = { pl: 0, n: 0, wins: 0, rSum: 0, rN: 0 }); });
    let maxAbs = 0, counted = 0, estimated = 0, pending = 0;
    const cache = mode === 'hour' ? _hmCache() : null;
    const trades = _manualClosed();
    trades.forEach(t => {
      if (!t.date) return;
      const day = _HM_DOW_IDX[new Date(t.date + 'T12:00:00Z').getUTCDay()];
      let col = null;
      if (mode === 'hour') {
        const h = _hourFor(t);
        if (h) { col = h.col; if (h.est) estimated++; }
        else if (cache[_hmKey(t)] === undefined) pending++;  // estimate not attempted yet
      } else {
        col = _hmSessionCol(t);
      }
      if (!day || !col || !cells[day] || !cells[day][col]) return;
      const c = cells[day][col];
      const pl = parseFloat(t.result || 0);
      c.pl += pl; c.n++; if (pl > 0) c.wins++;
      const r = parseFloat(t.rMultiple);
      if (isFinite(r)) { c.rSum += r; c.rN++; }
      counted++;
    });
    _HM_DAYS.forEach(d => cols.forEach(c => { const v = cells[d][c]; if (v.n) maxAbs = Math.max(maxAbs, Math.abs(v.pl)); }));
    return { cols, cells, maxAbs: maxAbs || 1, counted, total: trades.length, estimated, pending };
  }

  function _heatColor(pl, n, maxAbs) {
    if (!n) return 'rgba(127,127,127,0.05)';
    if (pl === 0) return 'rgba(127,127,127,0.16)';
    const ratio = Math.min(1, Math.abs(pl) / maxAbs);
    const a = (0.14 + 0.6 * ratio).toFixed(3);
    return pl > 0 ? `rgba(34,197,94,${a})` : `rgba(239,68,68,${a})`;
  }

  function _heatmapCard() {
    const mode = _hmMode;
    const { cols, cells, maxAbs, counted, total, estimated, pending } = _heatData(mode);
    // hour estimates are fetched lazily — kick the filler when needed
    if (mode === 'hour' && pending > 0) setTimeout(_hmFillHours, 60);

    if (!total) {
      return `<div id="tendHeatmap" class="card" style="padding:16px;margin-bottom:16px">
        <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:#666;margin-bottom:2px">Day × Time P&amp;L Map</div>
        <div class="text-dim" style="font-size:.82rem;padding:10px 0">Log some trades to see which day-and-time windows make you money.</div>
      </div>`;
    }

    // best / worst populated cell
    let best = null, worst = null;
    _HM_DAYS.forEach(d => cols.forEach(c => {
      const v = cells[d][c]; if (!v.n) return;
      if (!best || v.pl > best.pl) best = { d, c, ...v };
      if (!worst || v.pl < worst.pl) worst = { d, c, ...v };
    }));

    const colLabel = c => mode === 'hour' ? c : c;
    const header = `<div class="hm-cell hm-corner"></div>` +
      cols.map(c => `<div class="hm-cell hm-collabel">${esc(colLabel(c))}</div>`).join('');

    const body = _HM_DAYS.map(d => {
      const rowCells = cols.map(c => {
        const v = cells[d][c];
        const bg = _heatColor(v.pl, v.n, maxAbs);
        const txt = v.n ? `<span class="hm-pl">${fmtCompact(v.pl)}</span><span class="hm-n">${v.n}</span>` : '';
        const click = v.n ? `onclick="TendenciesTab._hmCell('${d}','${esc(c)}')"` : '';
        return `<div class="hm-cell hm-data${v.n ? ' has' : ''}" style="background:${bg}" ${click} title="${esc(d)} · ${esc(c)}">${txt}</div>`;
      }).join('');
      return `<div class="hm-daylabel">${d}</div>${rowCells}`;
    }).join('');

    const modeBtns = `
      <span class="hm-mode-group">
        <button class="hm-mode-pill${mode === 'session' ? ' active' : ''}" onclick="TendenciesTab._hmSetMode('session')">Session</button>
        <button class="hm-mode-pill${mode === 'hour' ? ' active' : ''}" onclick="TendenciesTab._hmSetMode('hour')">Hour (UTC)</button>
      </span>`;

    let note;
    if (mode === 'hour') {
      if (pending > 0) note = `Estimating entry hours from price data (${pending} trade${pending === 1 ? '' : 's'} to go) — the grid fills in automatically…`;
      else {
        const na = total - counted;
        note = `${counted}/${total} trades placed`
          + (estimated ? ` — ${estimated} hour${estimated === 1 ? '' : 's'} estimated from the first bar that traded through the logged entry (log a Time on the trade form for exact placement)` : '')
          + (na ? `; ${na} couldn't be placed (price never touched the logged entry that day — check those trades' data)` : '')
          + '. Hours are UTC.';
      }
    } else {
      note = counted < total ? `${total - counted} trade${total - counted === 1 ? '' : 's'} without a session fell into “Other”.` : `All ${total} logged trades placed.`;
    }

    const callout = (best && worst) ? `
      <div class="hm-callout">
        <span>🟢 Best window: <b>${best.d} · ${esc(best.c)}</b> ${fmtPL(best.pl)} <span class="hm-sub">(${best.n} trade${best.n === 1 ? '' : 's'})</span></span>
        <span>🔴 Worst window: <b>${worst.d} · ${esc(worst.c)}</b> ${fmtPL(worst.pl)} <span class="hm-sub">(${worst.n} trade${worst.n === 1 ? '' : 's'})</span></span>
      </div>` : '';

    return `<div id="tendHeatmap" class="card" style="padding:16px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:10px">
        <div>
          <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:#666;margin-bottom:2px">Day × Time P&amp;L Map</div>
          <div style="font-size:.85rem;font-weight:600;color:var(--text)">When your edge shows up — green makes money, red loses it</div>
        </div>
        ${modeBtns}
      </div>
      <div class="hm-grid" style="grid-template-columns:52px repeat(${cols.length}, 1fr)">
        ${header}
        ${body}
      </div>
      <div class="hm-detail" id="hmDetail">Click any coloured cell for its win rate, average R and trade count.</div>
      ${callout}
      <div class="hm-note">${note}</div>
    </div>`;
  }

  function _hmSetMode(m) {
    _hmMode = (m === 'hour') ? 'hour' : 'session';
    localStorage.setItem('jb_tend_hm_mode', _hmMode);
    const el = document.getElementById('tendHeatmap');
    if (el) el.outerHTML = _heatmapCard();
  }

  // trades living behind one cell (same bucketing rules as _heatData)
  function _hmTradesFor(day, col) {
    return _manualClosed().filter(t => {
      if (!t.date) return false;
      if (_HM_DOW_IDX[new Date(t.date + 'T12:00:00Z').getUTCDay()] !== day) return false;
      if (_hmMode === 'hour') { const h = _hourFor(t); return !!h && h.col === col; }
      return _hmSessionCol(t) === col;
    });
  }

  function _hmCell(day, col) {
    const list = _hmTradesFor(day, col).sort((a, b) => new Date(b.date) - new Date(a.date));
    const el = document.getElementById('hmDetail');
    if (!el || !list.length) return;

    const n = list.length;
    const wins = list.filter(t => parseFloat(t.result) > 0).length;
    const pl = list.reduce((s, t) => s + parseFloat(t.result || 0), 0);
    const rs = list.map(t => parseFloat(t.rMultiple)).filter(isFinite);
    const avgR = rs.length ? ((rs.reduce((a, b) => a + b, 0) / rs.length >= 0 ? '+' : '') + (rs.reduce((a, b) => a + b, 0) / rs.length).toFixed(2) + 'R') : '—';
    const colLabel = _hmMode === 'hour' ? `${col}:00–${(parseInt(col, 10) + 3) % 24}:00 UTC` : col;

    const rows = list.map(t => {
      const tpl = parseFloat(t.result || 0);
      const setups = (t.setupTypes || (t.setupType ? [t.setupType] : [])).filter(Boolean).join(', ') || '—';
      const est = _hmMode === 'hour' && !/^\d{2}:/.test(t.time || '') ? ' <span class="hm-est" title="hour estimated from price data">≈</span>' : '';
      return `<tr onclick="TradeView.open('${esc(t.id)}')" title="Open trade">
        <td>${esc(t.date)}${est}</td>
        <td><b>${esc(t.symbol || '—')}</b></td>
        <td><span style="color:${t.direction === 'Long' ? 'var(--good,#22c55e)' : 'var(--bad,#ef4444)'};font-weight:600">${esc(t.direction || '—')}</span></td>
        <td class="hm-td-setup">${esc(setups)}</td>
        <td>${t.rMultiple !== undefined && t.rMultiple !== '' && t.rMultiple !== null ? esc(t.rMultiple) + 'R' : '—'}</td>
        <td style="text-align:right;font-weight:700;color:${tpl >= 0 ? 'var(--good,#22c55e)' : 'var(--bad,#ef4444)'}">${fmtPL(tpl)}</td>
      </tr>`;
    }).join('');

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <span><b>${esc(day)} · ${esc(colLabel)}</b> — ${n} trade${n === 1 ? '' : 's'} · ${Math.round(wins / n * 100)}% WR · ${avgR} avg ·
          <span style="color:${pl >= 0 ? 'var(--good,#22c55e)' : 'var(--bad,#ef4444)'};font-weight:700">${fmtPL(pl)}</span></span>
        <span class="hm-hint">click a row to open the trade</span>
      </div>
      <table class="hm-trades">
        <thead><tr><th>Date</th><th>Symbol</th><th>Dir</th><th>Setup</th><th>R</th><th style="text-align:right">P&amp;L</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  /* ── Chart renderers ────────────────────────────────────── */
  function _drawDOW(dowData) {
    const canvas = document.getElementById('tendDOW');
    if (!canvas) return;
    if (_dowChart) { _dowChart.destroy(); _dowChart = null; }
    const colors = dowData.map(d => d.pl >= 0 ? '#22c55e' : '#ef4444');
    _dowChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: dowData.map(d => d.day),
        datasets: [{
          data: dowData.map(d => d.pl),
          backgroundColor: colors,
          borderRadius: 4,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: {
          callbacks: { label: ctx => fmtPL(ctx.raw) }
        }},
        scales: {
          x: { grid: { display: false }, ticks: { color: '#888', font: { size: 11 } } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#888', font: { size: 10 }, callback: v => '$' + v } }
        }
      }
    });
  }

  function _drawDir(dirData) {
    const canvas = document.getElementById('tendDir');
    if (!canvas) return;
    if (_dirChart) { _dirChart.destroy(); _dirChart = null; }
    const hasData = dirData.longs + dirData.shorts > 0;
    _dirChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Long', 'Short'],
        datasets: [{
          data: hasData ? [dirData.longs, dirData.shorts] : [1, 1],
          backgroundColor: hasData ? ['#22c55e', '#ef4444'] : ['#333', '#333'],
          borderWidth: 0,
          hoverOffset: 4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: { legend: { display: false }, tooltip: { enabled: hasData } }
      }
    });
  }

  /* ── Analytics section HTML ─────────────────────────────── */
  function _renderAnalytics(trades) {
    const dowData     = _groupByDOW(trades);
    const sessionData = _groupBySession(trades);
    const setupData   = _groupBySetup(trades);
    const dirData     = _groupByDir(trades);

    const maxSessPL   = sessionData.length ? Math.max(...sessionData.map(s => Math.abs(s.pl)), 1) : 1;
    const maxSetupPL  = setupData.length   ? Math.max(...setupData.map(s => Math.abs(s.pl)), 1)   : 1;

    const sessionRows = sessionData.length
      ? sessionData.map(s => {
          const pct = Math.round(Math.abs(s.pl) / maxSessPL * 100);
          const color = s.pl >= 0 ? '#a855f7' : '#ef4444';
          return `<div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <span style="font-size:.82rem;font-weight:600;color:var(--text)">${esc(s.session)}</span>
              <div style="display:flex;gap:8px;align-items:center">
                <span style="font-size:.75rem;color:#888">${s.wr}% WR</span>
                <span style="font-size:.82rem;font-weight:600;color:${s.pl>=0?'#22c55e':'#ef4444'}">${fmtPL(s.pl)}</span>
              </div>
            </div>
            <div style="height:5px;border-radius:3px;background:rgba(255,255,255,0.08)">
              <div style="height:100%;width:${pct}%;border-radius:3px;background:${color};transition:width .4s"></div>
            </div>
          </div>`;
        }).join('')
      : `<div class="text-dim" style="font-size:.8rem;padding:8px 0">No session data yet</div>`;

    const setupRows = setupData.length
      ? setupData.map(s => {
          const pct = Math.round(Math.abs(s.pl) / maxSetupPL * 100);
          const color = s.pl >= 0 ? '#22c55e' : '#ef4444';
          return `<div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <span style="font-size:.82rem;font-weight:600;color:var(--text)">${esc(s.setup)}</span>
              <span style="font-size:.82rem;font-weight:600;color:${color}">${fmtPL(s.pl)}</span>
            </div>
            <div style="height:5px;border-radius:3px;background:rgba(255,255,255,0.08)">
              <div style="height:100%;width:${pct}%;border-radius:3px;background:${color};transition:width .4s"></div>
            </div>
          </div>`;
        }).join('')
      : `<div class="text-dim" style="font-size:.8rem;padding:8px 0">No setup data yet</div>`;

    const hasDir = dirData.longs + dirData.shorts > 0;
    const dirLegend = hasDir ? `
      <div style="display:flex;flex-direction:column;gap:8px;min-width:120px">
        <div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            <div style="width:10px;height:10px;border-radius:2px;background:#22c55e;flex-shrink:0"></div>
            <span style="font-size:.8rem;color:#888">Long</span>
          </div>
          <div style="font-size:.85rem;font-weight:700;color:#22c55e;margin-left:16px">${dirData.longs} trades</div>
          <div style="font-size:.75rem;color:#888;margin-left:16px">${fmtPL(dirData.lPL)}</div>
        </div>
        <div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            <div style="width:10px;height:10px;border-radius:2px;background:#ef4444;flex-shrink:0"></div>
            <span style="font-size:.8rem;color:#888">Short</span>
          </div>
          <div style="font-size:.85rem;font-weight:700;color:#ef4444;margin-left:16px">${dirData.shorts} trades</div>
          <div style="font-size:.75rem;color:#888;margin-left:16px">${fmtPL(dirData.sPL)}</div>
        </div>
      </div>` : `<div class="text-dim" style="font-size:.8rem">No direction data yet</div>`;

    return { html: `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">

        <!-- P&L by Day of Week -->
        <div class="card" style="padding:16px">
          <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:#666;margin-bottom:2px">P&amp;L by Day of Week</div>
          <div style="font-size:.85rem;font-weight:600;color:var(--text);margin-bottom:12px">Where your edge lives</div>
          <div style="height:130px;position:relative"><canvas id="tendDOW"></canvas></div>
        </div>

        <!-- By Session -->
        <div class="card" style="padding:16px">
          <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:#666;margin-bottom:2px">By Session</div>
          <div style="font-size:.85rem;font-weight:600;color:var(--text);margin-bottom:12px">Win rate &amp; P&amp;L per session</div>
          ${sessionRows}
        </div>

        <!-- By Setup -->
        <div class="card" style="padding:16px">
          <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:#666;margin-bottom:2px">By Setup</div>
          <div style="font-size:.85rem;font-weight:600;color:var(--text);margin-bottom:12px">Top setups by P&amp;L</div>
          ${setupRows}
        </div>

        <!-- Direction Split -->
        <div class="card" style="padding:16px">
          <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:#666;margin-bottom:2px">Direction Split</div>
          <div style="font-size:.85rem;font-weight:600;color:var(--text);margin-bottom:12px">Long vs short bias</div>
          <div style="display:flex;align-items:center;gap:20px">
            <div style="position:relative;width:110px;height:110px;flex-shrink:0">
              <canvas id="tendDir" width="110" height="110"></canvas>
              <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none">
                <div style="font-size:1.1rem;font-weight:800;color:var(--text);line-height:1">${hasDir ? dirData.longPct + '%' : '—'}</div>
                <div style="font-size:.6rem;color:#888;text-transform:uppercase;letter-spacing:.06em">LONG BIAS</div>
              </div>
            </div>
            ${dirLegend}
          </div>
        </div>

      </div>
    `, dowData, dirData };
  }

  /* ── Card grid renderer (works for both kinds) ──────────── */
  function renderGrid(kind) {
    const items = kind === 'mistakes' ? DB.getMistakes() : DB.getStrengths();
    const isMis = kind === 'mistakes';
    const accent = isMis ? 'var(--red)' : 'var(--green)';
    const accentBg = isMis ? 'rgba(255,80,90,.08)' : 'rgba(0,200,150,.08)';
    const addLabel = isMis ? '＋ Add Mistake' : '＋ Add Strength';
    if (!items.length) {
      return `<div class="empty-state"><div class="empty-icon">${isMis?'⚠️':'💪'}</div>
        <p>No ${isMis?'mistakes':'strengths'} logged yet.</p>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:12px">
          <button class="btn-primary" onclick="TendenciesTab._autoAnalyze()">🧠 Auto-Analyze My Trades</button>
          <button class="btn-ghost" onclick="TendenciesTab._add('${kind}')">${addLabel}</button>
        </div>
        <p class="text-dim" style="font-size:.78rem;margin-top:14px">Auto-Analyze scans every closed trade and surfaces patterns: worst/best session, worst/best setup, revenge trading, win/loss streaks, R-multiple consistency.</p>
      </div>`;
    }
    return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap">
        <button class="btn-ghost btn-sm" onclick="TendenciesTab._autoAnalyze()" title="Scan all your trades and auto-detect patterns">🧠 Auto-Analyze Trades</button>
        <button class="btn-primary btn-sm" onclick="TendenciesTab._add('${kind}')">${addLabel}</button>
      </div>
      <div class="tend-grid">
        ${items.map(it => {
          const sid = _safeId(it.id);
          return `<div class="tend-card" style="border-left:3px solid ${accent};background:${accentBg}">
          <div class="tend-card-hdr">
            <div class="tend-title" contenteditable="true" data-id="${esc(sid)}" data-kind="${kind}" data-field="title" oninput="TendenciesTab._edit(event)">${esc(it.title || '(untitled)')}</div>
            <div class="tend-card-actions">
              <span class="tend-counter" title="Times seen">×${it.seenCount || 0}</span>
              <button class="btn-ghost btn-sm" onclick="TendenciesTab._inc('${kind}','${sid}')" title="+1 occurrence">＋</button>
              <button class="btn-ghost btn-sm" onclick="TendenciesTab._delete('${kind}','${sid}')" title="Delete">✕</button>
            </div>
          </div>
          <div class="tend-desc" contenteditable="true" data-id="${esc(sid)}" data-kind="${kind}" data-field="description" oninput="TendenciesTab._edit(event)">${esc(it.description || '')}</div>
          <div class="tend-meta">
            <span class="text-dim">Last seen: ${esc(it.lastSeen) || '—'}</span>
            <span class="text-dim" style="margin-left:auto">Linked trades: ${(it.linkedTradeIds||[]).length}</span>
          </div>
        </div>`;
        }).join('')}
      </div>`;
  }

  /* ── Public render ──────────────────────────────────────── */
  function render() {
    _embedId = null;   // standalone mode — reset embed tracking
    const content = document.getElementById('content');
    const trades = DB.getTrades();
    const analytics = _renderAnalytics(trades);

    content.innerHTML = `
      <div class="page-head">
        <h1>Tendencies</h1>
        <p class="page-subtitle">Where you make money and where you don't</p>
      </div>

      ${analytics.html}

      <div style="border-top:1px solid var(--border-sub);margin-bottom:20px"></div>

      <div class="tend-wrap">
        <div class="tend-subnav">
          <button class="tend-sub-btn${_sub==='mistakes' ?' active mistakes':''}" data-sub="mistakes">⚠️ Mistakes</button>
          <button class="tend-sub-btn${_sub==='strengths'?' active strengths':''}" data-sub="strengths">💪 Strengths</button>
        </div>
        <div id="tendBody">${renderGrid(_sub)}</div>
      </div>
    `;

    document.querySelectorAll('.tend-sub-btn').forEach(b => {
      b.addEventListener('click', () => { saveSub(b.dataset.sub); render(); });
    });

    requestAnimationFrame(() => {
      _drawDOW(analytics.dowData);
      _drawDir(analytics.dirData);
    });
  }

  /* ── Embed render — slot into an existing container ──────── */
  function renderInto(containerId) {
    _embedId = containerId;
    const container = document.getElementById(containerId);
    if (!container) return;
    const trades = DB.getTrades();
    const analytics = _renderAnalytics(trades);

    container.innerHTML = `
      ${analytics.html}
      <div style="border-top:1px solid var(--border-sub);margin-bottom:20px"></div>
      <div class="tend-wrap">
        <div class="tend-subnav">
          <button class="tend-sub-btn${_sub==='mistakes' ?' active mistakes':''}" data-sub="mistakes">⚠️ Mistakes</button>
          <button class="tend-sub-btn${_sub==='strengths'?' active strengths':''}" data-sub="strengths">💪 Strengths</button>
        </div>
        <div id="tendBody">${renderGrid(_sub)}</div>
      </div>
    `;

    container.querySelectorAll('.tend-sub-btn').forEach(b => {
      b.addEventListener('click', () => { saveSub(b.dataset.sub); renderInto(containerId); });
    });

    requestAnimationFrame(() => {
      _drawDOW(analytics.dowData);
      _drawDir(analytics.dirData);
    });
  }

  /* ── Edit / CRUD wiring ─────────────────────────────────── */
  const _pendingTimers = new WeakMap();
  function _edit(e) {
    const el = e.target;
    const { id, kind, field } = el.dataset;
    const prev = _pendingTimers.get(el);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      _pendingTimers.delete(el);
      const items = kind === 'mistakes' ? DB.getMistakes() : DB.getStrengths();
      const it = items.find(x => x.id === id);
      if (!it) return;
      it[field] = el.textContent.trim();
      if (kind === 'mistakes') DB.saveMistakes(items); else DB.saveStrengths(items);
    }, 400);
    _pendingTimers.set(el, timer);
  }

  function _add(kind) {
    const title = prompt(`New ${kind === 'mistakes' ? 'mistake' : 'strength'} title:`);
    if (!title) return;
    const items = kind === 'mistakes' ? DB.getMistakes() : DB.getStrengths();
    const newItem = {
      id: 'tend_' + Date.now(),
      title: title.trim(),
      description: '',
      dateAdded: new Date().toISOString().slice(0,10),
      seenCount: 0,
      lastSeen: '',
      linkedTradeIds: [],
    };
    items.push(newItem);
    if (kind === 'mistakes') DB.saveMistakes(items); else DB.saveStrengths(items);
    _rerenderCurrent();
  }

  function _delete(kind, id) {
    if (!confirm('Delete this entry?')) return;
    let items = kind === 'mistakes' ? DB.getMistakes() : DB.getStrengths();
    items = items.filter(x => x.id !== id);
    if (kind === 'mistakes') DB.saveMistakes(items); else DB.saveStrengths(items);
    _rerenderCurrent();
  }

  function _inc(kind, id) {
    const items = kind === 'mistakes' ? DB.getMistakes() : DB.getStrengths();
    const it = items.find(x => x.id === id);
    if (!it) return;
    it.seenCount = (it.seenCount || 0) + 1;
    it.lastSeen = new Date().toISOString().slice(0,10);
    if (kind === 'mistakes') DB.saveMistakes(items); else DB.saveStrengths(items);
    _rerenderCurrent();
  }

  /* ── Build a compact trade summary for the AI prompt ─── */
  function _buildTradeSummary(trades) {
    const closed = trades.filter(t => t.result !== '' && t.result !== undefined && t.result !== null);
    if (!closed.length) return null;

    const wins = closed.filter(t => parseFloat(t.result) > 0);
    const losses = closed.filter(t => parseFloat(t.result) < 0);
    const wr = Math.round(wins.length / closed.length * 100);
    const totalPL = closed.reduce((s, t) => s + parseFloat(t.result), 0);
    const rMults = closed.map(t => parseFloat(t.rMultiple)).filter(n => !isNaN(n));
    const avgR = rMults.length ? (rMults.reduce((a, b) => a + b, 0) / rMults.length).toFixed(2) : 'n/a';

    // By session
    const bySess = {};
    closed.forEach(t => {
      const k = t.session || 'Other';
      if (!bySess[k]) bySess[k] = { w: 0, n: 0 };
      bySess[k].n++; if (parseFloat(t.result) > 0) bySess[k].w++;
    });
    const sessTable = Object.entries(bySess)
      .map(([k, v]) => `${k}: ${v.n} trades, ${Math.round(v.w/v.n*100)}% WR`).join(' | ');

    // By setup
    const bySetup = {};
    closed.forEach(t => {
      (t.setupTypes || (t.setupType ? [t.setupType] : ['Untagged'])).forEach(k => {
        if (!bySetup[k]) bySetup[k] = { w: 0, n: 0 };
        bySetup[k].n++; if (parseFloat(t.result) > 0) bySetup[k].w++;
      });
    });
    const setupTable = Object.entries(bySetup)
      .sort((a, b) => b[1].n - a[1].n).slice(0, 8)
      .map(([k, v]) => `${k}: ${v.n} trades, ${Math.round(v.w/v.n*100)}% WR`).join(' | ');

    // HTF alignment
    const aligned   = closed.filter(t => (t.direction==='Long'&&t.htfBias==='Bullish') || (t.direction==='Short'&&t.htfBias==='Bearish'));
    const misaligned = closed.filter(t => (t.direction==='Long'&&t.htfBias==='Bearish') || (t.direction==='Short'&&t.htfBias==='Bullish'));
    const alignWR   = aligned.length ? Math.round(aligned.filter(t=>parseFloat(t.result)>0).length/aligned.length*100) : 'n/a';
    const misalWR   = misaligned.length ? Math.round(misaligned.filter(t=>parseFloat(t.result)>0).length/misaligned.length*100) : 'n/a';

    // Rule check stats (if saved on trades)
    const withChecks = closed.filter(t => t.ruleChecks);
    let ruleCheckLine = '';
    if (withChecks.length) {
      let totalRules = 0, totalChecked = 0;
      withChecks.forEach(t => {
        ['scalp','swing','longterm'].forEach(k => {
          const arr = t.ruleChecks[k] || [];
          totalRules += arr.length;
          totalChecked += arr.filter(Boolean).length;
        });
      });
      ruleCheckLine = `\nRule checklist compliance on ${withChecks.length} trades: ${Math.round(totalChecked/totalRules*100)}% of boxes ticked before entry`;
    }

    // Revenge trade count
    const sorted = [...closed].sort((a, b) => new Date(a.date) - new Date(b.date));
    let revCount = 0;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].date === sorted[i-1].date && parseFloat(sorted[i-1].result) < 0) revCount++;
    }

    // Recent 20 trades (compact)
    const recent = [...closed].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 20);
    const recentLines = recent.map(t =>
      `${t.date} ${t.symbol||'?'} ${t.direction||'?'} ${t.session||'?'} bias:${t.htfBias||'?'} setup:${(t.setupTypes||[t.setupType]||[]).join('+')||'?'} P&L:${parseFloat(t.result||0).toFixed(0)} R:${t.rMultiple||'?'}`
    ).join('\n');

    return `STATISTICS (${closed.length} closed trades):
Win rate: ${wr}% | Avg R: ${avgR} | Total P&L: $${totalPL.toFixed(0)}
Longs: ${closed.filter(t=>t.direction==='Long').length} | Shorts: ${closed.filter(t=>t.direction==='Short').length}
By session: ${sessTable || 'n/a'}
By setup: ${setupTable || 'n/a'}
HTF-aligned (${aligned.length} trades): ${alignWR}% WR | HTF-counter (${misaligned.length} trades): ${misalWR}% WR
Possible revenge trades (same-day re-entry after loss): ${revCount}${ruleCheckLine}

RECENT 20 TRADES:
${recentLines}`;
  }

  /* ── AI-powered analysis ────────────────────────────── */
  async function _aiAnalyze(trades) {
    const summary = _buildTradeSummary(trades);
    if (!summary) return null;

    const rules = DB.getRules();
    const ruleText = [
      'PRE-TRADE RULES:\n' + (rules.scalp||[]).map((r,i)=>`${i+1}. ${r.text}`).join('\n'),
      'RISK RULES:\n'      + (rules.swing||[]).map((r,i)=>`${i+1}. ${r.text}`).join('\n'),
      'PSYCHOLOGY RULES:\n'+ (rules.longterm||[]).map((r,i)=>`${i+1}. ${r.text}`).join('\n'),
    ].join('\n\n');

    const system = `You are an expert trading coach analyzing a trader's history against their personal rules. Be specific and data-driven. Return ONLY valid JSON — no markdown, no preamble.`;

    const user = `Analyze this trader's history and identify their key mistakes and strengths.

${ruleText}

${summary}

Return JSON only in this exact format:
{
  "mistakes": [
    {"title": "Short title under 50 chars", "description": "Specific finding with numbers, 1-2 sentences", "seenCount": N}
  ],
  "strengths": [
    {"title": "Short title under 50 chars", "description": "Specific finding with numbers, 1-2 sentences", "seenCount": N}
  ]
}

Rules for analysis:
- Cross-reference trade patterns against the rules listed above — name the specific rule being broken or followed
- Include 3-6 mistakes and 3-6 strengths
- Only include findings backed by at least 3 data points
- seenCount = number of trades/instances this pattern appears
- Be honest and specific — vague findings are useless`;

    const { text } = await AICoachTab.callClaude({ system, user, maxTokens: 1800 });
    // Strip any markdown fences then parse
    const clean = text.replace(/```json|```/g, '').trim();
    const json = JSON.parse(clean);
    return json;
  }

  /* ── Merge helper — updates existing by title, adds new ─ */
  function _mergeItems(existing, found, stamp) {
    const updated = [...existing];
    let addedCount = 0, refreshedCount = 0;
    found.forEach(f => {
      const idx = updated.findIndex(x => x.title.toLowerCase() === f.title.toLowerCase());
      if (idx >= 0) {
        // Update existing entry
        updated[idx] = {
          ...updated[idx],
          description: f.description || updated[idx].description,
          seenCount: Math.max(updated[idx].seenCount || 0, f.seenCount || 0),
          lastSeen: stamp,
        };
        refreshedCount++;
      } else {
        updated.push({
          id: 'auto_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
          title: f.title, description: f.description,
          seenCount: f.seenCount || 1, lastSeen: stamp,
          linkedTradeIds: [], dateAdded: stamp, auto: true,
        });
        addedCount++;
      }
    });
    return { merged: updated, addedCount, refreshedCount };
  }

  async function _autoAnalyze() {
    const trades = DB.getTrades();
    if (!trades.length) { App.toast('No trades to analyze yet — log some first.', 'error'); return; }

    // Show loading state on whichever button triggered this
    const btns = document.querySelectorAll('[onclick*="_autoAnalyze"]');
    btns.forEach(b => { b.disabled = true; b.textContent = '⏳ Analysing…'; });

    const stamp = new Date().toISOString().slice(0,10);
    let found = null;

    try {
      found = await _aiAnalyze(trades);
    } catch (e) {
      console.warn('[tendencies] AI analysis failed, falling back to stats:', e.message);
      found = null;
    }

    // Fall back to stats engine if AI failed / no key
    if (!found || (!found.mistakes?.length && !found.strengths?.length)) {
      found = DB.analyzePatterns(trades);
      if (!found.mistakes.length && !found.strengths.length) {
        App.toast('Not enough data yet — need 5+ trades per session/setup.', 'info');
        btns.forEach(b => { b.disabled = false; b.textContent = '🧠 Auto-Analyze Trades'; });
        return;
      }
    }

    // Merge into existing
    const { merged: mergedM, addedCount: mA, refreshedCount: mR } = _mergeItems(DB.getMistakes(), found.mistakes || [], stamp);
    const { merged: mergedS, addedCount: sA, refreshedCount: sR } = _mergeItems(DB.getStrengths(), found.strengths || [], stamp);

    DB.saveMistakes(mergedM);
    DB.saveStrengths(mergedS);

    const parts = [];
    if (mA) parts.push(`${mA} new mistake${mA===1?'':'s'}`);
    if (mR) parts.push(`${mR} updated`);
    if (sA) parts.push(`${sA} new strength${sA===1?'':'s'}`);
    if (sR) parts.push(`${sR} refreshed`);
    App.toast('Analysis complete — ' + (parts.join(', ') || 'no changes'), 'success');

    _rerenderCurrent();
  }

  // _heatmapCardHTML: raw-HTML helper — the Day × Time heatmap renders at the
  // bottom of the Dashboard tab (js/tabs/dashboard.js), not in Patterns.
  return { render, renderInto, _edit, _add, _delete, _inc, _autoAnalyze, _hmSetMode, _hmCell, _heatmapCardHTML: _heatmapCard };
})();
