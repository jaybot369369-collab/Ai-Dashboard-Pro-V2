/* ═══════════════════════════════════════════════════════════
   DAILY REPORT TAB
   Reads js/data/daily_report.json (generated server-side by the
   /Daily_Report skill on Mon-Fri at midnight via launchd) and
   renders the same content as the daily PDF.
════════════════════════════════════════════════════════════ */
const DailyReportTab = (() => {

  let _data = null;
  let _err = null;
  let _loading = false;
  let _autoTimer = null;

  const REFRESH_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
  const CHECK_MS   = 60 * 60 * 1000;           // re-check every 1h while tab open

  async function load() {
    if (_loading) return;
    _loading = true; _err = null;
    try {
      // Cache-bust via timestamp so we always get the freshest JSON
      const r = await fetch('js/data/daily_report.json?t=' + Date.now());
      if (!r.ok) throw new Error('report fetch ' + r.status);
      _data = await r.json();
    } catch (e) {
      _err = e.message;
    } finally {
      _loading = false;
    }
  }

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function fmtAge(iso) {
    if (!iso) return '—';
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '—';
    const ms = Date.now() - t;
    const m = Math.round(ms / 60000);
    if (m < 60)  return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 48)  return `${h}h ago`;
    const d = Math.round(h / 24);
    return `${d}d ago`;
  }

  function biasBadge(b) {
    const cls = b === 'LONG' ? 'dr-bias-long' : b === 'SHORT' ? 'dr-bias-short' : 'dr-bias-neutral';
    return `<span class="dr-bias ${cls}">${esc(b)}</span>`;
  }
  function priorityPill(p) {
    const cls = p === 'HIGH' ? 'dr-pri-high' : p === 'MEDIUM' ? 'dr-pri-med' : 'dr-pri-low';
    return `<span class="dr-pri ${cls}">${esc(p)}</span>`;
  }
  function impactPill(i) {
    const cls = i === 'RED' ? 'dr-imp-red' : i === 'ORANGE' ? 'dr-imp-orange' : 'dr-imp-yellow';
    return `<span class="dr-imp ${cls}">${esc(i)}</span>`;
  }

  function renderTickerCard(t) {
    const isSpotRow = row => String(row[0] || '').includes('Spot');
    const chgColor = c => (typeof c === 'string' && c.startsWith('-')) ? 'var(--red)' : 'var(--green)';
    const safeChartPath = p => encodeURI(String(p || '').replace(/\.\./g, ''));
    const setup = t.setup || {};
    return `<div class="dr-ticker">
      <div class="dr-ticker-hdr">
        <div class="dr-ticker-left">
          <h2 class="dr-sym">${esc(t.sym)}<span class="dr-sym-name">/USD</span></h2>
          <div class="dr-prices">
            <span class="dr-price">${esc(t.price)}</span>
            <span class="dr-chg" style="color:${chgColor(t.chg24)}">${esc(t.chg24)} 24h</span>
            <span class="dr-chg" style="color:${chgColor(t.chg7)}">${esc(t.chg7)} 7d</span>
          </div>
          <div class="dr-meta">Vol ${esc(t.vol)} · MCap ${esc(t.mcap)}</div>
        </div>
        <div class="dr-ticker-right">${biasBadge(t.bias)} ${priorityPill(t.priority)}</div>
      </div>

      <p class="dr-thesis">${esc(t.thesis)}</p>

      <div class="dr-section">
        <div class="dr-sec-hdr">📍 Key Levels</div>
        <table class="dr-levels">
          ${(t.levels || []).map(l => `<tr class="${isSpotRow(l) ? 'dr-spot' : ''}">
            <td class="dr-lvl-label">${esc(l[0])}</td>
            <td class="dr-lvl-price">${esc(l[1])}</td>
            <td class="dr-lvl-note">${esc(l[2])}</td>
          </tr>`).join('')}
        </table>
      </div>

      ${t.charts ? `<div class="dr-section dr-charts">
        <div class="dr-sec-hdr">📊 ICT Top-Down Charts</div>
        <img loading="lazy" src="js/data/${safeChartPath(t.charts.daily)}" alt="${esc(t.sym)} Daily">
        <img loading="lazy" src="js/data/${safeChartPath(t.charts.h1)}"    alt="${esc(t.sym)} 1H">
        <img loading="lazy" src="js/data/${safeChartPath(t.charts.m15)}"   alt="${esc(t.sym)} 15m">
      </div>` : ''}

      <div class="dr-setup">
        <div class="dr-sec-hdr">🎯 Trade Setup</div>
        <div class="dr-setup-row"><span class="dr-setup-lbl">Entry</span><span class="dr-setup-val">${esc(setup.entry)}</span></div>
        <div class="dr-setup-row"><span class="dr-setup-lbl">Stop</span><span class="dr-setup-val" style="color:var(--red)">${esc(setup.stop)}</span></div>
        <div class="dr-setup-row"><span class="dr-setup-lbl">TP1</span><span class="dr-setup-val" style="color:var(--green)">${esc(setup.tp1)}</span></div>
        <div class="dr-setup-row"><span class="dr-setup-lbl">TP2</span><span class="dr-setup-val" style="color:var(--green)">${esc(setup.tp2)}</span></div>
        <div class="dr-setup-row"><span class="dr-setup-lbl">⚠ Invalidation</span><span class="dr-setup-val">${esc(setup.invalidation)}</span></div>
      </div>

      <div class="dr-twocol">
        <div class="dr-section">
          <div class="dr-sec-hdr">📰 Catalysts</div>
          <ul class="dr-list">${(t.catalysts || []).map(c => `<li>${esc(c)}</li>`).join('')}</ul>
        </div>

        <div class="dr-section">
          <div class="dr-sec-hdr">💧 Liquidity Map</div>
          <div class="dr-liq-block">
            <div class="dr-liq-hdr" style="color:var(--red)">▲ Above</div>
            ${(t.liq_above || []).map(l => `<div class="dr-liq-row"><span class="dr-liq-tf">${esc(l[0])}</span><span class="dr-liq-px">${esc(l[1])}</span><span class="dr-liq-note">${esc(l[2])}</span></div>`).join('')}
          </div>
          <div class="dr-liq-block">
            <div class="dr-liq-hdr" style="color:var(--green)">▼ Below</div>
            ${(t.liq_below || []).map(l => `<div class="dr-liq-row"><span class="dr-liq-tf">${esc(l[0])}</span><span class="dr-liq-px">${esc(l[1])}</span><span class="dr-liq-note">${esc(l[2])}</span></div>`).join('')}
          </div>
        </div>
      </div>
    </div>`;
  }

  function renderMacro(events) {
    if (!events || !events.length) return '';
    return `<div class="dr-section dr-macro">
      <div class="dr-sec-hdr">📅 This Week's Macro Events</div>
      <table class="dr-macro-table">
        <thead><tr><th>When</th><th>Event</th><th>Impact</th><th>Notes</th></tr></thead>
        <tbody>${events.map(e => `<tr>
          <td class="dr-macro-when">${esc(e.date)}</td>
          <td class="dr-macro-name">${esc(e.name)}</td>
          <td>${impactPill(e.impact)}</td>
          <td class="dr-macro-desc">${esc(e.desc)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
  }

  function renderInsights(insights) {
    if (!insights || !insights.length) return '';
    return `<div class="dr-section">
      <div class="dr-sec-hdr">💡 Analyst Insights</div>
      ${insights.map(i => `<div class="dr-insight">
        <div class="dr-insight-title">${esc(i.title)}</div>
        <div class="dr-insight-body">${esc(i.body)}</div>
      </div>`).join('')}
    </div>`;
  }

  async function render() {
    const content = document.getElementById('content');
    const cachedTime = _data && new Date(_data.generated).getTime();
    const stale = !_data || isNaN(cachedTime) || (Date.now() - cachedTime) > REFRESH_MS;
    if (stale) {
      content.innerHTML = `<div class="dr-wrap"><div class="loading-state">Loading daily report…</div></div>`;
      await load();
    }
    startAutoRefresh();
    if (_err) {
      content.innerHTML = `<div class="dr-wrap"><div class="empty-state"><div class="empty-icon">⚠️</div>
        <p>Could not load daily report: ${_err}</p>
        <p class="text-dim" style="font-size:.85rem">Run <code>/Daily_Report</code> in Claude Code to generate <code>js/data/daily_report.json</code>.</p>
      </div></div>`;
      return;
    }
    const d = _data;
    content.innerHTML = `<div class="dr-wrap">
      <div class="dr-hdr">
        <div>
          <h1 class="dr-title">📰 Daily Report</h1>
          <div class="dr-subtitle">${esc(d.weekday)} · ${esc(d.date)} · refreshed ${fmtAge(d.generated)}</div>
        </div>
        <button class="btn-ghost btn-sm" onclick="DailyReportTab._refresh()">↻ Refresh</button>
      </div>

      ${d.context ? `<div class="dr-context"><div class="dr-sec-hdr">🌐 Market Context</div><p>${esc(d.context)}</p></div>` : ''}

      <div class="dr-tickers">
        ${(d.tickers || []).map(renderTickerCard).join('')}
      </div>

      ${renderMacro(d.macro_today)}
      ${renderInsights(d.insights)}

      <div class="dr-footer text-dim" style="font-size:.78rem;text-align:center;margin-top:24px">
        Generated by /Daily_Report skill · ${esc(d.generated)}<br>
        Auto-regenerates Mon–Fri at midnight via launchd · UI auto-refreshes every 2 days
      </div>
    </div>`;
  }

  function startAutoRefresh() {
    if (_autoTimer) return;
    _autoTimer = setInterval(async () => {
      // Only act when the Daily Report tab is the active view
      const onTab = document.querySelector('.nav-item.active')?.dataset.tab === 'dailyreport';
      if (!onTab) return;
      const t = _data ? new Date(_data.generated).getTime() : NaN;
      const age = isNaN(t) ? Infinity : Date.now() - t;
      if (age > REFRESH_MS) {
        await load();
        render();
      }
    }, CHECK_MS);
  }

  return {
    render,
    _refresh: async () => { await load(); render(); },
  };
})();
