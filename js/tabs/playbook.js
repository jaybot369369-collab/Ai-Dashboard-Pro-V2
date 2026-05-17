/* ═══════════════════════════════════════════════════════════
   PLAYBOOK TAB
════════════════════════════════════════════════════════════ */
const PlaybookTab = (() => {

  const SETUP_ICONS = [
    ['silver bullet', '🥈'], ['liquidity sweep', '🎯'], ['liquidity', '🎯'],
    ['order block', '📦'],   ['breaker', '🧱'],          ['cisd', '⚡'],
    ['asia range', '🌏'],    ['asia', '🌏'],              ['ote', '📐'],
    ['fair value', '📊'],    ['fvg', '📊'],               ['power of 3', '🔺'],
    ['killzone', '⏱️'],      ['sweep', '🌊'],             ['continuation', '➡️'],
  ];

  function setupIcon(name) {
    const lower = (name || '').toLowerCase();
    for (const [key, icon] of SETUP_ICONS) {
      if (lower.includes(key)) return icon;
    }
    return '📋';
  }

  function wrBadge(wr) {
    if (wr === null) return { color: '#6b7280', label: '—' };
    if (wr >= 75) return { color: '#22c55e', label: wr.toFixed(0) + '%' };
    if (wr >= 60) return { color: '#f59e0b', label: wr.toFixed(0) + '%' };
    if (wr >= 50) return { color: '#f97316', label: wr.toFixed(0) + '%' };
    return { color: '#ef4444', label: wr.toFixed(0) + '%' };
  }

  function render() {
    const content = document.getElementById('content');
    const setups  = DB.recomputePlaybookStats();
    const sorted  = [...setups].sort((a, b) => (b.winRate ?? -999) - (a.winRate ?? -999));

    content.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Playbook</h1>
          <div class="sub">${sorted.length} approved setup${sorted.length !== 1 ? 's' : ''} · sorted by win rate</div>
        </div>
        <button onclick="PlaybookTab._addSetup()" style="display:flex;align-items:center;gap:6px;padding:9px 18px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap"
          onmouseenter="this.style.opacity='.88'" onmouseleave="this.style.opacity='1'">
          <span style="font-size:18px;line-height:1;margin-top:-1px">+</span> New setup
        </button>
      </div>
      <div id="playbookGrid" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:start"></div>
    `;

    document.getElementById('playbookGrid').innerHTML =
      sorted.length ? sorted.map(s => setupCard(s)).join('') :
      `<div style="grid-column:1/-1;padding:64px 20px;text-align:center;color:var(--text-2)">
        No setups yet. Click <strong>+ New setup</strong> to add your first.
      </div>`;
  }

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function safeImgUrl(u) {
    return typeof u === 'string' && /^(https?:|data:image\/)/i.test(u) ? u : '';
  }

  function setupCard(s) {
    const safeId = /^[A-Za-z0-9_-]+$/.test(s.id) ? s.id : '';
    const ar     = s.avgR !== null ? (s.avgR >= 0 ? '+' : '') + s.avgR.toFixed(2) + 'R' : '—';
    const badge  = wrBadge(s.winRate);
    const icon   = setupIcon(s.name);
    const imgSrc = safeImgUrl(s.screenshotUrl);

    const extraRows = [];
    if (s.entryRules) extraRows.push(['Entry Rules', esc(s.entryRules)]);
    if (s.slRules)    extraRows.push(['SL', esc(s.slRules)]);
    if (s.tpRules)    extraRows.push(['TP', esc(s.tpRules)]);

    return `
      <div class="card" id="pb_${esc(safeId)}" style="padding:0;overflow:hidden;display:flex;flex-direction:column">

        <div id="pb_view_${esc(safeId)}" style="display:flex;flex-direction:column;flex:1">
          <div style="padding:20px 20px 0">

            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px">
              <div style="display:flex;align-items:center;gap:12px">
                <div style="font-size:26px;line-height:1;background:var(--surface,var(--bg-2,#f5f5f5));width:44px;height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0">${icon}</div>
                <div>
                  <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:3px">${esc(s.name)}</div>
                  <div style="font-size:12px;color:var(--text-2)">${s.tradeCount} trade${s.tradeCount !== 1 ? 's' : ''} · avg ${ar}</div>
                </div>
              </div>
              <div style="font-size:13px;font-weight:700;color:${badge.color};background:${badge.color}22;padding:3px 10px;border-radius:99px;white-space:nowrap;flex-shrink:0">${badge.label}</div>
            </div>

            <p style="font-size:13px;color:var(--text-2);line-height:1.55;margin:0 0 12px">${esc(s.description) || '<em>No description</em>'}</p>

            ${extraRows.map(([label, val]) => `
              <div style="margin-bottom:8px;font-size:12px;color:var(--text-2)">
                <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">${label}</div>
                <div style="white-space:pre-wrap">${val}</div>
              </div>`).join('')}

            ${imgSrc ? `<img src="${esc(imgSrc)}" style="width:100%;border-radius:6px;margin-bottom:12px" onerror="this.style.display='none'" />` : ''}

            ${(s.checklist || []).length > 0 ? `
              <div style="border-top:1px solid var(--border);padding-top:12px;margin-bottom:16px">
                <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-2);margin-bottom:8px">Pre-Trade Checklist</div>
                ${(s.checklist || []).map((item, i) => `
                  <div class="checklist-item${item.checked ? ' checked' : ''}">
                    <input type="checkbox" ${item.checked ? 'checked' : ''} onchange="PlaybookTab._check('${safeId}',${i},this.checked)" />
                    ${esc(item.label)}
                  </div>`).join('')}
              </div>` : '<div style="margin-bottom:16px"></div>'}
          </div>

          <div style="margin-top:auto;border-top:1px solid var(--border);display:flex">
            <button style="flex:1;padding:13px;background:none;border:none;font-size:13px;font-weight:600;color:var(--text-2);cursor:pointer;transition:background .15s;border-right:1px solid var(--border)"
              onmouseenter="this.style.background='var(--hover,rgba(0,0,0,.04))'" onmouseleave="this.style.background='none'"
              onclick="PlaybookTab._showExamples('${safeId}')">Examples</button>
            <button style="flex:1;padding:13px;background:none;border:none;font-size:13px;font-weight:600;color:var(--accent);cursor:pointer;transition:background .15s"
              onmouseenter="this.style.background='var(--hover,rgba(0,0,0,.04))'" onmouseleave="this.style.background='none'"
              onclick="PlaybookTab._edit('${safeId}')">Edit</button>
          </div>
        </div>

        <div id="pb_edit_${esc(safeId)}" class="hidden" style="padding:20px">
          ${editForm(s)}
        </div>
      </div>
    `;
  }

  function editForm(s) {
    const safeId = /^[A-Za-z0-9_-]+$/.test(s.id) ? s.id : '';
    const cl = (s.checklist || []).map((item, i) =>
      `<div class="pb-cl-row" style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
        <input type="text" class="pb-cl-input" data-orig-idx="${i}" value="${esc(item.label)}" style="flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:4px;font-size:.8rem" />
        <button class="btn-icon" onclick="PlaybookTab._removeCheck(this)">✕</button>
      </div>`
    ).join('');

    return `
      <div style="display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:13px;font-weight:700;color:var(--text)">Edit Setup</div>
          <button class="btn-icon" onclick="PlaybookTab._del('${safeId}')" title="Delete setup" style="color:var(--red)">🗑</button>
        </div>
        <div class="form-group"><label>Name</label><input type="text" id="pbe_name_${esc(safeId)}" value="${esc(s.name)}" /></div>
        <div class="form-group"><label>Description</label><textarea id="pbe_desc_${esc(safeId)}" rows="2">${esc(s.description || '')}</textarea></div>
        <div class="form-group"><label>Entry Rules</label><textarea id="pbe_entry_${esc(safeId)}" rows="2">${esc(s.entryRules || '')}</textarea></div>
        <div class="form-group"><label>SL Rules</label><input type="text" id="pbe_sl_${esc(safeId)}" value="${esc(s.slRules || '')}" /></div>
        <div class="form-group"><label>TP Rules</label><input type="text" id="pbe_tp_${esc(safeId)}" value="${esc(s.tpRules || '')}" /></div>
        <div class="form-group"><label>Screenshot URL</label><input type="url" id="pbe_ss_${esc(safeId)}" value="${esc(s.screenshotUrl || '')}" /></div>
        <div>
          <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--text-sub);margin-bottom:6px">Checklist Items</div>
          <div id="pb_cllist_${esc(safeId)}">${cl}</div>
          <button class="btn-ghost btn-sm" onclick="PlaybookTab._addCheck('${safeId}')" style="margin-top:6px">＋ Add Item</button>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-primary btn-sm" onclick="PlaybookTab._save('${safeId}')">Save</button>
          <button class="btn-ghost btn-sm" onclick="PlaybookTab._cancelEdit('${safeId}')">Cancel</button>
        </div>
      </div>
    `;
  }

  return {
    render,
    _edit: id => {
      document.getElementById(`pb_view_${id}`)?.classList.add('hidden');
      document.getElementById(`pb_edit_${id}`)?.classList.remove('hidden');
    },
    _cancelEdit: id => {
      document.getElementById(`pb_view_${id}`)?.classList.remove('hidden');
      document.getElementById(`pb_edit_${id}`)?.classList.add('hidden');
    },
    _showExamples: id => {
      const setup = DB.getPlaybook().find(s => s.id === id);
      if (!setup) return;
      const trades = DB.getTrades().filter(t => (t.setupType || '').toLowerCase() === (setup.name || '').toLowerCase());
      if (!trades.length) { App.toast('No trades tagged to this setup yet'); return; }
      App.toast(`${trades.length} trade${trades.length !== 1 ? 's' : ''} tagged to "${setup.name}"`);
    },
    _save: id => {
      const g = s => document.getElementById(`pbe_${s}_${id}`)?.value || '';
      const setup = DB.getPlaybook().find(s => s.id === id);
      if (!setup) return;
      const existing = setup.checklist || [];
      const inputs = document.querySelectorAll(`#pb_cllist_${CSS.escape(id)} .pb-cl-input`);
      const cl = Array.from(inputs).map(inp => {
        const oi = inp.dataset.origIdx;
        const checked = (oi !== undefined && existing[+oi]) ? !!existing[+oi].checked : false;
        return { label: inp.value, checked };
      }).filter(item => item.label.trim());
      DB.updateSetup(id, {
        name: g('name'), description: g('desc'),
        entryRules: g('entry'), slRules: g('sl'), tpRules: g('tp'),
        screenshotUrl: g('ss'), checklist: cl
      });
      App.toast('Setup saved');
      render();
    },
    _check: (id, idx, val) => {
      const setup = DB.getPlaybook().find(s => s.id === id);
      if (!setup) return;
      const cl = [...(setup.checklist || [])];
      if (cl[idx]) cl[idx] = { ...cl[idx], checked: val };
      DB.updateSetup(id, { checklist: cl });
    },
    _addCheck: id => {
      const list = document.getElementById(`pb_cllist_${id}`);
      if (!list) return;
      const div = document.createElement('div');
      div.className = 'pb-cl-row';
      div.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:4px';
      div.innerHTML = `<input type="text" class="pb-cl-input" placeholder="Checklist item…" style="flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:4px;font-size:.8rem" /><button class="btn-icon" onclick="PlaybookTab._removeCheck(this)">✕</button>`;
      list.appendChild(div);
    },
    _removeCheck: btn => {
      btn?.closest('.pb-cl-row')?.remove();
    },
    _del: id => {
      App.confirmDelete('Delete this setup from the catalogue?', () => {
        DB.deleteSetup(id);
        App.toast('Setup deleted');
        render();
      });
    },
    _addSetup: () => {
      const name = prompt('Setup name:');
      if (!name?.trim()) return;
      DB.addSetup({ name: name.trim(), description: '', entryRules: '', slRules: '', tpRules: '', checklist: [], screenshotUrl: '' });
      render();
    }
  };
})();
