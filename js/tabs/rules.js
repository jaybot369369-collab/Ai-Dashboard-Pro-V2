/* ═══════════════════════════════════════════════════════════
   RULES TAB  (v2 visual redesign — 2026-05-17)
   Editable trading rules for scalp / swing / long-term
   + Daily Pre-Trade Checklist (checkbox panel, resets daily)
   Layout: .page-head hero + .hi-card compliance hero + rule cards
════════════════════════════════════════════════════════════ */
const RulesTab = (() => {

  let _draft = null;          // working copy of rules being edited
  let _checklistDraft = null; // working copy of today's checklist

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function load() {
    _draft = DB.getRules();
    _checklistDraft = DB.getChecklist();
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
    const activeCount = _checklistDraft.items.filter(i => i.checked).length;
    const totalRules   = stats.totalItems + _checklistDraft.items.length;
    const activeRules  = stats.totalEnabled + activeCount;
    const overallPct   = totalRules > 0 ? Math.round((activeRules / totalRules) * 100) : 100;

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
        ${renderChecklist()}
        ${renderRuleSet('scalp')}
        ${renderRuleSet('swing')}
        ${renderRuleSet('longterm')}
      </div>
    `;
  }

  /* ── Checklist card ───────────────────────────────────── */
  function renderChecklist() {
    const items = _checklistDraft.items;
    const done  = items.filter(i => i.checked).length;
    const total = items.length;
    return `
    <div class="card">
      <div class="card-header">
        <div class="card-title">📋 Daily Pre-Trade Checklist</div>
        <div style="font-size:.78rem;color:var(--text-dim)">${done}/${total} done · resets at midnight</div>
      </div>
      <div>
        ${items.map((item, i) => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-sub)">
            <input type="checkbox" ${item.checked?'checked':''} onchange="RulesTab._toggleCheck(${i})"
                   style="accent-color:#7c5cff;width:16px;height:16px;flex-shrink:0;cursor:pointer" />
            <span style="flex:1;font-size:.85rem;${item.checked?'text-decoration:line-through;color:var(--text-dim)':''}">${esc(item.text)}</span>
            <span style="font-size:.68rem;font-weight:600;padding:2px 7px;border-radius:10px;background:${item.checked?'rgba(34,197,94,.15)':'rgba(255,255,255,.06)'};color:${item.checked?'#22c55e':'var(--text-dim)'}">
              ${item.checked?'ON':'–'}
            </span>
          </div>
        `).join('')}
      </div>
    </div>`;
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
    _toggleCheck: i => {
      _checklistDraft.items[i].checked = !_checklistDraft.items[i].checked;
      DB.saveChecklist(_checklistDraft.items);
      render();
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
    },
    _reset: () => {
      App.confirmDelete('Reset all rules back to the defaults? Your edits will be lost.', () => {
        DB.resetRules();
        App.toast('Rules reset to defaults');
        render();
      });
    },
  };
})();
