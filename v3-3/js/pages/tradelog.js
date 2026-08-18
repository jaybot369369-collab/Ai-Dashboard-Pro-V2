/* ═══════════════════════════════════════════════════════════
   TRADE LOG — where every trade gets written up.

   Holds your 81 trades — everything from 27 April 2026 onward.
   The 1,430 older imported ones were dropped: they had no stops, no
   grades and almost no setup names. They stay in the old dashboard.

   The setup box has a real "NO SETUP" option. A blank means you
   have not filled it in yet. NO SETUP means you looked and the
   trade had no plan behind it. Those are different admissions.

   Your rules live at the top of this page, because this is where
   you actually use them.
════════════════════════════════════════════════════════════ */
const TradeLogPage = (() => {
  'use strict';
  const { esc, money, signed, dateShort, toast } = UI;
  const S = Stats;

  let filter = { text: '', result: 'all', setup: 'all', sort: 'date-desc' };
  let editing = null;      // trade id, 'new', or null
  let rulesOpen = false;
  let page = 0;
  const PER_PAGE = 40;

  const SESSIONS  = ['London', 'NY', 'Asian', 'Other'];
  const GRADES    = ['A', 'B', 'C', 'D'];
  const RULE_CATS = [
    ['scalp', 'Before a scalp'],
    ['swing', 'Before a swing'],
    ['longterm', 'Before a long-term buy'],
    ['redFlags', 'Warning signs to stop'],
  ];

  /* ── Setup choices: playbook + the NO SETUP option ── */
  function setupChoices() {
    const fromBook = Store.playbook().map(p => p.name || p.title).filter(Boolean);
    const used = [...new Set(Store.trades().map(t => S.str(t.setupType)).filter(Boolean))];
    return [...new Set([...fromBook, ...used])]
      .filter(x => x !== Store.NO_SETUP)
      .sort((a, b) => a.localeCompare(b));
  }

  /* ── Filtering ────────────────────────────────────── */
  function visible() {
    let ts = Store.trades();

    const q = filter.text.trim().toLowerCase();
    if (q) ts = ts.filter(t =>
      [t.symbol, t.setupType, t.notes, t.session, t.direction, t.preGradeNotes, t.postGradeNotes]
        .some(v => String(v || '').toLowerCase().includes(q)));

    if (filter.result === 'win')    ts = ts.filter(t => S.isClosed(t) && S.pl(t) > 0);
    if (filter.result === 'loss')   ts = ts.filter(t => S.isClosed(t) && S.pl(t) < 0);
    if (filter.result === 'open')   ts = ts.filter(S.isOpen);
    if (filter.result === 'nostop') ts = ts.filter(t => S.str(t.sl) === '');

    if (filter.setup === 'none')      ts = ts.filter(t => S.str(t.setupType) === Store.NO_SETUP);
    else if (filter.setup !== 'all')  ts = ts.filter(t => S.str(t.setupType) === filter.setup);

    const dir = filter.sort.endsWith('asc') ? 1 : -1;
    if (filter.sort.startsWith('date'))  ts.sort((a, b) => dir * S.byDate(a, b));
    if (filter.sort.startsWith('money')) ts.sort((a, b) => dir * (S.pl(a) - S.pl(b)));
    return ts;
  }

  /* ── Rules card ───────────────────────────────────── */
  function rulesCard() {
    const r = Store.rules();
    return `
    <div class="card">
      <div class="row-between" style="cursor:pointer" id="rulesToggle">
        <div class="card-title"><span class="card-emoji"></span>My rules</div>
        <span class="chev">${rulesOpen ? '▾' : '▸'}</span>
      </div>
      ${rulesOpen ? `
      <div style="margin-top:16px">
        <p class="dim small" style="margin:0 0 14px">
          These are the questions you ask yourself before you click buy. Tick them off on the
          trade form. Edit the wording here whenever it stops matching how you actually trade.</p>
        <div class="rules-grid">
          ${RULE_CATS.map(([key, label]) => `
            <div class="rule-col">
              <div class="gm-l">${esc(label)}</div>
              <div class="rule-list" data-cat="${key}">
                ${(r[key] || []).map((rule, i) => `
                  <div class="rule-row">
                    <input type="text" value="${esc(typeof rule === 'string' ? rule : rule.text || '')}"
                      data-cat="${key}" data-i="${i}" class="rule-input">
                    <button class="btn-icon" data-del-rule="${key}:${i}" title="Remove">✕</button>
                  </div>`).join('') || '<p class="dim small">Nothing here yet.</p>'}
              </div>
              <button class="btn ghost btn-sm" data-add-rule="${key}">+ Add</button>
            </div>`).join('')}
        </div>
        <button class="btn" id="saveRules" style="margin-top:16px">Save rules</button>
      </div>` : ''}
    </div>`;
  }

  /* ── The trade form ───────────────────────────────── */
  function form(t) {
    const isNew = !t;
    t = t || { date: new Date().toISOString().slice(0, 10), direction: 'Long', session: 'London' };
    const v = (k, d) => esc(t[k] ?? (d || ''));
    const choices = setupChoices();
    const cur = S.str(t.setupType);

    return `
    <div class="card form-card">
      <div class="row-between">
        <div class="card-title">${isNew ? 'Write up a new trade' : 'Edit this trade'}</div>
        <button class="btn-icon" id="closeForm" title="Close">✕</button>
      </div>

      <div class="form-grid" style="margin-top:16px">
        <label>Date<input type="date" id="f_date" value="${v('date')}"></label>
        <label>Time<input type="time" id="f_time" value="${v('time')}"></label>
        <label>Coin<input type="text" id="f_symbol" value="${v('symbol')}" placeholder="XRP/USDT"></label>
        <label>Long or short
          <select id="f_direction">
            ${['Long', 'Short'].map(d => `<option ${t.direction === d ? 'selected' : ''}>${d}</option>`).join('')}
          </select></label>
        <label>Session
          <select id="f_session">
            ${SESSIONS.map(s => `<option ${t.session === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select></label>

        <label class="span2">What setup was this?
          <select id="f_setupType">
            <option value="">— not filled in yet —</option>
            <option value="${esc(Store.NO_SETUP)}" ${cur === Store.NO_SETUP ? 'selected' : ''}
              style="font-weight:700">${esc(Store.NO_SETUP)} (no plan behind it)</option>
            ${choices.map(c => `<option ${cur === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
          <span class="hint">Pick <b>NO SETUP</b> if you took this one on the fly. It is worth
            knowing how often that happens — it is your most expensive habit.</span></label>

        <label>Entry price<input type="text" id="f_entry" value="${v('entry')}"></label>
        <label>Stop<input type="text" id="f_sl" value="${v('sl')}" placeholder="required">
          <span class="hint">No stop, no trade. Your own rule.</span></label>
        <label>Target<input type="text" id="f_tp" value="${v('tp')}"></label>
        <label>Size<input type="text" id="f_size" value="${v('size')}"></label>
        <label>Exit price<input type="text" id="f_exitPrice" value="${v('exitPrice')}"></label>
        <label>Made or lost ($)<input type="text" id="f_result" value="${v('result')}" placeholder="leave blank if still open"></label>
        <label>Fees ($)<input type="text" id="f_fees" value="${v('fees')}"></label>
        <label>Bigger picture view
          <select id="f_htfBias">
            ${['', 'Bullish', 'Bearish', 'Neutral'].map(b => `<option ${t.htfBias === b ? 'selected' : ''}>${b}</option>`).join('')}
          </select></label>

        <label>Your grade before you entered
          <select id="f_preGrade"><option value="">not graded</option>
            ${GRADES.map(g => `<option ${t.preGrade === g ? 'selected' : ''}>${g}</option>`).join('')}
          </select>
          <span class="hint">Only A and B are worth taking.</span></label>
        <label>Your grade afterwards
          <select id="f_postGrade"><option value="">not graded</option>
            ${GRADES.map(g => `<option ${t.postGrade === g ? 'selected' : ''}>${g}</option>`).join('')}
          </select></label>

        <label class="span2">Why you took it
          <textarea id="f_preGradeNotes" rows="2">${esc(t.preGradeNotes || '')}</textarea></label>
        <label class="span2">How it went
          <textarea id="f_postGradeNotes" rows="2">${esc(t.postGradeNotes || '')}</textarea></label>
        <label class="span2">Notes
          <textarea id="f_notes" rows="5" placeholder="What you saw, what you were thinking, what happened.">${esc(t.notes || '')}</textarea></label>
        <label class="span2">Screenshots
          <div class="shot-drop" id="shotDrop">
            <input type="file" id="shotFile" accept="image/*" multiple hidden>
            <span>Drop pictures here, paste with ⌘V, or <button type="button" class="link" id="shotPick">choose files</button></span>
            <span class="hint" id="shotHint">${R2.isEnabled()
              ? 'They go to your own storage, so the trade only keeps a short address.'
              : 'Storage is not set up yet, so pictures get saved inside the trade and eat space fast. Settings → Where screenshots go.'}</span>
          </div>
          <div class="shot-list" id="shotList"></div>
          <textarea id="f_shots" rows="2" placeholder="or paste web addresses, one per line">${esc((t.screenshotUrls || []).filter(u => typeof u === 'string' && !u.startsWith('data:')).join('\n'))}</textarea></label>
      </div>

      <div class="row-gap" style="margin-top:18px">
        <button class="btn" id="saveTrade">${isNew ? 'Save trade' : 'Save changes'}</button>
        <button class="btn ghost" id="closeForm2">Cancel</button>
        ${!isNew ? `<button class="btn danger" id="deleteTrade" style="margin-left:auto">Delete</button>` : ''}
      </div>
    </div>`;
  }

  /* Pictures added in this editing session, already uploaded. */
  let pendingShots = [];

  /** Send a picture to your own storage if it is set up, otherwise shrink it
      right down and keep it inside the trade — with a warning either way. */
  async function addPicture(file) {
    if (R2.isEnabled()) {
      const r = await R2.upload(file);
      return r.url;
    }
    const blob = await R2.compressImage(file, 900, 0.7);
    return await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(new Error('Could not read that picture'));
      fr.readAsDataURL(blob);
    });
  }

  function paintShots() {
    const el = UI.$('shotList');
    if (!el) return;
    el.innerHTML = pendingShots.map((u, i) => `
      <div class="shot-thumb">
        <img src="${esc(u)}" alt="screenshot">
        <button type="button" class="btn-icon" data-rm-shot="${i}" title="Remove">✕</button>
        ${u.startsWith('data:') ? '<span class="pill bad">stored inside the trade</span>' : ''}
      </div>`).join('');
    UI.$$('[data-rm-shot]').forEach(b => b.addEventListener('click', () => {
      pendingShots.splice(+b.dataset.rmShot, 1); paintShots();
    }));
  }

  async function takeFiles(files) {
    const imgs = [...files].filter(f => f.type.startsWith('image/'));
    if (!imgs.length) return;
    toast(`Adding ${imgs.length} ${imgs.length === 1 ? 'picture' : 'pictures'}…`);
    for (const f of imgs) {
      try { pendingShots.push(await addPicture(f)); }
      catch (e) { toast(e.message, 'bad'); }
    }
    paintShots();
    toast('Added');
  }

  function wireShots() {
    const drop = UI.$('shotDrop');
    if (!drop) return;
    paintShots();
    UI.$('shotPick')?.addEventListener('click', () => UI.$('shotFile').click());
    UI.$('shotFile')?.addEventListener('change', e => takeFiles(e.target.files));
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => {
      e.preventDefault(); drop.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => {
      e.preventDefault(); drop.classList.remove('over');
    }));
    drop.addEventListener('drop', e => takeFiles(e.dataTransfer.files));
    // Paste straight from a screenshot
    document.addEventListener('paste', onPaste);
  }
  function onPaste(e) {
    if (!UI.$('shotDrop')) { document.removeEventListener('paste', onPaste); return; }
    const items = [...(e.clipboardData?.items || [])].filter(i => i.type.startsWith('image/'));
    if (!items.length) return;
    e.preventDefault();
    takeFiles(items.map(i => i.getAsFile()).filter(Boolean));
  }

  function readForm() {
    const g = id => (document.getElementById('f_' + id) || {}).value || '';
    return {
      date: g('date'), time: g('time'), symbol: g('symbol'), direction: g('direction'),
      session: g('session'), setupType: g('setupType'), entry: g('entry'), sl: g('sl'),
      tp: g('tp'), size: g('size'), exitPrice: g('exitPrice'), result: g('result'),
      fees: g('fees'), htfBias: g('htfBias'), preGrade: g('preGrade'), postGrade: g('postGrade'),
      preGradeNotes: g('preGradeNotes'), postGradeNotes: g('postGradeNotes'), notes: g('notes'),
      screenshotUrls: [
        ...pendingShots,
        ...g('shots').split('\n').map(s => s.trim()).filter(Boolean),
      ],
      _autoNoSetup: false,
    };
  }

  /* ── Detail view ──────────────────────────────────── */
  function detail(t) {
    const shots = (t.screenshotUrls || []).filter(u => typeof u === 'string' && /^https?:/.test(u));
    const row = (k, v) => v ? `<div><span class="gm-l">${esc(k)}</span><div class="mono">${esc(v)}</div></div>` : '';
    return `
      <div class="detail">
        <div class="detail-grid">
          ${row('Entry', t.entry)}${row('Stop', t.sl || 'none written down')}${row('Target', t.tp)}
          ${row('Exit', t.exitPrice)}${row('Size', t.size)}${row('Fees', t.fees)}
          ${row('Bigger picture', t.htfBias)}${row('Before', t.preGrade)}${row('After', t.postGrade)}
        </div>
        ${t.preGradeNotes ? `<div class="note-block"><span class="gm-l">Why you took it</span><p>${esc(t.preGradeNotes)}</p></div>` : ''}
        ${t.postGradeNotes ? `<div class="note-block"><span class="gm-l">How it went</span><p>${esc(t.postGradeNotes)}</p></div>` : ''}
        ${t.notes ? `<div class="note-block"><span class="gm-l">Notes</span><p>${esc(t.notes).replace(/\n/g, '<br>')}</p></div>` : ''}
        ${shots.length ? `<div class="shots">${shots.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="trade screenshot" loading="lazy"></a>`).join('')}</div>` : ''}
        <button class="btn ghost btn-sm" data-edit="${esc(t.id)}" style="margin-top:12px">Edit this trade</button>
      </div>`;
  }

  /* ── Render ───────────────────────────────────────── */
  function render() {
    const ts = visible();
    const tot = S.totals(ts);
    const shown = ts.slice(0, (page + 1) * PER_PAGE);
    const setups = setupChoices();
    const autoTagged = Store.liveTrades().filter(t => t._autoNoSetup).length;

    UI.$('view').innerHTML = `
      ${rulesCard()}

      ${autoTagged ? `
      <div class="card"><div class="notice"><span class="notice-ico"></span><div>
        <b>${autoTagged} of your trades had the setup box left empty.</b> They are now labelled
        <b>NO SETUP</b> so they show up properly in your numbers. If any of them really did have a
        plan, open it and pick the right one — the label is only a best guess at what the empty
        box meant.</div></div></div>` : ''}

      <div class="card">
        <div class="row-between wrap">
          <div class="card-title">${ts.length.toLocaleString()} trades</div>
          <div class="row-gap">
            <span class="pill ${tot.total >= 0 ? 'good' : 'bad'}">${signed(tot.total)}</span>
            <span class="pill">${tot.wins}W / ${tot.losses}L</span>
            <span class="pill">${tot.closed ? UI.pct(tot.winRate) : '—'} won</span>
            <button class="btn" id="newTrade">+ New trade</button>
          </div>
        </div>

        <div class="filters">
          <input type="search" id="fText" placeholder="Search coin, setup or your notes…" value="${esc(filter.text)}">
          <select id="fResult">
            <option value="all"    ${filter.result === 'all' ? 'selected' : ''}>Any result</option>
            <option value="win"    ${filter.result === 'win' ? 'selected' : ''}>Winners</option>
            <option value="loss"   ${filter.result === 'loss' ? 'selected' : ''}>Losers</option>
            <option value="open"   ${filter.result === 'open' ? 'selected' : ''}>Never closed off</option>
            <option value="nostop" ${filter.result === 'nostop' ? 'selected' : ''}>No stop written down</option>
          </select>
          <select id="fSetup">
            <option value="all"  ${filter.setup === 'all' ? 'selected' : ''}>Any setup</option>
            <option value="none" ${filter.setup === 'none' ? 'selected' : ''}>NO SETUP only</option>
            ${setups.map(s => `<option ${filter.setup === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
          </select>
          <select id="fSort">
            <option value="date-desc"  ${filter.sort === 'date-desc' ? 'selected' : ''}>Newest first</option>
            <option value="date-asc"   ${filter.sort === 'date-asc' ? 'selected' : ''}>Oldest first</option>
            <option value="money-desc" ${filter.sort === 'money-desc' ? 'selected' : ''}>Biggest win first</option>
            <option value="money-asc"  ${filter.sort === 'money-asc' ? 'selected' : ''}>Biggest loss first</option>
          </select>
        </div>
      </div>

      <div id="formSlot">${editing === 'new' ? form(null) : (editing ? form(Store.tradeById(editing)) : '')}</div>

      <div class="card">
        <div class="tbl-wrap"><table class="trades">
          <thead><tr>
            <th>Date</th><th>Coin</th><th>Way</th><th>Setup</th><th>Session</th>
            <th>Grade</th><th>Stop</th><th class="num">Made / lost</th><th></th>
          </tr></thead>
          <tbody>
            ${shown.map(t => {
              const noSetup = S.str(t.setupType) === Store.NO_SETUP;
              const openTrade = S.isOpen(t);
              return `
              <tr class="trow" data-row="${esc(t.id)}">
                <td class="mono small">${esc(dateShort(t.date))}</td>
                <td><b>${esc(String(t.symbol || '?').toUpperCase())}</b></td>
                <td class="small ${S.str(t.direction).toLowerCase() === 'short' ? 'accent-txt' : 'dim'}">${esc(t.direction || '')}</td>
                <td class="small">${noSetup ? `<span class="pill bad">NO SETUP</span>`
                    : esc(t.setupType || '') || '<span class="dim">—</span>'}</td>
                <td class="small dim">${esc(t.session || '')}</td>
                <td class="small">${t.preGrade
                    ? `<span class="pill ${['A','B'].includes(t.preGrade) ? 'good' : 'bad'}">${esc(t.preGrade)}</span>`
                    : '<span class="dim">—</span>'}</td>
                <td class="small">${S.str(t.sl) ? `<span class="mono">${esc(t.sl)}</span>` : '<span class="pill bad">none</span>'}</td>
                <td class="num ${openTrade ? 'dim' : (S.pl(t) >= 0 ? 'good' : 'bad')}">
                  ${openTrade ? 'not closed' : signed(S.pl(t))}</td>
                <td class="small dim">▸</td>
              </tr>
              <tr class="drow" data-detail="${esc(t.id)}" hidden><td colspan="9">${detail(t)}</td></tr>`;
            }).join('') || `<tr><td colspan="9" class="dim" style="padding:22px;text-align:center">
              No trades match what you searched for.</td></tr>`}
          </tbody>
        </table></div>
        ${shown.length < ts.length ? `<button class="btn ghost" id="more" style="margin-top:14px">
          Show more (${ts.length - shown.length} left)</button>` : ''}
      </div>`;

    wire();
  }

  function wire() {
    const on = (id, ev, fn) => { const el = UI.$(id); if (el) el.addEventListener(ev, fn); };

    on('rulesToggle', 'click', () => { rulesOpen = !rulesOpen; render(); });
    on('saveRules', 'click', () => {
      const r = {};
      RULE_CATS.forEach(([k]) => { r[k] = []; });
      UI.$$('.rule-input').forEach(i => {
        const v = i.value.trim();
        if (v) r[i.dataset.cat].push(v);
      });
      Store.saveRules(r); toast('Rules saved'); render();
    });
    UI.$$('[data-add-rule]').forEach(b => b.addEventListener('click', () => {
      const r = Store.rules(); const k = b.dataset.addRule;
      r[k] = [...(r[k] || []), 'New rule'];
      Store.saveRules(r); render();
    }));
    UI.$$('[data-del-rule]').forEach(b => b.addEventListener('click', () => {
      const [k, i] = b.dataset.delRule.split(':');
      const r = Store.rules(); r[k].splice(+i, 1); Store.saveRules(r); render();
    }));

    on('fText', 'input', e => { filter.text = e.target.value; page = 0; render();
      const f = UI.$('fText'); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } });
    ['fResult', 'fSetup', 'fSort'].forEach(id =>
      on(id, 'change', e => {
        filter[{ fResult: 'result', fSetup: 'setup', fSort: 'sort' }[id]] = e.target.value;
        page = 0; render();
      }));
    on('more', 'click', () => { page++; render(); });

    wireShots();

    on('newTrade', 'click', () => {
      editing = 'new'; pendingShots = [];
      render(); window.scrollTo({ top: 180, behavior: 'smooth' });
    });
    on('closeForm', 'click', () => { editing = null; pendingShots = []; render(); });
    on('closeForm2', 'click', () => { editing = null; pendingShots = []; render(); });

    on('saveTrade', 'click', () => {
      const d = readForm();
      if (!d.symbol.trim()) { toast('Which coin was it?', 'bad'); return; }
      if (!d.sl.trim() && !confirm('You have not written down a stop.\n\nYour own first rule is "no stop, no trade". Save it anyway?')) return;
      if (editing === 'new') { Store.addTrade(d); toast('Trade saved'); }
      else { Store.updateTrade(editing, d); toast('Changes saved'); }
      editing = null; pendingShots = []; render();
    });
    on('deleteTrade', 'click', () => {
      if (!confirm('Delete this trade for good?')) return;
      Store.deleteTrade(editing); editing = null; toast('Trade deleted'); render();
    });

    UI.$$('.trow').forEach(r => r.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      const d = document.querySelector(`[data-detail="${r.dataset.row}"]`);
      if (d) {
        d.hidden = !d.hidden;
        r.querySelector('td:last-child').textContent = d.hidden ? '▸' : '▾';
        if (!d.hidden) d.querySelectorAll('[data-edit]').forEach(b =>
          b.addEventListener('click', () => {
            editing = b.dataset.edit;
            const tr = Store.tradeById(editing);
            pendingShots = (tr?.screenshotUrls || []).filter(u => typeof u === 'string' && u.startsWith('data:'));
            render(); window.scrollTo({ top: 180, behavior: 'smooth' });
          }));
      }
    }));
  }

  /* Open one trade straight into the editor, from another page.
     The Morning Desk uses this so the trades you never closed off can be
     clicked and finished off there and then. */
  function openForEdit(id) {
    const t = Store.tradeById(id);
    if (!t) { toast('That trade is no longer here', 'bad'); return; }
    editing = id;
    pendingShots = (t.screenshotUrls || []).filter(u => typeof u === 'string' && u.startsWith('data:'));
    App.go('tradelog');
    window.scrollTo({ top: 180, behavior: 'smooth' });
  }

  return { render, openForEdit, title: 'Trade Log', sub: () => `${Store.trades().length.toLocaleString()} trades written up` };
})();
