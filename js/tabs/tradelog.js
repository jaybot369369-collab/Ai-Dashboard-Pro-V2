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

  function render() {
    // Reset to latest-first on every fresh tab render (unless user manually sorted)
    if (!_userSorted) { sortCol = 'date'; sortDir = 'desc'; }
    const content = document.getElementById('content');
    const { range, from, to } = App.getDateFilter();
    const allTrades = DB.getTrades();
    const trades = DB.filterByRange(allTrades, range, from, to);
    const setups = DB.getSetupNames();

    content.innerHTML = `
      <div class="section-header">
        <div class="section-title">Trade Log <span class="badge badge-dim">${trades.length}</span>
          ${sortCol === 'date' && sortDir === 'desc' ? '<span class="badge badge-dim" style="font-size:.72rem;font-weight:400;margin-left:6px">Latest first ↓</span>' : ''}
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-primary btn-sm" onclick="App.openTradeModal()">＋ New Trade</button>
        </div>
      </div>

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
      filtered.forEach(t => appendTradeRow(tbody, t));
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
      expandedId = expandedId === t.id ? null : t.id;
      const { range, from, to } = App.getDateFilter();
      renderTable(DB.filterByRange(DB.getTrades(), range, from, to));
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

  return {
    render,
    _sort: col => {
      _userSorted = true;
      if (sortCol === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortCol = col; sortDir = 'desc'; }
      const { range, from, to } = App.getDateFilter();
      const trades = DB.filterByRange(DB.getTrades(), range, from, to);
      renderTable(trades);
    },
    _filter: () => {
      filterSymbol    = document.getElementById('tlSearch')?.value || '';
      filterSession   = document.getElementById('tlSession')?.value || '';
      filterDirection = document.getElementById('tlDirection')?.value || '';
      filterSetup     = document.getElementById('tlSetup')?.value || '';
      const { range, from, to } = App.getDateFilter();
      const trades = DB.filterByRange(DB.getTrades(), range, from, to);
      renderTable(trades);
    },
    _clearFilters: () => {
      filterSymbol = filterSession = filterDirection = filterSetup = '';
      render();
    },
    _setGroupBy: g => {
      groupBy = g;
      localStorage.setItem('jb_tradelog_groupby', g);
      collapsedGroups.clear();
      render();
    },
    _toggleGroup: key => {
      if (collapsedGroups.has(key)) collapsedGroups.delete(key);
      else collapsedGroups.add(key);
      const { range, from, to } = App.getDateFilter();
      renderTable(DB.filterByRange(DB.getTrades(), range, from, to));
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
    }
  };
})();
