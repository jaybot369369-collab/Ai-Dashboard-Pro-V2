/* ═══════════════════════════════════════════════════════════
   AI COACH

   Most of this works with no key and no internet. It reads your
   own trades and notes and groups what keeps happening.

   It does not grade your trades. That is on purpose. When your
   daily report used to call a direction, it was right 35 times
   out of 100 — confident and wrong. Sorting and spotting repeats
   is the part that actually works, so that is the part it does.

   The written weekly review needs an Anthropic key. Everything
   above it works without one.
════════════════════════════════════════════════════════════ */
const CoachPage = (() => {
  'use strict';
  const { esc, money, signed, pct, dateShort, toast } = UI;
  const S = Stats;

  let tab = 'patterns';
  let busy = false;
  let lastReview = null;
  let serverReports = null;   // reports written on the Mac and sent up

  async function loadServerReports() {
    const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
    const base = isLocal ? 'http://127.0.0.1:8767' : '';
    try {
      const r = await fetch(base + '/api/v3/coach_reports?limit=20', { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      serverReports = j.reports || [];
    } catch (e) { serverReports = []; }
    if (UI.stillOn('coach')) render();
  }

  const TABS = [
    ['patterns', 'What keeps happening'],
    ['words',    'What your notes say'],
    ['review',   'Written review'],
    ['key',      'Set up the key'],
  ];

  /* ── Pattern finding — no key needed ──────────────── */
  function patterns() {
    const ts = Store.liveTrades();
    if (!ts.length) return `<div class="card"><p class="dim">No trades on this account yet.</p></div>`;
    const hs = S.habits(ts);
    const costly = hs.filter(h => h.costly);
    const fine = hs.filter(h => !h.costly);

    const unfinished = S.unfinished(ts).filter(t => t.ageDays > 14);
    const noStopOpen = S.unfinished(ts).filter(t => !t.hasStop);

    const row = h => `
      <div class="habit ${h.costly ? 'costly' : 'ok'}">
        <div class="habit-top">
          <span class="pill ${h.costly ? 'bad' : ''}">${esc(h.rule)}</span>
          <span class="habit-label">${esc(h.label)}</span>
          <span class="habit-count">${h.count} of your ${h.of} trades</span>
        </div>
        <div class="habit-bar"><div class="habit-fill" style="width:${h.pct}%"></div></div>
        <div class="habit-cmp">
          <span>These made <b class="num ${h.pl >= 0 ? 'good' : 'bad'}">${signed(h.pl)}</b></span>
          <span>${esc(h.otherLabel[0].toUpperCase() + h.otherLabel.slice(1))} made
            <b class="num ${h.plOther >= 0 ? 'good' : 'bad'}">${signed(h.plOther)}</b></span>
          <span>${h.difference < 0 ? 'Costing you' : 'Better by'}
            <b class="num ${h.difference >= 0 ? 'good' : 'bad'}">${money(Math.abs(h.difference))}</b></span>
          ${h.tooFew ? `<span class="pill thin">only ${h.count} trades — too few to be sure</span>` : ''}
        </div>
        <div class="habit-why">${esc(h.why)}</div>
      </div>`;

    return `
      <div class="card">
        <div class="notice info"><span class="notice-ico"></span><div>
          This works out of your own ${ts.length} trades. It takes the ones where you broke a rule
          and compares what they made against the ones where you kept it.
          <b>Sorted by money, not by rule.</b> Break a rule and still make money and it does not
          get flagged. You get the numbers, not a telling-off.</div></div>
        <div style="margin-top:16px">
          ${costly.length ? `<div class="gm-l" style="margin-bottom:9px">These are losing you money</div>${costly.map(row).join('')}` : ''}
          ${fine.length ? `<div class="gm-l" style="margin:18px 0 9px">Against your rules, but not losing you money</div>${fine.map(row).join('')}` : ''}
        </div>
      </div>

      ${unfinished.length || noStopOpen.length ? `
      <div class="card">
        <div class="card-title">Things to tidy up</div>
        <ul class="plain-list">
          ${unfinished.length ? `<li><b>${unfinished.length} trades were never closed off</b> and are
            over two weeks old — the oldest is ${Math.max(...unfinished.map(t => t.ageDays))} days.
            Check them on the exchange, then fill in what happened.</li>` : ''}
          ${noStopOpen.length ? `<li><b>${noStopOpen.length} unfinished trades have no stop written down.</b>
            If any of those are still running, that is real money with nothing protecting it.</li>` : ''}
        </ul>
      </div>` : ''}

      <div class="card">
        <div class="card-title">Where your money actually comes from</div>
        <div class="tbl-wrap" style="margin-top:12px"><table>
          <thead><tr><th>Setup</th><th class="num">Trades</th><th class="num">Made / lost</th><th></th></tr></thead>
          <tbody>${S.bySetup(ts).map(r => `
            <tr>
              <td>${r.key === Store.NO_SETUP ? `<b class="bad">${esc(r.key)}</b>` : esc(r.key)}</td>
              <td class="num">${r.n}</td>
              <td class="num ${r.total >= 0 ? 'good' : 'bad'}">${signed(r.total)}</td>
              <td>${r.n < 20 ? `<span class="pill thin">${r.n} so far — need 20 to judge</span>`
                : `<span class="pill ${r.total >= 0 ? 'good' : 'bad'}">${r.total >= 0 ? 'Keep doing this' : 'Stop doing this'}</span>`}</td>
            </tr>`).join('')}</tbody>
        </table></div>
      </div>`;
  }

  /* ── What your own notes say ──────────────────────── */
  function words() {
    const ts = Store.liveTrades().filter(t => (t.notes || t.postGradeNotes || t.preGradeNotes));
    if (!ts.length) return `<div class="card"><p class="dim">You have not written notes on any trades yet.</p></div>`;

    // Words Jay uses when things go wrong, counted honestly.
    const FLAGS = [
      ['fomo',            /\bfomo\b|chased?|chasing/i,             'Chasing a move'],
      ['revenge',         /revenge|claw ?back|get it back|tilt/i,  'Trying to win it back'],
      ['no stop',         /no stop|without a stop|mental stop/i,   'Trading without a stop'],
      ['moved stop',      /moved? (my )?stop|widened?/i,           'Moving the stop'],
      ['early exit',      /exited? early|closed? early|cut (it )?early|paper hand/i, 'Getting out too early'],
      ['held too long',   /held too long|should have (closed|taken)|gave (it )?back/i, 'Holding too long'],
      ['oversized',       /too big|oversiz|over ?lever|size too/i,  'Position too big'],
      ['news',            /cpi|fomc|ppi|nfp|news/i,                'Trading around news'],
      ['impatient',       /impatient|bored|forced|nothing there/i,  'Forcing a trade'],
    ];

    const hits = FLAGS.map(([id, re, label]) => {
      const rows = ts.filter(t => re.test([t.notes, t.preGradeNotes, t.postGradeNotes].join(' ')));
      return { id, label, rows, n: rows.length, total: S.totals(rows).total };
    }).filter(h => h.n).sort((a, b) => a.total - b.total);

    return `
      <div class="card">
        <div class="notice info"><span class="notice-ico"></span><div>
          You have written notes on <b>${ts.length}</b> trades. This looks through them for the
          same words coming up again, and adds up what those trades made. It is your own words
          counted back at you — nothing is being guessed.</div></div>
        ${hits.length ? `<div style="margin-top:16px">
          ${hits.map(h => `
            <div class="habit ${h.total < 0 ? 'costly' : 'ok'}">
              <div class="habit-top">
                <span class="habit-label">${esc(h.label)}</span>
                <span class="habit-count">${h.n} ${h.n === 1 ? 'trade' : 'trades'}</span>
              </div>
              <div class="habit-cmp">
                <span>Between them: <b class="num ${h.total >= 0 ? 'good' : 'bad'}">${signed(h.total)}</b></span>
                ${h.n < 20 ? `<span class="pill thin">only ${h.n} — too few to be sure</span>` : ''}
              </div>
              <details style="margin-top:8px"><summary class="small dim">Show the trades</summary>
                <ul class="plain-list small" style="margin-top:8px">
                  ${h.rows.slice(0, 8).map(t => `<li><span class="mono">${esc(dateShort(t.date))}</span>
                    <b>${esc(t.symbol)}</b> ${signed(S.pl(t))} —
                    <span class="dim">${esc(String(t.notes || t.postGradeNotes || '').slice(0, 110))}…</span></li>`).join('')}
                </ul></details>
            </div>`).join('')}
        </div>` : `<p class="dim" style="margin-top:14px">Nothing repeated often enough to call a pattern yet.</p>`}
      </div>`;
  }

  /* ── Written review (needs a key) ─────────────────── */
  function reviewTab() {
    const key = Store.settings().aiKey;
    const saved = Store.reviews();
    return `
      <div class="card">
        <div class="row-between wrap">
          <div class="card-title">Written review of your last 7 days</div>
          <button class="btn" id="runReview" ${busy || !key ? 'disabled' : ''}>
            ${busy ? 'Writing…' : 'Write it'}</button>
        </div>
        ${!key ? `<div class="notice" style="margin-top:14px"><span class="notice-ico"></span><div>
          This one needs an Anthropic key, because it sends your trade summary off to be written up.
          Add one under <b>Set up the key</b>. Everything on the other pages works without it.
        </div></div>` : ''}
        <p class="dim small" style="margin:12px 0 0">
          It gets your numbers and your notes, and is told to sort and summarise — not to grade
          your trades or decide whether a setup is any good. Those calls stay yours.</p>
        <div id="reviewOut" style="margin-top:16px">${lastReview ? renderReview(lastReview) : ''}</div>
      </div>
      ${(serverReports && serverReports.length) ? `<div class="card">
        <div class="card-title">Reports written on your Mac (${serverReports.length})</div>
        <p class="dim small" style="margin:6px 0 12px">
          These were written by the coach running on your own computer, then sent up so both
          dashboards can show them. They cost nothing and they still show when you are offline.</p>
        <div>${serverReports.map(r => `
          <details class="rev"><summary>${esc(r.report_date || '')} — ${esc(r.headline || 'Report')}</summary>
            <div class="rev-body">${renderReview(r.markdown || '')}</div></details>`).join('')}</div>
      </div>` : ''}

      ${saved.length ? `<div class="card">
        <div class="card-title">Reviews you already had (${saved.length})</div>
        <div style="margin-top:12px">${saved.slice().reverse().map((r, i) => `
          <details class="rev"><summary>${esc(r.weekOf || r.rangeLabel || 'Review ' + (saved.length - i))}</summary>
            <div class="rev-body">${r.html || esc(r.text || '')}</div></details>`).join('')}</div>
      </div>` : ''}`;
  }

  function renderReview(text) {
    const html = esc(text)
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^## (.+)$/gm, '<h3>$1</h3>')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/^[-•] (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
      .replace(/\n{2,}/g, '</p><p>');
    return `<div class="rev-body"><p>${html}</p></div>`;
  }

  function buildPrompt() {
    const ts = Store.liveTrades();
    const cut = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const week = ts.filter(t => t.date >= cut);
    const t = S.totals(week);
    const hs = S.habits(ts);
    const lines = week.map(x =>
      `${x.date} ${x.symbol} ${x.direction} setup="${x.setupType || 'blank'}" grade=${x.preGrade || 'none'} `
      + `stop=${x.sl ? 'yes' : 'NO'} result=${x.result || 'not closed'} notes="${String(x.notes || '').replace(/\s+/g, ' ').slice(0, 260)}"`
    ).join('\n');

    return `You are helping a trader review their own week. Your job is to ORGANISE and SUMMARISE what is already there.

Hard rules:
- Do NOT grade the trades or say whether a setup is good or bad.
- Do NOT invent any number or fact that is not below.
- Do NOT change their risk rules.
- Write in plain simple English. No jargon, no stats notation, no symbols like § or n=.
- Finish with what you assumed and anything you need them to clarify.

Their own rules: risk $50 a trade; stop for the day is -$100; stop for the week is -$200; three losses in a row means halve the size; only trade A or B graded ideas; every trade needs a stop; every trade needs a setup name.

This week: ${week.length} trades, ${t.closed} finished, made or lost ${t.total.toFixed(0)} dollars, won ${t.winRate.toFixed(0)} out of every 100.

Longer-run patterns already worked out from all ${ts.length} trades:
${hs.map(h => `- ${h.label}: ${h.count} of ${h.of} trades, those made ${h.pl.toFixed(0)}, the rest made ${h.plOther.toFixed(0)}`).join('\n')}

This week's trades:
${lines || '(no trades this week)'}

Write: what happened this week, which mistakes repeated, what they did well, and at most three things to carry into next week.`;
  }

  async function runReview() {
    const cfg = Store.settings();
    if (!cfg.aiKey) { toast('Add a key first', 'bad'); return; }
    busy = true; render();
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': cfg.aiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: cfg.aiModel || 'claude-sonnet-5',
          max_tokens: 2000,
          messages: [{ role: 'user', content: buildPrompt() }],
        }),
      });
      if (!r.ok) throw new Error('The service said no (' + r.status + '). Check the key.');
      const j = await r.json();
      lastReview = (j.content || []).map(c => c.text).join('\n');
      const saved = Store.reviews();
      saved.push({ weekOf: new Date().toISOString().slice(0, 10), text: lastReview, html: renderReview(lastReview) });
      Store.saveReviews(saved);
      toast('Review written');
    } catch (e) {
      lastReview = null;
      toast(e.message, 'bad');
      UI.$('reviewOut').innerHTML = `<div class="notice"><span class="notice-ico"></span><div>${esc(e.message)}</div></div>`;
    } finally { busy = false; if (UI.stillOn('coach')) render(); }
  }

  function keyTab() {
    const cfg = Store.settings();
    return `
      <div class="card">
        <div class="card-title">Anthropic key</div>
        <p class="dim small" style="margin:6px 0 14px">
          Only the written review needs this. It is kept in this browser and is deliberately
          left out of every backup file, so it can never end up in your Downloads folder.</p>
        <div class="form-grid">
          <label class="span2">Key
            <input type="password" id="aiKey" value="${esc(cfg.aiKey || '')}" placeholder="sk-ant-…"></label>
          <label>Which model
            <select id="aiModel">
              ${['claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5-20251001']
                .map(m => `<option ${cfg.aiModel === m ? 'selected' : ''}>${m}</option>`).join('')}
            </select></label>
        </div>
        <button class="btn" id="saveKey" style="margin-top:14px">Save</button>
      </div>`;
  }

  function render() {
    UI.$('view').innerHTML = `
      <div class="seg seg-wide" id="coachTabs">
        ${TABS.map(([id, label]) => `<button data-ct="${id}" class="${tab === id ? 'on' : ''}">${label}</button>`).join('')}
      </div>
      <div style="margin-top:14px">
        ${tab === 'patterns' ? patterns() : tab === 'words' ? words() : tab === 'review' ? reviewTab() : keyTab()}
      </div>`;

    UI.$$('#coachTabs button').forEach(b => b.addEventListener('click', () => { tab = b.dataset.ct; render(); }));
    const rr = UI.$('runReview'); if (rr) rr.addEventListener('click', runReview);
    const sk = UI.$('saveKey');
    if (sk) sk.addEventListener('click', () => {
      Store.saveSettings({ aiKey: UI.$('aiKey').value.trim(), aiModel: UI.$('aiModel').value });
      toast('Saved'); render();
    });
  }

  function enter() {
    render();
    if (serverReports === null) loadServerReports();
  }

  return { render: enter, title: 'AI Coach',
           sub: () => 'Sorts and spots repeats. It does not grade you.' };
})();
