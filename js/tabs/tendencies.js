/* ═══════════════════════════════════════════════════════════
   TENDENCIES — merged Mistakes + Strengths
   Same card UI as before, sub-nav switches between the two lists.
════════════════════════════════════════════════════════════ */
const TendenciesTab = (() => {

  let _sub = localStorage.getItem('jb_tend_sub') || 'mistakes';
  const _safeId = id => /^[A-Za-z0-9_-]+$/.test(id) ? id : '';

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function saveSub(s) { _sub = s; localStorage.setItem('jb_tend_sub', s); }

  /* ── Card grid renderer (works for both kinds) ──────── */
  function renderGrid(kind) {
    const items = kind === 'mistakes' ? DB.getMistakes() : DB.getStrengths();
    const isMis = kind === 'mistakes';
    const accent = isMis ? 'var(--red)' : 'var(--green)';
    const accentBg = isMis ? 'rgba(255,80,90,.08)' : 'rgba(0,200,150,.08)';
    const addLabel = isMis ? '＋ Add Mistake' : '＋ Add Strength';
    if (!items.length) {
      return `<div class="empty-state"><div class="empty-icon">${isMis?'⚠️':'💪'}</div>
        <p>No ${isMis?'mistakes':'strengths'} logged yet.</p>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:12px">
          <button class="btn-primary" onclick="TendenciesTab._autoAnalyze()">🧠 Auto-Analyze My Trades</button>
          <button class="btn-ghost" onclick="TendenciesTab._add('${kind}')">${addLabel}</button>
        </div>
        <p class="text-dim" style="font-size:.78rem;margin-top:14px">Auto-Analyze scans every closed trade and surfaces patterns: worst/best session, worst/best setup, revenge trading, win/loss streaks, R-multiple consistency.</p>
      </div>`;
    }
    return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap">
        <button class="btn-ghost btn-sm" onclick="TendenciesTab._autoAnalyze()" title="Scan all your trades and auto-detect patterns">🧠 Auto-Analyze Trades</button>
        <button class="btn-primary btn-sm" onclick="TendenciesTab._add('${kind}')">${addLabel}</button>
      </div>
      <div class="tend-grid">
        ${items.map(it => {
          const sid = _safeId(it.id);
          return `<div class="tend-card" style="border-left:3px solid ${accent};background:${accentBg}">
          <div class="tend-card-hdr">
            <div class="tend-title" contenteditable="true" data-id="${esc(sid)}" data-kind="${kind}" data-field="title" oninput="TendenciesTab._edit(event)">${esc(it.title || '(untitled)')}</div>
            <div class="tend-card-actions">
              <span class="tend-counter" title="Times seen">×${it.seenCount || 0}</span>
              <button class="btn-ghost btn-sm" onclick="TendenciesTab._inc('${kind}','${sid}')" title="+1 occurrence">＋</button>
              <button class="btn-ghost btn-sm" onclick="TendenciesTab._delete('${kind}','${sid}')" title="Delete">✕</button>
            </div>
          </div>
          <div class="tend-desc" contenteditable="true" data-id="${esc(sid)}" data-kind="${kind}" data-field="description" oninput="TendenciesTab._edit(event)">${esc(it.description || '')}</div>
          <div class="tend-meta">
            <span class="text-dim">Last seen: ${esc(it.lastSeen) || '—'}</span>
            <span class="text-dim" style="margin-left:auto">Linked trades: ${(it.linkedTradeIds||[]).length}</span>
          </div>
        </div>`;
        }).join('')}
      </div>`;
  }

  /* ── Public render ──────────────────────────────────── */
  function render() {
    const content = document.getElementById('content');
    content.innerHTML = `<div class="tend-wrap">
      <div class="tend-subnav">
        <button class="tend-sub-btn${_sub==='mistakes' ?' active mistakes':''}" data-sub="mistakes">⚠️ Mistakes</button>
        <button class="tend-sub-btn${_sub==='strengths'?' active strengths':''}" data-sub="strengths">💪 Strengths</button>
      </div>
      <div id="tendBody">${renderGrid(_sub)}</div>
    </div>`;
    document.querySelectorAll('.tend-sub-btn').forEach(b => {
      b.addEventListener('click', () => { saveSub(b.dataset.sub); render(); });
    });
  }

  /* ── Edit / CRUD wiring ─────────────────────────────── */
  // Per-element timers so editing field A then quickly editing field B
  // doesn't cancel A's pending save (the previous module-wide single timer
  // would lose A's edit).
  const _pendingTimers = new WeakMap();
  function _edit(e) {
    const el = e.target;
    const { id, kind, field } = el.dataset;
    const prev = _pendingTimers.get(el);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      _pendingTimers.delete(el);
      const items = kind === 'mistakes' ? DB.getMistakes() : DB.getStrengths();
      const it = items.find(x => x.id === id);
      if (!it) return;
      it[field] = el.textContent.trim();
      if (kind === 'mistakes') DB.saveMistakes(items); else DB.saveStrengths(items);
    }, 400);
    _pendingTimers.set(el, timer);
  }

  function _add(kind) {
    const title = prompt(`New ${kind === 'mistakes' ? 'mistake' : 'strength'} title:`);
    if (!title) return;
    const items = kind === 'mistakes' ? DB.getMistakes() : DB.getStrengths();
    const newItem = {
      id: 'tend_' + Date.now(),
      title: title.trim(),
      description: '',
      dateAdded: new Date().toISOString().slice(0,10),
      seenCount: 0,
      lastSeen: '',
      linkedTradeIds: [],
    };
    items.push(newItem);
    if (kind === 'mistakes') DB.saveMistakes(items); else DB.saveStrengths(items);
    render();
  }

  function _delete(kind, id) {
    if (!confirm('Delete this entry?')) return;
    let items = kind === 'mistakes' ? DB.getMistakes() : DB.getStrengths();
    items = items.filter(x => x.id !== id);
    if (kind === 'mistakes') DB.saveMistakes(items); else DB.saveStrengths(items);
    render();
  }

  function _inc(kind, id) {
    const items = kind === 'mistakes' ? DB.getMistakes() : DB.getStrengths();
    const it = items.find(x => x.id === id);
    if (!it) return;
    it.seenCount = (it.seenCount || 0) + 1;
    it.lastSeen = new Date().toISOString().slice(0,10);
    if (kind === 'mistakes') DB.saveMistakes(items); else DB.saveStrengths(items);
    render();
  }

  function _autoAnalyze() {
    const trades = DB.getTrades();
    if (!trades.length) { alert('No trades to analyze yet — log some trades first.'); return; }
    const found = DB.analyzePatterns(trades);
    if (!found.mistakes.length && !found.strengths.length) {
      alert('No clear patterns found yet. Need at least 5 trades per session/setup to surface a tendency.');
      return;
    }
    const stamp = new Date().toISOString().slice(0,10);
    // MISTAKES — merge: skip duplicates by title
    const existingM = DB.getMistakes();
    const exM = new Set(existingM.map(x => x.title));
    const newMistakes = found.mistakes.filter(m => !exM.has(m.title)).map(m => ({
      id: 'auto_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      title: m.title, description: m.description,
      seenCount: m.seenCount || 0, lastSeen: m.lastSeen || stamp,
      linkedTradeIds: m.linkedTradeIds || [], dateAdded: stamp, auto: true,
    }));
    if (newMistakes.length) DB.saveMistakes([...existingM, ...newMistakes]);

    const existingS = DB.getStrengths();
    const exS = new Set(existingS.map(x => x.title));
    const newStrengths = found.strengths.filter(s => !exS.has(s.title)).map(s => ({
      id: 'auto_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      title: s.title, description: s.description,
      seenCount: s.seenCount || 0, lastSeen: s.lastSeen || stamp,
      linkedTradeIds: s.linkedTradeIds || [], dateAdded: stamp, auto: true,
    }));
    if (newStrengths.length) DB.saveStrengths([...existingS, ...newStrengths]);

    if (typeof toast === 'function') toast(`Added ${newMistakes.length} mistake${newMistakes.length===1?'':'s'} + ${newStrengths.length} strength${newStrengths.length===1?'':'s'}`, 'success');
    render();
  }

  return { render, _edit, _add, _delete, _inc, _autoAnalyze };
})();
