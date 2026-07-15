/* ═══════════════════════════════════════════════════════════
   JAYBOT DASHBOARD — app.js
   Router · Tab switcher · Global state · Theme · FAB
════════════════════════════════════════════════════════════ */

const App = (() => {

  /* ── State ───────────────────────────────────────────── */
  let currentTab    = 'dashboard';
  let dateRange     = '30';
  let dateFrom      = '';   // legacy custom-range fields (UI removed; kept for compat)
  let dateTo        = '';
  // Single app-wide date-range dropdown options. '7/30/60/90' = days back; 'alltime' = since 27 Apr 2026.
  const RANGE_LABEL = { '7': '1 week', '30': '1 month', '60': '2 months', '90': '3 months', 'alltime': 'All time' };
  let dataMode      = 'new';   // hardwired 2026-07-15 — Past/New/Both switcher removed (Jay).
                               // Imported history stays in localStorage; use DB.getTradesRaw() to reach it.
  let confirmCallback = null;

  // Pending trade-form state (reset each time modal opens)
  let _pendingScreenshots = [];  // array of data-URL / http URL strings
  let _pendingSetups      = [];  // array of setup name strings
  let _pendingScan        = null; // last scan result (so Edit & Save can attach aiCritique)
  let _scanImage          = null; // { dataUrl, b64, mediaType } for current scan

  /* ── Cached DOM refs ─────────────────────────────────── */
  const $ = id => document.getElementById(id);
  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  /* ── Tab renderers map ───────────────────────────────── */
  // 2026-05-19 audit: dojo / goals / rules / playbook / reports tabs are
  // off the sidebar but full pages remain addressable so AI Coach &
  // Dashboard can deep-link into them ("Open full ▸" buttons).
  const RENDERERS = {
    dashboard:  () => DashboardTab.render(),
    dailyreport:() => DailyReportTab.render(),
    dojo:       () => DojoTab.render(),
    tradelog:   () => TradeLogTab.render(),
    playbook:   () => PlaybookTab.render(),
    rules:      () => RulesTab.render(),
    confluence: () => ConfluenceTab.render(),
    scanner:    () => ScannerTab.render(),
    catalysts:  () => CatalystTab.render(),
    coach:      () => CoachTab.render(),
    aicoach:    () => AICoachTab.render(),
    context:    () => ContextTab.render(),
    goals:      () => GoalsTab.render(),
    reports:    () => ReportsTab.render(),
    liquidity:  () => LiquidityWatcherTab.render(),
    orderbook:  () => OrderBookTab.render(),
    marketintel:() => MarketIntelTab.render(),
    cryptoscanner: () => CryptoScannerTab.render(),
    fcpscan:    () => FCPScanner.render(),   // back-compat deep-link
    lowcap:     () => LowCapTab.render(),    // back-compat deep-link
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

  // Deep-linked tabs not in sidebar (retired but still addressable)
  const DEEP_LINK_LABELS = {
    rules: '📜 Rules', playbook: '📖 Playbook', reports: '📑 My Reports',
    goals: '🎯 Goals', dojo: '🥋 ICT Dojo',
  };
  function navigate(tabId) {
    currentTab = tabId;
    buildNav();
    renderTab(tabId);

    // Update page title
    const tab = DB.getTabs().find(t => t.id === tabId);
    if (tab) $('pageTitle').textContent = tab.label;
    else if (DEEP_LINK_LABELS[tabId]) $('pageTitle').textContent = DEEP_LINK_LABELS[tabId];

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
     THEME (legacy — kept for DB.saveSettings compat)
  ══════════════════════════════════════════════════════ */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const tog = $('themeToggle');
    if (tog) tog.textContent = theme === 'dark' ? '🌙' : '☀️';
    DB.saveSettings({ theme });
  }

  /* ══════════════════════════════════════════════════════
     TWEAKS PANEL  (Variation · Theme · Accent · Density
                    Sidebar · Privacy · Chart style)
  ══════════════════════════════════════════════════════ */
  const TWEAK_KEYS = ['variation','theme','accent','density','sidebar','privacy','chartStyle'];
  const tweakState = {
    variation: 'a', theme: 'light', accent: 'purple',
    density: 'comfy', sidebar: 'expanded', privacy: 'off', chartStyle: 'smooth',
  };

  function loadTweaks() {
    TWEAK_KEYS.forEach(k => {
      const v = localStorage.getItem('td-' + k);
      if (v) tweakState[k] = v;
    });
    // Back-compat: honour jb_settings.theme if no td-theme saved yet
    if (!localStorage.getItem('td-theme')) {
      const s = DB.getSettings();
      if (s.theme) tweakState.theme = s.theme;
    }
  }

  function applyTweaks() {
    const html = document.documentElement;
    html.setAttribute('data-variation', tweakState.variation);
    html.setAttribute('data-theme',     tweakState.theme);
    html.setAttribute('data-accent',    tweakState.accent);
    html.setAttribute('data-density',   tweakState.density);
    html.setAttribute('data-sidebar',   tweakState.sidebar);
    html.setAttribute('data-privacy',   tweakState.privacy);
    html.setAttribute('data-chart',     tweakState.chartStyle);

    TWEAK_KEYS.forEach(k => localStorage.setItem('td-' + k, tweakState[k]));
    DB.saveSettings({ theme: tweakState.theme });

    // Update active highlights in the panel
    document.querySelectorAll('.tweak-opt[data-key]').forEach(b => {
      b.classList.toggle('on', tweakState[b.dataset.key] === b.dataset.val);
    });

    // Update legacy theme toggle icon
    const tog = $('themeToggle');
    if (tog) tog.textContent = tweakState.theme === 'dark' ? '🌙' : '☀️';

    // Privacy mode body class
    document.body.classList.toggle('privacy-mode', tweakState.privacy === 'on');
  }

  function wireTweaksPanel() {
    const fab   = $('tweaksFab');
    const panel = $('tweaksPanel');
    const close = $('tweaksClose');
    if (!fab || !panel) return;

    fab.addEventListener('click', () => panel.classList.toggle('open'));
    if (close) close.addEventListener('click', () => panel.classList.remove('open'));

    // Close on outside click
    document.addEventListener('click', e => {
      if (panel.classList.contains('open') && !panel.contains(e.target) && e.target !== fab) {
        panel.classList.remove('open');
      }
    });

    // Tweak option buttons
    document.querySelectorAll('.tweak-opt[data-key]').forEach(btn => {
      btn.addEventListener('click', () => {
        tweakState[btn.dataset.key] = btn.dataset.val;
        applyTweaks();
        // Re-render active tab so charts pick up new theme colors
        if (typeof currentTab !== 'undefined') renderTab(currentTab);
      });
    });
  }

  /* ══════════════════════════════════════════════════════
     DATE FILTER
  ══════════════════════════════════════════════════════ */
  function getDateFilter() {
    return { range: dateRange, from: dateFrom, to: dateTo };
  }

  function getDataMode() { return dataMode; }

  function applyDateFilter(range) {
    if (!RANGE_LABEL[range]) range = '30';
    dateRange = range;
    const label = $('dateRangeLabel');
    if (label) label.textContent = RANGE_LABEL[range];
    document.querySelectorAll('#dateRangeMenu .pill-menu-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.range === range);
    });
    const menu = $('dateRangeMenu');
    if (menu) menu.classList.add('hidden');
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
    // Show auto-tag button: vision mode (API key + image) OR local mode (no image needed)
    const btn = $('fAutoTagBtn');
    if (btn) {
      const hasImg    = _pendingScreenshots.some(u => u.startsWith('data:image'));
      const hasKey    = !!localStorage.getItem('jb_ai_key');
      const localMode = localStorage.getItem('jb_ai_local') === 'on';
      const show = (hasImg && hasKey && !localMode) || localMode;
      btn.style.display = show ? 'inline-block' : 'none';
      btn.textContent = localMode ? '✨ Auto-tag with AI (local)' : '✨ Auto-tag last screenshot with AI';
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
      renderSetupRulesChecklist();
    }
  }

  /* ── Setup-rules (playbook adherence) helpers ─────────
     For each tagged setup that maps to a playbook entry with a checklist,
     render its rule items as ticks. Feeds trade.setupRuleChecks → the
     followed-vs-broke discipline stat (mirrors the global rules pattern). */
  function _findSetup(pb, name) {
    return pb.find(s => s.name === name || s.id === name);
  }
  function renderSetupRulesChecklist() {
    const body = $('fSetupRulesBody');
    const fs   = $('fSetupRulesFieldset');
    if (!body) return;
    const pb = DB.getPlaybook();
    const blocks = [];
    _pendingSetups.forEach(name => {
      const setup = _findSetup(pb, name);
      const list  = (setup && setup.checklist) || [];
      if (!setup || !list.length) return;
      const rows = list.map((item, i) => `
        <div style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;border-bottom:1px solid var(--border-sub)">
          <input type="checkbox" id="fSetupRuleCheck_${setup.id}_${i}" onchange="App._updateSetupRuleCount('${setup.id}')"
                 style="accent-color:var(--accent);width:14px;height:14px;flex-shrink:0;margin-top:2px;cursor:pointer" />
          <label for="fSetupRuleCheck_${setup.id}_${i}" style="font-size:.8rem;line-height:1.35;cursor:pointer">${item.label}</label>
        </div>`).join('');
      blocks.push(`<div style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="font-size:.72rem;font-weight:700;letter-spacing:.05em;color:var(--accent);text-transform:uppercase">${setup.name}</span>
          <span id="fSetupRuleCount_${setup.id}" style="font-size:.7rem;color:var(--text-dim)"></span>
        </div>
        ${rows}
      </div>`);
    });
    if (!blocks.length) {
      body.innerHTML = '<div style="font-size:.78rem;color:var(--text-dim);padding:2px 0">Tag a playbook setup above to check off its rules.</div>';
      if (fs) fs.style.display = 'none';
      return;
    }
    if (fs) fs.style.display = '';
    body.innerHTML = blocks.join('');
    _pendingSetups.forEach(name => {
      const setup = _findSetup(pb, name);
      if (setup) updateSetupRuleCount(setup.id);
    });
  }

  function updateSetupRuleCount(setupId) {
    const body = $('fSetupRulesBody');
    if (!body) return;
    const boxes = body.querySelectorAll(`input[id^="fSetupRuleCheck_${setupId}_"]`);
    const el = document.getElementById(`fSetupRuleCount_${setupId}`);
    if (!el || !boxes.length) return;
    const done = [...boxes].filter(c => c.checked).length;
    const pct  = done / boxes.length;
    const thr  = DB.getAdherenceThreshold();
    el.textContent = `${done}/${boxes.length} · ${(pct * 100).toFixed(0)}%`;
    el.style.color = pct >= thr ? '#22c55e' : done > 0 ? '#f59e0b' : 'var(--text-dim)';
  }

  function collectSetupRuleChecks() {
    const out = {};
    const pb = DB.getPlaybook();
    _pendingSetups.forEach(name => {
      const setup = _findSetup(pb, name);
      const list  = (setup && setup.checklist) || [];
      if (!setup || !list.length) return;
      out[setup.id] = list.map((_, i) => {
        const cb = document.getElementById(`fSetupRuleCheck_${setup.id}_${i}`);
        return cb ? cb.checked : false;
      });
    });
    return out;
  }

  /* ── Rules checklist helpers ────────────────────────── */
  const RULE_SET_META = {
    scalp:    { label: 'Pre-trade Rules',  color: '#7c5cff' },
    swing:    { label: 'Risk Rules',       color: '#ef4444' },
    longterm: { label: 'Psychology Rules', color: '#f59e0b' },
  };

  function renderRulesChecklist() {
    const grid = $('fRulesGrid');
    if (!grid) return;
    const rules = DB.getRules();
    grid.innerHTML = ['scalp','swing','longterm'].map(k => {
      const items = rules[k] || [];
      const meta  = RULE_SET_META[k];
      const rows  = items.map((r, i) => `
        <div style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;border-bottom:1px solid var(--border-sub)">
          <input type="checkbox" id="fRuleCheck_${k}_${i}" onchange="App._updateRulesCount()"
                 style="accent-color:${meta.color};width:14px;height:14px;flex-shrink:0;margin-top:2px;cursor:pointer" />
          <label for="fRuleCheck_${k}_${i}" style="font-size:.8rem;line-height:1.35;cursor:pointer">${r.text}</label>
        </div>`).join('');
      return `<div>
        <div style="font-size:.72rem;font-weight:700;letter-spacing:.05em;color:${meta.color};text-transform:uppercase;margin-bottom:6px">${meta.label}</div>
        ${rows || '<div style="font-size:.78rem;color:var(--text-dim);padding:4px 0">No rules set</div>'}
      </div>`;
    }).join('');
    updateRulesCount();
  }

  function updateRulesCount() {
    const grid = $('fRulesGrid');
    if (!grid) return;
    const all  = grid.querySelectorAll('input[type=checkbox]');
    const done = [...all].filter(c => c.checked).length;
    const el   = $('fRulesCount');
    if (el) {
      el.textContent = `${done}/${all.length} checked`;
      el.style.color = done === all.length ? '#22c55e' : done > 0 ? '#f59e0b' : 'var(--text-dim)';
    }
  }

  function collectRuleChecks() {
    const out = {};
    ['scalp','swing','longterm'].forEach(k => {
      const rules = DB.getRules()[k] || [];
      out[k] = rules.map((_, i) => {
        const cb = document.getElementById(`fRuleCheck_${k}_${i}`);
        return cb ? cb.checked : false;
      });
    });
    return out;
  }

  /* ══════════════════════════════════════════════════════
     SCAN TRADE MODAL — vision read of a marked-up chart
  ══════════════════════════════════════════════════════ */
  function openScanModal() {
    _pendingScan = null;
    _scanImage   = null;
    $('scanModal').classList.remove('hidden');
    $('scanStage1').classList.remove('hidden');
    $('scanStage2').classList.add('hidden');
    $('scanStage2').innerHTML = '';
    $('scanPreviewWrap').classList.add('hidden');
    $('scanLocalDesc').classList.add('hidden');
    $('scanStatus').textContent = '';
    $('scanFileInput').value = '';

    // Local mode? Surface the text-description fallback instead of the dropzone
    if (typeof AICoachTab !== 'undefined' && AICoachTab.isLocalMode && AICoachTab.isLocalMode()) {
      $('scanLocalDesc').classList.remove('hidden');
    }
  }

  function closeScanModal() {
    $('scanModal').classList.add('hidden');
  }

  function _scanReset() {
    _scanImage = null;
    _pendingScan = null;
    $('scanFileInput').value = '';
    $('scanPreviewWrap').classList.add('hidden');
    $('scanStage2').classList.add('hidden');
    $('scanStage1').classList.remove('hidden');
    $('scanStatus').textContent = '';
  }

  async function _scanHandleFile(e) {
    const file = (e.target.files || [])[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast('Image over 8MB — skipping', 'error'); return; }
    const dataUrl = await new Promise(res => { const r = new FileReader(); r.onload = ev => res(ev.target.result); r.readAsDataURL(file); });
    _setScanImage(dataUrl);
  }

  function _setScanImage(dataUrl) {
    const m = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!m) { toast('Could not read image', 'error'); return; }
    _scanImage = { dataUrl, mediaType: m[1], b64: m[2] };
    $('scanPreviewImg').src = dataUrl;
    $('scanPreviewWrap').classList.remove('hidden');
    $('scanStatus').textContent = '';
  }

  // Paste handler — pasting an image into the modal sets it as the source
  document.addEventListener('paste', e => {
    if ($('scanModal')?.classList.contains('hidden')) return;
    const items = (e.clipboardData || {}).items || [];
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (!f) continue;
        const r = new FileReader();
        r.onload = ev => _setScanImage(ev.target.result);
        r.readAsDataURL(f);
        e.preventDefault();
        return;
      }
    }
  });

  async function _scanAnalyze() {
    if (!_scanImage) { toast('Drop a screenshot first', 'error'); return; }
    const btn = $('scanAnalyzeBtn');
    btn.disabled = true;
    $('scanStatus').innerHTML = '<span style="color:var(--accent)">✨ Reading chart…</span>';
    try {
      const r = await AICoachTab.scanTradeImage(_scanImage.dataUrl);
      _pendingScan = r;
      _renderScanResult(r);
    } catch (err) {
      $('scanStatus').innerHTML = `<span style="color:var(--red)">⚠ ${err.message}</span>`;
    } finally {
      btn.disabled = false;
    }
  }

  async function _scanAnalyzeLocal() {
    const desc = $('scanLocalText')?.value?.trim();
    if (!desc) { $('scanLocalText')?.focus(); return; }
    $('scanStatus').innerHTML = '<span style="color:var(--accent)">✨ Reading…</span>';
    try {
      const r = await AICoachTab.scanTradeFromText(desc);
      _pendingScan = r;
      _renderScanResult(r);
    } catch (err) {
      $('scanStatus').innerHTML = `<span style="color:var(--red)">⚠ ${err.message}</span>`;
    }
  }

  function _renderScanResult(r) {
    if (r._parseError) {
      $('scanStage2').innerHTML = `<div style="color:var(--red);padding:12px">⚠ Could not parse Claude's response. Raw output:<pre style="white-space:pre-wrap;font-size:.78rem;margin-top:8px;background:var(--surface);padding:10px;border-radius:6px">${esc(r._raw||'')}</pre></div>`;
      $('scanStage1').classList.add('hidden');
      $('scanStage2').classList.remove('hidden');
      return;
    }
    const c = r.confidence || {};
    const conf = (k) => {
      const v = c[k];
      if (v === undefined || v === null) return '';
      if (v >= 0.8) return '<span class="scan-conf scan-conf-hi">✓</span>';
      if (v >= 0.6) return '<span class="scan-conf scan-conf-md">~</span>';
      return '<span class="scan-conf scan-conf-lo">⚠</span>';
    };
    const fmt = v => (v === null || v === undefined || v === '') ? '<span class="text-dim">—</span>' : esc(String(v));
    const crit = r.critique || {};
    const gradeColor = { A:'#22c55e', B:'#86efac', C:'#f59e0b', D:'#ef4444' }[crit.grade] || '#888';

    $('scanStage2').innerHTML = `
      <div class="scan-result">
        <div class="scan-result-header">
          <img src="${_scanImage ? _scanImage.dataUrl : ''}" class="scan-thumb" ${_scanImage ? '' : 'style="display:none"'} />
          <div class="scan-result-meta">
            <div class="scan-result-title">
              <strong>${fmt(r.symbol)}</strong>
              <span class="text-dim">·</span> ${fmt(r.timeframe)}
              <span class="text-dim">·</span> ${fmt(r.session)}
              <span class="text-dim">·</span>
              <span class="badge ${r.direction === 'Long' ? 'badge-green' : r.direction === 'Short' ? 'badge-red' : 'badge-dim'}">${fmt(r.direction)}</span>
            </div>
            <div class="text-xs text-sub" style="margin-top:4px">${fmt(r.chart_timestamp)} · HTF: ${fmt(r.htf_bias)}</div>
          </div>
        </div>

        <div class="scan-fields">
          <div class="scan-field"><span class="sf-lbl">Entry</span><span class="sf-val">${fmt(r.entry)} ${conf('entry')}</span></div>
          <div class="scan-field"><span class="sf-lbl">SL</span><span class="sf-val">${fmt(r.sl)} ${conf('sl')}</span></div>
          <div class="scan-field"><span class="sf-lbl">TP</span><span class="sf-val">${fmt(r.tp)} ${conf('tp')}</span></div>
          <div class="scan-field"><span class="sf-lbl">R:R</span><span class="sf-val">${fmt(r.rr_planned)}</span></div>
        </div>

        <div class="scan-setup-row">
          <span class="sf-lbl">Setup</span>
          ${(r.setup_types || []).map(s => `<span class="badge badge-accent">${esc(s)}</span>`).join(' ') || '<span class="text-dim">—</span>'}
          ${conf('setup')}
        </div>

        ${r.playbook_suggestion && r.playbook_suggestion.name ? `
          <div class="scan-pb-suggest" style="margin-top:10px;padding:10px 12px;border:1px dashed var(--accent);border-radius:8px;background:var(--accent-soft)">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:1.1em">💡</span>
              <strong style="color:var(--accent)">New playbook entry suggested</strong>
            </div>
            <div style="font-weight:600;margin-bottom:4px">${esc(r.playbook_suggestion.name)}</div>
            <div class="text-sm text-sub" style="margin-bottom:6px">${esc(r.playbook_suggestion.description || '')}</div>
            ${r.playbook_suggestion.why_missing ? `<div class="text-xs text-dim" style="margin-bottom:8px">Why missing: ${esc(r.playbook_suggestion.why_missing)}</div>` : ''}
            <button class="btn-primary btn-sm" onclick="App._scanAddPlaybookSuggestion()">＋ Add to playbook</button>
            <button class="btn-ghost btn-sm" onclick="App._scanDismissPlaybookSuggestion(this)">Dismiss</button>
          </div>
        ` : ''}

        ${r.key_features?.length ? `<ul class="scan-features">${r.key_features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}

        <div class="scan-critique">
          <div class="scan-critique-header">
            <span class="scan-grade-pill" style="background:${gradeColor}22;color:${gradeColor};border-color:${gradeColor}55">Grade ${esc(crit.grade || '?')}</span>
            <span class="text-xs text-sub">AI critique</span>
          </div>
          ${(crit.strengths || []).length ? `<div class="scan-bullet-group"><div class="sbg-label" style="color:#22c55e">✓ Strengths</div><ul>${crit.strengths.map(s=>`<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
          ${(crit.weaknesses || []).length ? `<div class="scan-bullet-group"><div class="sbg-label" style="color:#ef4444">✗ Weaknesses</div><ul>${crit.weaknesses.map(s=>`<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
          ${crit.rr_assessment ? `<div class="scan-rr-note">${esc(crit.rr_assessment)}</div>` : ''}
        </div>

        <div class="scan-actions">
          <button class="btn-primary" onclick="App._scanCommit()">⬇ Edit &amp; Save Trade</button>
          <button class="btn-ghost btn-sm" onclick="App._scanReset()">↺ Try another</button>
        </div>
      </div>`;
    $('scanStage1').classList.add('hidden');
    $('scanStage2').classList.remove('hidden');
  }

  // Add the AI's suggested new playbook entry from the scan result.
  // Auto-attaches the new entry's name to the current trade's setup_types
  // so the next "Edit & Save Trade" picks it up. Idempotent — clicking
  // twice doesn't add duplicates (we match by case-insensitive name).
  function _scanAddPlaybookSuggestion() {
    if (!_pendingScan || !_pendingScan.playbook_suggestion) return;
    const sug = _pendingScan.playbook_suggestion;
    const name = (sug.name || '').trim();
    if (!name) { toast('Suggestion has no name', 'error'); return; }
    const existing = DB.getPlaybook().find(s =>
      (s.name || '').toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      toast(`"${name}" already in playbook`, 'warn');
    } else {
      DB.addSetup({
        name,
        description: sug.description || '',
        rules: '',
        screenshotUrl: '',
      });
      toast(`✓ Added "${name}" to playbook`, 'success');
    }
    // Auto-attach to this trade's setup_types so the form prefill includes it
    const types = _pendingScan.setup_types || [];
    if (!types.some(t => t.toLowerCase() === name.toLowerCase())) {
      _pendingScan.setup_types = [...types, name];
    }
    // Clear the suggestion + re-render
    _pendingScan.playbook_suggestion = null;
    _renderScanResult(_pendingScan);
  }

  function _scanDismissPlaybookSuggestion(btn) {
    if (_pendingScan) _pendingScan.playbook_suggestion = null;
    const block = btn?.closest('.scan-pb-suggest');
    if (block) block.remove();
  }

  function _scanCommit() {
    if (!_pendingScan) return;
    const r = _pendingScan;
    // Build a prefill object aligned to the trade form
    const sessionMap = { London:'London', NY:'NY', Asian:'Asian' };
    const session = sessionMap[r.session] || 'Other';
    const dir = r.direction === 'Long' || r.direction === 'Short' ? r.direction : '';
    const data = {
      symbol: r.symbol || '',
      direction: dir,
      entry: r.entry ?? '',
      sl:    r.sl    ?? '',
      tp:    r.tp    ?? '',
      session,
      htfBias: r.htf_bias && /^(Bull|Bear|Neut)/i.test(r.htf_bias)
        ? (/^Bull/i.test(r.htf_bias) ? 'Bullish' : /^Bear/i.test(r.htf_bias) ? 'Bearish' : 'Neutral')
        : '',
      setupTypes: Array.isArray(r.setup_types) ? r.setup_types : [],
      exitPrice: r.exit_price ?? '',
      preGrade:  r.critique?.suggested_pre_grade || '',
      notes: (r.key_features || []).join(' · '),
      aiCritique: r.critique ? { ...r.critique, generated_at: new Date().toISOString() } : null,
      scanConfidence: r.confidence || null,
      screenshotUrl: _scanImage ? _scanImage.dataUrl : '',
    };
    closeScanModal();
    openTradeModalPrefilled(data);
  }

  // Normalize a pasted/scanned data-URL screenshot before it is persisted:
  // upload to R2 if configured, otherwise compress to 1200px webp base64.
  // Prevents the scan-trade flow from storing a raw multi-MB PNG that would
  // blow the ~5MB localStorage quota (the root cause of blank trade images).
  async function _normalizeShotForStore(url) {
    if (!url || !url.startsWith('data:image')) return url;
    if (typeof R2 !== 'undefined' && R2.isEnabled()) {
      try { return (await R2.uploadDataUrl(url)).url; }
      catch (e) { console.warn('R2 uploadDataUrl failed, compressing:', e.message); }
    }
    try {
      const blob = await R2.compressImage(url);
      return await new Promise(res => { const r = new FileReader(); r.onload = ev => res(ev.target.result); r.readAsDataURL(blob); });
    } catch (e) {
      console.warn('compress failed, storing raw scan:', e.message);
      return url;
    }
  }

  async function openTradeModalPrefilled(d) {
    openTradeModal(); // resets state, opens normal modal
    if (d.screenshotUrl) {
      const stored = await _normalizeShotForStore(d.screenshotUrl);
      if (!_pendingScreenshots.includes(stored)) _pendingScreenshots.push(stored);
      renderScreenshotPrev();
    }
    if (d.setupTypes && d.setupTypes.length) {
      _pendingSetups = [...d.setupTypes];
      renderSetupChips();
      renderSetupRulesChecklist();
    }
    // Apply fields
    const setVal = (id, v) => {
      if (v === undefined || v === null || v === '') return;
      const el = $(id);
      if (!el) return;
      if (el.tagName === 'SELECT') {
        const opts = Array.from(el.options).map(o => o.value);
        if (opts.includes(String(v))) el.value = v;
        else if (id === 'fSymbol' && opts.includes('custom')) {
          el.value = 'custom';
          $('fSymbolCustomGroup').classList.remove('hidden');
          $('fSymbolCustom').value = v;
        }
      } else {
        el.value = v;
      }
    };
    setVal('fSymbol', d.symbol);
    setVal('fDirection', d.direction);
    setVal('fEntry', d.entry);
    setVal('fSl', d.sl);
    setVal('fTp', d.tp);
    setVal('fSession', d.session);
    setVal('fHtfBias', d.htfBias);
    setVal('fExitPrice', d.exitPrice);
    setVal('fPreGrade', d.preGrade);
    if (d.notes) $('fNotes').value = d.notes;
    // Attach AI critique into the post-grade notes too (so it persists in the trade)
    if (d.aiCritique) {
      const c = d.aiCritique;
      const summary = `AI: Grade ${c.grade || '?'}${c.strengths?.length ? ' · ✓ ' + c.strengths.join('; ') : ''}${c.weaknesses?.length ? ' · ✗ ' + c.weaknesses.join('; ') : ''}${c.rr_assessment ? ' — ' + c.rr_assessment : ''}`;
      $('fPostGradeNotes').value = summary;
    }
    // Stash the critique + confidence on a hidden field on the form root so saveTradeForm can pick them up
    const form = $('tradeForm');
    if (form) {
      form.dataset.aiCritique = d.aiCritique ? JSON.stringify(d.aiCritique) : '';
      form.dataset.scanConfidence = d.scanConfidence ? JSON.stringify(d.scanConfidence) : '';
    }
    toast('Scan applied — review and save', 'success');
  }

  function openTradeModal(editId) {
    const modal = $('tradeModal');
    const form  = $('tradeForm');
    form.reset();

    // Reset pending state
    _pendingScreenshots = [];
    _pendingSetups      = [];
    // Clear any stashed AI critique on form
    if (form) { form.dataset.aiCritique = ''; form.dataset.scanConfidence = ''; }

    // Build rules checklist panel
    renderRulesChecklist();
    $('fAnalyseOut').innerHTML = '';
    $('fAnalyseStatus').textContent = '';
    // Collapse panel on new modal open
    const rb = $('fRulesBody'), rc = $('fRulesChevron');
    if (rb) { rb.style.display = 'none'; }
    if (rc) { rc.textContent = '▼'; }

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
    renderSetupRulesChecklist();

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
      fFees: t.fees,
      fPostGrade: t.postGrade, fPostGradeNotes: t.postGradeNotes,
      fNotes: t.notes, fDate: t.date, fDateEnd: t.dateEnd || '',
      fTime: t.time || '',
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
    // Render setup-rule ticks and restore saved state
    renderSetupRulesChecklist();
    if (t.setupRuleChecks) {
      Object.entries(t.setupRuleChecks).forEach(([sid, arr]) => {
        (arr || []).forEach((checked, i) => {
          const cb = document.getElementById(`fSetupRuleCheck_${sid}_${i}`);
          if (cb) cb.checked = !!checked;
        });
        updateSetupRuleCount(sid);
      });
    }
    // Stash AI critique if present so a re-save preserves it
    const form = $('tradeForm');
    if (form) {
      form.dataset.aiCritique = t.aiCritique ? JSON.stringify(t.aiCritique) : '';
      form.dataset.scanConfidence = t.scanConfidence ? JSON.stringify(t.scanConfidence) : '';
    }
    // Load screenshots
    _pendingScreenshots = DB.getScreenshots(t);
    renderScreenshotPrev();
    // Restore rule checks
    if (t.ruleChecks) {
      const rules = DB.getRules();
      ['scalp','swing','longterm'].forEach(k => {
        (t.ruleChecks[k] || []).forEach((checked, i) => {
          const cb = document.getElementById(`fRuleCheck_${k}_${i}`);
          if (cb) cb.checked = !!checked;
        });
      });
      updateRulesCount();
    }
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

    // Pull AI scan extras from the stashed form datasets (set by openTradeModalPrefilled)
    const form = $('tradeForm');
    let aiCritique = null, scanConfidence = null;
    try { aiCritique     = form?.dataset.aiCritique     ? JSON.parse(form.dataset.aiCritique)     : null; } catch {}
    try { scanConfidence = form?.dataset.scanConfidence ? JSON.parse(form.dataset.scanConfidence) : null; } catch {}

    const data = {
      symbol: sym, direction: f('fDirection'),
      entry: f('fEntry'), sl: f('fSl'), tp: f('fTp'), size: f('fSize'),
      session: f('fSession'), htfBias: f('fHtfBias'),
      setupType, setupTypes,
      dateEnd: f('fDateEnd') || window._jb_pendingEndDate || '',
      preGrade: f('fPreGrade'), preGradeNotes: f('fPreGradeNotes'),
      exitPrice: f('fExitPrice'), result: f('fResult'), rMultiple,
      fees: f('fFees'),   // combined transaction costs: commission + funding (2026-07-11)
      postGrade: f('fPostGrade'), postGradeNotes: f('fPostGradeNotes'),
      notes: f('fNotes'),
      screenshotUrls: [..._pendingScreenshots],
      screenshotUrl: '',   // clear legacy field on save
      date: f('fDate'),
      time: f('fTime'),    // optional HH:MM — anchors the Trade View chart to the exact bar
      ruleChecks: collectRuleChecks(),
      setupRuleChecks: collectSetupRuleChecks(),
      aiCritique, scanConfidence,
    };

    const editId = f('tradeId');

    /* ── RISK CHARTER gate (2026-07-06) — NEW trades must carry the data
       contract: live SL (One Rule), size, setup tag, pre-grade. Edits of
       existing trades are exempt so historical fixes stay unblocked.
       Override = typed reason, flagged charterOverride → weekly review. */
    if (!editId) {
      const missing = [];
      if (!parseFloat(data.sl))   missing.push('Stop-loss (One Rule: no stop, no trade)');
      if (!parseFloat(data.size)) missing.push('Size');
      if (!setupTypes.length)     missing.push('Setup tag');
      if (!['A', 'B', 'C', 'D'].includes(data.preGrade)) missing.push('Pre-grade');
      if (missing.length) {
        const reason = window.prompt(
          '⛔ RISK CHARTER — missing:\n  • ' + missing.join('\n  • ') +
          '\n\nCancel to go back and fill them in (recommended).\n' +
          'To save anyway, type WHY — the override is flagged and appears in your weekly review.'
        );
        if (reason === null || !reason.trim()) {
          toast('Charter: fill SL / size / setup / pre-grade (or type an override reason)', 'error');
          return;
        }
        data.charterOverride = true;
        data.overrideReason  = reason.trim();
      }

      /* Regime gate (2026-07-11) — RegimeCard writes jb_regime; in RISK-OFF the
         charter prescription is A-grade only at half size (1R = $25). Soft gate:
         confirm + flag, never a silent block. */
      try {
        const reg = JSON.parse(localStorage.getItem('jb_regime') || 'null');
        const freshH = reg && reg.ts ? (Date.now() - new Date(reg.ts)) / 36e5 : 99;
        if (reg && reg.state === 'risk-off' && freshH < 24 && data.preGrade !== 'A') {
          const ok = window.confirm(
            '🌡️ REGIME: RISK-OFF\n' +
            'Prescription: A-grade only · half size (1R = $25).\n' +
            'This trade is graded "' + (data.preGrade || '—') + '".\n\nSave anyway? (flagged for weekly review)'
          );
          if (!ok) { toast('Regime gate: A-grade only while risk-off', 'error'); return; }
          data.regimeOverride = 'risk-off';
        }
      } catch {}
    }

    if (editId) {
      DB.updateTrade(editId, data);
      toast('Trade updated');
    } else {
      DB.addTrade(data);
      toast(data.charterOverride ? '⚠️ Saved with charter override — flagged for review' : 'Trade saved');
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
    loadTweaks();
    applyTweaks();
    wireTweaksPanel();
    dateRange = s.dateRange || '30';
    if (!RANGE_LABEL[dateRange]) dateRange = '30';   // normalize legacy 'custom'/'1'
    dataMode  = 'new';   // switcher removed 2026-07-15 — ignore any saved dataMode setting
    const _drLabel = $('dateRangeLabel');
    if (_drLabel) _drLabel.textContent = RANGE_LABEL[dateRange];
    document.querySelectorAll('#dateRangeMenu .pill-menu-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.range === dateRange);
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

    // Date range dropdown (single app-wide filter)
    const _drTrigger = $('dateRangeTrigger');
    const _drMenu    = $('dateRangeMenu');
    if (_drTrigger && _drMenu) {
      _drTrigger.addEventListener('click', e => {
        e.stopPropagation();
        _drMenu.classList.toggle('hidden');
      });
      _drMenu.querySelectorAll('.pill-menu-item').forEach(btn => {
        btn.addEventListener('click', () => applyDateFilter(btn.dataset.range));
      });
      // Close on outside click
      document.addEventListener('click', e => {
        if (!e.target.closest('#dateRangeDD')) _drMenu.classList.add('hidden');
      });
    }

    // 🖥 Open Local — shown only on remote hosts (Railway / github.io). The local
    // dashboard runs 24/7 via a launchd agent (com.jaybot.local-dashboard) that
    // serves localhost:8768 from a home-dir mirror, so this just opens the tab.
    // If the click lands on a blank "can't connect" tab, the Mac is asleep/off.
    const llBtn = $('launchLocalBtn');
    if (llBtn) {
      if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
        llBtn.style.display = 'none';   // already local — nothing to open
      } else {
        llBtn.addEventListener('click', () => { window.open('http://localhost:8768/', '_blank'); });
      }
    }

    // FAB + sidebar new trade button
    $('fab').addEventListener('click', () => openTradeModal());
    $('sidebarNewTrade').addEventListener('click', () => openTradeModal());

    // Trade modal
    $('tradeModalClose').addEventListener('click', closeTradeModal);
    $('tradeFormCancel').addEventListener('click', closeTradeModal);
    $('tradeFormSave').addEventListener('click', saveTradeForm);
    $('tradeModal').addEventListener('click', e => { if (e.target === $('tradeModal')) closeTradeModal(); });

    // Inline position sizer (2026-05-19 audit) — live calc on input change
    const acctKey = 'jb_sizer_acct', riskKey = 'jb_sizer_risk';
    const acctIn = $('fAcct'), riskIn = $('fRiskPct'), out = $('fSizerOut');
    if (acctIn && riskIn && out) {
      acctIn.value = localStorage.getItem(acctKey) || '';
      riskIn.value = localStorage.getItem(riskKey) || '1';
      const recalc = () => {
        const acct  = parseFloat(acctIn.value) || 0;
        const risk  = parseFloat(riskIn.value) || 0;
        const entry = parseFloat($('fEntry').value);
        const sl    = parseFloat($('fSl').value);
        if (acct > 0) localStorage.setItem(acctKey, acctIn.value);
        if (risk > 0) localStorage.setItem(riskKey, riskIn.value);
        if (!(acct > 0 && risk > 0 && entry > 0 && sl > 0)) {
          out.textContent = '— fill entry + SL';
          out.dataset.size = '';
          return;
        }
        const riskUsd  = acct * (risk / 100);
        const stopDist = Math.abs(entry - sl);
        if (stopDist === 0) { out.textContent = 'SL = entry'; out.dataset.size = ''; return; }
        const units    = riskUsd / stopDist;
        const notional = units * entry;
        out.innerHTML = `<span style="color:var(--accent,#7c5cff)">$${notional.toFixed(0)}</span> notional · <span style="color:var(--muted)">${units.toPrecision(4)} units · $${riskUsd.toFixed(0)} risk</span>`;
        out.dataset.size = notional.toFixed(2);
      };
      ['input','change'].forEach(ev => {
        acctIn.addEventListener(ev, recalc);
        riskIn.addEventListener(ev, recalc);
        $('fEntry').addEventListener(ev, recalc);
        $('fSl').addEventListener(ev, recalc);
      });
      $('fSizerApply').addEventListener('click', () => {
        const s = out.dataset.size;
        if (s) $('fSize').value = s;
      });
      // Recalc when modal opens
      const obs = new MutationObserver(() => {
        if (!$('tradeModal').classList.contains('hidden')) recalc();
      });
      obs.observe($('tradeModal'), { attributes: true, attributeFilter: ['class'] });
    }

    // Symbol custom field toggle
    $('fSymbol').addEventListener('change', e => {
      $('fSymbolCustomGroup').classList.toggle('hidden', e.target.value !== 'custom');
    });

    // Add tab modal
    $('addTabBtn')?.addEventListener('click', openAddTabModal);
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

    _toggleRulesPanel: () => {
      const body = $('fRulesBody'), chev = $('fRulesChevron');
      if (!body) return;
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      if (chev) chev.textContent = open ? '▼' : '▲';
    },
    _updateRulesCount: () => updateRulesCount(),

    _analyseSetup: async () => {
      const out    = $('fAnalyseOut');
      const status = $('fAnalyseStatus');
      const btn    = $('fAnalyseBtn');

      // Collect form values
      const f  = id => document.getElementById(id)?.value?.trim() ?? '';
      const sym = f('fSymbol') === 'custom' ? f('fSymbolCustom') : f('fSymbol');
      const dir = f('fDirection'), entry = f('fEntry'), sl = f('fSl'), tp = f('fTp');
      const session = f('fSession'), bias = f('fHtfBias'), notes = f('fNotes');
      const setups  = _pendingSetups.join(', ') || '(not specified)';

      // Collect rule checks
      const rules     = DB.getRules();
      const checks    = collectRuleChecks();
      let totalR = 0, doneR = 0;
      const ruleLines = ['scalp','swing','longterm'].map(k => {
        const meta  = RULE_SET_META[k];
        const items = rules[k] || [];
        const lines = items.map((r, i) => {
          const ticked = checks[k]?.[i];
          totalR++; if (ticked) doneR++;
          return `  [${ticked ? '✓' : '○'}] ${r.text}`;
        }).join('\n');
        return `${meta.label}:\n${lines || '  (none)'}`;
      }).join('\n\n');

      // Construct prompt
      const system = `You are an ICT trading coach reviewing a trade before entry. Be direct and concise. Format your reply in 3 clear sections: RULES CHECK, PROBABILITY, and KEY INSIGHT.`;
      const user   = `Review this trade:

SETUP:
• Symbol: ${sym} | Direction: ${dir}
• Entry: ${entry || 'n/a'} | SL: ${sl || 'n/a'} | TP: ${tp || 'n/a'}
• Session: ${session} | HTF Bias: ${bias}
• Setup type(s): ${setups}
• Notes: ${notes || 'none'}
• Self-checked rules: ${doneR}/${totalR}

MY RULES:
${ruleLines}

Please analyse:

**RULES CHECK** — For each rule category, state which rules appear MET ✓ and which are UNCERTAIN or BROKEN ✗ based on the trade details above. Be specific.

**PROBABILITY** — Give a probability band (Low <40%, Medium 40-60%, High 60-75%, Very High >75%) that this trade works out, with 2-3 reasons.

**KEY INSIGHT** — One important thing I should know before pressing the button.`;

      // Get image if available
      const lastImg = [..._pendingScreenshots].reverse().find(u => u.startsWith('data:image'));
      let imageData = null;
      if (lastImg) {
        const m = lastImg.match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (m) imageData = { mediaType: m[1], b64: m[2] };
      }

      btn.disabled = true;
      status.textContent = 'Analysing…';
      out.innerHTML = '';

      try {
        const { text } = await AICoachTab.callClaude({ system, user, maxTokens: 1200, imageData });
        // Render result as styled card
        const html = text
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\n/g, '<br>');
        const probMatch = text.match(/Very High|High|Medium|Low/i);
        const probLabel = probMatch ? probMatch[0] : null;
        const probColor = probLabel === 'Very High' ? '#22c55e'
                        : probLabel === 'High'      ? '#86efac'
                        : probLabel === 'Medium'    ? '#f59e0b'
                        : '#ef4444';
        out.innerHTML = `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;font-size:.83rem;line-height:1.6">
          ${probLabel ? `<div style="display:inline-block;background:${probColor}22;color:${probColor};border:1px solid ${probColor}55;border-radius:20px;padding:2px 12px;font-size:.75rem;font-weight:700;margin-bottom:10px">Probability: ${probLabel}</div>` : ''}
          <div>${html}</div>
        </div>`;
        status.textContent = imageData ? '📸 chart analysed' : '';
      } catch (e) {
        out.innerHTML = `<span style="color:var(--red);font-size:.82rem">⚠ ${e.message}</span>`;
        status.textContent = '';
      } finally {
        btn.disabled = false;
      }
    },

    _aiAutoTag: async () => {
      const out = $('fAutoTagOut');
      const btn = $('fAutoTagBtn');
      const localMode = localStorage.getItem('jb_ai_local') === 'on';

      // Local mode — no vision available; show inline description input
      if (localMode) {
        out.innerHTML = `
          <div style="margin-top:4px">
            <div style="font-size:.78rem;color:var(--muted);margin-bottom:5px">Local mode — describe your chart setup and Claude will tag it:</div>
            <textarea id="fAutoTagDesc" rows="2" placeholder="e.g. 15m BTC NY AM, swept equal highs, FVG at 94200, long bias…"
              style="width:100%;box-sizing:border-box;font-size:.82rem;padding:7px 9px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);resize:none;font-family:inherit"></textarea>
            <button type="button" class="btn-ghost btn-sm" style="margin-top:5px" onclick="App._aiAutoTagLocal()">✨ Analyze</button>
          </div>`;
        setTimeout(() => $('fAutoTagDesc')?.focus(), 50);
        return;
      }

      // API / vision mode
      const lastImg = [..._pendingScreenshots].reverse().find(u => u.startsWith('data:image'));
      if (!lastImg) { out.textContent = 'No image to tag'; return; }
      btn.disabled = true; out.innerHTML = '<span style="color:var(--gold)">✨ Analyzing chart…</span>';
      try {
        const r = await AICoachTab.autoTagImage(lastImg);
        out.innerHTML = App._autoTagResultHTML(r);
      } catch (e) { out.innerHTML = `<span style="color:var(--red)">⚠ ${e.message}</span>`; }
      finally { btn.disabled = false; }
    },

    _aiAutoTagLocal: async () => {
      const out    = $('fAutoTagOut');
      const desc   = $('fAutoTagDesc')?.value?.trim();
      if (!desc) { $('fAutoTagDesc')?.focus(); return; }
      const analyzeBtn = out.querySelector('button');
      if (analyzeBtn) { analyzeBtn.disabled = true; analyzeBtn.textContent = '⏳ Analyzing…'; }
      try {
        const r = await AICoachTab.autoTagFromText(desc);
        out.innerHTML = App._autoTagResultHTML(r);
      } catch (e) { out.innerHTML = `<span style="color:var(--red)">⚠ ${e.message}</span>`; }
    },

    _autoTagResultHTML: (r) => `<div class="ai-autotag-out">
      <div><strong>Setup:</strong> ${r.setup_type||'?'} · <strong>Direction:</strong> ${r.direction||'?'} · <strong>Session:</strong> ${r.session||'?'}</div>
      ${r.suggested_entry ? `<div><strong>Suggested entry:</strong> ${r.suggested_entry}${r.suggested_stop?` · <strong>Stop:</strong> ${r.suggested_stop}`:''}</div>` : ''}
      ${r.notes ? `<div class="text-sub" style="margin-top:4px">${r.notes}</div>` : ''}
      ${r.key_features?.length ? `<ul style="margin:6px 0 0 18px">${r.key_features.map(f=>`<li>${f}</li>`).join('')}</ul>` : ''}
      <button type="button" class="btn-ghost btn-sm" onclick="App._applyAutoTag(${JSON.stringify(r).replace(/"/g,'&quot;')})" style="margin-top:6px">⬇ Apply to form</button>
    </div>`,
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
        renderSetupRulesChecklist();
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

      // Base64 fallback — ALWAYS compress first (1200px webp) so a single
      // raw TradingView PNG (~0.5MB) doesn't blow the ~5MB localStorage quota.
      // Falls back to the raw file only if canvas encoding is unavailable.
      const toCompressedDataUrl = async (f) => {
        let blob = f;
        try {
          if (typeof R2 !== 'undefined' && R2.compressImage) blob = await R2.compressImage(f);
        } catch (err) {
          console.warn('compressImage failed, storing raw:', f.name, err.message);
          blob = f;
        }
        return await new Promise(res => { const r = new FileReader(); r.onload = ev => res(ev.target.result); r.readAsDataURL(blob); });
      };

      const newUrls = [];
      let r2Ok = 0, r2Fail = 0, lastErr = '';
      if (useR2) {
        toast(`Uploading ${valid.length} image${valid.length===1?'':'s'} to R2…`, 'info');
        for (const f of valid) {
          try {
            const r = await R2.upload(f);
            newUrls.push(r.url);
            r2Ok++;
          } catch (err) {
            r2Fail++; lastErr = err.message || String(err);
            console.warn('R2 upload failed, falling back to compressed base64:', f.name, lastErr);
            newUrls.push(await toCompressedDataUrl(f));
          }
        }
      } else {
        for (const f of valid) {
          newUrls.push(await toCompressedDataUrl(f));
        }
      }

      newUrls.forEach(u => { if (!_pendingScreenshots.includes(u)) _pendingScreenshots.push(u); });
      renderScreenshotPrev();
      if (useR2 && r2Fail > 0) {
        toast(`R2 failed for ${r2Fail}/${valid.length} — using base64 fallback. ${lastErr.slice(0,120)}`, 'error');
      } else if (useR2) {
        toast(`${r2Ok} image${r2Ok===1?'':'s'} uploaded to R2`);
      } else {
        toast(`${newUrls.length} image${newUrls.length===1?'':'s'} attached (local base64)`);
      }
      e.target.value = '';
    },
    _removeScreenshot: (idx) => {
      _pendingScreenshots.splice(idx, 1);
      renderScreenshotPrev();
    },
    _removeSetup: (idx) => {
      _pendingSetups.splice(idx, 1);
      renderSetupChips();
      renderSetupRulesChecklist();
    },
    _updateSetupRuleCount: (sid) => updateSetupRuleCount(sid),
    openTradeModal,
    openTradeModalPrefilled,
    closeTradeModal,
    confirmDelete,
    toast,
    buildNav,
    renderTab,
    // Scan trade modal
    openScanModal,
    closeScanModal,
    _scanHandleFile,
    _scanAnalyze,
    _scanAnalyzeLocal,
    _scanReset,
    _scanCommit,
    _scanAddPlaybookSuggestion,
    _scanDismissPlaybookSuggestion,
  };

})();

/* ── Boot ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', App.init);
