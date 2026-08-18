/* ═══════════════════════════════════════════════════════════
   CONTEXT — what the AI is allowed to know about how you trade.

   This is the thing that stops the coach handing you generic
   advice. Four documents:
     · Who you are as a trader
     · The only storylines it may name
     · How a date gets on the calendar
     · Your risk rules (read-only — the real file wins)

   Edit them here. They save to this browser.
════════════════════════════════════════════════════════════ */
const ContextPage = (() => {
  'use strict';
  const { esc, toast } = UI;

  const DOCS = [
    { id: 'profile',  file: 'data/trader_profile.md',  title: 'Who you are as a trader',
      why: 'Read by the coach and anything that writes for you. It only works if it describes how you actually trade, not how you would like to look.' },
    { id: 'themes',   file: 'data/theme_map.md',       title: 'The only storylines it may name',
      why: 'When anything tags a theme it has to come from this list, spelled the same. Something genuinely new gets flagged rather than named. This is what stops it inventing narratives.' },
    { id: 'catalyst', file: 'data/catalyst_rules.md',  title: 'How a date earns its place',
      why: 'The test a date has to pass before it goes on your calendar.' },
    { id: 'charter',  file: 'data/RISK_CHARTER.md',    title: 'Your risk rules', readOnly: true,
      why: 'Shown here so the coach and you are reading the same thing. Edit the real file, not this copy — that one always wins.' },
  ];

  let open = 'profile';
  let loaded = {};

  async function ensure(doc) {
    if (loaded[doc.id] !== undefined) return loaded[doc.id];
    const saved = Store.settings()['ctx_' + doc.id];
    if (saved !== undefined && !doc.readOnly) { loaded[doc.id] = saved; return saved; }
    try {
      const r = await fetch(doc.file + '?t=' + Date.now());
      loaded[doc.id] = r.ok ? await r.text() : '(Could not load this one.)';
    } catch { loaded[doc.id] = '(Could not load this one.)'; }
    return loaded[doc.id];
  }

  /** Small markdown renderer — enough for these docs, nothing clever. */
  function md(src) {
    // Strip html comments first. They can run over several lines, and skipping
    // line-by-line let the tail of one show up as body text.
    const clean = String(src).replace(/<!--[\s\S]*?-->/g, '');
    const lines = esc(clean).split('\n');
    let out = '', inTable = false, inList = false;
    const closeList = () => { if (inList) { out += '</ul>'; inList = false; } };
    const closeTable = () => { if (inTable) { out += '</tbody></table></div>'; inTable = false; } };

    lines.forEach(raw => {
      const l = raw.trimEnd();
      if (/^\s*&lt;!--/.test(l)) return;                       // hide html comments
      if (/^\|/.test(l)) {
        const cells = l.split('|').slice(1, -1).map(c => c.trim());
        if (/^[-\s:|]+$/.test(l.replace(/\|/g, ''))) return;   // separator row
        if (!inTable) {
          closeList();
          out += '<div class="tbl-wrap"><table><thead><tr>' + cells.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';
          inTable = true;
        } else {
          out += '<tr>' + cells.map(c => `<td>${bold(c)}</td>`).join('') + '</tr>';
        }
        return;
      }
      closeTable();
      if (/^#### /.test(l)) { closeList(); out += `<h5>${bold(l.slice(5))}</h5>`; return; }
      if (/^### /.test(l))  { closeList(); out += `<h4>${bold(l.slice(4))}</h4>`; return; }
      if (/^## /.test(l))   { closeList(); out += `<h3>${bold(l.slice(3))}</h3>`; return; }
      if (/^# /.test(l))    { closeList(); out += `<h2>${bold(l.slice(2))}</h2>`; return; }
      if (/^&gt; /.test(l)) { closeList(); out += `<blockquote>${bold(l.slice(5))}</blockquote>`; return; }
      if (/^[-*] /.test(l)) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${bold(l.slice(2))}</li>`; return; }
      if (/^\d+\. /.test(l)){ if (!inList) { out += '<ul>'; inList = true; } out += `<li>${bold(l.replace(/^\d+\.\s*/, ''))}</li>`; return; }
      if (/^---+$/.test(l)) { closeList(); out += '<hr>'; return; }
      if (!l.trim())        { closeList(); return; }
      closeList();
      out += `<p>${bold(l)}</p>`;
    });
    closeList(); closeTable();
    return out;
  }
  const bold = s => s
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener" class="link">$1</a>');

  /* Loading a document is async. If Jay clicks a different tab while it is
     still loading, the old page must not paint over the new one — that put
     the Context page under the Trade Log heading. */
  let token = 0;

  async function render() {
    const mine = ++token;
    const doc = DOCS.find(d => d.id === open);
    const text = await ensure(doc);
    if (mine !== token || !document.getElementById('view')) return;
    if (!UI.stillOn('context')) return;
    const edited = Store.settings()['ctx_' + doc.id] !== undefined;

    UI.$('view').innerHTML = `
      <div class="card">
        <div class="notice info"><span class="notice-ico"></span><div>
          This is everything the coach is allowed to know about you. Without it you get generic
          advice that could be aimed at anybody. The rule that matters most is the storyline list:
          it can only name a theme that is written there, and anything new gets flagged rather
          than invented.</div></div>
      </div>

      <div class="seg seg-wide" id="ctxTabs">
        ${DOCS.map(d => `<button data-doc="${d.id}" class="${open === d.id ? 'on' : ''}">${esc(d.title)}</button>`).join('')}
      </div>

      <div class="card" style="margin-top:14px">
        <div class="row-between wrap">
          <div>
            <div class="card-title">${esc(doc.title)}</div>
            <p class="dim small" style="margin:5px 0 0;max-width:70ch">${esc(doc.why)}</p>
          </div>
          <div class="row-gap">
            ${edited ? `<span class="pill warn">you have edited this</span>` : ''}
            ${doc.readOnly ? `<span class="pill">read only</span>`
              : `<button class="btn ghost btn-sm" id="ctxEdit">Edit</button>`}
          </div>
        </div>
        <div id="ctxBody" class="doc" style="margin-top:16px">${md(text)}</div>
      </div>`;

    UI.$$('#ctxTabs button').forEach(b => b.addEventListener('click', () => { open = b.dataset.doc; render(); }));
    const ed = UI.$('ctxEdit');
    if (ed) ed.addEventListener('click', () => {
      UI.$('ctxBody').innerHTML = `
        <textarea id="ctxText" rows="26" class="mono-area">${esc(text)}</textarea>
        <div class="row-gap" style="margin-top:12px">
          <button class="btn" id="ctxSave">Save</button>
          <button class="btn ghost" id="ctxCancel">Cancel</button>
          ${edited ? `<button class="btn ghost" id="ctxReset" style="margin-left:auto">Put the original back</button>` : ''}
        </div>`;
      UI.$('ctxSave').addEventListener('click', () => {
        const v = UI.$('ctxText').value;
        Store.saveSettings({ ['ctx_' + doc.id]: v });
        loaded[doc.id] = v; toast('Saved'); render();
      });
      UI.$('ctxCancel').addEventListener('click', render);
      const rs = UI.$('ctxReset');
      if (rs) rs.addEventListener('click', () => {
        const s = Store.settings(); delete s['ctx_' + doc.id];
        localStorage.setItem(Store.K.settings, JSON.stringify(s));
        Store.clearCache(); delete loaded[doc.id]; toast('Original put back'); render();
      });
    });
  }

  return { render, title: 'Context', sub: () => 'What the coach knows about how you trade' };
})();
