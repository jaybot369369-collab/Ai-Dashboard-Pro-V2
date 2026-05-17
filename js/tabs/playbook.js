/* ═══════════════════════════════════════════════════════════
   PLAYBOOK TAB
════════════════════════════════════════════════════════════ */
const PlaybookTab = (() => {

  function render() {
    const content  = document.getElementById('content');
    const setups   = DB.recomputePlaybookStats();

    content.innerHTML = `
      <div class="section-header">
        <div class="section-title">Playbook — Setup Catalogue</div>
        <button class="btn-ghost btn-sm" onclick="PlaybookTab._addSetup()">＋ Add Setup</button>
      </div>
      <div class="playbook-grid" id="playbookGrid"></div>
    `;

    document.getElementById('playbookGrid').innerHTML = setups.map(s => setupCard(s)).join('');
  }

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function safeImgUrl(u) {
    return typeof u === 'string' && /^(https?:|data:image\/)/i.test(u) ? u : '';
  }

  function setupCard(s) {
    const wr = s.winRate !== null ? s.winRate.toFixed(0) + '%' : '—';
    const wrColor = s.winRate !== null ? (s.winRate >= 50 ? 'var(--green)' : 'var(--red)') : 'var(--text-sub)';
    const ar = s.avgR !== null ? s.avgR.toFixed(2) + 'R' : '—';
    const safeId = /^[A-Za-z0-9_-]+$/.test(s.id) ? s.id : '';
    const imgSrc = safeImgUrl(s.screenshotUrl);

    return `
      <div class="playbook-card" id="pb_${esc(safeId)}">
        <div class="playbook-card-header">
          <div class="playbook-card-name">${esc(s.name)}</div>
          <div style="display:flex;gap:6px">
            <button class="btn-icon" onclick="PlaybookTab._edit('${safeId}')" title="Edit">✏️</button>
            <button class="btn-icon" onclick="PlaybookTab._del('${safeId}')" title="Delete">🗑</button>
          </div>
        </div>

        <div id="pb_view_${esc(safeId)}">
          <div class="playbook-stats">
            <div class="playbook-stat">Win Rate: <strong style="color:${wrColor}">${wr}</strong></div>
            <div class="playbook-stat">Avg R: <strong>${ar}</strong></div>
            <div class="playbook-stat">Trades: <strong>${s.tradeCount}</strong></div>
          </div>

          <div class="playbook-rules" style="font-size:.78rem">
            <div style="margin-bottom:4px"><strong style="color:var(--text-sub);font-size:.68rem;text-transform:uppercase">Description</strong></div>
            <div style="white-space:pre-wrap">${esc(s.description) || '—'}</div>
          </div>
          <div class="playbook-rules" style="font-size:.78rem">
            <div style="margin-bottom:4px"><strong style="color:var(--text-sub);font-size:.68rem;text-transform:uppercase">Entry Rules</strong></div>
            <div style="white-space:pre-wrap">${esc(s.entryRules) || '—'}</div>
          </div>
          <div class="playbook-rules" style="font-size:.78rem">
            <div style="margin-bottom:4px"><strong style="color:var(--text-sub);font-size:.68rem;text-transform:uppercase">SL / TP</strong></div>
            <div>SL: ${esc(s.slRules) || '—'}</div>
            <div>TP: ${esc(s.tpRules) || '—'}</div>
          </div>

          ${imgSrc ? `<img src="${esc(imgSrc)}" style="width:100%;border-radius:6px;margin-bottom:10px" onerror="this.style.display='none'" />` : ''}

          <div style="border-top:1px solid var(--border-sub);padding-top:10px;margin-top:4px">
            <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;color:var(--text-sub);margin-bottom:8px">Pre-Trade Checklist</div>
            ${(s.checklist || []).map((item, i) => `
              <div class="checklist-item${item.checked ? ' checked' : ''}">
                <input type="checkbox" ${item.checked ? 'checked' : ''} onchange="PlaybookTab._check('${safeId}',${i},this.checked)" />
                ${esc(item.label)}
              </div>
            `).join('')}
          </div>
        </div>

        <div id="pb_edit_${esc(safeId)}" class="hidden">
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
      // btn is the ✕ button — remove the parent row
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
