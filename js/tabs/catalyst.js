/* ═══════════════════════════════════════════════════════════
   CATALYST CALENDAR — js/tabs/catalyst.js
   Quarter-ahead view of crypto catalysts for BTC/ETH/XRP/SUI.
   Reads js/data/catalysts.json and merges MacroEvents.
════════════════════════════════════════════════════════════ */
const CatalystTab = (() => {

  const ASSETS     = ['BTC', 'ETH', 'XRP', 'SUI', 'MACRO'];
  const CATEGORIES = ['Regulatory', 'Macro', 'Protocol', 'Token Unlock', 'ETF/Flows', 'Earnings'];
  const IMPACTS    = ['high', 'medium', 'low'];

  const MON_SHORT  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MON_LONG   = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  const ASSET_ICON = { BTC:'₿', ETH:'Ξ', XRP:'✕', SUI:'🌊', MACRO:'🏛' };
  const CAT_ICON   = { 'Regulatory':'⚖️', 'Macro':'🏛', 'Protocol':'🔧', 'Token Unlock':'🔓', 'ETF/Flows':'💰', 'Earnings':'📈' };

  // ── Module state ─────────────────────────────────────────
  let _events = [];
  let _loaded = false;
  let _assetSet      = new Set((localStorage.getItem('jb_cal_assets') || 'All').split(',').filter(Boolean));
  let _impactSet     = new Set((localStorage.getItem('jb_cal_impact') || 'All').split(',').filter(Boolean));
  let _catSet        = new Set((localStorage.getItem('jb_cal_cat')    || 'All').split(',').filter(Boolean));
  let _rangeFilter   = localStorage.getItem('jb_cal_range') || '90';
  let _guideCollapsed = localStorage.getItem('jb_cal_guide_collapsed') !== 'off';

  // ── Helpers ──────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]
    ));
  }

  function _persist(key, set) {
    localStorage.setItem(key, [...set].join(',') || 'All');
  }

  /** Resolve a precision-tagged date to a Date for sorting / grouping. */
  function _resolveDate(ev) {
    if (ev.date_precision === 'quarter') {
      const [y, q] = ev.date.split('-Q');
      const m0 = (Number(q) - 1) * 3;
      return new Date(Date.UTC(Number(y), m0 + 1, 15));
    }
    if (ev.date_precision === 'month') {
      const [y, m] = ev.date.split('-');
      return new Date(Date.UTC(Number(y), Number(m) - 1, 15));
    }
    return new Date(ev.date + 'T00:00:00Z');
  }

  function _displayDate(ev) {
    if (ev.date_precision === 'quarter') {
      const [y, q] = ev.date.split('-Q');
      return `Q${q} ${y}`;
    }
    if (ev.date_precision === 'month') {
      const [y, m] = ev.date.split('-');
      return `${MON_LONG[Number(m)-1]} ${y}`;
    }
    const dt = _resolveDate(ev);
    return `${MON_SHORT[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
  }

  function _daysUntil(ev) {
    const d = _resolveDate(ev);
    const now = new Date(); now.setUTCHours(0,0,0,0);
    return Math.round((d - now) / 86400000);
  }

  function _isoDay(d) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  }

  /** Start of week (Monday) for the given Date. */
  function _weekStart(d) {
    const c = new Date(d);
    c.setUTCHours(0,0,0,0);
    const wd = c.getUTCDay() || 7;  // Sun = 7
    if (wd !== 1) c.setUTCDate(c.getUTCDate() - (wd - 1));
    return c;
  }

  function _weekLabel(weekStart) {
    const end = new Date(weekStart);
    end.setUTCDate(end.getUTCDate() + 6);
    return `Week of ${MON_SHORT[weekStart.getUTCMonth()]} ${weekStart.getUTCDate()} – ${MON_SHORT[end.getUTCMonth()]} ${end.getUTCDate()}`;
  }

  // ── Data loading ─────────────────────────────────────────
  async function _loadData(force = false) {
    if (_loaded && !force) return _events;
    let json = { events: [] };
    try {
      const r = await fetch(`js/data/catalysts.json?_=${Date.now()}`);
      if (r.ok) json = await r.json();
    } catch (e) {
      console.error('[catalyst] failed to load catalysts.json', e);
    }
    const native = (json.events || []).map(e => ({ ...e, _src: 'json' }));

    let macro = [];
    if (typeof MacroEvents !== 'undefined') {
      try {
        macro = MacroEvents.upcoming(95).map(m => ({
          id: `macro-${m.date}-${m.type}`,
          date: m.date,
          date_precision: 'day',
          title: m.name,
          assets: ['MACRO'],
          category: 'Macro',
          impact: m.impact || 'high',
          desc: m.desc || '',
          why_it_matters: 'High-impact US macro release — typical crypto vol window is 30 min before / 4 h after the print.',
          source_url: m.type === 'fomc'
            ? 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'
            : 'https://www.bls.gov/schedule/news_release/empsit.htm',
          confidence: 'confirmed',
          last_verified: m.date,
          icon: m.icon || '📊',
          _src: 'macro'
        }));
      } catch (_) {}
    }

    _events = [...native, ...macro].sort((a, b) => _resolveDate(a) - _resolveDate(b));
    _loaded = true;
    return _events;
  }

  // ── Filtering ────────────────────────────────────────────
  function _applyFilters(events) {
    const now = new Date(); now.setUTCHours(0,0,0,0);
    const days = _rangeFilter === 'all' ? 9999 : Number(_rangeFilter);
    const end = new Date(now); end.setUTCDate(now.getUTCDate() + days);

    return events.filter(ev => {
      const d = _resolveDate(ev);
      if (d < now || d > end) return false;
      if (!_assetSet.has('All')) {
        if (!ev.assets.some(a => _assetSet.has(a))) return false;
      }
      if (!_impactSet.has('All') && !_impactSet.has(ev.impact)) return false;
      if (!_catSet.has('All') && !_catSet.has(ev.category)) return false;
      return true;
    });
  }

  // ── Renderers ────────────────────────────────────────────
  function _renderMonthStrip(filtered) {
    const now = new Date(); now.setUTCHours(0,0,0,0);
    const rangeEnd = new Date(now); rangeEnd.setUTCDate(now.getUTCDate() + 90);

    // Bucket events by ISO day
    const byDay = new Map();
    filtered.forEach(ev => {
      if (ev.date_precision === 'day') {
        const key = _isoDay(_resolveDate(ev));
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push(ev);
      }
    });

    // Collect months in the 90-day window
    const months = [];
    let cur = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    while (cur <= rangeEnd) {
      months.push({ year: cur.getUTCFullYear(), month0: cur.getUTCMonth() });
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    }

    const rows = months.map(({ year, month0 }) => {
      const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
      const cells = [];

      for (let day = 1; day <= 31; day++) {
        if (day > daysInMonth) {
          // Filler so all rows share the same 31-column grid
          cells.push(`<div class="cal-strip-cell cal-strip-filler"></div>`);
          continue;
        }
        const d = new Date(Date.UTC(year, month0, day));
        const key = _isoDay(d);
        const inRange = d >= now && d <= rangeEnd;
        if (!inRange) {
          cells.push(`<div class="cal-strip-cell cal-strip-out"><span class="cal-strip-day">${day}</span></div>`);
          continue;
        }
        const events = byDay.get(key) || [];
        const topImpact = events.find(e => e.impact === 'high') ? 'high'
                        : events.find(e => e.impact === 'medium') ? 'medium'
                        : events.length ? 'low' : '';
        const isToday = d.getTime() === now.getTime();
        const title = events.length
          ? events.map(e => `${_displayDate(e)} · ${e.title}`).join('\n')
          : key;
        cells.push(`
          <div class="cal-strip-cell ${topImpact ? 'has-event impact-'+topImpact : ''} ${isToday ? 'is-today' : ''}"
               data-day="${key}" title="${esc(title)}">
            <span class="cal-strip-day">${day}</span>
            ${events.length > 1 ? `<span class="cal-strip-count">${events.length}</span>` : ''}
          </div>
        `);
      }

      return `
        <div class="cal-month-row">
          <div class="cal-month-row-lbl">${MON_SHORT[month0]}</div>
          <div class="cal-month-row-cells">${cells.join('')}</div>
        </div>
      `;
    });

    return `
      <div class="cal-month-strip-wrap">
        <div class="cal-month-strip-head">
          <span class="cal-strip-title">📅 Next 90 days</span>
          <span class="cal-strip-legend">
            <span class="cal-strip-dot impact-high"></span> High
            <span class="cal-strip-dot impact-medium"></span> Med
            <span class="cal-strip-dot impact-low"></span> Low
          </span>
        </div>
        <div class="cal-month-rows">${rows.join('')}</div>
      </div>
    `;
  }

  function _renderFilterBar() {
    const chip = (label, key, group) => {
      const set = group === 'asset' ? _assetSet : group === 'impact' ? _impactSet : _catSet;
      const active = set.has(key);
      return `<button class="cal-chip ${active ? 'active' : ''}" data-group="${group}" data-key="${esc(key)}" type="button">${esc(label)}</button>`;
    };

    const assetChips = ['All', ...ASSETS]
      .map(a => chip(a === 'All' ? 'All' : `${ASSET_ICON[a]||''} ${a}`.trim(), a, 'asset'))
      .join('');
    const impactChips = ['All', ...IMPACTS]
      .map(i => chip(i === 'All' ? 'All' : i[0].toUpperCase() + i.slice(1), i, 'impact'))
      .join('');
    const catChips = ['All', ...CATEGORIES]
      .map(c => chip(c === 'All' ? 'All' : `${CAT_ICON[c]||''} ${c}`.trim(), c, 'cat'))
      .join('');

    const ranges = [
      { v: '7',   l: '7d'  },
      { v: '30',  l: '30d' },
      { v: '90',  l: '90d' },
      { v: 'all', l: 'All' },
    ].map(r => `<button class="cal-range-pill ${_rangeFilter === r.v ? 'active' : ''}" data-range="${r.v}" type="button">${r.l}</button>`).join('');

    return `
      <div class="cal-filter-card">
        <div class="cal-filter-row">
          <span class="cal-filter-label">Asset</span>
          <div class="cal-chip-row">${assetChips}</div>
        </div>
        <div class="cal-filter-row">
          <span class="cal-filter-label">Impact</span>
          <div class="cal-chip-row">${impactChips}</div>
        </div>
        <div class="cal-filter-row">
          <span class="cal-filter-label">Category</span>
          <div class="cal-chip-row">${catChips}</div>
        </div>
        <div class="cal-filter-row">
          <span class="cal-filter-label">Window</span>
          <div class="cal-chip-row">${ranges}</div>
        </div>
      </div>
    `;
  }

  function _impactPill(impact) {
    const lbl = impact ? impact[0].toUpperCase() + impact.slice(1) : '—';
    return `<span class="cal-impact-pill impact-${impact || 'low'}">${lbl} impact</span>`;
  }

  function _confidenceBadge(conf) {
    if (!conf || conf === 'confirmed') return '';
    const lbl = conf[0].toUpperCase() + conf.slice(1);
    return `<span class="cal-confidence-badge conf-${conf}">${lbl}</span>`;
  }

  function _eventCard(ev) {
    const dStr = _displayDate(ev);
    const dayN = _daysUntil(ev);
    const dayLbl = dayN === 0 ? 'today' : dayN === 1 ? 'tomorrow' : dayN < 0 ? `${-dayN}d ago` : `in ${dayN}d`;
    const assetChips = (ev.assets || []).map(a =>
      `<span class="cal-asset-chip">${ASSET_ICON[a]||''} ${esc(a)}</span>`
    ).join('');
    const catChip = `<span class="cal-category-chip">${CAT_ICON[ev.category]||''} ${esc(ev.category||'')}</span>`;
    const why = ev.why_it_matters ? `<div class="cal-event-why"><strong>Why it matters:</strong> ${esc(ev.why_it_matters)}</div>` : '';
    const source = ev.source_url ? `<a class="cal-event-src" href="${esc(ev.source_url)}" target="_blank" rel="noopener">source ↗</a>` : '';

    const scenarios = (ev.bull_scenario || ev.bear_scenario) ? `
      <div class="cal-scenarios">
        ${ev.bull_scenario ? `<div class="cal-scenario cal-scenario-bull"><span class="cal-scenario-label">🟢 Bull</span><span class="cal-scenario-text">${esc(ev.bull_scenario)}</span></div>` : ''}
        ${ev.bear_scenario ? `<div class="cal-scenario cal-scenario-bear"><span class="cal-scenario-label">🔴 Bear</span><span class="cal-scenario-text">${esc(ev.bear_scenario)}</span></div>` : ''}
      </div>` : '';

    return `
      <div class="cal-event-card impact-${ev.impact || 'low'}">
        <div class="cal-event-rail">
          <div class="cal-event-date">${esc(dStr)}</div>
          <div class="cal-event-rel muted">${dayLbl}</div>
          ${_impactPill(ev.impact)}
          ${_confidenceBadge(ev.confidence)}
        </div>
        <div class="cal-event-body">
          <div class="cal-event-title">${esc(ev.title || '')}</div>
          <div class="cal-event-meta">${assetChips} ${catChip}</div>
          ${ev.desc ? `<div class="cal-event-desc">${esc(ev.desc)}</div>` : ''}
          ${why}
          ${scenarios}
          ${source}
        </div>
      </div>
    `;
  }

  function _renderTimeline(filtered) {
    if (filtered.length === 0) {
      return `
        <div class="cal-empty">
          <div class="cal-empty-icon">🗓</div>
          <div class="cal-empty-title">Nothing matches those filters.</div>
          <div class="cal-empty-sub">Widen the date window, add more assets, or reset filters.</div>
        </div>`;
    }

    // Group by week of resolved date. Quarter / month-precision events get bucketed under their resolved (middle) date.
    const buckets = new Map();
    filtered.forEach(ev => {
      const ws = _weekStart(_resolveDate(ev));
      const key = _isoDay(ws);
      if (!buckets.has(key)) buckets.set(key, { weekStart: ws, events: [] });
      buckets.get(key).events.push(ev);
    });

    const sortedWeeks = [...buckets.values()].sort((a, b) => a.weekStart - b.weekStart);

    return `
      <div class="cal-timeline">
        ${sortedWeeks.map(b => `
          <div class="cal-week-block">
            <div class="cal-week-header">
              <span class="cal-week-bullet"></span>
              ${esc(_weekLabel(b.weekStart))}
              <span class="cal-week-count">${b.events.length} event${b.events.length === 1 ? '' : 's'}</span>
            </div>
            <div class="cal-week-events">
              ${b.events.map(_eventCard).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function _renderKPIs(filtered) {
    const total = filtered.length;
    const high  = filtered.filter(e => e.impact === 'high').length;
    const next  = filtered[0];
    const nextLbl = next ? `${_displayDate(next)} · ${next.title}` : '—';
    const nextDays = next ? _daysUntil(next) : null;

    return `
      <div class="kpi-row" style="margin-bottom:14px">
        <div class="kpi-card">
          <div class="kpi-ic kpi-1">🗓</div>
          <div class="kpi-body"><div class="kpi-val">${total}</div><div class="kpi-lbl">Events in window</div></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-ic kpi-2">🔥</div>
          <div class="kpi-body"><div class="kpi-val">${high}</div><div class="kpi-lbl">High-impact</div></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-ic kpi-3">⏭</div>
          <div class="kpi-body">
            <div class="kpi-val" style="font-size:.95rem;line-height:1.2">${nextDays != null ? (nextDays === 0 ? 'Today' : nextDays === 1 ? 'Tomorrow' : `${nextDays}d`) : '—'}</div>
            <div class="kpi-lbl" title="${esc(nextLbl)}">Next catalyst</div>
          </div>
        </div>
      </div>
    `;
  }

  function _renderGuide() {
    const collapsedCls = _guideCollapsed ? 'is-collapsed' : '';
    return `
      <div class="cal-guide-card">
        <div class="cal-guide-head">
          <strong>📖 How to use this calendar</strong>
          <button class="btn-soft" id="calGuideToggle" type="button">${_guideCollapsed ? 'Expand all' : 'Collapse all'}</button>
        </div>

        <div class="cal-guide-section ${collapsedCls}">
          <div class="cal-guide-section-head" data-sec="howto">▾ Read it in 4 steps</div>
          <div class="cal-guide-section-body">
            <ol class="cal-guide-steps">
              <li><strong>Filter</strong> — pick your assets, the impact tier you care about, and a category if you want a single lens.</li>
              <li><strong>Scan the strip</strong> — top row shows the next 90 days. Red squares = high-impact days, amber = medium, grey = low.</li>
              <li><strong>Read the timeline</strong> — events grouped by week. Each card has the date, the impact pill, the assets it touches, and a "why it matters" line.</li>
              <li><strong>Follow the source</strong> — every event has a source link. Verify before you trade — dates change, especially regulatory ones.</li>
            </ol>
          </div>
        </div>

        <div class="cal-guide-section ${collapsedCls}">
          <div class="cal-guide-section-head" data-sec="impact">▾ Impact grading</div>
          <div class="cal-guide-section-body">
            <div class="cal-guide-grid">
              <div class="cal-guide-cell"><span class="cal-impact-pill impact-high">High</span> <span class="muted">Reliable mover. Plan position sizing around it; consider being flat through the print.</span></div>
              <div class="cal-guide-cell"><span class="cal-impact-pill impact-medium">Medium</span> <span class="muted">Often moves price, but range-bound. Trade around it, don't trade through it.</span></div>
              <div class="cal-guide-cell"><span class="cal-impact-pill impact-low">Low</span> <span class="muted">Background context. Worth knowing, not worth restructuring your day for.</span></div>
            </div>
          </div>
        </div>

        <div class="cal-guide-section ${collapsedCls}">
          <div class="cal-guide-section-head" data-sec="confidence">▾ Confidence levels</div>
          <div class="cal-guide-section-body">
            <div class="cal-guide-grid">
              <div class="cal-guide-cell"><span class="cal-confidence-badge conf-confirmed">Confirmed</span> <span class="muted">Date is official, on the calendar, or a deterministic pattern (e.g. CME last-Friday expiry).</span></div>
              <div class="cal-guide-cell"><span class="cal-confidence-badge conf-likely">Likely</span> <span class="muted">Event will happen in this window, exact day still soft. Verify a week before.</span></div>
              <div class="cal-guide-cell"><span class="cal-confidence-badge conf-rumored">Rumored</span> <span class="muted">Discussed in markets / press, not officially scheduled. Treat as scenario planning.</span></div>
            </div>
          </div>
        </div>

        <div class="cal-guide-section ${collapsedCls}">
          <div class="cal-guide-section-head" data-sec="cats">▾ Categories</div>
          <div class="cal-guide-section-body">
            <div class="cal-guide-grid">
              ${CATEGORIES.map(c => `<div class="cal-guide-cell">${CAT_ICON[c]||''} <strong>${c}</strong></div>`).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ── Main render ──────────────────────────────────────────
  async function render() {
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="page-head">
        <div>
          <h1 class="page-title">Catalyst Calendar</h1>
          <p class="page-sub">Quarter-ahead view · BTC · ETH · XRP · SUI · Macro</p>
        </div>
        <div class="page-actions">
          <button class="btn-primary" id="calRefreshBtn" type="button">⟳ Refresh</button>
        </div>
      </div>
      <div id="catalystRoot"><div class="muted" style="padding:24px">Loading catalysts…</div></div>
    `;

    document.getElementById('calRefreshBtn').addEventListener('click', async () => {
      await _loadData(true);
      _paint();
    });

    await _loadData();
    _paint();
  }

  function _paint() {
    const root = document.getElementById('catalystRoot');
    if (!root) return;
    const filtered = _applyFilters(_events);

    root.innerHTML = `
      ${_renderKPIs(filtered)}
      ${_renderMonthStrip(filtered)}
      ${_renderFilterBar()}
      ${_renderTimeline(filtered)}
      ${_renderGuide()}
    `;

    _wireChips();
    _wireGuide();
    _wireStripScroll();
  }

  // ── Event wiring ─────────────────────────────────────────
  function _wireChips() {
    document.querySelectorAll('.cal-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const group = btn.dataset.group;
        const key = btn.dataset.key;
        const set = group === 'asset' ? _assetSet
                  : group === 'impact' ? _impactSet
                  : _catSet;
        if (key === 'All') {
          set.clear(); set.add('All');
        } else {
          set.delete('All');
          if (set.has(key)) set.delete(key); else set.add(key);
          if (set.size === 0) set.add('All');
        }
        _persist(group === 'asset' ? 'jb_cal_assets' : group === 'impact' ? 'jb_cal_impact' : 'jb_cal_cat', set);
        _paint();
      });
    });
    document.querySelectorAll('.cal-range-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        _rangeFilter = btn.dataset.range;
        localStorage.setItem('jb_cal_range', _rangeFilter);
        _paint();
      });
    });
  }

  function _wireGuide() {
    const toggle = document.getElementById('calGuideToggle');
    if (toggle) toggle.addEventListener('click', () => {
      _guideCollapsed = !_guideCollapsed;
      localStorage.setItem('jb_cal_guide_collapsed', _guideCollapsed ? 'on' : 'off');
      _paint();
    });
    document.querySelectorAll('.cal-guide-section-head').forEach(h => {
      h.addEventListener('click', () => {
        const sec = h.closest('.cal-guide-section');
        if (sec) sec.classList.toggle('is-collapsed');
      });
    });
  }

  function _wireStripScroll() {
    document.querySelectorAll('.cal-strip-cell.has-event').forEach(cell => {
      cell.addEventListener('click', () => {
        const day = cell.dataset.day;
        // Find the first event card whose displayed date corresponds — scroll to the week block containing it.
        const dt = new Date(day + 'T00:00:00Z');
        const ws = _weekStart(dt);
        const wsKey = _isoDay(ws);
        const blocks = document.querySelectorAll('.cal-week-block');
        blocks.forEach(b => {
          // Identify the block by its header text matching the week
          const hdr = b.querySelector('.cal-week-header');
          if (hdr && hdr.textContent.includes(_weekLabel(ws).split('Week of ')[1])) {
            b.scrollIntoView({ behavior: 'smooth', block: 'start' });
            b.classList.add('cal-week-flash');
            setTimeout(() => b.classList.remove('cal-week-flash'), 1200);
          }
        });
      });
    });
  }

  return { render };
})();
