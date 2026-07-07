/* ═══════════════════════════════════════════════════════════
   🧠 CONTEXT TAB — editable "who I am" docs feeding every AI layer
   (Trading-OS style settings: Trader Profile · Theme Map · Catalyst Rules)

   Storage: localStorage jb_ctx_profile / jb_ctx_themes / jb_ctx_catalyst
   (+ jb_ctx_meta for last-edited stamps). Shipped defaults live in
   js/data/context_defaults.js (window.CONTEXT_DEFAULTS) and are used
   whenever a key is unset — "Restore default" simply clears the key.

   Consumers:
   - In-app AI features read live text via ContextTab.getDoc(id).
   - Python layers (morning brief, report skills) read the mirror files
     written by automation/export_trader_context.py from the weekly
     Pro Tools full-backup export (which dumps all jb_* keys).

   Risk is deliberately NOT editable here: RISK_CHARTER.md is the risk
   contract and per its own rules changes only inside a weekly review.
═══════════════════════════════════════════════════════════ */
const ContextTab = (() => {

  const META_KEY = 'jb_ctx_meta';
  const DOCS = [
    {
      id: 'profile', key: 'jb_ctx_profile', title: '👤 Trader Profile',
      desc: 'Who you are as a trader — style, instruments, sessions, risk summary, tendencies, goals, and how AI should speak to you. Injected into coach + morning-brief prompts.',
    },
    {
      id: 'themes', key: 'jb_ctx_themes', title: '🧭 Theme Map',
      desc: 'The fixed menu of storylines you track: theme → definition → coins. AI layers may only tag themes from this list — anything else must be "Unclassified".',
    },
    {
      id: 'catalyst', key: 'jb_ctx_catalyst', title: '🗓 Catalyst Rules',
      desc: 'How events are weighed: confirmed/likely/rumored tiers, 7-day proximity, the 60-min pre-news no-entry window, ranking, ghost checks.',
    },
  ];

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  const toast = (m, ty) => { if (typeof App !== 'undefined' && App.toast) App.toast(m, ty); };

  function _defaults() { return (typeof CONTEXT_DEFAULTS !== 'undefined') ? CONTEXT_DEFAULTS : {}; }
  function _doc(id)    { return DOCS.find(x => x.id === id); }

  /* Live text for a doc — user copy if saved, else shipped default.
     Public: other modules inject this into their AI prompts. */
  function getDoc(id) {
    const d = _doc(id); if (!d) return '';
    const v = localStorage.getItem(d.key);
    return (v !== null && v.trim() !== '') ? v : (_defaults()[id] || '');
  }
  function isCustom(id) {
    const d = _doc(id);
    return !!(d && localStorage.getItem(d.key) !== null);
  }

  function _meta() {
    try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); }
    catch (_) { return {}; }
  }
  function _stamp(id, source) {
    const m = _meta();
    m[id] = { ts: Date.now(), source };
    localStorage.setItem(META_KEY, JSON.stringify(m));
  }
  function _stampLabel(id) {
    const m = _meta()[id];
    if (!m) return isCustom(id) ? 'edited (no stamp)' : 'shipped default — not edited yet';
    const iso = new Date(m.ts).toISOString().slice(0, 16).replace('T', ' ');
    return (m.source === 'user' ? 'saved ' : 'default restored ') + iso + ' UTC';
  }

  function _save(id) {
    const d = _doc(id);
    const ta = document.getElementById('ctx-ta-' + id);
    if (!d || !ta) return;
    localStorage.setItem(d.key, ta.value);
    _stamp(id, 'user');
    toast(d.title.slice(d.title.indexOf(' ') + 1) + ' saved', 'success');
    render();
  }

  function _restore(id) {
    const d = _doc(id); if (!d) return;
    if (!confirm('Replace your edited version with the shipped default? Your current text will be lost.')) return;
    localStorage.removeItem(d.key);
    _stamp(id, 'default');
    toast('Restored shipped default', 'warn');
    render();
  }

  function _card(d) {
    return `
    <div class="card ctx-card">
      <div class="ctx-doc-head">
        <div>
          <h3 style="margin:0 0 4px">${d.title}</h3>
          <p class="text-sub" style="font-size:.8rem;margin:0">${esc(d.desc)}</p>
        </div>
        <span class="ctx-stamp ${isCustom(d.id) ? 'is-custom' : ''}">${esc(_stampLabel(d.id))}</span>
      </div>
      <textarea id="ctx-ta-${d.id}" class="ctx-ta" spellcheck="false">${esc(getDoc(d.id))}</textarea>
      <div class="ctx-doc-foot">
        <button class="btn-primary" onclick="ContextTab._save('${d.id}')">💾 Save</button>
        <button class="btn-ghost" onclick="ContextTab._restore('${d.id}')">↩ Restore default</button>
      </div>
    </div>`;
  }

  function render() {
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="page-head">
        <div>
          <h2 style="margin:0 0 4px">🧠 Context — teach the AI who you are</h2>
          <p class="text-sub" style="margin:0;font-size:.85rem">
            These documents feed every AI layer (coach, morning brief, reports). Edit + Save anytime —
            the AI only tags what you define here. Boundaries beat freedom.
          </p>
        </div>
      </div>
      <div class="card" style="padding:12px 16px;margin-bottom:14px">
        <p class="text-sub" style="font-size:.8rem;margin:0;line-height:1.6">
          🔒 <strong>Risk is not editable here.</strong> RISK_CHARTER.md (repo root) is the risk contract —
          per its own rules it changes only inside a weekly review.<br>
          🔁 <strong>Reaching the Python layers:</strong> these docs travel in your weekly Pro Tools →
          Full backup export. After exporting, <code>python3 automation/export_trader_context.py</code>
          refreshes the <code>context/</code> mirror files (the morning brief also runs it automatically).
        </p>
      </div>
      ${DOCS.map(_card).join('')}
    `;
  }

  return { render, getDoc, isCustom, _save, _restore };
})();
