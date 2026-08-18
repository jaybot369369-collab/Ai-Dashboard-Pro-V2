/* ═══════════════════════════════════════════════════════════
   PERFORMANCE — the numbers page.

   Kept off the Morning Desk on purpose. Looking at your balance
   before the open is how you talk yourself into a trade.

   Everything here is your current account, from 27 April 2026.
   The older imported trades are not in Dashboard 3 at all.

   Nothing gets a "this works" or "this doesn't" label until you
   have done it 20 times. Under that it just says how many.
════════════════════════════════════════════════════════════ */
const PerformancePage = (() => {
  'use strict';
  const { esc, money, signed, pct, dateShort } = UI;
  const S = Stats;

  let range = 'all';   // all | 90 | 30 | 7

  function inRange(ts) {
    if (range === 'all') return ts;
    const cut = new Date(Date.now() - (+range) * 86400000).toISOString().slice(0, 10);
    return ts.filter(t => t.date >= cut);
  }

  function kpi(label, value, sub, tone) {
    return `
      <div class="kpi">
        <div class="kpi-l">${esc(label)}</div>
        <div class="kpi-v ${tone || ''}">${value}</div>
        <div class="kpi-s">${sub || ''}</div>
      </div>`;
  }

  function groupTable(title, rows, note) {
    return `
      <div class="card">
        <div class="card-title">${esc(title)}</div>
        ${note ? `<p class="dim small" style="margin:6px 0 0">${esc(note)}</p>` : ''}
        <div class="tbl-wrap" style="margin-top:12px"><table>
          <thead><tr><th>${esc(title.split(' ').pop())}</th><th class="num">Trades</th>
            <th class="num">Won</th><th class="num">Made / lost</th><th>What it tells you</th></tr></thead>
          <tbody>${rows.map(r => `
            <tr>
              <td>${r.key === Store.NO_SETUP ? `<b class="bad">${esc(r.key)}</b>` : esc(r.key)}</td>
              <td class="num">${r.n}</td>
              <td class="num dim">${r.closed ? pct(r.winRate) : '—'}</td>
              <td class="num ${r.total >= 0 ? 'good' : 'bad'}">${signed(r.total)}</td>
              <td>${r.n < 20
                ? `<span class="pill thin">${r.n} so far — need 20 to judge</span>`
                : `<span class="pill ${r.total >= 0 ? 'good' : 'bad'}">${r.total >= 0 ? 'Keep doing this' : 'Stop doing this'}</span>`}</td>
            </tr>`).join('')}</tbody>
        </table></div>
      </div>`;
  }

  function heatmap(ts) {
    const { days, grid } = S.dayHourGrid(ts);
    const flat = grid.flat().filter(v => v !== null);
    if (!flat.length) return `<div class="card"><div class="card-title">When you make and lose money</div>
      <p class="dim small" style="margin-top:8px">Not enough trades with a time on them yet.
      Add the time when you write a trade up and this fills in.</p></div>`;
    const max = Math.max(...flat.map(Math.abs), 1);
    const hours = [...Array(24).keys()];

    // Worst and best cells, stated plainly
    let worst = null, best = null;
    days.forEach((d, r) => hours.forEach(h => {
      const v = grid[r][h];
      if (v === null) return;
      if (!worst || v < worst.v) worst = { v, d, h };
      if (!best  || v > best.v)  best  = { v, d, h };
    }));

    return `
      <div class="card">
        <div class="card-title">When you make and lose money</div>
        <p class="dim small" style="margin:6px 0 14px">
          Each square is one day of the week at one hour. Light cells mean you made money then,
          dark cells mean you lost it.</p>
        <div class="tbl-wrap"><table class="heat">
          <thead><tr><th></th>${hours.map(h => `<th class="hh">${String(h).padStart(2, '0')}</th>`).join('')}</tr></thead>
          <tbody>${days.map((d, r) => `
            <tr><td class="hd">${d.slice(0, 3)}</td>
              ${hours.map(h => {
                const v = grid[r][h];
                if (v === null) return `<td class="hc"></td>`;
                const a = Math.min(1, Math.abs(v) / max) * 0.85 + 0.15;
                const c = `color-mix(in srgb,var(${v >= 0 ? '--good' : '--bad'}) ${Math.round(a * 100)}%,transparent)`;
                return `<td class="hc" style="background:${c}" title="${d} ${h}:00 — ${signed(v)}"></td>`;
              }).join('')}</tr>`).join('')}</tbody>
        </table></div>
        <div class="row-gap small" style="margin-top:12px">
          ${best  ? `<span class="pill good">Best: ${esc(best.d)} at ${String(best.h).padStart(2,'0')}:00 · ${signed(best.v)}</span>` : ''}
          ${worst ? `<span class="pill bad">Worst: ${esc(worst.d)} at ${String(worst.h).padStart(2,'0')}:00 · ${signed(worst.v)}</span>` : ''}
        </div>
      </div>`;
  }

  function render() {
    const all = Store.liveTrades();
    const ts = inRange(all);
    const t = S.totals(ts);
    const bal = S.balance(all);
    const eq = S.equity(ts);

    UI.$('view').innerHTML = `
      <div class="card">
        <div class="row-between wrap">
          <div class="card-title">How you are doing</div>
          <div class="seg" id="rangeSeg">
            ${[['7', 'Last week'], ['30', 'Last month'], ['90', 'Last 3 months'], ['all', 'Everything']]
              .map(([v, l]) => `<button data-range="${v}" class="${range === v ? 'on' : ''}">${l}</button>`).join('')}
          </div>
        </div>
        <div class="kpi-grid" style="margin-top:16px">
          ${kpi('Account balance', money(bal), `started at ${money(S.START_BALANCE)}`, bal >= S.START_BALANCE ? 'good' : 'bad')}
          ${kpi('Made or lost', signed(t.total), `${t.closed} finished trades`, t.total >= 0 ? 'good' : 'bad')}
          ${kpi('How often you win', t.closed ? pct(t.winRate) : '—', `${t.wins} won, ${t.losses} lost`, t.winRate >= 50 ? 'good' : 'bad')}
          ${kpi('For every $1 lost', t.ratio === null ? '—' : (t.ratio === Infinity ? '∞' : '$' + t.ratio.toFixed(2)),
                `made ${money(t.moneyMade)}, lost ${money(t.moneyLost)}`, (t.ratio || 0) >= 1 ? 'good' : 'bad')}
        </div>
        <div class="kpi-grid" style="margin-top:10px">
          ${kpi('Biggest win', signed(t.biggestWin), '', 'good')}
          ${kpi('Biggest loss', signed(t.biggestLoss), t.biggestLoss < -75 ? 'over your $75 limit' : '', 'bad')}
          ${kpi('Average win', signed(t.avgWin), '', 'good')}
          ${kpi('Average loss', signed(t.avgLoss), '', 'bad')}
        </div>
        ${t.fees ? `<p class="dim small" style="margin:12px 0 0">
          Fees came to ${money(t.fees)}. After fees you are at
          <b class="${t.netAfterFees >= 0 ? 'good' : 'bad'}">${signed(t.netAfterFees)}</b>.</p>` : ''}
      </div>

      <div class="card">
        <div class="card-title">Your balance over time</div>
        <div class="chart-wrap" style="height:280px"><canvas id="eqChart"></canvas></div>
      </div>

      ${heatmap(ts)}

      ${groupTable('Every setup', S.bySetup(ts),
        'NO SETUP means you took the trade without a plan. It is listed here like any other setup, because it is one.')}

      <div class="row-2">
        ${groupTable('By coin', S.bySymbol(ts))}
        ${groupTable('By session', S.bySession(ts))}
      </div>

      <div class="row-2">
        ${groupTable('By grade you gave it', S.byGrade(ts),
          'Your own rule says only A and B are worth taking.')}
        ${groupTable('By day', S.byDay(ts))}
      </div>

      <div class="card">
        <div class="card-title">Money by setup</div>
        <div class="chart-wrap" style="height:250px"><canvas id="setupChart"></canvas></div>
      </div>`;

    // charts
    requestAnimationFrame(() => {
      UI.lineChart(UI.$('eqChart'),
        eq.map(p => ({ y: p.balance, label: dateShort(p.date) })));
      UI.barChart(UI.$('setupChart'),
        S.bySetup(ts).slice(0, 12).map(r => ({ label: r.key, value: r.total })));
    });

    UI.$$('#rangeSeg button').forEach(b => b.addEventListener('click', () => {
      range = b.dataset.range; render();
    }));
  }

  return { render, title: 'Performance', sub: () => 'This account only, from 27 April' };
})();
