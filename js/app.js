/* ═══════════════════════════════════════════════════════════
   JAYBOT DASHBOARD — app.js
   Router · Tab switcher · Global state · Theme · FAB
════════════════════════════════════════════════════════════ */

const App = (() => {

  /* ── State ───────────────────────────────────────────── */
  let currentTab    = 'dashboard';
  let dateRange     = '30';
  let dateFrom      = '';
  let dateTo        = '';
  let dataMode      = 'all';   // 'imported' | 'new' | 'all'
  let confirmCallback = null;

  // Pending trade-form state (reset each time modal opens)
  let _pendingScreenshots = [];  // array of data-URL / http URL strings
  let _pendingSetups      = [];  // array of setup name strings

  /* ── Cached DOM refs ─────────────────────────────────── */
  const $ = id => document.getElementById(id);

  /* ── Tab renderers map ───────────────────────────────── */
  const RENDERERS = {
    dashboard:  () => DashboardTab.render(),
    dailyreport:() => DailyReportTab.render(),
    dojo:       () => DojoTab.render(),
    tradelog:   () => TradeLogTab.render(),
    playbook:   () => PlaybookTab.render(),
    rules:      () => RulesTab.render(),
    coach:      () => CoachTab.render(),
    aicoach:    () => AICoachTab.render(),
    goals:      () => GoalsTab.render(),
    tendencies: () => TendenciesTab.render(),
    reports:    () => ReportsTab.render(),
    liquidity:  () => LiquidityWatcherTab.render(),
    marketintel:() => MarketIntelTab.render(),
    fund:       () => FundTab.render(),
    sensei:     () => SenseiTab.render(),
    protools:   () => ProToolsTab.render(),
  };

  /* ══════════════════════════════════════════════════════
     NAVIGATION
  ══════════════════════════════════════════════════════ */
  function buildNav() {
    const nav        = $('sidebarNav');
    const tabs       = DB.getTabs();
    const tradeCount = (DB.getTrades() || []).length;
    nav.innerHTML    = '';
    let lastGroup    = null;

    tabs.forEach(tab => {
      const group = tab.group || 'OTHER';
      if (group !== lastGroup) {
        lastGroup = group;
        const lbl = document.createElement('div');
        lbl.className   = 'sb-group-label';
        lbl.textContent = group;
        nav.appendChild(lbl);
      }

      const badge = tab.id === 'tradelog' && tradeCount > 0 ? tradeCount : '';
      const item  = document.createElement('div');
      item.className  = `nav-item${tab.id === currentTab ? ' active' : ''}`;
      item.dataset.tab = tab.id;
      item.innerHTML  = `
        <span class="nav-icon">${tab.icon}</span>
        <span class="nav-label">${tab.label}</span>
        ${badge ? `<span class="nav-badge">${badge}</span>` : ''}
        ${!tab.builtin ? `<button class="nav-item-delete btn-icon" data-id="${tab.id}" title="Remove tab">✕</button>` : ''}
      `;
      item.addEventListener('click', e => {
        if (e.target.closest('.nav-item-delete')) {
          e.stopPropagation();
          confirmDelete(`Remove the "${tab.label}" tab?`, () => {
            DB.deleteTab(tab.id);
            if (currentTab === tab.id) navigate('dashboard');
            else buildNav();
          });
          return;
        }
        navigate(tab.id);
      });
      nav.appendChild(item);
    });
  }

  function navigate(tabId) {
    currentTab = tabId;
    buildNav();
    renderTab(tabId);

    // Update page title
    const tab = DB.getTabs().find(t => t.id === tabId);
    if (tab) $('pageTitle').textContent = tab.label;

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('mobile-open');
    document.body.classList.remove('sidebar-overlay');
  }

  function renderTab(tabId) {
    const content = $('content');
    content.innerHTML = '';
    const renderer = RENDERERS[tabId];
    if (renderer) {
      renderer();
    } else {
      content.innerHTML = `<div class="empty-state"><div class="empty-icon">📌</div><p>Custom tab — add your own content.</p></div>`;
    }
  }

  /* ══════════════════════════════════════════════════════
     THEME
  ══════════════════════════════════════════════════════ */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    $('themeToggle').textContent = theme === 'dark' ? '🌙' : '☀️';
    DB.saveSettings({ theme });
  }

  /* ══════════════════════════════════════════════════════
     DATE FILTER
  ══════════════════════════════════════════════════════ */
  function getDateFilter() {
    return { range: dateRange, from: dateFrom, to: dateTo };
  }

  function getDataMode() { return dataMode; }

  function applyDateFilter(range) {
    dateRange = range;
    document.querySelectorAll('#dateFilter .date-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.range === range);
    });
    const customDiv = $('customDates');
    customDiv.classList.toggle('hidden', range !== 'custom');
    DB.saveSettings({ dateRange: range });
    renderTab(currentTab);
  }

  function applyDataMode(mode) {
    dataMode = mode;
    document.querySelectorAll('#dataModeFilter .date-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    DB.saveSettings({ dataMode: mode });
    renderTab(currentTab);
  }

  /* ══════════════════════════════════════════════════════
     TRADE MODAL
  ══════════════════════════════════════════════════════ */
  /* ── Screenshot helpers ─────────────────────────────── */
  function renderScreenshotPrev() {
    const el = $('fScreenshotPreview');
    if (!el) return;
    el.innerHTML = _pendingScreenshots.map((u, i) =>
      `<div class="screenshot-thumb">
        <img src="${u}" onerror="this.style.opacity=0.3" />
        <button type="button" class="thumb-remove" onclick="App._removeScreenshot(${i})">✕</button>
      </div>`
    ).join('');
    // Show auto-tag button if there's at least one base64 image (vision-capable) and AI key is set
    const btn = $('fAutoTagBtn');
    if (btn) {
      const hasImg = _pendingScreenshots.some(u => u.startsWith('data:image'));
      const hasKey = !!localStorage.getItem('jb_ai_key');
      btn.style.display = (hasImg && hasKey) ? 'inline-block' : 'none';
    }
  }

  function addScreenshotUrl(raw) {
    const urls = raw.split(/,(?=https?:|data:)/).map(s => s.trim()).filter(Boolean);
    urls.forEach(u => { if (!_pendingScreenshots.includes(u)) _pendingScreenshots.push(u); });
    renderScreenshotPrev();
  }

  /* ── Setup chip helpers ──────────────────────────────── */
  function renderSetupChips() {
    const el = $('fSetupChips');
    if (!el) return;
    el.innerHTML = _pendingSetups.map((s, i) =>
      `<span class="setup-chip">${s}<button type="button" class="chip-rm" onclick="App._removeSetup(${i})">✕</button></span>`
    ).join('');
  }

  function addSetup(name) {
    if (!name || name === '__custom__') return;
    if (!_pendingSetups.includes(name)) {
      _pendingSetups.push(name);
      renderSetupChips();
    }
  }

  function openTradeModal(editId) {
    const modal = $('tradeModal');
    const form  = $('tradeForm');
    form.reset();

    // Reset pending state
    _pendingScreenshots = [];
    _pendingSetups      = [];

    // Populate setup picker from playbook
    const picker = $('fSetupPicker');
    if (picker) {
      picker.innerHTML = '<option value="">— select setup —</option>';
      DB.getSetupNames().forEach(name => {
        const opt = document.createElement('option');
        opt.value = opt.textContent = name;
        picker.appendChild(opt);
      });
      const customOpt = document.createElement('option');
      customOpt.value = '__custom__'; customOpt.textContent = '＋ Custom setup name…';
      picker.appendChild(customOpt);
      picker.onchange = () => {
        $('fSetupCustomGroup').classList.toggle('hidden', picker.value !== '__custom__');
      };
    }
    $('fSetupCustomGroup').classList.add('hidden');
    $('fSetupCustom').value = '';
    renderSetupChips();

    // Wire setup Add buttons (re-wire each open to avoid stale closures)
    const setupAddBtn = $('fSetupAdd');
    const customAddBtn = $('fSetupCustomAdd');
    if (setupAddBtn) {
      setupAddBtn.onclick = () => {
        const v = picker ? picker.value : '';
        if (v === '__custom__') {
          $('fSetupCustomGroup').classList.remove('hidden');
          $('fSetupCustom').focus();
        } else {
          addSetup(v);
        }
      };
    }
    if (customAddBtn) {
      customAddBtn.onclick = () => {
        const v = $('fSetupCustom').value.trim();
        if (v) { addSetup(v); $('fSetupCustom').value = ''; $('fSetupCustomGroup').classList.add('hidden'); }
      };
    }

    // Wire URL paste input → add to screenshot array on blur / Enter
    const urlEl = $('fScreenshotUrl');
    if (urlEl) {
      urlEl._wired = false; // always re-wire
      const commitUrl = () => {
        const v = urlEl.value.trim();
        if (v) { addScreenshotUrl(v); urlEl.value = ''; }
      };
      urlEl.onblur = commitUrl;
      urlEl.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); commitUrl(); } };
    }
    renderScreenshotPrev();

    // Default date to today
    $('fDate').value = new Date().toISOString().slice(0, 10);

    if (editId) {
      $('tradeModalTitle').textContent = 'Edit Trade';
      $('tradeId').value = editId;
      const t = DB.getTradeById(editId);
      if (t) populateTradeForm(t);
    } else {
      $('tradeModalTitle').textContent = 'New Trade';
      $('tradeId').value = '';
    }
    modal.classList.remove('hidden');
  }

  function populateTradeForm(t) {
    const fields = {
      fSymbol: t.symbol, fDirection: t.direction,
      fEntry: t.entry, fSl: t.sl, fTp: t.tp, fSize: t.size,
      fSession: t.session, fHtfBias: t.htfBias,
      fPreGrade: t.preGrade, fPreGradeNotes: t.preGradeNotes,
      fExitPrice: t.exitPrice, fResult: t.result, fRMultiple: t.rMultiple,
      fPostGrade: t.postGrade, fPostGradeNotes: t.postGradeNotes,
      fNotes: t.notes, fDate: t.date, fDateEnd: t.dateEnd || '',
    };
    Object.entries(fields).forEach(([id, val]) => {
      const el = $(id);
      if (!el || val === undefined || val === null) return;
      // For <select>, if the value isn't an existing option, fall back to
      // "custom" and stash the original value in the matching custom input.
      // Without this, edits to imported trades (e.g. XRP/USDC) silently
      // wipe the symbol because the select stays empty on save.
      if (el.tagName === 'SELECT') {
        const opts = Array.from(el.options).map(o => o.value);
        if (!opts.includes(String(val))) {
          if (opts.includes('custom')) {
            el.value = 'custom';
            const customId = id + 'Custom';
            const customEl = $(customId);
            const customGroup = $(customId + 'Group');
            if (customEl) customEl.value = val;
            if (customGroup) customGroup.classList.remove('hidden');
          }
          return;
        }
      }
      el.value = val;
    });
    // Load setup chips
    _pendingSetups = t.setupTypes || (t.setupType ? [t.setupType] : []);
    renderSetupChips();
    // Load screenshots
    _pendingScreenshots = DB.getScreenshots(t);
    renderScreenshotPrev();
  }

  function closeTradeModal() {
    $('tradeModal').classList.add('hidden');
  }

  function saveTradeForm() {
    const f = id => $(id)?.value?.trim() ?? '';
    const sym = f('fSymbol') === 'custom' ? f('fSymbolCustom') : f('fSymbol');

    // Also commit any URL still typed in the box
    const urlEl = $('fScreenshotUrl');
    if (urlEl && urlEl.value.trim()) {
      addScreenshotUrl(urlEl.value.trim());
      urlEl.value = '';
    }

    const setupTypes = [..._pendingSetups];
    const setupType  = setupTypes[0] || '';   // keep backward-compat single field

    // Auto-compute R if entry+sl+exitPrice given but rMultiple empty
    let rMultiple = f('fRMultiple');
    if (!rMultiple && f('fEntry') && f('fSl') && f('fExitPrice')) {
      const entry = parseFloat(f('fEntry')), sl = parseFloat(f('fSl'));
      const exit  = parseFloat(f('fExitPrice'));
      const risk  = Math.abs(entry - sl);
      if (risk > 0) rMultiple = (((exit - entry) / risk) * (f('fDirection') === 'Long' ? 1 : -1)).toFixed(2);
    }

    const data = {
      symbol: sym, direction: f('fDirection'),
      entry: f('fEntry'), sl: f('fSl'), tp: f('fTp'), size: f('fSize'),
      session: f('fSession'), htfBias: f('fHtfBias'),
      setupType, setupTypes,
      dateEnd: f('fDateEnd') || window._jb_pendingEndDate || '',
      preGrade: f('fPreGrade'), preGradeNotes: f('fPreGradeNotes'),
      exitPrice: f('fExitPrice'), result: f('fResult'), rMultiple,
      postGrade: f('fPostGrade'), postGradeNotes: f('fPostGradeNotes'),
      notes: f('fNotes'),
      screenshotUrls: [..._pendingScreenshots],
      screenshotUrl: '',   // clear legacy field on save
      date: f('fDate'),
    };

    const editId = f('tradeId');
    if (editId) {
      DB.updateTrade(editId, data);
      toast('Trade updated');
    } else {
      DB.addTrade(data);
      toast('Trade saved');
    }
    window._jb_pendingEndDate = '';
    closeTradeModal();
    DB.recomputePlaybookStats();
    renderTab(currentTab);
  }

  /* ══════════════════════════════════════════════════════
     ADD TAB MODAL
  ══════════════════════════════════════════════════════ */
  function openAddTabModal() {
    $('newTabName').value = '';
    $('newTabIcon').value = '';
    $('addTabModal').classList.remove('hidden');
    $('newTabName').focus();
  }
  function closeAddTabModal() { $('addTabModal').classList.add('hidden'); }
  function confirmAddTab() {
    const name = $('newTabName').value.trim();
    const icon = $('newTabIcon').value.trim();
    if (!name) { toast('Enter a tab name', 'error'); return; }
    DB.addTab(name, icon);
    closeAddTabModal();
    buildNav();
    toast(`"${name}" tab added`);
  }

  /* ══════════════════════════════════════════════════════
     MACRO EVENTS PILL (topbar)
  ══════════════════════════════════════════════════════ */
  function renderMacroPill() {
    const el = $('macroPill');
    if (!el || typeof MacroEvents === 'undefined') return;
    const next = MacroEvents.next();
    if (!next) { el.innerHTML = ''; el.classList.add('macro-empty'); return; }
    const days = MacroEvents.daysUntil(next.date);
    const cls = days <= 0 ? 'macro-today' : days <= 1 ? 'macro-soon' : days <= 3 ? 'macro-near' : 'macro-far';
    const when = days < 0 ? 'past' : days === 0 ? 'TODAY' : days === 1 ? 'tomorrow' : `in ${days}d`;
    el.style.display = '';
    el.className = 'macro-pill ' + cls;
    el.innerHTML = `${next.icon} <span class="macro-name">${next.name}</span> <span class="macro-when">${when}</span>`;
    el.onclick = showMacroPopup;
  }

  function showMacroPopup() {
    const upc = (typeof MacroEvents !== 'undefined') ? MacroEvents.upcoming(30) : [];
    if (!upc.length) { toast('No major events in next 30 days', 'info'); return; }
    const html = upc.map(e => {
      const days = MacroEvents.daysUntil(e.date);
      return `<div class="macro-row">
        <div class="macro-row-icon">${e.icon}</div>
        <div class="macro-row-body">
          <div class="macro-row-name">${e.name}</div>
          <div class="macro-row-desc">${e.desc}</div>
        </div>
        <div class="macro-row-when">
          <div>${e.date}</div>
          <div class="text-dim" style="font-size:.72rem">${days === 0 ? 'TODAY' : days === 1 ? 'tomorrow' : `${days}d`}</div>
        </div>
      </div>`;
    }).join('');
    showPopup('📅 Upcoming Macro Events (30d)', html);
  }

  function showPopup(title, html) {
    let pop = document.getElementById('macroPopup');
    if (pop) pop.remove();
    pop = document.createElement('div');
    pop.id = 'macroPopup'; pop.className = 'modal-overlay';
    pop.innerHTML = `<div class="modal modal-sm">
      <div class="modal-header"><h2>${title}</h2><button class="modal-close" onclick="document.getElementById('macroPopup').remove()">✕</button></div>
      <div class="modal-body" style="max-height:60vh;overflow-y:auto">${html}</div>
    </div>`;
    document.body.appendChild(pop);
    pop.addEventListener('click', e => { if (e.target === pop) pop.remove(); });
  }

  /* ══════════════════════════════════════════════════════
     CONFIRM MODAL
  ══════════════════════════════════════════════════════ */
  function confirmDelete(message, cb) {
    $('confirmMessage').textContent = message;
    confirmCallback = cb;
    $('confirmModal').classList.remove('hidden');
  }
  function closeConfirmModal() {
    $('confirmModal').classList.add('hidden');
    confirmCallback = null;
  }

  /* ══════════════════════════════════════════════════════
     SIDEBAR TOGGLE
  ══════════════════════════════════════════════════════ */
  function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('collapsed');
    document.body.classList.toggle('sidebar-collapsed');
  }

  /* ══════════════════════════════════════════════════════
     TOAST
  ══════════════════════════════════════════════════════ */
  function toast(msg, type = 'success') {
    const t = $('toast');
    t.textContent = msg;
    t.className = `toast ${type}`;
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), 3000);
  }

  /* ══════════════════════════════════════════════════════
     EXPORT / IMPORT
  ══════════════════════════════════════════════════════ */
  function handleImport(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result;
      try {
        // Try JSON first
        if (file.name.endsWith('.json')) {
          DB.importJSON(text);
          toast('Backup restored');
          renderTab(currentTab);
          return;
        }
        // CSV import
        const { format, trades } = DB.autoParseCSV(text);
        if (!trades.length) { toast('No trades found in file', 'error'); return; }
        const { added, skipped } = DB.mergeImportedTrades(trades);
        DB.recomputePlaybookStats();
        toast(`${format}: ${added} trades imported, ${skipped} duplicates skipped`);
        renderTab(currentTab);
      } catch (err) {
        toast('Import failed: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  }

  /* ══════════════════════════════════════════════════════
     INIT — wire up all events
  ══════════════════════════════════════════════════════ */
  /* ══════════════════════════════════════════════════════
     HYDRATE FROM DISK — load trades + AI key from the fund API's
     server-side store (fund_data/dashboard_state.json). Falls back
     to the seed file if the fund API isn't reachable AND localStorage
     is empty. This is what makes everything survive Chrome's
     localStorage auto-eviction.
  ══════════════════════════════════════════════════════ */
  async function hydrateOnBoot() {
    // 1. Try fund API first
    if (typeof LocalPersist !== 'undefined') {
      const r = await LocalPersist.loadFromFund();
      if (r.ok) return;   // fund served us; we're done
    }
    // 2. Fund unreachable — fall back to seed if localStorage empty
    try {
      const existing = JSON.parse(localStorage.getItem('jb_trades') || '[]');
      if (existing.length > 0) return; // localStorage has data, leave it
      const res = await fetch('assets/seed_trades.json');
      if (!res.ok) return;
      const trades = await res.json();
      if (Array.isArray(trades) && trades.length) {
        localStorage.setItem('jb_trades', JSON.stringify(trades));
        console.log(`[JayBot] Auto-seeded ${trades.length} trades on first visit (fund API was unreachable)`);
      }
    } catch (e) {
      console.warn('[JayBot] Auto-seed skipped:', e.message);
    }
  }

  async function init() {
    // PIN lock — show before anything else if a PIN is set
    if (typeof Lock !== 'undefined' && Lock.isSet()) {
      Lock.show(() => {
        // after unlock: finish booting
        _finishInit();
      });
      return;
    }
    _finishInit();
  }

  async function _finishInit() {
    if (typeof Lock !== 'undefined' && Lock.isSet()) Lock.startIdleWatch();

    // Hydrate trades + AI key from the fund-API disk store. Falls
    // back to seed file if fund API is unreachable AND localStorage
    // is empty. The fund-API path is the durable one — wipe
    // localStorage all you want and your trades + key reload here.
    await hydrateOnBoot();

    // Apply saved settings
    const s = DB.getSettings();
    applyTheme(s.theme);
    dateRange = s.dateRange || '30';
    dataMode  = s.dataMode  || 'all';
    document.querySelectorAll('#dateFilter .date-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.range === dateRange);
    });
    document.querySelectorAll('#dataModeFilter .date-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === dataMode);
    });

    // Monkey-patch DB.getTrades for tab consumers — applies the data-mode filter
    // automatically. Internal CRUD inside data.js uses the closure-bound original
    // getTrades, so writes still see all trades (read-side filter only).
    const _origGetTrades = DB.getTrades;
    DB.getTradesRaw = _origGetTrades;
    DB.getTrades    = () => DB.filterByMode(_origGetTrades(), dataMode);

    // Build nav and render default tab
    buildNav();
    navigate('dashboard');

    // Macro events pill in topbar (refresh every minute)
    renderMacroPill();
    setInterval(renderMacroPill, 60000);

    // Theme toggle
    $('themeToggle').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      applyTheme(cur === 'dark' ? 'light' : 'dark');
    });

    // Privacy toggle (eye button) — hides all dollar values
    const applyPrivacy = on => {
      document.body.classList.toggle('privacy-mode', on);
      const btn = $('privacyToggle');
      btn.textContent = on ? '🙈' : '👁';
      btn.classList.toggle('active', on);
      btn.title = on ? 'Show balances' : 'Hide all balances';
      DB.saveSettings({ privacy: on });
    };
    applyPrivacy(!!s.privacy);
    $('privacyToggle').addEventListener('click', () => {
      applyPrivacy(!document.body.classList.contains('privacy-mode'));
    });

    // Sidebar toggles
    $('sidebarToggle').addEventListener('click', toggleSidebar);
    $('hamburger').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('mobile-open');
    });

    // Date range
    document.querySelectorAll('#dateFilter .date-btn').forEach(btn => {
      btn.addEventListener('click', () => applyDateFilter(btn.dataset.range));
    });

    // Data mode toggle (Past / New / Both)
    document.querySelectorAll('#dataModeFilter .date-btn').forEach(btn => {
      btn.addEventListener('click', () => applyDataMode(btn.dataset.mode));
    });
    $('dateFrom').addEventListener('change', e => { dateFrom = e.target.value; if (dateRange === 'custom') renderTab(currentTab); });
    $('dateTo').addEventListener('change', e => { dateTo = e.target.value; if (dateRange === 'custom') renderTab(currentTab); });

    // FAB + sidebar new trade button
    $('fab').addEventListener('click', () => openTradeModal());
    $('sidebarNewTrade').addEventListener('click', () => openTradeModal());

    // Trade modal
    $('tradeModalClose').addEventListener('click', closeTradeModal);
    $('tradeFormCancel').addEventListener('click', closeTradeModal);
    $('tradeFormSave').addEventListener('click', saveTradeForm);
    $('tradeModal').addEventListener('click', e => { if (e.target === $('tradeModal')) closeTradeModal(); });

    // Symbol custom field toggle
    $('fSymbol').addEventListener('change', e => {
      $('fSymbolCustomGroup').classList.toggle('hidden', e.target.value !== 'custom');
    });

    // Add tab modal
    $('addTabBtn').addEventListener('click', openAddTabModal);
    $('addTabClose').addEventListener('click', closeAddTabModal);
    $('addTabCancel').addEventListener('click', closeAddTabModal);
    $('addTabConfirm').addEventListener('click', confirmAddTab);
    $('addTabModal').addEventListener('click', e => { if (e.target === $('addTabModal')) closeAddTabModal(); });
    $('newTabName').addEventListener('keydown', e => { if (e.key === 'Enter') confirmAddTab(); });

    // Confirm modal
    $('confirmClose').addEventListener('click', closeConfirmModal);
    $('confirmCancel').addEventListener('click', closeConfirmModal);
    $('confirmOk').addEventListener('click', () => {
      if (confirmCallback) confirmCallback();
      closeConfirmModal();
    });

    // Export
    $('exportBtn').addEventListener('click', () => { DB.exportJSON(); toast('Backup exported'); });

    // Import (JSON or CSV)
    $('importBtn').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) { handleImport(file); e.target.value = ''; }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeTradeModal();
        closeAddTabModal();
        closeConfirmModal();
      }
      // Ctrl/Cmd + N = new trade
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        openTradeModal();
      }
    });
  }

  /* ── Public API ──────────────────────────────────────── */
  return {
    init,
    navigate,
    _switchTab: navigate,
    getDateFilter,
    getDataMode,
    _aiAutoTag: async () => {
      const out = $('fAutoTagOut');
      const btn = $('fAutoTagBtn');
      const lastImg = [..._pendingScreenshots].reverse().find(u => u.startsWith('data:image'));
      if (!lastImg) { out.textContent = 'No image to tag'; return; }
      btn.disabled = true; out.innerHTML = '<span style="color:var(--gold)">✨ Analyzing chart…</span>';
      try {
        const r = await AICoachTab.autoTagImage(lastImg);
        out.innerHTML = `<div class="ai-autotag-out">
          <div><strong>Setup:</strong> ${r.setup_type||'?'} · <strong>Direction:</strong> ${r.direction||'?'} · <strong>Session:</strong> ${r.session||'?'}</div>
          ${r.suggested_entry ? `<div><strong>Suggested entry:</strong> ${r.suggested_entry}${r.suggested_stop?` · <strong>Stop:</strong> ${r.suggested_stop}`:''}</div>` : ''}
          ${r.notes ? `<div class="text-sub" style="margin-top:4px">${r.notes}</div>` : ''}
          ${r.key_features?.length ? `<ul style="margin:6px 0 0 18px">${r.key_features.map(f=>`<li>${f}</li>`).join('')}</ul>` : ''}
          <button type="button" class="btn-ghost btn-sm" onclick="App._applyAutoTag(${JSON.stringify(r).replace(/"/g,'&quot;')})" style="margin-top:6px">⬇ Apply to form</button>
        </div>`;
      } catch (e) { out.innerHTML = `<span style="color:var(--red)">⚠ ${e.message}</span>`; }
      finally { btn.disabled = false; }
    },
    _applyAutoTag: (r) => {
      // Apply suggestions to form fields where empty
      if (r.direction && $('fDirection').value !== r.direction) $('fDirection').value = (r.direction.toLowerCase().startsWith('l') ? 'Long' : 'Short');
      if (r.session) {
        const map = { London:'London', NY:'NY', Asian:'Asian' };
        const sess = Object.keys(map).find(k => r.session.includes(k));
        if (sess) $('fSession').value = sess;
      }
      if (r.suggested_entry && !$('fEntry').value) $('fEntry').value = parseFloat(String(r.suggested_entry).replace(/[^\d.]/g,'')) || '';
      if (r.suggested_stop  && !$('fSl').value)    $('fSl').value    = parseFloat(String(r.suggested_stop ).replace(/[^\d.]/g,'')) || '';
      if (r.setup_type && _pendingSetups && !_pendingSetups.includes(r.setup_type)) {
        _pendingSetups.push(r.setup_type);
        renderSetupChips();
      }
      if (typeof toast === 'function') toast('Applied AI suggestions', 'success');
    },
    _handleScreenshotFiles: async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      const useR2 = (typeof R2 !== 'undefined') && R2.isEnabled();
      const oversized = files.filter(f => f.size > 8 * 1024 * 1024);
      if (oversized.length) toast(`${oversized.length} file(s) over 8MB skipped`, 'error');
      const valid = files.filter(f => f.size <= 8 * 1024 * 1024);
      if (!valid.length) { e.target.value = ''; return; }

      const newUrls = [];
      if (useR2) {
        toast(`Uploading ${valid.length} image${valid.length===1?'':'s'} to R2…`, 'info');
        for (const f of valid) {
          try {
            const r = await R2.upload(f);
            newUrls.push(r.url);
          } catch (err) {
            console.warn('R2 upload failed, falling back to base64:', err.message);
            // Fallback: base64 for this file
            const dataUrl = await new Promise(res => { const r = new FileReader(); r.onload = ev => res(ev.target.result); r.readAsDataURL(f); });
            newUrls.push(dataUrl);
          }
        }
      } else {
        // Original base64 path
        for (const f of valid) {
          const dataUrl = await new Promise(res => { const r = new FileReader(); r.onload = ev => res(ev.target.result); r.readAsDataURL(f); });
          newUrls.push(dataUrl);
        }
      }

      newUrls.forEach(u => { if (!_pendingScreenshots.includes(u)) _pendingScreenshots.push(u); });
      renderScreenshotPrev();
      toast(`${newUrls.length} image${newUrls.length === 1 ? '' : 's'} attached${useR2 ? ' (R2 cloud)' : ''}`);
      e.target.value = '';
    },
    _removeScreenshot: (idx) => {
      _pendingScreenshots.splice(idx, 1);
      renderScreenshotPrev();
    },
    _removeSetup: (idx) => {
      _pendingSetups.splice(idx, 1);
      renderSetupChips();
    },
    openTradeModal,
    closeTradeModal,
    confirmDelete,
    toast,
    buildNav,
    renderTab,
  };

})();

/* ── Boot ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', App.init);
