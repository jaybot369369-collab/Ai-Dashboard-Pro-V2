/* ═══════════════════════════════════════════════════════════
   TRADE LOG TAB
════════════════════════════════════════════════════════════ */
const TradeLogTab = (() => {

  let sortCol = 'date', sortDir = 'desc', expandedId = null;
  let filterSymbol = '', filterSession = '', filterDirection = '', filterSetup = '';
  let _userSorted = false; // true if user clicked a column header this session

  // Group-by: 'none' | 'session' | 'setup' | 'symbol' | 'day'
  let groupBy = localStorage.getItem('jb_tradelog_groupby') || 'none';
  const collapsedGroups = new Set(); // group keys that are collapsed

  // Pagination (flat "None" view only) — 15 trades per page
  let page = 1;
  const PAGE_SIZE = 15;

  // Ordered ids of the last-rendered (filtered+sorted) list — handed to
  // TradeView so its ‹ › navigation walks the same order the table shows.
  let _lastOrderedIds = [];

  // Bot view: flips the whole tab to browse imported OBxADX paper trades
  // (source 'obxadx') instead of the real ledger. Never mixed.
  let _botView = false;

  // Complete ledger source: every real trade (manual + binance_api imports),
  // decoupled from the topbar date dropdown AND the data-mode toggle.
  // DB.getTradesRaw is the un-patched original set (assigned in app.js init).
  function tradesForLog() {
    const raw = (typeof DB.getTradesRaw === 'function') ? DB.getTradesRaw() : DB.getTrades();
    if (_botView) return raw.filter(t => t.source === 'obxadx');
    return DB.filterByMode(raw, 'new');   // manual + binance_api
  }

  function render() {
    // Reset to latest-first on every fresh tab render (unless user manually sorted)
    if (!_userSorted) { sortCol = 'date'; sortDir = 'desc'; }
    const content = document.getElementById('content');
    const trades = tradesForLog();   // all manual trades, no date-range filter
    const setups = DB.getSetupNames();

    content.innerHTML = `
      <div class="section-header">
        <div class="section-title">Trade Log <span class="badge badge-dim">${trades.length}</span>
          ${sortCol === 'date' && sortDir === 'desc' ? '<span class="badge badge-dim" style="font-size:.72rem;font-weight:400;margin-left:6px">Latest first ↓</span>' : ''}
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-ghost btn-sm${_botView ? ' active' : ''}" onclick="TradeLogTab._toggleBotView()" title="Browse imported OBxADX bot paper trades (kept separate from your stats)">${_botView ? '👤 My trades' : '🤖 Bot trades'}</button>
          <button class="btn-ghost btn-sm" onclick="TradeSync.open()" title="Auto-import round-trip trades from your Binance fills + the OBxADX bot ledger">⇄ Sync trades</button>
          <button class="btn-primary btn-sm" onclick="App.openTradeModal()">＋ New Trade</button>
        </div>
      </div>
      ${_botView ? '<div class="text-xs" style="margin:-8px 0 12px;color:var(--warn,#b45309)">🤖 Viewing OBxADX bot paper trades — these never count toward your personal stats. Click "👤 My trades" to switch back.</div>' : ''}

      <!-- ═══ Scan-a-chart hero card (moved here from header per E14) ═══ -->
      <div class="scan-hero-card" onclick="App.openScanModal()">
        <div class="scan-hero-icon">📸</div>
        <div class="scan-hero-body">
          <div class="scan-hero-title">Scan a chart screenshot</div>
          <div class="scan-hero-sub">Drop a marked-up TradingView screenshot — AI extracts symbol, entry, SL, TP, session, setup type, and grades the trade automatically.</div>
        </div>
        <div class="scan-hero-cta">Open scanner →</div>
      </div>

      <div class="filter-bar">
        <input type="text" class="filter-search" id="tlSearch" placeholder="Search symbol, notes…" value="${esc(filterSymbol)}" oninput="TradeLogTab._filter()" />
        <select id="tlSession" onchange="TradeLogTab._filter()">
          <option value="">All Sessions</option>
          <option value="London">London</option>
          <option value="NY">NY</option>
          <option value="Asian">Asian</option>
          <option value="Other">Other</option>
        </select>
        <select id="tlDirection" onchange="TradeLogTab._filter()">
          <option value="">All Directions</option>
          <option value="Long">Long</option>
          <option value="Short">Short</option>
        </select>
        <select id="tlSetup" onchange="TradeLogTab._filter()">
          <option value="">All Setups</option>
          ${setups.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
        </select>
        <button class="btn-ghost btn-sm" onclick="TradeLogTab._clearFilters()">Clear</button>
      </div>

      <div class="groupby-bar">
        <span class="gb-label">Group by:</span>
        ${['none','session','setup','symbol','day'].map(g => `
          <button class="gb-pill${groupBy===g?' active':''}" onclick="TradeLogTab._setGroupBy('${g}')">${g === 'none' ? 'None' : g.charAt(0).toUpperCase()+g.slice(1)}</button>
        `).join('')}
      </div>

      <div class="table-wrap" id="tlTableWrap"></div>
    `;

    // Restore filter values
    const tlSession = document.getElementById('tlSession');
    const tlDir = document.getElementById('tlDirection');
    const tlSetup = document.getElementById('tlSetup');
    if (tlSession) tlSession.value = filterSession;
    if (tlDir) tlDir.value = filterDirection;
    if (tlSetup) tlSetup.value = filterSetup;

    renderTable(trades);
  }

  function renderTable(trades) {
    const wrap = document.getElementById('tlTableWrap');
    if (!wrap) return;

    // Apply text search filter
    const q = (document.getElementById('tlSearch')?.value || '').toLowerCase();
    let filtered = trades.filter(t => {
      if (filterSession && t.session !== filterSession) return false;
      if (filterDirection && t.direction !== filterDirection) return false;
      if (filterSetup && !(t.setupTypes || (t.setupType ? [t.setupType] : [])).includes(filterSetup)) return false;
      if (q && !`${t.symbol} ${t.notes} ${t.setupType}`.toLowerCase().includes(q)) return false;
      return true;
    });

    // Sort
    filtered = filtered.sort((a, b) => {
      let va = a[sortCol] ?? '', vb = b[sortCol] ?? '';
      if (sortCol === 'date') { va = new Date(va); vb = new Date(vb); }
      else if (sortCol === 'result' || sortCol === 'rMultiple') { va = parseFloat(va) || 0; vb = parseFloat(vb) || 0; }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      const ca = new Date(a.createdAt || 0), cb = new Date(b.createdAt || 0);
      if (ca < cb) return sortDir === 'asc' ? -1 : 1;
      if (ca > cb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    _lastOrderedIds = filtered.map(t => t.id);

    if (!filtered.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>No trades match the current filters.</p></div>`;
      return;
    }

    const th = (col, label) => {
      let cls = sortCol === col ? (sortDir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
      return `<th class="${cls}" onclick="TradeLogTab._sort('${col}')">${label}</th>`;
    };

    wrap.innerHTML = `<table id="tlTable">
      <thead><tr>
        ${th('date', 'Date')}
        ${th('symbol', 'Symbol')}
        ${th('direction', 'Dir')}
        ${th('setupType', 'Setup')}
        ${th('session', 'Session')}
        ${th('entry', 'Entry')}
        ${th('result', 'P&L')}
        ${th('rMultiple', 'R')}
        <th>Grade</th>
        <th>Source</th>
        <th></th>
      </tr></thead>
      <tbody id="tlTbody"></tbody>
    </table>`;

    const tbody = document.getElementById('tlTbody');

    if (groupBy === 'none') {
      // Paginate the flat ledger — 15 per page
      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      if (page > totalPages) page = totalPages;
      if (page < 1) page = 1;
      const startIdx = (page - 1) * PAGE_SIZE;
      const pageRows = filtered.slice(startIdx, startIdx + PAGE_SIZE);
      pageRows.forEach(t => appendTradeRow(tbody, t));
      renderPager(wrap, total, totalPages, startIdx, pageRows.length);
      return;
    }

    // Group-by logic
    const groups = {};
    filtered.forEach(t => {
      const keys = groupKeysFor(t, groupBy);
      keys.forEach(k => {
        if (!groups[k]) groups[k] = [];
        groups[k].push(t);
      });
    });

    // Build group rows (sorted)
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      if (groupBy === 'day') return b.localeCompare(a); // newest day first
      return groups[b].length - groups[a].length;       // biggest group first
    });

    sortedKeys.forEach(key => {
      const rows = groups[key];
      const closed = rows.filter(r => r.result !== '' && r.result !== undefined && r.result !== null);
      const wins   = closed.filter(r => parseFloat(r.result) > 0).length;
      const wr     = closed.length ? (wins / closed.length) * 100 : 0;
      const totalR = closed.reduce((s, r) => s + (parseFloat(r.rMultiple) || 0), 0);
      const totalPl = closed.reduce((s, r) => s + (parseFloat(r.result) || 0), 0);
      const isCollapsed = collapsedGroups.has(key);

      const groupRow = document.createElement('tr');
      groupRow.className = 'trade-group-row';
      groupRow.innerHTML = `<td colspan="11">
        <div class="group-row-inner" onclick="TradeLogTab._toggleGroup('${esc(key).replace(/'/g,'&#39;')}')">
          <span class="gr-chevron">${isCollapsed ? '▶' : '▼'}</span>
          <span class="gr-name">${esc(key)}</span>
          <span class="gr-badge">${rows.length} trade${rows.length === 1 ? '' : 's'}</span>
          ${closed.length ? `<span class="gr-stat">${wr.toFixed(0)}% WR</span>
            <span class="gr-stat ${totalR >= 0 ? 'pos' : 'neg'}">${totalR >= 0 ? '+' : ''}${totalR.toFixed(2)}R</span>
            <span class="gr-stat ${totalPl >= 0 ? 'pos' : 'neg'}">${totalPl >= 0 ? '+' : ''}$${Math.abs(totalPl).toFixed(0)}</span>` : '<span class="gr-stat text-dim">no closed trades</span>'}
        </div>
      </td>`;
      tbody.appendChild(groupRow);

      if (!isCollapsed) {
        rows.forEach(t => appendTradeRow(tbody, t));
      }
    });
  }

  function groupKeysFor(t, mode) {
    switch (mode) {
      case 'session': return [t.session || '— no session —'];
      case 'symbol':  return [t.symbol || '— no symbol —'];
      case 'day':     return [(t.date || '').slice(0, 10) || '— no date —'];
      case 'setup': {
        const ss = t.setupTypes || (t.setupType ? [t.setupType] : []);
        return ss.length ? ss : ['— no setup —'];
      }
      default: return ['all'];
    }
  }

  // Pager for the flat ledger view. Appended below the table inside the wrap.
  function renderPager(wrap, total, totalPages, startIdx, shown) {
    if (total <= PAGE_SIZE) return;  // single page — no controls needed
    const from = total ? startIdx + 1 : 0;
    const to   = startIdx + shown;
    const pager = document.createElement('div');
    pager.className = 'tl-pager';
    pager.innerHTML = `
      <button class="tl-pager-btn" ${page <= 1 ? 'disabled' : ''}
              onclick="TradeLogTab._setPage(${page - 1})">‹ Prev</button>
      <span class="tl-pager-info">Page ${page} of ${totalPages} · Showing ${from}–${to} of ${total}</span>
      <button class="tl-pager-btn" ${page >= totalPages ? 'disabled' : ''}
              onclick="TradeLogTab._setPage(${page + 1})">Next ›</button>`;
    wrap.appendChild(pager);
  }

  function appendTradeRow(tbody, t) {
    const pl = t.result !== '' && t.result !== undefined ? parseFloat(t.result) : null;
    const isExpanded = expandedId === t.id;
    const safeId = /^[A-Za-z0-9_-]+$/.test(t.id) ? t.id : '';

    const row = document.createElement('tr');
    row.className = isExpanded ? 'expanded' : '';
    row.dataset.id = t.id;

    row.innerHTML = `
      <td>${esc(t.date)}</td>
      <td><strong>${esc(t.symbol)}</strong></td>
      <td>${dirBadge(t.direction)}</td>
      <td>${(t.setupTypes || (t.setupType ? [t.setupType] : [])).filter(Boolean).map(s => `<span class="badge badge-accent">${esc(s)}</span>`).join(' ') || '—'}</td>
      <td>${sessionBadge(t.session)}</td>
      <td class="mono-num">${t.entry ? parseFloat(t.entry).toLocaleString() : '—'}</td>
      <td class="${pl !== null ? (pl >= 0 ? 'text-green' : 'text-red') : ''} font-bold mono-num">${pl !== null ? fmt$(pl) : '—'}</td>
      <td class="mono-num">${t.rMultiple !== '' && t.rMultiple !== undefined ? parseFloat(t.rMultiple).toFixed(2) + 'R' : '—'}</td>
      <td>${gradeBadge(t.postGrade || t.preGrade)}</td>
      <td><span class="badge badge-dim" style="font-size:.65rem">${esc(t.source || 'manual')}</span></td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn-icon" title="Edit" onclick="TradeLogTab._edit('${safeId}',event)">✏️</button>
          <button class="btn-icon" title="Delete" onclick="TradeLogTab._del('${safeId}',event)">🗑</button>
        </div>
      </td>
    `;
    row.addEventListener('click', e => {
      if (e.target.tagName === 'BUTTON') return;
      // Trade View popup (details left, live TradingView chart right).
      // Fall back to the old inline expand if the module didn't load.
      if (typeof TradeView !== 'undefined') { TradeView.open(t.id, _lastOrderedIds); return; }
      expandedId = expandedId === t.id ? null : t.id;
      renderTable(tradesForLog());   // keep current page; expand toggles in place
    });
    tbody.appendChild(row);

    if (isExpanded) {
      const expRow = document.createElement('tr');
      expRow.className = 'trade-expand-row';
      expRow.innerHTML = `<td colspan="11"><div class="trade-expand-inner">${expandHTML(t)}</div></td>`;
      tbody.appendChild(expRow);
    }
  }

  function expandHTML(t) {
    const fields = [
      ['SL', t.sl], ['TP', t.tp], ['Exit', t.exitPrice], ['Size ($)', t.size],
      ['HTF Bias', t.htfBias], ['Pre-Grade', t.preGrade], ['Pre-Notes', t.preGradeNotes],
      ['Post-Grade', t.postGrade], ['Post-Notes', t.postGradeNotes],
      ['Linked Mistakes', (t.linkedMistakeIds || []).length],
      ['Source', t.source],
    ];
    const fieldHtml = fields.map(([l, v]) => v !== undefined && v !== '' && v !== null
      ? `<div class="expand-field"><span class="ef-label">${esc(l)}</span><span class="ef-val">${esc(v)}</span></div>` : ''
    ).join('');

    const critique = t.aiCritique ? renderCritiqueBlock(t.aiCritique) : '';

    const notes = t.notes ? `<div class="expand-field" style="grid-column:1/-1"><span class="ef-label">Notes</span><span class="ef-val" style="white-space:pre-wrap">${esc(t.notes)}</span></div>` : '';
    const urls = (DB.getScreenshots(t) || []).filter(u => typeof u === 'string' && /^(https?:|data:image\/)/i.test(u));
    const ss = urls.length
      ? `<div class="expand-field" style="grid-column:1/-1">
           <span class="ef-label">Screenshots (${urls.length})</span>
           <div class="ef-val" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin-top:6px">
             ${urls.map(u => `<img src="${esc(u)}" style="width:100%;max-height:200px;object-fit:cover;border-radius:6px;border:1px solid var(--border-sub);cursor:pointer" onclick="window.open(this.src,'_blank')" onerror="this.style.opacity=0.3" />`).join('')}
           </div>
         </div>`
      : '';

    return fieldHtml + critique + notes + ss;
  }

  function renderCritiqueBlock(c) {
    const gradeColor = { A:'#22c55e', B:'#86efac', C:'#f59e0b', D:'#ef4444' }[c.grade] || '#888';
    return `<div class="expand-field" style="grid-column:1/-1">
      <span class="ef-label">🤖 AI Critique</span>
      <div class="ef-val">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span class="scan-grade-pill" style="background:${gradeColor}22;color:${gradeColor};border-color:${gradeColor}55">Grade ${esc(c.grade || '?')}</span>
          ${c.generated_at ? `<span class="text-xs text-sub">${esc((c.generated_at || '').slice(0,10))}</span>` : ''}
        </div>
        ${(c.strengths || []).length ? `<div style="margin-top:4px"><strong style="color:#22c55e;font-size:.75rem">✓ Strengths</strong><ul style="margin:2px 0 4px 18px;font-size:.82rem">${c.strengths.map(s=>`<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
        ${(c.weaknesses || []).length ? `<div><strong style="color:#ef4444;font-size:.75rem">✗ Weaknesses</strong><ul style="margin:2px 0 4px 18px;font-size:.82rem">${c.weaknesses.map(s=>`<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
        ${c.rr_assessment ? `<div class="text-xs text-sub" style="margin-top:4px;font-style:italic">${esc(c.rr_assessment)}</div>` : ''}
      </div>
    </div>`;
  }

  /* ── Helpers ─────────────────────────────────────────── */
  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function fmt$(n) {
    const abs = Math.abs(n);
    const str = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '-$' : '+$') + str;
  }
  function dirBadge(dir) {
    if (!dir) return '<span class="text-dim">—</span>';
    return dir === 'Long'
      ? `<span class="badge badge-green">▲ Long</span>`
      : `<span class="badge badge-red">▼ Short</span>`;
  }
  function sessionBadge(s) {
    if (!s) return '<span class="text-dim">—</span>';
    const map = { London: 'badge-accent', NY: 'badge-orange', Asian: 'badge-teal', Other: 'badge-dim' };
    return `<span class="badge ${map[s] || 'badge-dim'}">${s}</span>`;
  }
  function gradeBadge(g) {
    if (!g) return '<span class="text-dim">—</span>';
    const map = { A: 'badge-green', B: 'badge-accent', C: 'badge-orange', D: 'badge-red' };
    return `<span class="badge ${map[g] || 'badge-dim'}">${g}</span>`;
  }

  /* ═══════════════════════════════════════════════════════════════════
     AI BACKFILL — append AI scan to existing trade notes
     ═══════════════════════════════════════════════════════════════════
     Pipes a trade's most recent screenshot through
     AICoachTab.scanTradeImage() and appends a structured block to the
     trade's existing notes (never overwrites). Idempotent — re-running
     replaces the previous block in place rather than stacking.
     Phase 1: callable from DevTools console for single-trade testing
     before we ship the bulk button.
     ═══════════════════════════════════════════════════════════════════ */

  // Convert any screenshot reference to a data:image/...;base64,... URL.
  // Already-base64 URLs are returned as-is; R2/https URLs are fetched and
  // converted via FileReader. Same pattern app.js already uses on line 383.
  async function _fetchAsDataUrl(url) {
    if (!url) throw new Error('empty url');
    if (url.startsWith('data:image/')) return url;
    if (!/^https?:\/\//i.test(url)) throw new Error(`unsupported url scheme: ${url.slice(0, 30)}…`);
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`R2 fetch ${resp.status}`);
    const blob = await resp.blob();
    return await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload  = ev => res(ev.target.result);
      fr.onerror = () => rej(new Error('FileReader failed'));
      fr.readAsDataURL(blob);
    });
  }

  // Render the AI scan JSON to a human-readable text block. Idempotency
  // marker is the literal "[AI ANALYSIS — " — any block matching that
  // header on a re-run gets replaced rather than stacked.
  function _formatAiBlock(scan, isoTs) {
    if (!scan || scan._parseError) {
      const raw = (scan && scan._raw) ? scan._raw : '(no response)';
      return `[AI PARSE WARNING — ${isoTs}]\nClaude returned non-JSON. Raw response:\n${raw.slice(0, 600)}`;
    }
    const c = scan.critique || {};
    const conf = scan.confidence || {};
    const lines = [];
    lines.push(`[AI ANALYSIS — ${isoTs}]`);
    if (c.grade)               lines.push(`Grade: ${c.grade}${c.suggested_pre_grade ? ` (suggested pre-grade: ${c.suggested_pre_grade})` : ''}`);
    const setups = Array.isArray(scan.setup_types) ? scan.setup_types.join(' + ') : '';
    if (setups || conf.setup) lines.push(`Setup: ${setups || '—'}${typeof conf.setup === 'number' ? ` (confidence ${conf.setup.toFixed(2)})` : ''}`);
    const meta = [];
    if (scan.direction) meta.push(`Direction: ${scan.direction}`);
    if (scan.session)   meta.push(`Session: ${scan.session}`);
    if (scan.htf_bias)  meta.push(`HTF bias: ${scan.htf_bias}`);
    if (meta.length) lines.push(meta.join('  ·  '));
    const lvl = [];
    if (scan.entry != null) lvl.push(`Entry ${scan.entry}`);
    if (scan.sl    != null) lvl.push(`SL ${scan.sl}`);
    if (scan.tp    != null) lvl.push(`TP ${scan.tp}`);
    if (scan.rr_planned != null) lvl.push(`R:R ${scan.rr_planned}`);
    if (lvl.length) lines.push(lvl.join('  ·  '));
    if (Array.isArray(c.strengths) && c.strengths.length) {
      lines.push('Strengths:');
      c.strengths.forEach(s => lines.push(`  · ${s}`));
    }
    if (Array.isArray(c.weaknesses) && c.weaknesses.length) {
      lines.push('Weaknesses:');
      c.weaknesses.forEach(s => lines.push(`  · ${s}`));
    }
    if (c.rr_assessment) lines.push(`R:R: ${c.rr_assessment}`);
    return lines.join('\n');
  }

  // Merge an AI block into existing notes. Idempotent: any previous
  // `---\n[AI ANALYSIS — ` / `[AI PARSE WARNING — ` block is stripped
  // first, so re-runs cleanly replace the block rather than stacking.
  function _mergeNotes(existing, aiBlock) {
    const stripRe = /\n*---\n\[(?:AI ANALYSIS|AI PARSE WARNING) —[\s\S]*?\n---\s*$/;
    const cleaned = (existing || '').replace(stripRe, '').replace(/\s+$/, '');
    const sep = cleaned ? `${cleaned}\n\n` : '';
    return `${sep}---\n${aiBlock}\n---`;
  }

  // Pick the target trade for a given YYYY-MM-DD date. If multiple trades
  // share the date, prefer ones with screenshots; tiebreak by most
  // screenshots, then latest createdAt.
  function _pickTradeByDate(dateStr) {
    const candidates = DB.getTrades().filter(t => t.date === dateStr);
    if (!candidates.length) return null;
    const withShots = candidates.filter(t => DB.getScreenshots(t).length > 0);
    const pool = withShots.length ? withShots : candidates;
    pool.sort((a, b) => {
      const da = DB.getScreenshots(a).length;
      const db = DB.getScreenshots(b).length;
      if (da !== db) return db - da;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
    return pool[0];
  }

  // PUBLIC: backfill one trade by date OR trade.id. Returns a promise
  // resolving to { trade, scan, skipped, reason } so console invocations
  // can inspect the parsed JSON.
  async function _aiBackfillOne(arg) {
    if (typeof AICoachTab === 'undefined' || !AICoachTab.scanTradeImage) {
      App.toast('AICoachTab.scanTradeImage not loaded — reload the page', 'error');
      return { skipped: true, reason: 'no-aicoach' };
    }
    const trade = (typeof arg === 'string' && arg.includes('-') && arg.length === 10)
      ? _pickTradeByDate(arg)
      : DB.getTradeById(arg);
    if (!trade) {
      App.toast(`No trade found for "${arg}"`, 'error');
      return { skipped: true, reason: 'no-trade' };
    }
    const shots = DB.getScreenshots(trade);
    if (!shots.length) {
      App.toast(`Trade ${trade.symbol} ${trade.date} has no screenshot — skipped`, 'warn');
      return { trade, skipped: true, reason: 'no-screenshot' };
    }
    const lastShot = shots[shots.length - 1];
    console.log(`[ai-backfill] ${trade.symbol} ${trade.date} (${trade.id}) — fetching screenshot ${lastShot.slice(0, 60)}…`);
    App.toast(`✨ Scanning ${trade.symbol} ${trade.date} — Claude Code can take 20-60s`, 'info');

    let scan;
    try {
      const dataUrl = await _fetchAsDataUrl(lastShot);
      scan = await AICoachTab.scanTradeImage(dataUrl);
    } catch (err) {
      console.error('[ai-backfill] failed:', err);
      App.toast(`✗ Scan failed: ${err.message}`, 'error');
      return { trade, skipped: true, reason: err.message };
    }

    const isoTs   = new Date().toISOString();
    const aiBlock = _formatAiBlock(scan, isoTs);
    const merged  = _mergeNotes(trade.notes || '', aiBlock);
    DB.updateTrade(trade.id, { notes: merged, _aiScanAt: isoTs });
    App.toast(`✓ AI scan appended to ${trade.symbol} ${trade.date}`, 'success');
    console.log('[ai-backfill] result:', scan);
    render();
    return { trade: DB.getTradeById(trade.id), scan, skipped: false };
  }

  return {
    render,
    _toggleBotView: () => { _botView = !_botView; page = 1; render(); },
    _sort: col => {
      _userSorted = true;
      if (sortCol === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortCol = col; sortDir = 'desc'; }
      page = 1;
      renderTable(tradesForLog());
    },
    _filter: () => {
      filterSymbol    = document.getElementById('tlSearch')?.value || '';
      filterSession   = document.getElementById('tlSession')?.value || '';
      filterDirection = document.getElementById('tlDirection')?.value || '';
      filterSetup     = document.getElementById('tlSetup')?.value || '';
      page = 1;
      renderTable(tradesForLog());
    },
    _clearFilters: () => {
      filterSymbol = filterSession = filterDirection = filterSetup = '';
      page = 1;
      render();
    },
    _setGroupBy: g => {
      groupBy = g;
      localStorage.setItem('jb_tradelog_groupby', g);
      collapsedGroups.clear();
      page = 1;
      render();
    },
    _setPage: n => {
      page = n;
      renderTable(tradesForLog());
    },
    _toggleGroup: key => {
      if (collapsedGroups.has(key)) collapsedGroups.delete(key);
      else collapsedGroups.add(key);
      renderTable(tradesForLog());
    },
    _edit: (id, e) => { e.stopPropagation(); App.openTradeModal(id); },
    _del: (id, e) => {
      e.stopPropagation();
      App.confirmDelete('Delete this trade permanently?', () => {
        DB.deleteTrade(id);
        DB.recomputePlaybookStats();
        App.toast('Trade deleted');
        render();
      });
    },
    // Phase-1 AI backfill — console-callable single-trade test.
    // Usage: await TradeLogTab._aiBackfillOne('2026-05-22')
    //    or: await TradeLogTab._aiBackfillOne('<trade.id>')
    _aiBackfillOne,
  };
})();
