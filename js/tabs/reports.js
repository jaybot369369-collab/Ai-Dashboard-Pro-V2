/* ═══════════════════════════════════════════════════════════
   REPORTS TAB — My Reports
   Header + template cards prepended; existing sub-tabs below.
   Sources: Notion journal CSV, Binance TX CSV,
            Binance Order History CSV (from XLSX)
════════════════════════════════════════════════════════════ */
const ReportsTab = (() => {

  let activeSubTab = 'overview';
  let _savedReport = null; // persists last generated report across tab switches

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  /* ── Template cards ─────────────────────────────────────── */
  function _renderTemplateCards() {
    const setups = [...new Set(DB.getTrades().flatMap(t => t.setupTypes || (t.setupType ? [t.setupType] : [])))].filter(Boolean);
    const setupOpts = setups.length
      ? setups.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')
      : '<option value="">— no setups logged —</option>';

    return `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:24px">

        <!-- Weekly review -->
        <div class="card" style="padding:18px;display:flex;flex-direction:column;gap:10px">
          <div style="font-size:1.6rem;line-height:1">📋</div>
          <div>
            <div style="font-size:.9rem;font-weight:700;color:var(--text);margin-bottom:2px">Weekly review</div>
            <div style="font-size:.78rem;color:var(--text-dim)">AI-written summary of your last 7 days</div>
          </div>
          <button class="btn-primary btn-sm" style="margin-top:auto;align-self:flex-start" id="btnWeekly"
                  onclick="ReportsTab._generateWeekly()">Generate</button>
        </div>

        <!-- Monthly review -->
        <div class="card" style="padding:18px;display:flex;flex-direction:column;gap:10px">
          <div style="font-size:1.6rem;line-height:1">📊</div>
          <div>
            <div style="font-size:.9rem;font-weight:700;color:var(--text);margin-bottom:2px">Monthly review</div>
            <div style="font-size:.78rem;color:var(--text-dim)">Full performance breakdown vs your rules</div>
          </div>
          <button class="btn-primary btn-sm" style="margin-top:auto;align-self:flex-start" id="btnMonthly"
                  onclick="ReportsTab._generateMonthly()">Generate</button>
        </div>

        <!-- Setup deep-dive -->
        <div class="card" style="padding:18px;display:flex;flex-direction:column;gap:10px">
          <div style="font-size:1.6rem;line-height:1">🔍</div>
          <div>
            <div style="font-size:.9rem;font-weight:700;color:var(--text);margin-bottom:2px">Setup deep-dive</div>
            <div style="font-size:.78rem;color:var(--text-dim)">In-depth analysis of one setup type</div>
          </div>
          <select id="setupDiveSelect" style="font-size:.82rem;margin-top:4px">
            <option value="">— pick a setup —</option>
            ${setupOpts}
          </select>
          <button class="btn-primary btn-sm" style="align-self:flex-start" id="btnSetupDive"
                  onclick="ReportsTab._generateSetupDive()">Generate</button>
        </div>

      </div>

      <!-- AI report output panel (hidden until generated) -->
      <div id="reportOutput" style="display:none;margin-bottom:24px"></div>
    `;
  }

  function render() {
    const trades = DB.getTrades();
    const tradeCount = trades.length;
    const subtitle = tradeCount > 0
      ? esc(tradeCount + ' reports available')
      : 'no data yet';

    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
        <div>
          <h1>My Reports</h1>
          <p class="page-subtitle">${subtitle}</p>
        </div>
        <button class="btn-primary" onclick="ReportsTab._sub('import')">+ New report</button>
      </div>

      ${_renderTemplateCards()}

      <div style="border-top:1px solid var(--border-sub);margin-bottom:20px"></div>

      <div class="sub-tabs">
        ${['overview','win-loss','drawdown','compare','tags','import']
          .map(id => `<div class="sub-tab${activeSubTab === id ? ' active' : ''}" onclick="ReportsTab._sub('${id}')">${subLabel(id)}</div>`)
          .join('')}
      </div>
      <div id="reportContent"></div>
    `;
    renderSub();

    // Restore last generated report if one exists
    if (_savedReport) {
      const out = document.getElementById('reportOutput');
      if (out) { out.innerHTML = _savedReport; out.style.display = 'block'; }
    }
  }

  function subLabel(id) {
    return { overview: 'Overview', 'win-loss': 'Win vs Loss Days',
             drawdown: 'Drawdown', compare: 'Compare',
             tags: 'Tag Breakdown', import: '⬆ Import' }[id] || id;
  }

  function renderSub() {
    const wrap = document.getElementById('reportContent');
    if (!wrap) return;
    const { range, from, to } = App.getDateFilter();
    const allTrades = DB.getTrades();
    const trades    = DB.filterByRange(allTrades, range, from, to);

    switch (activeSubTab) {
      case 'overview':   renderOverview(wrap, trades); break;
      case 'win-loss':   renderWinLoss(wrap, trades); break;
      case 'drawdown':   renderDrawdown(wrap, trades); break;
      case 'compare':    renderCompare(wrap, allTrades); break;
      case 'tags':       renderTags(wrap, trades); break;
      case 'import':     renderImport(wrap); break;
    }
  }

  /* ── Overview ─────────────────────────────────────────── */
  function renderOverview(wrap, trades) {
    const s  = DB.calcStats(trades);
    const closed = trades.filter(t => t.result !== '' && t.result !== undefined);
    const best   = closed.reduce((b, t) => parseFloat(t.result) > parseFloat(b?.result || -Infinity) ? t : b, null);
    const worst  = closed.reduce((b, t) => parseFloat(t.result) < parseFloat(b?.result || Infinity) ? t : b, null);

    wrap.innerHTML = `
      <div class="report-stats">
        ${rs('Total Trades', s.total)}
        ${rs('Closed Trades', s.closed)}
        ${rs('Win Rate', s.closed ? s.winRate.toFixed(1) + '%' : '—', s.winRate >= 50 ? 'var(--green)' : 'var(--red)')}
        ${rs('Total P&L', s.closed ? fmt$(s.totalPL) : '—', s.totalPL >= 0 ? 'var(--green)' : 'var(--red)')}
        ${rs('Avg R:R', s.closed ? s.avgR.toFixed(2) + 'R' : '—')}
        ${rs('Max Drawdown', s.maxDD ? '-$' + s.maxDD.toFixed(2) : '—', 'var(--red)')}
        ${rs('Best Trade', best ? fmt$(parseFloat(best.result)) : '—', 'var(--green)')}
        ${rs('Worst Trade', worst ? fmt$(parseFloat(worst.result)) : '—', 'var(--red)')}
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-header"><div class="card-title">Equity Curve</div></div>
        <div style="height:200px;position:relative"><canvas id="rptEquity"></canvas></div>
      </div>
    `;
    requestAnimationFrame(() => Charts.equityCurve('rptEquity', DB.equityCurve(trades)));
  }

  /* ── Win vs Loss Days ────────────────────────────────── */
  function renderWinLoss(wrap, trades) {
    const dlMap = DB.dailyPLMap(trades);
    const days  = Object.entries(dlMap).sort(([a], [b]) => new Date(a) - new Date(b));
    const green = days.filter(([, v]) => v > 0).length;
    const red   = days.filter(([, v]) => v < 0).length;
    const flat  = days.filter(([, v]) => v === 0).length;

    wrap.innerHTML = `
      <div class="report-stats" style="margin-bottom:16px">
        ${rs('Green Days', green, 'var(--green)')}
        ${rs('Red Days', red, 'var(--red)')}
        ${rs('Flat Days', flat)}
        ${rs('Win Day Rate', days.length ? (green / days.length * 100).toFixed(0) + '%' : '—', 'var(--green)')}
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Daily P&L Distribution</div></div>
        <div style="height:220px;position:relative"><canvas id="rptDaily"></canvas></div>
      </div>
    `;
    requestAnimationFrame(() => Charts.dailyPLBar('rptDaily', dlMap));
  }

  /* ── Drawdown ─────────────────────────────────────────── */
  function renderDrawdown(wrap, trades) {
    const closed = trades.filter(t => t.result !== '' && t.result !== undefined)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    let eq = 0, peak = 0, maxDD = 0, maxDDPct = 0;
    closed.forEach(t => {
      eq += parseFloat(t.result || 0);
      if (eq > peak) peak = eq;
      const dd = peak - eq;
      if (dd > maxDD) { maxDD = dd; maxDDPct = peak > 0 ? (dd / peak) * 100 : 0; }
    });

    const dlMap = DB.dailyPLMap(trades);
    const dayArr = Object.values(dlMap);
    let maxLoss = 0, curLoss = 0;
    dayArr.forEach(v => { if (v < 0) { curLoss++; maxLoss = Math.max(maxLoss, curLoss); } else curLoss = 0; });

    wrap.innerHTML = `
      <div class="report-stats" style="margin-bottom:16px">
        ${rs('Max Drawdown $', maxDD ? '-$' + maxDD.toFixed(2) : '—', 'var(--red)')}
        ${rs('Max Drawdown %', maxDDPct ? '-' + maxDDPct.toFixed(1) + '%' : '—', 'var(--red)')}
        ${rs('Max Consec. Loss Days', maxLoss, maxLoss >= 3 ? 'var(--red)' : 'var(--text)')}
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Drawdown Curve</div></div>
        <div style="height:220px;position:relative"><canvas id="rptDD"></canvas></div>
      </div>
    `;
    requestAnimationFrame(() => Charts.drawdownCurve('rptDD', trades));
  }

  /* ── Compare ─────────────────────────────────────────── */
  function renderCompare(wrap, allTrades) {
    wrap.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><div class="card-title">Compare</div></div>
        <div class="form-row" style="margin-bottom:16px">
          <div class="form-group">
            <label>Compare By</label>
            <select id="cmpType" onchange="ReportsTab._runCompare()">
              <option value="month">Month vs Month</option>
              <option value="setup">Setup vs Setup</option>
              <option value="session">Session vs Session</option>
              <option value="direction">Long vs Short</option>
            </select>
          </div>
        </div>
        <div id="cmpResult"></div>
      </div>
    `;
    runCompare(allTrades, 'month');
  }

  function runCompare(trades, type) {
    const wrap = document.getElementById('cmpResult');
    if (!wrap) return;
    const groups = {};

    if (type === 'month') {
      trades.forEach(t => {
        const k = t.date?.slice(0, 7) || 'Unknown';
        if (!groups[k]) groups[k] = [];
        groups[k].push(t);
      });
    } else if (type === 'setup') {
      trades.forEach(t => {
        const k = t.setupType || 'Untagged';
        if (!groups[k]) groups[k] = [];
        groups[k].push(t);
      });
    } else if (type === 'session') {
      trades.forEach(t => {
        const k = t.session || 'Untagged';
        if (!groups[k]) groups[k] = [];
        groups[k].push(t);
      });
    } else if (type === 'direction') {
      trades.forEach(t => {
        const k = t.direction || 'Unknown';
        if (!groups[k]) groups[k] = [];
        groups[k].push(t);
      });
    }

    const rows = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([key, grp]) => {
      const s = DB.calcStats(grp);
      return { key, ...s };
    });

    if (!rows.length) { wrap.innerHTML = `<div class="empty-state" style="padding:20px"><p>No data to compare.</p></div>`; return; }

    wrap.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr>
          <th>${type === 'month' ? 'Month' : type === 'setup' ? 'Setup' : type === 'session' ? 'Session' : 'Direction'}</th>
          <th>Trades</th><th>Win Rate</th><th>Total P&L</th><th>Avg R</th><th>Wins</th><th>Losses</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td><strong>${esc(r.key)}</strong></td>
            <td>${r.total}</td>
            <td class="${r.winRate >= 50 ? 'text-green' : 'text-red'}">${r.closed ? r.winRate.toFixed(1) + '%' : '—'}</td>
            <td class="${r.totalPL >= 0 ? 'text-green' : 'text-red'}">${r.closed ? fmt$(r.totalPL) : '—'}</td>
            <td>${r.closed ? r.avgR.toFixed(2) + 'R' : '—'}</td>
            <td class="text-green">${r.wins}</td>
            <td class="text-red">${r.losses}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    `;
  }

  /* ── Tag Breakdown ───────────────────────────────────── */
  function renderTags(wrap, trades) {
    const sections = [
      { label: 'By Setup Type', key: 'setupType' },
      { label: 'By Session / Killzone', key: 'session' },
      { label: 'By HTF Bias', key: 'htfBias' },
      { label: 'By Pre-Trade Grade', key: 'preGrade' },
      { label: 'By Post-Trade Grade', key: 'postGrade' },
      { label: 'By Direction', key: 'direction' },
    ];

    wrap.innerHTML = sections.map(sec => {
      const groups = {};
      trades.forEach(t => {
        const k = t[sec.key] || 'Untagged';
        if (!groups[k]) groups[k] = [];
        groups[k].push(t);
      });
      const rows = Object.entries(groups).map(([key, grp]) => {
        const s = DB.calcStats(grp);
        return { key, ...s };
      }).sort((a, b) => b.total - a.total);

      if (!rows.length) return '';
      return `
        <div class="card" style="margin-bottom:16px">
          <div class="card-header"><div class="card-title">${sec.label}</div></div>
          <div class="table-wrap"><table>
            <thead><tr><th>${sec.label.replace('By ', '')}</th><th>Trades</th><th>Win Rate</th><th>P&L</th><th>Avg R</th></tr></thead>
            <tbody>
              ${rows.map(r => `<tr>
                <td><strong>${esc(r.key)}</strong></td>
                <td>${r.total}</td>
                <td class="${r.winRate >= 50 ? 'text-green' : 'text-red'}">${r.closed ? r.winRate.toFixed(1) + '%' : '—'}</td>
                <td class="${r.totalPL >= 0 ? 'text-green' : 'text-red'}">${r.closed ? fmt$(r.totalPL) : '—'}</td>
                <td>${r.closed ? r.avgR.toFixed(2) + 'R' : '—'}</td>
              </tr>`).join('')}
            </tbody>
          </table></div>
        </div>
      `;
    }).join('');
  }

  /* ── Import ──────────────────────────────────────────── */
  function renderImport(wrap) {
    wrap.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <div class="card-title">Import Trade History</div>
        </div>
        <p class="text-sub text-sm" style="margin-bottom:16px">
          Supports: <strong>Notion journal CSV</strong> · <strong>Binance Transaction History CSV</strong> · <strong>Binance Spot Order History CSV</strong> (save your .xlsx as .csv first)
        </p>

        <div class="drop-zone" id="dropZone" onclick="document.getElementById('csvFileInput').click()">
          <div class="dz-icon">⬆</div>
          <p>Drop your CSV file here or <strong>click to browse</strong></p>
          <p class="text-xs text-dim" style="margin-top:6px">Auto-detects format · Skips duplicates</p>
        </div>
        <input type="file" id="csvFileInput" accept=".csv,.xlsx" class="hidden" onchange="ReportsTab._handleFile(event)" />

        <div id="importStatus" style="margin-top:16px"></div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">Import History</div>
          <span class="text-sub text-sm">${DB.getTrades().length} total trades in database</span>
        </div>
        ${sourceSummary()}
      </div>
    `;

    const dz = document.getElementById('dropZone');
    if (dz) {
      dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
      dz.addEventListener('drop', e => {
        e.preventDefault();
        dz.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
      });
    }
  }

  function sourceSummary() {
    const trades = DB.getTrades();
    const srcs = {};
    trades.forEach(t => { const s = t.source || 'manual'; srcs[s] = (srcs[s] || 0) + 1; });
    if (!Object.keys(srcs).length) return `<div class="empty-state" style="padding:20px"><p>No trades imported yet.</p></div>`;
    return Object.entries(srcs).map(([src, cnt]) => `
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-sub);font-size:.85rem">
        <span>${esc(srcLabel(src))}</span>
        <span class="badge badge-accent">${cnt} trades</span>
      </div>
    `).join('');
  }

  function srcLabel(s) {
    return { manual: 'Manual entry', notion: 'Notion Journal', binance_tx: 'Binance TX History',
             binance_order: 'Binance Order History' }[s] || s;
  }

  function handleFile(file) {
    const statusEl = document.getElementById('importStatus');
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result;
      try {
        const { format, trades } = DB.autoParseCSV(text);
        if (!trades.length) {
          if (statusEl) statusEl.innerHTML = `<div class="coach-alert warning"><div class="alert-icon">⚠️</div><div class="alert-body"><div class="alert-title">No trades found</div><div class="alert-desc">The file was read but no valid trades could be extracted. Check the format matches Notion journal or Binance export.</div></div></div>`;
          return;
        }
        const { added, skipped } = DB.mergeImportedTrades(trades);
        DB.recomputePlaybookStats();
        if (statusEl) statusEl.innerHTML = `<div class="coach-alert positive"><div class="alert-icon">✅</div><div class="alert-body"><div class="alert-title">${format} — Import successful</div><div class="alert-desc">${added} trades added · ${skipped} duplicates skipped · ${DB.getTrades().length} total trades now in database.</div></div></div>`;
        App.toast(`${added} trades imported from ${format}`);
      } catch (err) {
        if (statusEl) statusEl.innerHTML = `<div class="coach-alert danger"><div class="alert-icon">❌</div><div class="alert-body"><div class="alert-title">Import failed</div><div class="alert-desc">${esc(err.message)}</div></div></div>`;
      }
    };
    reader.readAsText(file);
  }

  /* ── AI report generators ────────────────────────────── */

  function _rulesText() {
    const r = DB.getRules();
    return [
      'PRE-TRADE RULES:\n' + (r.scalp   ||[]).map((x,i)=>`${i+1}. ${x.text}`).join('\n'),
      'RISK RULES:\n'      + (r.swing   ||[]).map((x,i)=>`${i+1}. ${x.text}`).join('\n'),
      'PSYCHOLOGY RULES:\n'+ (r.longterm||[]).map((x,i)=>`${i+1}. ${x.text}`).join('\n'),
    ].join('\n\n');
  }

  function _tradesSummary(trades) {
    const closed = trades.filter(t => t.result !== '' && t.result !== undefined && t.result !== null);
    if (!closed.length) return null;
    const wins   = closed.filter(t => parseFloat(t.result) > 0);
    const wr     = Math.round(wins.length / closed.length * 100);
    const pl     = closed.reduce((s, t) => s + parseFloat(t.result), 0);
    const rMults = closed.map(t => parseFloat(t.rMultiple)).filter(n => !isNaN(n));
    const avgR   = rMults.length ? (rMults.reduce((a,b)=>a+b,0)/rMults.length).toFixed(2) : 'n/a';

    const byS = {};
    closed.forEach(t => {
      const k = t.session || 'Other';
      if (!byS[k]) byS[k] = { w:0, n:0 };
      byS[k].n++; if (parseFloat(t.result) > 0) byS[k].w++;
    });
    const sessLines = Object.entries(byS)
      .map(([k,v]) => `${k}: ${v.n} trades, ${Math.round(v.w/v.n*100)}% WR`).join(' | ');

    const bySetup = {};
    closed.forEach(t => {
      (t.setupTypes||(t.setupType?[t.setupType]:['Untagged'])).forEach(k => {
        if (!bySetup[k]) bySetup[k] = { w:0, n:0 };
        bySetup[k].n++; if (parseFloat(t.result) > 0) bySetup[k].w++;
      });
    });
    const setupLines = Object.entries(bySetup)
      .sort((a,b)=>b[1].n-a[1].n).slice(0,6)
      .map(([k,v]) => `${k}: ${v.n} trades, ${Math.round(v.w/v.n*100)}% WR`).join(' | ');

    const sorted = [...closed].sort((a,b)=>new Date(a.date)-new Date(b.date));
    const tradeLines = sorted.map(t =>
      `${t.date} ${t.symbol||'?'} ${t.direction||'?'} ${t.session||'?'} bias:${t.htfBias||'?'} setup:${(t.setupTypes||[t.setupType]||[]).join('+')||'?'} P&L:${parseFloat(t.result||0).toFixed(0)} R:${t.rMultiple||'?'}`
    ).join('\n');

    return { closed, wins, wr, pl, avgR, sessLines, setupLines, tradeLines };
  }

  function _renderReportCard(title, icon, dateRange, text) {
    const out = document.getElementById('reportOutput');
    if (!out) return;
    const html = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/^#{1,3} (.+)$/gm, '<div style="font-size:1rem;font-weight:700;color:var(--text);margin:14px 0 6px">$1</div>')
      .replace(/^[-•] (.+)$/gm, '<div style="padding:3px 0 3px 14px;position:relative">• $1</div>')
      .replace(/\n\n/g, '<br>')
      .replace(/\n/g, ' ');
    const inner = `
      <div class="card" style="border-left:3px solid var(--accent)">
        <div class="card-header" style="margin-bottom:12px">
          <div>
            <div class="card-title">${icon} ${esc(title)}</div>
            <div style="font-size:.83rem;color:var(--text-dim);margin-top:2px">${esc(dateRange)}</div>
          </div>
          <button class="btn-ghost btn-sm" onclick="ReportsTab._clearReport()">✕ Clear</button>
        </div>
        <div style="font-size:.94rem;line-height:1.7;color:var(--text)">${html}</div>
        <div style="margin-top:14px;font-size:.78rem;color:var(--text-dim)">Generated ${new Date().toLocaleString()}</div>
      </div>`;
    out.style.display = 'block';
    out.innerHTML = inner;
    _savedReport = inner; // persist across tab switches
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function _setBtnState(id, loading) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? '⏳ Generating…' : 'Generate';
  }

  async function _generateWeekly() {
    const now   = new Date();
    const cutoff = new Date(now); cutoff.setDate(now.getDate() - 7);
    const trades = DB.getTrades().filter(t => t.date && new Date(t.date) >= cutoff);
    if (!trades.length) { App.toast('No trades in the last 7 days to review.', 'info'); return; }

    _setBtnState('btnWeekly', true);
    const s = _tradesSummary(trades);
    if (!s) { App.toast('No closed trades this week.', 'info'); _setBtnState('btnWeekly', false); return; }

    const dateRange = `${cutoff.toISOString().slice(0,10)} → ${now.toISOString().slice(0,10)}`;
    const system = `You are a trading performance coach writing a concise, honest weekly review. Use markdown bold for section headers.`;
    const user   = `Write a weekly review for my last 7 days of trading.

MY RULES:
${_rulesText()}

LAST 7 DAYS (${s.closed.length} closed trades):
Win rate: ${s.wr}% | Total P&L: $${s.pl.toFixed(0)} | Avg R: ${s.avgR}
By session: ${s.sessLines || 'n/a'}
By setup: ${s.setupLines || 'n/a'}

All trades (chronological):
${s.tradeLines}

Write these 4 sections using my actual data:
**Week Summary** — headline numbers, overall verdict in 2 sentences
**What Worked** — 2-3 specific bullets with data (sessions, setups, decisions)
**What Didn't** — 2-3 specific bullets, reference any rule violations you spot
**Next Week Focus** — 2 concrete, actionable targets based on the patterns

Be direct and specific. Under 280 words. Reference rule text where relevant.`;

    try {
      const { text } = await AICoachTab.callClaude({ system, user, maxTokens: 900 });
      _renderReportCard('Weekly Review', '📋', dateRange, text);
    } catch (e) {
      App.toast('AI error: ' + e.message, 'error');
    } finally { _setBtnState('btnWeekly', false); }
  }

  async function _generateMonthly() {
    const now    = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
    const trades = DB.getTrades().filter(t => t.date && new Date(t.date) >= cutoff);
    if (!trades.length) { App.toast('No trades this month yet.', 'info'); return; }

    _setBtnState('btnMonthly', true);
    const s = _tradesSummary(trades);
    if (!s) { App.toast('No closed trades this month.', 'info'); _setBtnState('btnMonthly', false); return; }

    // Drawdown
    let eq = 0, peak = 0, maxDD = 0;
    [...s.closed].sort((a,b)=>new Date(a.date)-new Date(b.date)).forEach(t => {
      eq += parseFloat(t.result||0); if (eq > peak) peak = eq;
      const dd = peak - eq; if (dd > maxDD) maxDD = dd;
    });
    const monthLabel = now.toLocaleDateString('en-US', { month:'long', year:'numeric' });

    const system = `You are a trading performance coach writing a monthly review. Use markdown bold for headers.`;
    const user   = `Write a full monthly performance review for ${monthLabel}.

MY RULES:
${_rulesText()}

${monthLabel.toUpperCase()} DATA (${s.closed.length} closed trades):
Win rate: ${s.wr}% | Total P&L: $${s.pl.toFixed(0)} | Avg R: ${s.avgR}
Max drawdown: $${maxDD.toFixed(0)}
By session: ${s.sessLines || 'n/a'}
By setup: ${s.setupLines || 'n/a'}

All trades:
${s.tradeLines}

Write these 5 sections:
**Month Summary** — headline numbers and one-line verdict
**Performance Analysis** — best and worst session/setup with data, direction bias impact
**Rule Compliance** — which of my rules I followed well and which I broke (be specific, use rule text)
**Key Takeaways** — top 3 specific lessons from this month's data
**Next Month Targets** — 2 measurable, concrete goals

Under 400 words. Data-driven and honest.`;

    try {
      const { text } = await AICoachTab.callClaude({ system, user, maxTokens: 1200 });
      _renderReportCard(`Monthly Review — ${monthLabel}`, '📊', `1 ${monthLabel} → today`, text);
    } catch (e) {
      App.toast('AI error: ' + e.message, 'error');
    } finally { _setBtnState('btnMonthly', false); }
  }

  async function _generateSetupDive() {
    const sel   = document.getElementById('setupDiveSelect');
    const setup = sel?.value;
    if (!setup) { App.toast('Pick a setup from the dropdown first.', 'info'); return; }

    const allTrades = DB.getTrades();
    const trades = allTrades.filter(t =>
      (t.setupTypes||[]).includes(setup) || t.setupType === setup
    );
    if (!trades.length) { App.toast(`No trades found for "${setup}".`, 'info'); return; }

    _setBtnState('btnSetupDive', true);
    const s = _tradesSummary(trades);
    if (!s) { App.toast('No closed trades for this setup.', 'info'); _setBtnState('btnSetupDive', false); return; }

    // Best conditions
    const bySession = {};
    s.closed.forEach(t => {
      const k = t.session||'Other';
      if (!bySession[k]) bySession[k]={w:0,n:0};
      bySession[k].n++; if (parseFloat(t.result)>0) bySession[k].w++;
    });
    const bestSess = Object.entries(bySession).sort((a,b)=>(b[1].w/b[1].n)-(a[1].w/a[1].n))[0];

    const system = `You are a trading coach doing a deep-dive analysis of one specific setup. Use markdown bold for headers.`;
    const user   = `Analyze my "${setup}" setup in depth.

MY RULES:
${_rulesText()}

"${setup}" DATA (${s.closed.length} closed trades across all time):
Win rate: ${s.wr}% | Total P&L: $${s.pl.toFixed(0)} | Avg R: ${s.avgR}
Best session for this setup: ${bestSess ? `${bestSess[0]} (${Math.round(bestSess[1].w/bestSess[1].n*100)}% WR)` : 'n/a'}
Sessions breakdown: ${s.sessLines || 'n/a'}

All trades with this setup:
${s.tradeLines}

Write these 5 sections:
**Setup Performance** — win rate, P&L, R:R verdict — is it profitable overall?
**Best Conditions** — when does this setup work best (session, bias, specific patterns in winning trades)
**Failure Modes** — when does it fail? What do the losers have in common?
**Rule Check** — which of my rules am I following/breaking specifically with this setup?
**Verdict** — Keep as-is, refine it, or stop trading it? Give one concrete improvement to implement immediately.

Under 320 words. Be specific — reference actual dates/R-multiples from the data where useful.`;

    try {
      const { text } = await AICoachTab.callClaude({ system, user, maxTokens: 1100 });
      _renderReportCard(`Setup Deep-Dive: ${setup}`, '🔍', `${s.closed.length} trades all-time`, text);
    } catch (e) {
      App.toast('AI error: ' + e.message, 'error');
    } finally { _setBtnState('btnSetupDive', false); }
  }

  /* ── Helpers ─────────────────────────────────────────── */
  function rs(label, value, color) {
    return `<div class="report-stat">
      <div class="rs-label">${label}</div>
      <div class="rs-value" style="${color ? `color:${color}` : ''}">${value ?? '—'}</div>
    </div>`;
  }
  function fmt$(n) {
    return (n < 0 ? '-$' : '+$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  return {
    render,
    _sub: id => { activeSubTab = id; render(); },
    _runCompare: () => {
      const type = document.getElementById('cmpType')?.value || 'month';
      runCompare(DB.getTrades(), type);
    },
    _handleFile: e => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ''; },
    _generateWeekly,
    _generateMonthly,
    _generateSetupDive,
    _clearReport: () => {
      _savedReport = null;
      const out = document.getElementById('reportOutput');
      if (out) { out.style.display = 'none'; out.innerHTML = ''; }
    },
  };
})();
