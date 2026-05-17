/* ═══════════════════════════════════════════════════════════
   TENDENCIES — Analytics + Mistakes/Strengths
   Analytics section: P&L by DOW, By Session, By Setup, Direction
   Below: sub-nav switches Mistakes / Strengths (existing CRUD).
════════════════════════════════════════════════════════════ */
const TendenciesTab = (() => {

  let _sub = localStorage.getItem('jb_tend_sub') || 'mistakes';
  const _safeId = id => /^[A-Za-z0-9_-]+$/.test(id) ? id : '';

  // Chart instances — destroyed before recreating
  let _dowChart = null;
  let _dirChart = null;

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function saveSub(s) { _sub = s; localStorage.setItem('jb_tend_sub', s); }

  /* ── Data helpers ───────────────────────────────────────── */
  function _groupByDOW(trades) {
    const map = {};
    trades.forEach(t => {
      if (!t.date) return;
      const d = new Date(t.date + 'T12:00:00Z');
      const day = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()];
      if (!map[day]) map[day] = 0;
      map[day] += parseFloat(t.result || 0);
    });
    return ['Mon','Tue','Wed','Thu','Fri'].map(d => ({ day: d, pl: map[d] || 0 }));
  }

  function _groupBySession(trades) {
    const map = {};
    trades.forEach(t => {
      const k = t.session || 'Other';
      if (!map[k]) map[k] = { pl: 0, wins: 0, count: 0 };
      const r = parseFloat(t.result || 0);
      map[k].pl += r; map[k].count++;
      if (r > 0) map[k].wins++;
    });
    return Object.entries(map)
      .map(([s, v]) => ({ session: s, pl: v.pl, wr: v.count ? Math.round((v.wins/v.count)*100) : 0 }))
      .sort((a, b) => b.pl - a.pl);
  }

  function _groupBySetup(trades) {
    const map = {};
    trades.forEach(t => {
      const k = t.setupType || t.setupTypes?.[0] || 'Untagged';
      if (!map[k]) map[k] = 0;
      map[k] += parseFloat(t.result || 0);
    });
    return Object.entries(map).map(([s, pl]) => ({ setup: s, pl })).sort((a, b) => b.pl - a.pl).slice(0, 6);
  }

  function _groupByDir(trades) {
    const longs = trades.filter(t => t.direction === 'Long');
    const shorts = trades.filter(t => t.direction === 'Short');
    const lPL = longs.reduce((s, t) => s + parseFloat(t.result || 0), 0);
    const sPL = shorts.reduce((s, t) => s + parseFloat(t.result || 0), 0);
    const tot = longs.length + shorts.length;
    return { longs: longs.length, shorts: shorts.length, lPL, sPL, longPct: tot ? Math.round(longs.length/tot*100) : 0 };
  }

  function fmtPL(n) {
    return (n >= 0 ? '+$' : '-$') + Math.abs(n).toFixed(2);
  }

  /* ── Chart renderers ────────────────────────────────────── */
  function _drawDOW(dowData) {
    const canvas = document.getElementById('tendDOW');
    if (!canvas) return;
    if (_dowChart) { _dowChart.destroy(); _dowChart = null; }
    const colors = dowData.map(d => d.pl >= 0 ? '#22c55e' : '#ef4444');
    _dowChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: dowData.map(d => d.day),
        datasets: [{
          data: dowData.map(d => d.pl),
          backgroundColor: colors,
          borderRadius: 4,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: {
          callbacks: { label: ctx => fmtPL(ctx.raw) }
        }},
        scales: {
          x: { grid: { display: false }, ticks: { color: '#888', font: { size: 11 } } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#888', font: { size: 10 }, callback: v => '$' + v } }
        }
      }
    });
  }

  function _drawDir(dirData) {
    const canvas = document.getElementById('tendDir');
    if (!canvas) return;
    if (_dirChart) { _dirChart.destroy(); _dirChart = null; }
    const hasData = dirData.longs + dirData.shorts > 0;
    _dirChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Long', 'Short'],
        datasets: [{
          data: hasData ? [dirData.longs, dirData.shorts] : [1, 1],
          backgroundColor: hasData ? ['#22c55e', '#ef4444'] : ['#333', '#333'],
          borderWidth: 0,
          hoverOffset: 4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: { legend: { display: false }, tooltip: { enabled: hasData } }
      }
    });
  }

  /* ── Analytics section HTML ─────────────────────────────── */
  function _renderAnalytics(trades) {
    const dowData     = _groupByDOW(trades);
    const sessionData = _groupBySession(trades);
    const setupData   = _groupBySetup(trades);
    const dirData     = _groupByDir(trades);

    const maxSessPL   = sessionData.length ? Math.max(...sessionData.map(s => Math.abs(s.pl)), 1) : 1;
    const maxSetupPL  = setupData.length   ? Math.max(...setupData.map(s => Math.abs(s.pl)), 1)   : 1;

    const sessionRows = sessionData.length
      ? sessionData.map(s => {
          const pct = Math.round(Math.abs(s.pl) / maxSessPL * 100);
          const color = s.pl >= 0 ? '#a855f7' : '#ef4444';
          return `<div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <span style="font-size:.82rem;font-weight:600;color:var(--text)">${esc(s.session)}</span>
              <div style="display:flex;gap:8px;align-items:center">
                <span style="font-size:.75rem;color:#888">${s.wr}% WR</span>
                <span style="font-size:.82rem;font-weight:600;color:${s.pl>=0?'#22c55e':'#ef4444'}">${fmtPL(s.pl)}</span>
              </div>
            </div>
            <div style="height:5px;border-radius:3px;background:rgba(255,255,255,0.08)">
              <div style="height:100%;width:${pct}%;border-radius:3px;background:${color};transition:width .4s"></div>
            </div>
          </div>`;
        }).join('')
      : `<div class="text-dim" style="font-size:.8rem;padding:8px 0">No session data yet</div>`;

    const setupRows = setupData.length
      ? setupData.map(s => {
          const pct = Math.round(Math.abs(s.pl) / maxSetupPL * 100);
          const color = s.pl >= 0 ? '#22c55e' : '#ef4444';
          return `<div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <span style="font-size:.82rem;font-weight:600;color:var(--text)">${esc(s.setup)}</span>
              <span style="font-size:.82rem;font-weight:600;color:${color}">${fmtPL(s.pl)}</span>
            </div>
            <div style="height:5px;border-radius:3px;background:rgba(255,255,255,0.08)">
              <div style="height:100%;width:${pct}%;border-radius:3px;background:${color};transition:width .4s"></div>
            </div>
          </div>`;
        }).join('')
      : `<div class="text-dim" style="font-size:.8rem;padding:8px 0">No setup data yet</div>`;

    const hasDir = dirData.longs + dirData.shorts > 0;
    const dirLegend = hasDir ? `
      <div style="display:flex;flex-direction:column;gap:8px;min-width:120px">
        <div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            <div style="width:10px;height:10px;border-radius:2px;background:#22c55e;flex-shrink:0"></div>
            <span style="font-size:.8rem;color:#888">Long</span>
          </div>
          <div style="font-size:.85rem;font-weight:700;color:#22c55e;margin-left:16px">${dirData.longs} trades</div>
          <div style="font-size:.75rem;color:#888;margin-left:16px">${fmtPL(dirData.lPL)}</div>
        </div>
        <div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            <div style="width:10px;height:10px;border-radius:2px;background:#ef4444;flex-shrink:0"></div>
            <span style="font-size:.8rem;color:#888">Short</span>
          </div>
          <div style="font-size:.85rem;font-weight:700;color:#ef4444;margin-left:16px">${dirData.shorts} trades</div>
          <div style="font-size:.75rem;color:#888;margin-left:16px">${fmtPL(dirData.sPL)}</div>
        </div>
      </div>` : `<div class="text-dim" style="font-size:.8rem">No direction data yet</div>`;

    return { html: `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">

        <!-- P&L by Day of Week -->
        <div class="card" style="padding:16px">
          <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:#666;margin-bottom:2px">P&amp;L by Day of Week</div>
          <div style="font-size:.85rem;font-weight:600;color:var(--text);margin-bottom:12px">Where your edge lives</div>
          <div style="height:130px;position:relative"><canvas id="tendDOW"></canvas></div>
        </div>

        <!-- By Session -->
        <div class="card" style="padding:16px">
          <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:#666;margin-bottom:2px">By Session</div>
          <div style="font-size:.85rem;font-weight:600;color:var(--text);margin-bottom:12px">Win rate &amp; P&amp;L per session</div>
          ${sessionRows}
        </div>

        <!-- By Setup -->
        <div class="card" style="padding:16px">
          <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:#666;margin-bottom:2px">By Setup</div>
          <div style="font-size:.85rem;font-weight:600;color:var(--text);margin-bottom:12px">Top setups by P&amp;L</div>
          ${setupRows}
        </div>

        <!-- Direction Split -->
        <div class="card" style="padding:16px">
          <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:#666;margin-bottom:2px">Direction Split</div>
          <div style="font-size:.85rem;font-weight:600;color:var(--text);margin-bottom:12px">Long vs short bias</div>
          <div style="display:flex;align-items:center;gap:20px">
            <div style="position:relative;width:110px;height:110px;flex-shrink:0">
              <canvas id="tendDir" width="110" height="110"></canvas>
              <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none">
                <div style="font-size:1.1rem;font-weight:800;color:var(--text);line-height:1">${hasDir ? dirData.longPct + '%' : '—'}</div>
                <div style="font-size:.6rem;color:#888;text-transform:uppercase;letter-spacing:.06em">LONG BIAS</div>
              </div>
            </div>
            ${dirLegend}
          </div>
        </div>

      </div>
    `, dowData, dirData };
  }

  /* ── Card grid renderer (works for both kinds) ──────────── */
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

  /* ── Public render ──────────────────────────────────────── */
  function render() {
    const content = document.getElementById('content');
    const trades = DB.getTrades();
    const analytics = _renderAnalytics(trades);

    content.innerHTML = `
      <div class="page-head">
        <h1>Tendencies</h1>
        <p class="page-subtitle">Where you make money and where you don't</p>
      </div>

      ${analytics.html}

      <div style="border-top:1px solid var(--border-sub);margin-bottom:20px"></div>

      <div class="tend-wrap">
        <div class="tend-subnav">
          <button class="tend-sub-btn${_sub==='mistakes' ?' active mistakes':''}" data-sub="mistakes">⚠️ Mistakes</button>
          <button class="tend-sub-btn${_sub==='strengths'?' active strengths':''}" data-sub="strengths">💪 Strengths</button>
        </div>
        <div id="tendBody">${renderGrid(_sub)}</div>
      </div>
    `;

    document.querySelectorAll('.tend-sub-btn').forEach(b => {
      b.addEventListener('click', () => { saveSub(b.dataset.sub); render(); });
    });

    requestAnimationFrame(() => {
      _drawDOW(analytics.dowData);
      _drawDir(analytics.dirData);
    });
  }

  /* ── Edit / CRUD wiring ─────────────────────────────────── */
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
