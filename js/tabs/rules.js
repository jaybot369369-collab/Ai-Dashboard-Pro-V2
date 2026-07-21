/* ═══════════════════════════════════════════════════════════
   RULES TAB  (v2 visual redesign — 2026-05-17)
   Editable trading rules for scalp / swing / long-term
   Layout: .page-head hero + .hi-card compliance hero + rule cards
════════════════════════════════════════════════════════════ */
const RulesTab = (() => {

  let _draft = null; // working copy of rules being edited

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function load() {
    _draft = DB.getRules();
  }

  /* ── Compliance computation ───────────────────────────── */
  function _complianceStats() {
    const sets = ['scalp','swing','longterm'];
    let totalEnabled = 0, totalItems = 0;
    const bySet = {};
    sets.forEach(k => {
      const items = _draft[k] || [];
      const enabled = items.filter(r => r.enabled !== false).length;
      bySet[k] = { enabled, total: items.length };
      totalEnabled += enabled;
      totalItems   += items.length;
    });
    const pct = totalItems > 0 ? Math.round((totalEnabled / totalItems) * 100) : 100;
    return { totalEnabled, totalItems, pct, bySet };
  }

  /* ── Config: key → display label + accent color ───────── */
  const RULESET_CONFIG = {
    scalp:    { label: 'Pre-trade rules',   color: '#7c5cff', sub: 'Conditions before entering any trade' },
    swing:    { label: 'Risk rules',         color: '#ef4444', sub: 'Position sizing and loss management rules' },
    longterm: { label: 'Psychology rules',   color: '#f59e0b', sub: 'Mindset and discipline commitments' },
  };

  /* ── Main render ──────────────────────────────────────── */
  function render() {
    load();
    const content = document.getElementById('content');
    const stats = _complianceStats();
    const overallPct = stats.pct;

    // Hero bar color based on compliance
    const barColor = overallPct >= 80 ? '#22c55e' : overallPct >= 50 ? '#f59e0b' : '#ef4444';

    content.innerHTML = `
      <!-- Page header -->
      <div class="page-head">
        <div>
          <h1>Rules</h1>
          <div class="page-head-sub">${stats.totalEnabled} of ${stats.totalItems} active · ${stats.pct}% compliance</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-ghost btn-sm" onclick="RulesTab._reset()">↺ Reset</button>
          <button class="btn-primary btn-sm" id="rulesSaveBtn" onclick="RulesTab._save()">Save</button>
        </div>
      </div>

      <!-- Compliance hero card -->
      <div class="hi-card" style="display:flex;align-items:center;gap:32px;margin-bottom:24px;padding:24px 28px">
        <div style="flex:0 0 auto;text-align:center">
          <div style="font-size:3rem;font-weight:800;line-height:1;color:#fff">${overallPct}%</div>
          <div style="font-size:.75rem;color:rgba(255,255,255,.6);margin-top:4px;text-transform:uppercase;letter-spacing:.06em">Compliance</div>
          <div style="margin-top:10px;height:4px;width:80px;background:rgba(255,255,255,.15);border-radius:2px;overflow:hidden">
            <div style="height:100%;width:${overallPct}%;background:${barColor};border-radius:2px;transition:width .4s"></div>
          </div>
        </div>
        <div style="width:1px;height:56px;background:rgba(255,255,255,.12)"></div>
        <div style="display:flex;gap:24px;flex:1">
          <div style="text-align:center">
            <div style="font-size:1.4rem;font-weight:700;color:#a78bfa">${stats.bySet.scalp.enabled}/${stats.bySet.scalp.total}</div>
            <div style="font-size:.72rem;color:rgba(255,255,255,.5);margin-top:2px">Pre-trade</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:1.4rem;font-weight:700;color:#f87171">${stats.bySet.swing.enabled}/${stats.bySet.swing.total}</div>
            <div style="font-size:.72rem;color:rgba(255,255,255,.5);margin-top:2px">Risk</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:1.4rem;font-weight:700;color:#fbbf24">${stats.bySet.longterm.enabled}/${stats.bySet.longterm.total}</div>
            <div style="font-size:.72rem;color:rgba(255,255,255,.5);margin-top:2px">Psychology</div>
          </div>
        </div>
      </div>

      <!-- Rule cards grid -->
      <div style="display:grid;gap:16px">
        ${renderRuleSet('scalp')}
        ${renderRuleSet('swing')}
        ${renderRuleSet('longterm')}
      </div>
    `;
  }

  /* ── Rule-set card ────────────────────────────────────── */
  function renderRuleSet(key) {
    const cfg   = RULESET_CONFIG[key];
    const items = _draft[key] || [];
    return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title" style="color:${cfg.color}">${cfg.label}</div>
          <div style="font-size:.75rem;color:var(--text-dim);margin-top:2px">${cfg.sub}</div>
        </div>
        <button class="btn-ghost btn-sm" onclick="RulesTab._addRule('${key}')">＋ Add Rule</button>
      </div>
      <div id="rules-list-${esc(key)}" data-set="${esc(key)}">
        ${items.map((item, i) => ruleRow(key, item, i)).join('')}
      </div>
    </div>`;
  }

  /* ── Individual rule row (module-level, called by _addRule/_removeRule) */
  function ruleRow(key, item, i) {
    const cfg     = RULESET_CONFIG[key] || { color: '#7c5cff' };
    const enabled = item.enabled !== false;
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-sub)" data-key="${esc(key)}" data-idx="${i}">
      <input type="checkbox" ${enabled?'checked':''} onchange="RulesTab._toggleRule('${key}',${i})"
             style="accent-color:${cfg.color};width:16px;height:16px;flex-shrink:0;cursor:pointer" />
      <input type="text" value="${esc(item.text||'')}"
             oninput="RulesTab._editRule('${key}',${i},this.value)"
             placeholder="Type a rule…"
             style="flex:1;background:transparent;border:none;outline:none;font-size:.85rem;color:var(--text-primary);${enabled?'':'opacity:.45'}" />
      <span style="font-size:.68rem;font-weight:600;padding:2px 7px;border-radius:10px;background:${enabled?'rgba(34,197,94,.15)':'rgba(255,255,255,.06)'};color:${enabled?'#22c55e':'var(--text-dim)'}">
        ${enabled?'ON':'OFF'}
      </span>
      <button onclick="RulesTab._removeRule('${key}',${i})"
              style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:.9rem;padding:0 4px;line-height:1" title="Delete">✕</button>
    </div>`;
  }

  /* ── Embeddable card (mounted on the Trade Log tab) ───── */
  /* Collapsible "My Rules" editor that reuses every edit handler below.
     Placed at the top of the Trade Log tab so rules live next to trades.
     Open/closed state persists in localStorage jb_rules_card_open. */
  let _cardOpen = null;
  function _isOpen() {
    if (_cardOpen === null) {
      try { _cardOpen = localStorage.getItem('jb_rules_card_open') === '1'; }
      catch (_) { _cardOpen = false; }
    }
    return _cardOpen;
  }

  function _cardBodyHTML() {
    return `<div style="display:grid;gap:14px;padding-top:6px">
      ${renderRuleSet('scalp')}
      ${renderRuleSet('swing')}
      ${renderRuleSet('longterm')}
    </div>`;
  }

  function _cardHTML() {
    load();
    const stats = _complianceStats();
    const open = _isOpen();
    return `
      <div class="card rules-embed-card" id="rulesEmbedCard" style="margin-bottom:16px">
        <div class="card-head" style="cursor:pointer;margin-bottom:0" onclick="RulesTab._toggleCard()">
          <div>
            <div class="card-title"><span class="card-emoji">📋</span>My Rules
              <span class="badge badge-dim" style="font-weight:400;margin-left:6px">${stats.totalEnabled}/${stats.totalItems} active · ${stats.pct}%</span>
            </div>
            <div class="card-sub">Your pre-trade, risk &amp; psychology checklist — edit freely; saved to this browser</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center" onclick="event.stopPropagation()">
            <button class="btn-ghost btn-sm" onclick="RulesTab._reset()">↺ Reset</button>
            <button class="btn-primary btn-sm" id="rulesSaveBtn" onclick="RulesTab._save()">Save</button>
            <span id="rulesCardChevron" style="font-size:.85rem;color:var(--text-dim);transition:transform .2s;display:inline-block;transform:rotate(${open ? 90 : 0}deg)">▸</span>
          </div>
        </div>
        <div id="rulesCardBody" style="${open ? '' : 'display:none'}">${_cardBodyHTML()}</div>
      </div>`;
  }

  function _rerenderCard() {
    const body = document.getElementById('rulesCardBody');
    if (body) body.innerHTML = _cardBodyHTML();
    // refresh the compliance badge in the header
    const badge = document.querySelector('#rulesEmbedCard .card-title .badge');
    if (badge) { const s = _complianceStats(); badge.textContent = `${s.totalEnabled}/${s.totalItems} active · ${s.pct}%`; }
  }

  /* ── Flash saved feedback ─────────────────────────────── */
  function flashSaved() {
    const btn = document.getElementById('rulesSaveBtn');
    if (!btn) return;
    const orig = btn.innerHTML;
    btn.innerHTML = '✓ Saved';
    btn.classList.add('saved');
    setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('saved'); }, 1500);
  }

  /* ── Public API ───────────────────────────────────────── */
  return {
    render,
    _cardHTML,
    _toggleCard: () => {
      _cardOpen = !_isOpen();
      try { localStorage.setItem('jb_rules_card_open', _cardOpen ? '1' : '0'); } catch (_) {}
      const body = document.getElementById('rulesCardBody');
      const chev = document.getElementById('rulesCardChevron');
      if (body) body.style.display = _cardOpen ? '' : 'none';
      if (chev) chev.style.transform = `rotate(${_cardOpen ? 90 : 0}deg)`;
    },
    _toggleRule: (key, i) => {
      _draft[key][i].enabled = !(_draft[key][i].enabled !== false);
    },
    _editRule: (key, i, val) => {
      _draft[key][i].text = val;
    },
    _addRule: key => {
      _draft[key].push({ text: '', enabled: true });
      const el = document.getElementById(`rules-list-${key}`);
      if (el) el.insertAdjacentHTML('beforeend', ruleRow(key, _draft[key].at(-1), _draft[key].length-1));
      // Focus the new input
      setTimeout(() => {
        const inputs = document.querySelectorAll(`[data-set="${key}"] input[type="text"]`);
        inputs[inputs.length-1]?.focus();
      }, 50);
    },
    _removeRule: (key, i) => {
      if (!_draft[key]) return;
      _draft[key].splice(i, 1);
      // Re-render just this rule set's list without calling load()
      // (which would overwrite _draft from DB and lose the splice)
      const list = document.getElementById(`rules-list-${key}`);
      if (list) {
        list.innerHTML = (_draft[key] || []).map((item, idx) => ruleRow(key, item, idx)).join('');
      }
    },
    _save: () => {
      // Strip empty rules
      ['scalp','swing','longterm'].forEach(k => {
        _draft[k] = (_draft[k]||[]).filter(r => r.text && r.text.trim());
      });
      DB.saveRules(_draft);
      App.toast('Rules saved');
      flashSaved();
      // Embedded card: re-render so stripped-empty rows drop + badge updates.
      if (document.getElementById('rulesCardBody')) _rerenderCard();
    },
    _reset: () => {
      App.confirmDelete('Reset all rules back to the defaults? Your edits will be lost.', () => {
        DB.resetRules();
        App.toast('Rules reset to defaults');
        // Embedded on the Trade Log tab → re-render just the card; else full page.
        if (document.getElementById('rulesCardBody')) { load(); _rerenderCard(); }
        else render();
      });
    },
  };
})();
