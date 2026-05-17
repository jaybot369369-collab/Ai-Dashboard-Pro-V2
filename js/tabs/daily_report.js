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
  let _todayKey  = '';
  let _viewDate  = '';

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

  function fmt$(n) {
    const v = parseFloat(n) || 0;
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : '+';
    if (abs >= 10000) return sign + '$' + (abs / 1000).toFixed(1) + 'K';
    return sign + '$' + abs.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });
  }

  function fmtR(n) {
    const v = parseFloat(n) || 0;
    return (v >= 0 ? '+' : '') + v.toFixed(2) + 'R';
  }

  function chgColor(s) {
    return typeof s === 'string' && s.startsWith('-') ? 'var(--bad,#dc2626)' : 'var(--good,#16a34a)';
  }

  function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast success';
    clearTimeout(t._tid);
    t._tid = setTimeout(() => { t.className = 'toast hidden'; }, 3000);
  }

  /* ── Session classifier ────────────────────────────────── */
  function classifySession(trade) {
    if (trade.session) return trade.session;
    const src = trade.time || trade.date || '';
    const d = new Date(src);
    if (isNaN(d.getTime())) return '—';
    const h = d.getUTCHours();
    if (h >= 2  && h < 10) return 'London';
    if (h >= 12 && h < 21) return 'NY';
    return 'Asia';
  }

  function sessionBadge(sess) {
    const colors = { London: '#3b82f6', NY: '#f59e0b', Asia: '#8b5cf6' };
    const bg = colors[sess] || '#6b7280';
    return `<span style="background:${bg}22;color:${bg};font-size:.7rem;padding:2px 7px;border-radius:99px;font-weight:600;letter-spacing:.03em">${esc(sess)}</span>`;
  }

  function isAGrade(t) {
    return t.grade === 'A' || String(t.setupGrade || '').startsWith('A') || String(t.preGrade || '').startsWith('A');
  }

  function dirChip(dir) {
    if (!dir) return '<span style="color:var(--muted,#8b90a8)">—</span>';
    const long = String(dir).toLowerCase().startsWith('l');
    return `<span class="dir ${long ? 'long' : 'short'}" style="font-size:.72rem;padding:2px 8px">
      <span class="dir-arrow">${long ? '▲' : '▼'}</span> ${long ? 'Long' : 'Short'}
    </span>`;
  }

  /* ── Today's trade stats ───────────────────────────────── */
  function todayStats(dateKey) {
    const all    = DB.getTrades();
    const trades = all.filter(t => (t.date || '').slice(0,10) === dateKey);
    const closed = trades.filter(t => t.result !== undefined && t.result !== null && t.result !== '');
    const wins   = closed.filter(t => parseFloat(t.result) > 0);
    const dayPL  = closed.reduce((s, t) => s + (parseFloat(t.result) || 0), 0);
    const totalR = closed.reduce((s, t) => s + (parseFloat(t.rMultiple) || 0), 0);
    const aGrade = trades.filter(isAGrade).length;
    return { trades, closed, wins, dayPL, totalR, aGrade };
  }

  /* ── Journal persistence ───────────────────────────────── */
  function loadJournal(dateKey) {
    try { return JSON.parse(localStorage.getItem('jb_journal_' + dateKey)) || { mood:5, discipline:5, recap:'' }; }
    catch { return { mood:5, discipline:5, recap:'' }; }
  }
  function saveJournal(dateKey, data) {
    localStorage.setItem('jb_journal_' + dateKey, JSON.stringify(data));
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

  /* ── Hero card ─────────────────────────────────────────── */
  function renderHeroCard(stats) {
    const { closed, wins, dayPL, totalR } = stats;
    const wr     = closed.length ? Math.round(wins.length / closed.length * 100) : 0;
    const plCol  = dayPL >= 0 ? 'var(--good,#16a34a)' : 'var(--bad,#dc2626)';
    const rCol   = totalR >= 0 ? 'var(--good,#16a34a)' : 'var(--bad,#dc2626)';
    return `
      <div class="hi-card" style="display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;margin-bottom:var(--gap,16px)">
        <div>
          <div class="hi-num" style="color:${plCol}">${fmt$(dayPL)}</div>
          <div class="hi-lbl" style="margin-top:6px">Day P&amp;L &nbsp;·&nbsp; ${closed.length} trade${closed.length !== 1?'s':''} &nbsp;·&nbsp; ${wr}% win rate</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:2.2rem;font-weight:800;letter-spacing:-.03em;color:${rCol}">${fmtR(totalR)}</div>
          <div style="font-size:.78rem;color:rgba(255,255,255,.7);margin-top:2px">Total R captured</div>
        </div>
      </div>`;
  }

  /* ── KPI row ───────────────────────────────────────────── */
  function renderKpiRow(stats) {
    const { trades, closed, wins, aGrade, dayPL } = stats;
    const wr = closed.length ? (wins.length / closed.length * 100).toFixed(1) + '%' : '—';
    const mvColor = dayPL >= 0 ? 'var(--good,#16a34a)' : 'var(--bad,#dc2626)';

    const ICONS = {
      cal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
      target: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
      star: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
      wallet: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>`,
    };

    function kpi(iconHtml, value, label, color, bgCls) {
      return `<div class="kpi ${bgCls||'kpi-1'}">
        <div class="kpi-ic">${iconHtml}</div>
        <div style="flex:1;min-width:0">
          <div class="kpi-num"${color ? ` style="color:${color}"` : ''}>${value}</div>
          <div class="kpi-lbl">${label}</div>
        </div>
      </div>`;
    }

    return `<div class="kpi-grid" style="margin-bottom:var(--gap,16px)">
      ${kpi(ICONS.cal,    trades.length,       'Trades today',    '',       'kpi-1')}
      ${kpi(ICONS.target, wr,                  'Win rate today',  '',       'kpi-2')}
      ${kpi(ICONS.star,   aGrade,              'A-grade trades',  '',       'kpi-3')}
      ${kpi(ICONS.wallet, fmt$(dayPL),          'Account move',   mvColor,  'kpi-4')}
    </div>`;
  }

  /* ── Today's trades table ──────────────────────────────── */
  function renderTradesTable(trades) {
    if (!trades.length) {
      return `<div style="padding:32px;text-align:center;color:var(--muted,#8b90a8);font-size:.88rem">No trades logged for this session yet.</div>`;
    }
    const thStyle = 'text-align:left;padding:6px 10px;font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#8b90a8);font-weight:600;white-space:nowrap';
    const tdStyle = 'padding:8px 10px;border-top:1px solid var(--border,#e5e7eb)22';
    const rows = trades.map(t => {
      const pl  = parseFloat(t.result  || 0);
      const r   = parseFloat(t.rMultiple || 0);
      const hasPL = t.result   !== undefined && t.result   !== null && t.result   !== '';
      const hasR  = t.rMultiple !== undefined && t.rMultiple !== null && t.rMultiple !== '';
      const plCol = pl > 0 ? 'var(--good,#16a34a)' : pl < 0 ? 'var(--bad,#dc2626)' : '';
      const rCol  = r  > 0 ? 'var(--good,#16a34a)' : r  < 0 ? 'var(--bad,#dc2626)' : '';
      const sess  = classifySession(t);
      const timeStr = t.time ? String(t.time).slice(0,5) : (t.date ? String(t.date).slice(11,16) : '');
      const setup = t.setupType || (Array.isArray(t.setupTypes) ? t.setupTypes[0] : '') || '—';
      return `<tr>
        <td style="${tdStyle}">
          ${sessionBadge(sess)}
          ${timeStr ? `<span style="font-size:.72rem;color:var(--muted,#8b90a8);margin-left:5px">${esc(timeStr)}</span>` : ''}
        </td>
        <td style="${tdStyle};font-weight:600">${esc(t.symbol || t.sym || '—')}</td>
        <td style="${tdStyle}">${dirChip(t.direction || t.dir || t.type)}</td>
        <td style="${tdStyle};font-size:.8rem;color:var(--muted,#8b90a8)">${esc(setup)}</td>
        <td style="${tdStyle};font-weight:600;text-align:right;color:${rCol}">${hasR ? fmtR(r) : '—'}</td>
        <td style="${tdStyle};font-weight:600;text-align:right;color:${plCol}">${hasPL ? fmt$(pl) : '—'}</td>
      </tr>`;
    }).join('');
    return `<div class="table-wrap" style="margin:-4px -4px 0">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="${thStyle}">Time</th>
          <th style="${thStyle}">Symbol</th>
          <th style="${thStyle}">Dir</th>
          <th style="${thStyle}">Setup</th>
          <th style="${thStyle};text-align:right">R</th>
          <th style="${thStyle};text-align:right">P&amp;L</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  /* ── Journal card ──────────────────────────────────────── */
  function renderJournalCard(dateKey) {
    const j = loadJournal(dateKey);

    function chips(prefix, stored, accentVar) {
      return Array.from({length:10}, (_,i) => {
        const v = i+1, sel = v === stored;
        return `<span id="${prefix}${v}" onclick="DailyReportTab._${prefix.replace('-','').slice(0,-1)}(${v})"
          style="cursor:pointer;display:inline-block;width:28px;height:28px;line-height:26px;text-align:center;
                 border-radius:6px;font-size:.8rem;font-weight:600;user-select:none;transition:background .15s,color .15s;
                 ${sel
                   ? `background:var(${accentVar},#7c5cff);color:#fff;border:2px solid var(${accentVar},#7c5cff)`
                   : 'background:transparent;color:var(--muted,#8b90a8);border:2px solid var(--border,#e5e7eb)'}">${v}</span>`;
      }).join('');
    }

    return `
      <div class="card-head">
        <div><div class="card-title">Daily journal</div><div class="card-sub">${esc(fmtDateLong(dateKey))}</div></div>
      </div>
      <div>
        <div style="margin-bottom:14px">
          <div style="font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#8b90a8);margin-bottom:8px">Mood</div>
          <div style="display:flex;gap:5px;flex-wrap:wrap">${chips('mood-chip-', j.mood || 5, '--accent')}</div>
        </div>
        <div style="margin-bottom:14px">
          <div style="font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#8b90a8);margin-bottom:8px">Discipline</div>
          <div style="display:flex;gap:5px;flex-wrap:wrap">${chips('disc-chip-', j.discipline || 5, '--accent-2')}</div>
        </div>
        <div style="margin-bottom:14px">
          <div style="font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#8b90a8);margin-bottom:8px">Recap</div>
          <textarea id="journalRecap" rows="6"
            style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--border,#e5e7eb);border-radius:8px;
                   background:var(--surface,#fff);color:var(--text,#111);font-size:.86rem;font-family:inherit;resize:vertical;line-height:1.6;outline:none"
            placeholder="How did the session go? Execution quality? What to repeat or avoid tomorrow?">${esc(j.recap || '')}</textarea>
        </div>
        <button onclick="DailyReportTab._saveJournal()"
          style="width:100%;padding:9px;border-radius:8px;border:none;background:var(--accent,#7c5cff);color:#fff;font-size:.86rem;font-weight:600;cursor:pointer;letter-spacing:.02em">
          Save journal
        </button>
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
    _todayKey = dateKey;

    if (isReportStale()) {
      content.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted,#8b90a8)">Loading market brief…</div>`;
      await loadReport();
    }

    startAutoRefresh();

    const stats = todayStats(dateKey);
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

      ${renderHeroCard(stats)}
      ${renderKpiRow(stats)}

      <div class="row row-12-8" style="margin-bottom:var(--gap,16px)">
        <div class="card">
          <div class="card-head">
            <div>
              <div class="card-title">Today's trades</div>
              <div class="card-sub">${stats.trades.length} logged &nbsp;·&nbsp; ${stats.closed.length} closed</div>
            </div>
            <button class="pill-select" onclick="App.navigate('tradelog')"><span>View all</span><span class="chev">→</span></button>
          </div>
          ${renderTradesTable(stats.trades)}
        </div>
        <div class="card">
          ${renderJournalCard(dateKey)}
        </div>
      </div>

      ${d ? `
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

  /* ── Chip handlers (in-place update, no full re-render) ── */
  function _setMood(v) {
    const dateKey = _todayKey || todayISO();
    const j = loadJournal(dateKey); j.mood = v; saveJournal(dateKey, j);
    document.querySelectorAll('[id^="mood-chip-"]').forEach(el => {
      const n = parseInt(el.id.split('-').pop());
      const sel = n === v;
      el.style.background   = sel ? 'var(--accent,#7c5cff)' : 'transparent';
      el.style.color        = sel ? '#fff' : 'var(--muted,#8b90a8)';
      el.style.borderColor  = sel ? 'var(--accent,#7c5cff)' : 'var(--border,#e5e7eb)';
    });
  }

  function _setDisc(v) {
    const dateKey = _todayKey || todayISO();
    const j = loadJournal(dateKey); j.discipline = v; saveJournal(dateKey, j);
    document.querySelectorAll('[id^="disc-chip-"]').forEach(el => {
      const n = parseInt(el.id.split('-').pop());
      const sel = n === v;
      el.style.background   = sel ? 'var(--accent-2,#5b3df0)' : 'transparent';
      el.style.color        = sel ? '#fff' : 'var(--muted,#8b90a8)';
      el.style.borderColor  = sel ? 'var(--accent-2,#5b3df0)' : 'var(--border,#e5e7eb)';
    });
  }

  function _saveJournal() {
    const dateKey = _todayKey || todayISO();
    const recap = document.getElementById('journalRecap')?.value || '';
    const j = loadJournal(dateKey); j.recap = recap; saveJournal(dateKey, j);
    showToast('Journal saved ✓');
  }

  function _goToday() { _viewDate = todayISO(); render(); }

  return {
    render,
    _refresh: async () => { _report = null; await loadReport(); render(); },
    _setMood,
    _setDisc,
    _saveJournal,
    _goToday,
  };

})();
