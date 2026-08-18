/* ═══════════════════════════════════════════════════════════
   MORNING DESK — the first thing you look at.

   Four questions in the order they actually come up. Your own
   limits go first, because that is the only one that can end the
   day before it starts.

   No balance, no equity line, no win rate. Those are on the
   Performance page. Checking your profit before the open is how
   you talk yourself into a trade.
════════════════════════════════════════════════════════════ */
const DeskPage = (() => {
  'use strict';
  const { esc, money, signed, price, dateShort, toast } = UI;
  const S = Stats;

  let live = {};        // coin -> price
  let liveAt = null;

  let macro = null;     // the red-folder calendar
  let macroErr = null;
  let macroLoading = false;

  const COINS = ['BTC/USDT', 'XRP/USDT', 'SUI/USDT', 'XLM/USDT', 'SOL/USDT'];
  const today = () => new Date().toISOString().slice(0, 10);

  const daysTo = d =>
    Math.round((new Date(d + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000);

  const whenWord = d => {
    const n = daysTo(d);
    return n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
  };

  /* Built by calendar/fetch_calendar.py. Read from a file rather than
     fetched here, so the desk still shows the dates when you are offline
     and the numbers never change between refreshes. */
  async function loadMacro() {
    /* render() runs again when the prices land, so without this the file
       gets fetched twice on every visit. */
    if (macroLoading) return;
    macroLoading = true;
    try {
      const r = await fetch('data/macro_calendar.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('file not found (' + r.status + ')');
      macro = await r.json();
    } catch (e) {
      macroErr = e.message;
    }
    macroLoading = false;
    if (UI.stillOn('desk')) render();
  }

  /* ── 1 · Can I trade today ────────────────────────── */
  function secLimits() {
    const ts = Store.liveTrades();
    const L = S.limitCheck(ts, today());
    const unfinished = S.unfinished(ts, today());
    const old = unfinished.filter(t => t.ageDays > 14);
    const noStop = unfinished.filter(t => !t.hasStop);

    const head = { GREEN: 'You can trade today', AMBER: 'Careful — you are down', RED: 'Stop. No more trades today' }[L.state];
    const sub = {
      GREEN: `Nothing lost yet. You have taken ${L.tradesToday} of your 3 trades for today.`,
      AMBER: 'You are down more than $50 today. One more loss and you hit your daily limit.',
      RED: 'You hit one of your own limits. Close the platform.',
    }[L.state];
    const usedPct = L.dayPL < 0 ? Math.min(100, (Math.abs(L.dayPL) / L.dayLimit) * 100) : 0;

    return `
    <section class="sec">
      <div class="sec-head"><span class="sec-num">01</span>
        <span class="sec-title">Can I trade today?</span>
        <span class="sec-q">Your own limits, checked before you start</span></div>

      <div class="card gate ${L.state}">
        <div class="gate-light"></div>
        <div><div class="gate-verdict">${head}</div><div class="gate-sub">${esc(sub)}</div></div>
        <div class="gate-metrics">
          <div><div class="gm-l">Today</div>
            <div class="gm-v ${L.dayPL > 0 ? 'good' : L.dayPL < 0 ? 'bad' : ''}">${signed(L.dayPL)}</div>
            <div class="gm-s">stop at −$${L.dayLimit}</div></div>
          <div><div class="gm-l">This week</div>
            <div class="gm-v ${L.weekPL > 0 ? 'good' : L.weekPL < 0 ? 'bad' : ''}">${signed(L.weekPL)}</div>
            <div class="gm-s">stop at −$${L.weekLimit}</div></div>
          <div><div class="gm-l">Losses in a row</div>
            <div class="gm-v ${L.streak >= 3 ? 'bad' : ''}">${L.streak}</div>
            <div class="gm-s">at 3, halve your size</div></div>
          <div><div class="gm-l">Risk per trade</div>
            <div class="gm-v">$${L.riskPerTrade}</div>
            <div class="gm-s">same on every trade</div></div>
        </div>
        <div class="budget" style="width:100%">
          <div class="budget-l"><span>How much you can still lose today</span>
            <span>${money(L.dayLeft)} of ${money(L.dayLimit)} left</span></div>
          <div class="budget-bar"><div class="budget-fill ${usedPct > 50 ? 'bad' : ''}" style="width:${100 - usedPct}%"></div></div>
        </div>
        ${L.hits.map(b => `<div class="breaker" style="width:100%"><span class="notice-ico"></span>
          <div><b>${esc(b.rule)}</b><br>${esc(b.detail)}</div></div>`).join('')}
      </div>

      ${unfinished.length ? `
      <div class="card">
        <div class="card-title" style="font-size:.92rem">${unfinished.length} trades you never closed off</div>
        <div class="notice" style="margin-top:11px"><span class="notice-ico"></span><div>
          You wrote these down but never filled in how they ended. That does <b>not</b> mean they
          are still running. ${old.length} of them ${old.length === 1 ? 'is' : 'are'} more than two
          weeks old — the oldest is ${Math.max(...unfinished.map(t => t.ageDays))} days — and prices
          have moved a long way since.
          <b>Check each one on the exchange before you believe any of them.</b>
          ${noStop.length ? `${noStop.length} of them ${noStop.length === 1 ? 'has' : 'have'} no stop written down.` : ''}
          <br><br>Click any row to open it and fill in how it ended.
        </div></div>
        <div class="tbl-wrap" style="margin-top:12px"><table>
          <thead><tr><th>Date</th><th>How old</th><th>Coin</th><th>Long/short</th>
            <th class="num">Entry</th><th class="num">Now</th><th>Stop</th><th></th></tr></thead>
          <tbody>${unfinished.map(t => {
            const key = COINS.find(c => c.replace('/USDT', '') === String(t.symbol || '').toUpperCase().replace(/[^A-Z]/g, '').replace(/USDT|USDC|P$/g, ''));
            const now = key && live[key] ? live[key].price : null;
            const ent = parseFloat(t.entry);
            const drift = (now && Number.isFinite(ent)) ? ((now - ent) / ent) * 100 : null;
            return `<tr class="open-trade" data-open-trade="${esc(t.id)}" title="Open this trade and fill in how it ended">
              <td class="mono small">${esc(dateShort(t.date))}</td>
              <td><span class="pill ${t.ageDays > 30 ? 'bad' : t.ageDays > 14 ? 'warn' : ''}">${t.ageDays}d</span></td>
              <td><b>${esc(String(t.symbol || '').toUpperCase())}</b></td>
              <td class="dim small">${esc(t.direction || '')}</td>
              <td class="num mono">${esc(t.entry || '—')}</td>
              <td class="num mono ${drift === null ? 'dim' : Math.abs(drift) > 10 ? 'bad' : ''}">
                ${now ? price(now) : '—'}${drift !== null ? `<div class="small dim">${drift >= 0 ? '+' : ''}${drift.toFixed(1)}%</div>` : ''}</td>
              <td>${t.hasStop ? `<span class="pill good">${esc(t.sl)}</span>` : `<span class="pill bad">none</span>`}</td>
              <td class="dim">›</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>` : ''}
    </section>`;
  }

  /* ── 2 · What could move the market ─────────────────
     The big US releases, and nothing else. Earnings and the
     hand-entered dates were both taken off the desk. */
  function secEvents() {
    return `
    <section class="sec">
      <div class="sec-head"><span class="sec-num">02</span>
        <span class="sec-title">What could move the market</span>
        <span class="sec-q">The next 30 days</span></div>
      ${macroCard()}
    </section>`;
  }

  /* The big US releases — the red folders. */
  function macroCard() {
    if (macroErr) {
      return `<div class="card"><div class="notice">
        <span class="notice-ico"></span><div><b>The calendar file has not been built yet.</b><br>
        ${esc(macroErr)}<br><br>Run this and it will appear:<br>
        <code>cd "JP DASHBOARD 3/calendar" &amp;&amp; python3 fetch_calendar.py</code>
      </div></div></div>`;
    }
    if (!macro) return '<div class="card"><p class="dim">Reading the calendar…</p></div>';

    const t = today();
    const up = (macro.events || []).filter(e => e.date >= t);
    const theirs = up.filter(e => e.red_is_theirs).length;

    /* Everything landing in the same minute is one release. Payrolls day
       is one thing to plan around, not five rows. */
    const slots = [];
    up.forEach(e => {
      const last = slots[slots.length - 1];
      if (last && last.date === e.date && last.time === e.time) last.items.push(e);
      else slots.push({ date: e.date, time: e.time, from: e.from, items: [e] });
    });

    const next = slots[0];

    return `
      <div class="card">
        <div class="row-between wrap">
          <div class="card-title"><span class="card-emoji"></span>Big US releases</div>
          <span class="dim small">${up.length} in the next 30 days</span>
        </div>

        ${next ? `<div class="notice ${daysTo(next.date) <= 1 ? 'warn' : 'info'}" style="margin-top:12px">
          <span class="notice-ico">${daysTo(next.date) <= 1 ? '' : ''}</span><div>
          <b>Next: ${esc(next.items.map(i => i.title).join(', '))}</b> —
          ${whenWord(next.date)}${next.time ? ` at ${esc(next.time)}` : ''}.
          ${daysTo(next.date) <= 1
            ? 'Decide now whether you are trading through it or standing aside.'
            : ''}
        </div></div>` : `<p class="dim small" style="margin:12px 0 0">
          Nothing scheduled in the window.</p>`}

        ${slots.length ? (() => {
          /* Nobody publishes a forecast a month out, so that column is
             usually empty. An empty column is just clutter — only show it
             once something is actually in it. */
          const anyForecast = up.some(e => e.forecast);
          return `<div class="tbl-wrap" style="margin-top:14px"><table>
            <thead><tr><th>When</th><th>What</th>
              ${anyForecast ? '<th class="num">Expected</th>' : ''}
              <th class="num">Last time</th><th>Where from</th></tr></thead>
            <tbody>${slots.map(s => `
              <tr class="${daysTo(s.date) <= 1 ? 'row-hot' : ''}">
                <td class="mono small">${esc(dateShort(s.date))}
                  <div class="dim small">${esc(whenWord(s.date))}${s.time ? ' · ' + esc(s.time) : ''}</div></td>
                <td>${s.items.map(i => esc(i.title)).join('<br>')}</td>
                ${anyForecast ? `<td class="num mono small">${s.items.map(i => esc(i.forecast || '—')).join('<br>')}</td>` : ''}
                <td class="num mono small dim">${s.items.map(i => esc(i.previous || '—')).join('<br>')}</td>
                <td>${s.items.some(i => i.seen_before_not_now)
                  ? '<span class="pill warn" title="The calendar showed this earlier but is not showing it now. Kept on the desk because scheduled releases do not un-happen — but worth a look.">showing earlier, not now</span>'
                  : s.from === 'forexfactory'
                    ? '<span class="pill good">ForexFactory red</span>'
                    : '<span class="pill">date from Nasdaq</span>'}</td>
              </tr>`).join('')}</tbody>
          </table></div>`;
        })() : ''}

        ${(() => {
          /* Two ways this list can be lying to you, and both are worth
             saying out loud rather than hiding. */
          const carried = up.filter(e => e.seen_before_not_now).length;
          const holes = (macro.days_not_read || []).filter(d => d >= t);
          if (!carried && !holes.length) return '';
          return `<div class="notice warn" style="margin-top:14px">
            <span class="notice-ico"></span><div>
            ${carried ? `<b>${carried} of these ${carried > 1 ? 'were' : 'was'} showing on an
              earlier check and ${carried > 1 ? 'are' : 'is'} not showing now.</b> Still listed,
              because a scheduled release does not un-happen and the calendar we read is
              unreliable — but confirm ${carried > 1 ? 'them' : 'it'} yourself before you plan
              around ${carried > 1 ? 'them' : 'it'}.` : ''}
            ${carried && holes.length ? '<br><br>' : ''}
            ${holes.length ? `<b>${holes.length} day${holes.length > 1 ? 's' : ''} in this window
              could not be read at all</b> (${holes.map(d => esc(dateShort(d))).join(', ')}).
              Treat ${holes.length > 1 ? 'those days' : 'that day'} as unknown, not as empty.` : ''}
          </div></div>`;
        })()}

        <div class="notice" style="margin-top:14px"><span class="notice-ico"></span><div>
          <b>Where these came from, and what that is worth.</b>
          ForexFactory only publishes one week of its calendar for free, and its website turns
          away anything that is not a person with a browser — so a full 30 days of their red
          folders cannot be fetched.
          ${theirs
            ? `${theirs} of these carry ForexFactory's own red rating.`
            : 'None of these carry ForexFactory\'s own rating right now — their free feed only covers the current week, and this window starts after it.'}
          The rest are real published dates from Nasdaq, and <b>the red-folder call on those is
          ours, not ForexFactory's</b> — the list is the usual big ones: inflation, jobs, growth,
          the Fed. Anything further out, check it yourself.
        </div></div>
      </div>`;
  }

  /* ── 3 · Mistakes ─────────────────────────────────── */
  function secHabits() {
    const hs = S.habits(Store.liveTrades());
    const costly = hs.filter(h => h.costly), fine = hs.filter(h => !h.costly);
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
    <section class="sec">
      <div class="sec-head"><span class="sec-num">03</span>
        <span class="sec-title">Mistakes you keep making</span>
        <span class="sec-q">The same slip, over and over</span></div>
      <div class="card">
        <div class="notice"><span class="notice-ico"></span><div>
          Worked out from all <b>${Store.liveTrades().length}</b> of your trades. Each line
          takes the trades where you broke one of your own rules and compares what they made against
          the ones where you kept it. <b>Sorted by money, not by rule.</b></div></div>
        <div style="margin-top:15px">
          ${costly.length ? `<div class="gm-l" style="margin-bottom:9px">These are losing you money</div>${costly.map(row).join('')}` : ''}
          ${fine.length ? `<div class="gm-l" style="margin:18px 0 9px">Against your rules, but not losing you money</div>${fine.map(row).join('')}` : ''}
        </div>
        <button class="btn ghost btn-sm" data-go="coach" style="margin-top:6px">See what your notes say too</button>
      </div>
    </section>`;
  }

  /* ── 4 · What you did today ───────────────────────── */
  function secDecision() {
    const saved = Store.decisions();
    const done = saved.find(d => d.date === today());
    const OPTS = [
      ['stood_aside', '', 'Did nothing', 'No trade. This is the most common answer, and usually the right one.'],
      ['traded', '', 'Took a trade', 'One or more trades. Write them up in the Trade Log.'],
      ['adjusted', '', 'Managed a trade', 'Moved a stop, took some off, or closed something already open.'],
    ];
    return `
    <section class="sec">
      <div class="sec-head"><span class="sec-num">04</span>
        <span class="sec-title">What you did today</span>
        <span class="sec-q">One line before you shut the laptop</span></div>
      <div class="card">
        ${done ? `<div class="notice info"><span class="notice-ico"></span><div>
            Saved for today: <b>${esc(done.label)}</b>${done.why ? ` — ${esc(done.why)}` : ''}
            <button class="btn ghost btn-sm" id="undoDec" style="margin-left:10px">Change it</button>
          </div></div>`
        : `<p style="margin:0 0 13px;font-size:.86rem;color:var(--text-2)">
             Finish the day with one line. <b>Doing nothing counts as a decision and gets written
             down like any other.</b> Most days, the best thing you did was stay out.</p>
           <div class="dec-opts">${OPTS.map(([id, ico, t, d]) => `
             <button class="dec-opt" data-dec="${id}" data-label="${esc(t)}">
               <div class="dec-opt-t">${ico} ${esc(t)}</div><div class="dec-opt-d">${esc(d)}</div>
             </button>`).join('')}</div>
           <textarea id="decWhy" placeholder="Why? One sentence. What did you see, or not see?"></textarea>
           <button class="btn" id="decSave">Save today</button>`}
        ${saved.length ? `<div class="dec-saved">
          <div class="gm-l" style="margin-bottom:7px">Last few days</div>
          ${saved.slice(-8).reverse().map(d => `<div class="dec-row">
            <span class="dec-date">${esc(dateShort(d.date))}</span>
            <span><b>${esc(d.label)}</b>${d.why ? ` — <span class="dim">${esc(d.why)}</span>` : ''}</span>
          </div>`).join('')}</div>` : ''}
      </div>
    </section>`;
  }

  function render() {
    UI.$('view').innerHTML = secLimits() + secEvents()
      + secHabits() + secDecision();
    wire();
    if (!liveAt) refreshPrices();
    if (!macro && !macroErr) loadMacro();
  }

  /* Prices are still fetched with the watchlist gone — they fill the
     "now" column on the trades that were never closed off. */
  async function refreshPrices() {
    live = await UI.livePrices(COINS);
    Object.keys(live).forEach(k => { if (!live[k]) delete live[k]; });
    liveAt = new Date().toISOString();
    if (!UI.stillOn('desk')) return;
    render();
  }

  function wire() {
    let pick = null;
    UI.$$('.dec-opt').forEach(b => b.addEventListener('click', () => {
      UI.$$('.dec-opt').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel');
      pick = { id: b.dataset.dec, label: b.dataset.label };
    }));
    const ds = UI.$('decSave');
    if (ds) ds.addEventListener('click', () => {
      if (!pick) { toast('Pick what you did first', 'bad'); return; }
      const all = Store.decisions();
      all.push({ date: today(), ...pick, why: (UI.$('decWhy')?.value || '').trim(), at: new Date().toISOString() });
      Store.saveDecisions(all); toast('Saved'); render();
    });
    const ud = UI.$('undoDec');
    if (ud) ud.addEventListener('click', () => {
      Store.saveDecisions(Store.decisions().filter(d => d.date !== today())); render();
    });

    /* A trade you never closed off opens in the Trade Log editor, so it can
       be finished off from here instead of hunting for it in the list. */
    UI.$$('[data-open-trade]').forEach(r => r.addEventListener('click', () =>
      TradeLogPage.openForEdit(r.dataset.openTrade)));

    UI.$$('[data-go]').forEach(b => b.addEventListener('click', () => App.go(b.dataset.go)));
  }

  return { render, title: 'Morning Desk', sub: () => UI.dateLong(today()) };
})();
