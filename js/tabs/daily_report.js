/* ═══════════════════════════════════════════════════════════
   DAILY REPORT TAB (V3 — Claude.ai design)
   Top: today's session tracker + journal
   Bottom: market brief from js/data/daily_report.json
════════════════════════════════════════════════════════════ */
const DailyReportTab = (() => {

  let _report    = null;
  let _reportErr = null;
  let _loading   = false;
  let _autoTimer = null;
  let _viewDate  = '';
  let _intel     = null;
  let _intelErr  = null;

  const REFRESH_MS = 2 * 24 * 60 * 60 * 1000;
  const CHECK_MS   = 60 * 60 * 1000;

  /* ── Utilities ─────────────────────────────────────────── */
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function todayISO() {
    const n = new Date();
    return [n.getFullYear(), String(n.getMonth()+1).padStart(2,'0'), String(n.getDate()).padStart(2,'0')].join('-');
  }

  function tomorrowISO() {
    const n = new Date(); n.setDate(n.getDate()+1);
    return [n.getFullYear(), String(n.getMonth()+1).padStart(2,'0'), String(n.getDate()).padStart(2,'0')].join('-');
  }

  function fmtDateLong(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  }

  function fmtAge(iso) {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    if (isNaN(ms)) return '—';
    const m = Math.round(ms / 60000);
    if (m < 60) return m + 'm ago';
    const h = Math.round(m / 60);
    if (h < 48) return h + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }

  function chgColor(s) {
    return typeof s === 'string' && s.startsWith('-') ? 'var(--bad,#dc2626)' : 'var(--good,#16a34a)';
  }

  /* ── Report JSON fetch ─────────────────────────────────── */
  async function loadReport() {
    if (_loading) return;
    _loading = true; _reportErr = null;
    try {
      const r = await fetch('js/data/daily_report.json?t=' + Date.now());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      _report = await r.json();
    } catch(e) {
      _reportErr = e.message;
    } finally {
      _loading = false;
    }
  }

  function isReportStale() {
    if (!_report) return true;
    const t = new Date(_report.generated).getTime();
    return isNaN(t) || (Date.now() - t) > REFRESH_MS;
  }

  /* ── Market Intel highlights (absorbed from retired tab, 2026-05-19) ── */
  async function loadIntel() {
    if (_intel) return;
    try {
      const r = await fetch('js/data/market_intel.json?t=' + Date.now());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      _intel = await r.json();
    } catch(e) { _intelErr = e.message; }
  }
  function renderIntelStrip(intel) {
    if (!intel || !intel.sections) return '';
    const regime = intel.regime || {};
    const regimeLabel = regime.label || '—';
    const regimeConf  = regime.confidence ? ' · ' + regime.confidence + ' conf' : '';
    const regimeCol = /risk-?on/i.test(regimeLabel) ? '#22c55e'
                    : /risk-?off/i.test(regimeLabel) ? '#ef4444'
                    : '#fbbf24';

    // Pull top claim from macro, crypto, sentiment sections
    const pick = key => {
      const c = (intel.sections[key] && intel.sections[key].claims) || [];
      return c.length ? c[0].text : null;
    };
    const bullets = [
      ['Macro',     pick('macro')],
      ['Crypto',    pick('crypto')],
      ['Sentiment', pick('sentiment')],
    ].filter(([,t]) => t);

    const age = fmtAge(intel.generated);
    return `
      <div class="card" style="margin-bottom:var(--gap,16px);padding:14px 18px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap">
          <span style="font-size:.7rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#6b7280)">🛰 Market Intel</span>
          <span style="display:inline-flex;align-items:center;gap:6px;font-size:.78rem;font-weight:600">
            <span style="width:8px;height:8px;border-radius:50%;background:${regimeCol}"></span>
            ${esc(regimeLabel)}${esc(regimeConf)}
          </span>
          <span style="font-size:.7rem;color:var(--muted,#8b90a8);margin-left:auto">updated ${esc(age)} · <a href="#" onclick="App.navigate('marketintel');return false" style="color:var(--accent,#7c5cff);text-decoration:none">full brief ▸</a></span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px 18px">
          ${bullets.map(([lbl,t]) => `
            <div style="font-size:.82rem;line-height:1.5;color:var(--text,#111)">
              <span style="display:inline-block;font-size:.66rem;font-weight:700;letter-spacing:.04em;color:var(--muted,#6b7280);text-transform:uppercase;margin-right:6px">${lbl}</span>
              ${esc(t)}
            </div>`).join('')}
        </div>
      </div>`;
  }

  /* ── Macro badge count ─────────────────────────────────── */
  function tomorrowMacroCount(macro) {
    if (!macro || !macro.length) return 0;
    const tom = tomorrowISO().slice(5);  // MM-DD
    return macro.filter(e => String(e.date || '').includes(tom)).length;
  }

  /* ── Badge helpers ─────────────────────────────────────── */
  function biasBadge(b) {
    const map = { LONG:['#16a34a','#dcfce7'], SHORT:['#dc2626','#fee2e2'], NEUTRAL:['#6b7280','#f3f4f6'] };
    const [fg, bg] = map[b] || map.NEUTRAL;
    return `<span style="background:${bg};color:${fg};font-size:.7rem;padding:3px 9px;border-radius:99px;font-weight:700;letter-spacing:.04em">${esc(b)}</span>`;
  }

  function priorityPill(p) {
    const map = { HIGH:'#7c3aed', MEDIUM:'#ea580c', LOW:'#6b7280' };
    const fg = map[p] || '#6b7280';
    return `<span style="background:${fg}18;color:${fg};font-size:.7rem;padding:2px 8px;border-radius:4px;font-weight:600;text-transform:uppercase;letter-spacing:.05em">${esc(p)}</span>`;
  }

  function impactPill(i) {
    const map = { RED:'#dc2626', ORANGE:'#ea580c', YELLOW:'#d97706' };
    const fg = map[i] || '#6b7280';
    return `<span style="background:${fg}18;color:${fg};font-size:.7rem;padding:2px 8px;border-radius:4px;font-weight:600">${esc(i)}</span>`;
  }

  /* ── Freshness banner ──────────────────────────────────── */
  function renderFreshnessBanner(d) {
    if (!d) return '';
    const asOf = d.news_as_of || d.generated;
    const ageMs = asOf ? Date.now() - new Date(asOf).getTime() : Infinity;
    const ageH  = ageMs / 3_600_000;
    const stale = ageH > 12;
    const fng   = d.fear_greed;
    const fngBg  = fng ? (fng.score < 30 ? '#fee2e2' : fng.score > 60 ? '#dcfce7' : '#fef9c3') : '';
    const fngFg  = fng ? (fng.score < 30 ? '#dc2626' : fng.score > 60 ? '#16a34a' : '#d97706') : '';
    const fngHtml = fng
      ? `<span style="margin-left:10px;padding:2px 10px;border-radius:4px;font-size:.74rem;font-weight:700;background:${fngBg};color:${fngFg}">F&G ${esc(String(fng.score))} · ${esc(fng.label)}</span>`
      : '';
    if (stale) {
      return `<div style="background:#dc2626;color:#fff;padding:10px 16px;border-radius:8px;margin-bottom:14px;font-size:.82rem;font-weight:600">
        ⚠ STALE NEWS — verified ${esc(fmtAge(asOf))} (threshold 12h). Run <code style="background:#0002;border-radius:3px;padding:1px 5px">/THE_DAILY_REPORT</code> to refresh.
      </div>`;
    }
    return `<div style="background:var(--surface-2,#f5f6fa);border:1px solid var(--border,#e5e7eb);padding:8px 14px;border-radius:8px;margin-bottom:14px;font-size:.78rem;color:var(--muted,#8b90a8);display:flex;align-items:center;flex-wrap:wrap;gap:4px">
      <span>📡 News verified <strong style="color:var(--text,#111)">${esc(fmtAge(asOf))}</strong> · prices live-fetched at run time</span>
      ${fngHtml}
    </div>`;
  }

  /* ── Hidden signals ────────────────────────────────────── */
  function renderHiddenSignals(signals) {
    if (!signals || !signals.length) return '';
    const items = signals.map((s, i) => {
      const letter = s.letter || String.fromCharCode(97 + i);
      const age = s.as_of ? ` <span style="color:var(--text-sub,var(--muted,#a0a4c2));font-size:.72rem;opacity:.8">· verified ${fmtAge(s.as_of)}</span>` : '';
      return `<div style="display:flex;gap:10px;padding:10px 14px;border-radius:6px;background:var(--surface2,var(--surface-2,#f5f6fa));margin-bottom:8px;border-left:3px solid var(--accent,#7c5cff)">
        <span style="font-weight:700;color:var(--accent,#7c5cff);flex-shrink:0;font-size:.82rem;min-width:16px">${esc(letter)}</span>
        <span style="font-size:.82rem;line-height:1.65;color:var(--heading,var(--text,#f4f6ff))">${esc(s.body)}${age}</span>
      </div>`;
    }).join('');
    return `<div class="card" style="margin-bottom:var(--gap,16px)">
      <div class="card-head">
        <div>
          <div class="card-title">What the screen isn't showing you</div>
          <div class="card-sub">${signals.length} under-tracked signals · fetched this run</div>
        </div>
      </div>
      ${items}
    </div>`;
  }

  /* ── Live feed ─────────────────────────────────────────── */
  function renderLiveFeed(feed) {
    if (!feed || !feed.length) return '';
    const thS = 'text-align:left;padding:5px 10px 5px 0;font-size:.69rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#8b90a8);font-weight:600';
    const tdS = 'padding:7px 10px 7px 0;border-top:1px solid var(--border,#e5e7eb)33';
    const rows = feed.slice(0, 12).map(h => `<tr>
      <td style="${tdS};font-size:.79rem;font-weight:500;color:var(--text,#111)">${esc(h.headline)}</td>
      <td style="${tdS};font-size:.74rem;color:var(--muted,#8b90a8);white-space:nowrap;padding-left:10px">${esc(h.source)}</td>
      <td style="${tdS};font-size:.74rem;color:var(--muted,#8b90a8);white-space:nowrap;padding-left:6px">${h.age_h != null ? esc(String(h.age_h)) + 'h' : ''}</td>
      <td style="${tdS};padding-left:6px">${h.sym ? `<span style="background:var(--surface-2,#f5f6fa);padding:2px 7px;border-radius:4px;font-size:.72rem;font-weight:600">${esc(h.sym)}</span>` : ''}</td>
    </tr>`).join('');
    return `<div class="card" style="margin-bottom:var(--gap,16px)">
      <div class="card-head">
        <div>
          <div class="card-title">Live feed</div>
          <div class="card-sub">Last 24–48h · ${feed.length} headline${feed.length !== 1 ? 's' : ''} from 20+ sources</div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="${thS}">Headline</th>
          <th style="${thS};padding-left:10px">Source</th>
          <th style="${thS};padding-left:6px">Age</th>
          <th style="${thS};padding-left:6px">Asset</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  /* ── Ticker card (market brief) ────────────────────────── */
  function renderTickerCard(t) {
    const setup = t.setup || {};
    const isSpot = l => String(l[0]||'').toLowerCase().includes('spot');
    const safeImg = p => encodeURI(String(p||'').replace(/\.\./g,''));

    const levelsHtml = (t.levels||[]).map(l => `<tr style="${isSpot(l)?'font-weight:600':''}">
      <td style="padding:4px 8px 4px 0;font-size:.78rem;color:var(--muted,#8b90a8);white-space:nowrap">${esc(l[0])}</td>
      <td style="padding:4px 8px;font-size:.82rem;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap">${esc(l[1])}</td>
      <td style="padding:4px 0 4px 8px;font-size:.75rem;color:var(--muted,#8b90a8)">${esc(l[2])}</td>
    </tr>`).join('');

    const setupRows = [
      ['Entry',        setup.entry,        ''],
      ['Stop',         setup.stop,         'var(--bad,#dc2626)'],
      ['TP1',          setup.tp1,          'var(--good,#16a34a)'],
      ['TP2',          setup.tp2,          'var(--good,#16a34a)'],
      ['Invalidation', setup.invalidation, ''],
    ].filter(r => r[1]).map(([lbl,val,col]) => `
      <div style="display:flex;justify-content:space-between;align-items:baseline;padding:5px 0;border-bottom:1px solid var(--border,#e5e7eb)33;font-size:.81rem;gap:8px">
        <span style="color:var(--muted,#8b90a8);white-space:nowrap">${esc(lbl)}</span>
        <span style="font-weight:600;text-align:right${col?`;color:${col}`:''}">${esc(val)}</span>
      </div>`).join('');

    const liqRows = (arr, col) => (arr||[]).map(l => `
      <div style="display:flex;gap:6px;align-items:baseline;padding:3px 0;font-size:.77rem">
        <span style="width:34px;color:var(--muted,#8b90a8);flex-shrink:0">${esc(l[0])}</span>
        <span style="font-weight:600;color:${col};flex-shrink:0;width:56px">${esc(l[1])}</span>
        <span style="color:var(--muted,#8b90a8)">${esc(l[2])}</span>
      </div>`).join('');

    const chartsHtml = t.charts ? `
      <div style="display:flex;gap:8px;margin-top:14px">
        <img loading="lazy" src="js/data/${safeImg(t.charts.daily)}" alt="${esc(t.sym)} Daily"
          style="height:110px;border-radius:6px;object-fit:cover;flex:1;min-width:60px;background:var(--border,#e5e7eb)">
        <img loading="lazy" src="js/data/${safeImg(t.charts.h1)}" alt="${esc(t.sym)} 1H"
          style="height:110px;border-radius:6px;object-fit:cover;flex:1;min-width:60px;background:var(--border,#e5e7eb)">
        <img loading="lazy" src="js/data/${safeImg(t.charts.m15)}" alt="${esc(t.sym)} 15m"
          style="height:110px;border-radius:6px;object-fit:cover;flex:1;min-width:60px;background:var(--border,#e5e7eb)">
      </div>` : '';

    const liveHeadlinesHtml = (t.live_headlines && t.live_headlines.length) ? `
      <div style="margin-top:14px">
        <div style="font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#8b90a8);margin-bottom:5px">Live ${esc(t.sym)} headlines</div>
        ${t.live_headlines.slice(0,3).map(h => `
          <div style="font-size:.79rem;padding:6px 0;border-top:1px solid var(--border,#e5e7eb)33;display:flex;justify-content:space-between;align-items:baseline;gap:10px">
            <span style="color:var(--text,#111)">${esc(h.headline)}</span>
            <span style="color:var(--muted,#8b90a8);font-size:.72rem;white-space:nowrap;flex-shrink:0">${esc(h.source)}${h.age_h != null ? ' · ' + h.age_h + 'h' : ''}</span>
          </div>`).join('')}
      </div>` : '';

    return `
      <div class="card" style="margin-bottom:var(--gap,16px)">
        <div class="card-head">
          <div>
            <div class="card-title">${esc(t.sym)}/USD</div>
            <div class="card-sub">
              <span style="font-weight:600">${esc(t.price)}</span>
              <span style="color:${chgColor(t.chg24)};margin-left:8px">${esc(t.chg24)} 24h</span>
              <span style="color:${chgColor(t.chg7)};margin-left:6px">${esc(t.chg7)} 7d</span>
              <span style="color:var(--muted,#8b90a8);margin-left:10px;font-size:.74rem">Vol ${esc(t.vol)} · MCap ${esc(t.mcap)}</span>
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">${biasBadge(t.bias)}${priorityPill(t.priority)}</div>
        </div>

        <p style="font-size:.87rem;line-height:1.65;margin:0 0 16px;color:var(--text,#111)">${esc(t.thesis)}</p>

        <div class="row row-12-8">
          <div>
            <div style="font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#8b90a8);margin-bottom:6px">Key Levels</div>
            <table style="width:100%;border-collapse:collapse">${levelsHtml}</table>
          </div>
          <div>
            <div style="font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#8b90a8);margin-bottom:6px">Trade Setup</div>
            ${setupRows}
          </div>
        </div>

        ${chartsHtml}
        ${liveHeadlinesHtml}

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
          <div>
            <div style="font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#8b90a8);margin-bottom:6px">Catalysts</div>
            <ul style="margin:0;padding-left:16px;font-size:.8rem;line-height:1.65;color:var(--text,#111)">
              ${(t.catalysts||[]).map(c=>`<li style="margin-bottom:4px">${esc(c)}</li>`).join('')}
            </ul>
          </div>
          <div>
            <div style="font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#8b90a8);margin-bottom:5px">Liquidity Map</div>
            <div style="font-size:.7rem;color:var(--bad,#dc2626);font-weight:600;margin-bottom:2px">▲ Above</div>
            ${liqRows(t.liq_above, 'var(--bad,#dc2626)')}
            <div style="font-size:.7rem;color:var(--good,#16a34a);font-weight:600;margin:7px 0 2px">▼ Below</div>
            ${liqRows(t.liq_below, 'var(--good,#16a34a)')}
          </div>
        </div>
      </div>`;
  }

  /* ── Macro table ───────────────────────────────────────── */
  function renderMacroTable(events) {
    if (!events || !events.length) return '';
    const thS = 'text-align:left;padding:5px 10px;font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#8b90a8);font-weight:600';
    const tdS = 'padding:8px 10px;border-top:1px solid var(--border,#e5e7eb)33;font-size:.82rem';
    const rows = events.map(e => `<tr>
      <td style="${tdS};white-space:nowrap;color:var(--muted,#8b90a8)">${esc(e.date)}</td>
      <td style="${tdS};font-weight:500">${esc(e.name)}</td>
      <td style="${tdS}">${impactPill(e.impact)}</td>
      <td style="${tdS};font-size:.78rem;color:var(--muted,#8b90a8)">${esc(e.desc)}</td>
    </tr>`).join('');
    return `<div class="card" style="margin-bottom:var(--gap,16px)">
      <div class="card-head">
        <div><div class="card-title">Macro calendar</div><div class="card-sub">High-impact USD &amp; crypto events</div></div>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr><th style="${thS}">When</th><th style="${thS}">Event</th><th style="${thS}">Impact</th><th style="${thS}">Notes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  /* ── Insights ──────────────────────────────────────────── */
  function renderInsights(insights) {
    if (!insights || !insights.length) return '';
    return `<div class="card" style="margin-bottom:var(--gap,16px)">
      <div class="card-head">
        <div><div class="card-title">Analyst insights</div><div class="card-sub">Read between the lines</div></div>
      </div>
      ${insights.map(i=>`<div style="padding:12px 14px;border-radius:8px;background:var(--surface-2,#f5f6fa);margin-bottom:10px;border-left:3px solid var(--accent,#7c5cff)">
        <div style="font-weight:600;font-size:.87rem;margin-bottom:4px">${esc(i.title)}</div>
        <div style="font-size:.81rem;line-height:1.6;color:var(--muted-text,#555)">${esc(i.body)}</div>
      </div>`).join('')}
    </div>`;
  }

  /* ── Main render ───────────────────────────────────────── */
  async function render() {
    const content = document.getElementById('content');
    const dateKey = _viewDate || todayISO();

    if (isReportStale()) {
      content.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted,#8b90a8)">Loading market brief…</div>`;
      await loadReport();
    }
    if (!_intel) await loadIntel();

    startAutoRefresh();

    const d     = _report;
    const macroCount = d ? tomorrowMacroCount(d.macro_today) : 0;

    const macroChip = macroCount
      ? ` <span class="badge accent" style="font-size:.73rem;vertical-align:middle">• ${macroCount} macro event${macroCount!==1?'s':''} tomorrow</span>`
      : '';

    const todayBtn = (dateKey !== todayISO())
      ? `<button onclick="DailyReportTab._goToday()" style="padding:6px 14px;border-radius:8px;border:1px solid var(--border,#e5e7eb);background:transparent;color:var(--text,#111);font-size:.82rem;font-weight:600;cursor:pointer">Today</button>`
      : '';

    content.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Daily Report</h1>
          <div class="sub">${esc(fmtDateLong(dateKey))}${macroChip}</div>
        </div>
        <div class="right">
          ${todayBtn}
          <button onclick="DailyReportTab._refresh()" class="pill-select" title="Refresh market brief">↻ Refresh</button>
        </div>
      </div>

      ${renderIntelStrip(_intel)}

      ${d ? `
        ${renderFreshnessBanner(d)}
        ${renderLiveFeed(d.live_feed)}
        ${d.context ? `
          <div class="card" style="margin-bottom:var(--gap,16px)">
            <div class="card-head">
              <div><div class="card-title">Market context</div><div class="card-sub">Report ${esc(d.date)} · refreshed ${fmtAge(d.generated)}</div></div>
            </div>
            <p style="font-size:.88rem;line-height:1.7;margin:0;color:var(--text,#111)">${esc(d.context)}</p>
          </div>` : ''}
        ${(d.tickers||[]).map(renderTickerCard).join('')}
        ${renderMacroTable(d.macro_today)}
        ${renderInsights(d.insights)}
        ${renderHiddenSignals(d.hidden_signals)}
      ` : _reportErr ? `
        <div class="card" style="margin-bottom:var(--gap,16px)">
          <div style="padding:24px;text-align:center;color:var(--muted,#8b90a8);font-size:.87rem">
            Market brief unavailable: ${esc(_reportErr)}<br>
            <span style="font-size:.78rem">Run <code>/THE_DAILY_REPORT</code> to generate <code>js/data/daily_report.json</code>.</span>
          </div>
        </div>` : ''}

      <div style="font-size:.74rem;text-align:center;color:var(--muted,#8b90a8);padding:8px 0 32px">
        Market brief from /THE_DAILY_REPORT skill · auto-refreshes every 2 days
      </div>`;
  }

  /* ── Auto-refresh ──────────────────────────────────────── */
  function startAutoRefresh() {
    if (_autoTimer) return;
    _autoTimer = setInterval(async () => {
      const onTab = document.querySelector('.nav-item.active')?.dataset.tab === 'dailyreport';
      if (!onTab || !isReportStale()) return;
      await loadReport();
      render();
    }, CHECK_MS);
  }

  function _goToday() { _viewDate = todayISO(); render(); }

  return {
    render,
    _refresh: async () => { _report = null; await loadReport(); render(); },
    _goToday,
  };

})();
