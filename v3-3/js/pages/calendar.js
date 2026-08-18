/* ═══════════════════════════════════════════════════════════
   CALENDAR — what each month of the year has actually done,
   and which day inside the month the high and low formed on.

   Twelve vertical columns, one per month. Click one and it opens
   the raw record: every year on file, the day that month's high
   formed, the day its low formed, and the range those days fell
   in.

   Deliberately no interpretation layer. There used to be one —
   baseline comparisons, significance tests, a stretched path
   chart, "this month breaks the habit" notes. It was dropped:
   Jay asked for the plain record with nothing laid over it, and
   she was right, because a reader cannot check any of that by
   eye. Every number on this page can now be counted off the
   table it sits above. Keep it that way.

   Everything is counted from real price history and frozen to a
   file by seasonality/build_seasonality.py, from two independent
   sources that get compared before anything is published. The
   page does no maths of its own, so the numbers never drift.
════════════════════════════════════════════════════════════ */
const CalendarPage = (() => {
  'use strict';
  const { esc } = UI;

  let data = null;
  let loadErr = null;
  let market = localStorage.getItem('jp3_seasonality_market') || 'sp500';
  let view = localStorage.getItem('jp3_seasonality_view') || 'one';   // one | all
  let openMonth = null;      // which month's detail is showing
  let scale = localStorage.getItem('jp3_seasonality_scale') || 'own';   // own | true

  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const thisMonth = new Date().getMonth() + 1;

  async function load() {
    try {
      const r = await fetch('data/seasonality.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('file not found (' + r.status + ')');
      data = await r.json();
    } catch (e) {
      loadErr = e.message;
    }
    if (UI.stillOn('calendar')) render();
  }

  const pct  = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%';
  const pct2 = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%';
  const mk   = key => (data.markets || []).find(m => m.key === key);
  const ord  = d => d + (d > 3 && d < 21 ? 'th' : ['th','st','nd','rd'][d % 10] || 'th');

  /* ── The twelve vertical columns ───────────────────
     The bar is where the month typically closes. The faint line
     behind it is how far it typically travels first — down to the
     usual dip, up to the usual high. All three are middle values
     of the same kind, so they share one scale honestly. */
  function columns(m) {
    const got = m.months.filter(x => x.years);
    const top = Math.max(...got.map(x => Math.max(x.median_pop, x.median_change)), 0.1);
    const bot = Math.min(...got.map(x => Math.min(x.median_dip, x.median_change)), -0.1);
    const H = 190;
    const y = v => H - (v - bot) / (top - bot) * H;       // value → pixels from top
    const zero = y(0);

    const cols = got.map(x => {
      const up = x.median_change >= 0;
      const barTop = up ? y(x.median_change) : zero;
      const barH = Math.max(2, Math.abs(y(x.median_change) - zero));
      const spanTop = y(x.median_pop);
      const spanH = Math.max(2, y(x.median_dip) - y(x.median_pop));
      const now = x.month === thisMonth;
      const isOpen = openMonth === x.month;

      return `
        <button class="sea-col ${now ? 'now' : ''} ${isOpen ? 'open' : ''}"
                data-month="${x.month}"
                title="${esc(x.name)} — typically closes ${pct(x.median_change)}; on the way it usually dips ${pct(x.median_dip)} and reaches ${pct(x.median_pop)}. Click for the timing inside the month.">
          <span class="sea-col-val ${up ? 'good' : 'bad'}">${pct(x.median_change)}</span>
          <span class="sea-plot">
            <span class="sea-vspan" style="top:${spanTop}px;height:${spanH}px"></span>
            <span class="sea-zero" style="top:${zero}px"></span>
            <span class="sea-vbar ${up ? 'up' : 'down'}" style="top:${barTop}px;height:${barH}px"></span>
          </span>
          <span class="sea-col-name">${esc(MONTH_SHORT[x.month - 1])}</span>
          ${now ? '<span class="sea-nowdot"></span>' : ''}
        </button>`;
    }).join('');

    return `<div class="sea-cols">${cols}</div>
      <div class="sea-scale">
        <span>bar = where it usually closes · faint line = how far it usually travels first</span>
        <span>click a month</span>
      </div>`;
  }

  /* ── One month, clicked open ────────────────────────
     The raw record and nothing else: every year, the day the high formed
     and the day the low formed, then the range those days fell in. Every
     summary line here can be counted off the table above it by hand.
     Nothing is inferred, compared to a baseline, or called significant. */
  function detail(m, x) {
    const s = x.shape;
    if (!s || !s.by_year) {
      return `<div class="sea-detail"><b>${esc(x.name)}</b>
        <p class="dim small" style="margin:6px 0 0">
          There is not enough daily history for this month to say which day
          the high and low formed on.</p></div>`;
    }

    const rows = s.by_year;
    const line = (kind, rng, inRange, label) => `
      <div class="sea-fact ${kind}">
        <span class="sea-daytag ${kind}">${label}</span>
        <b>${ord(rng[0])} to ${ord(rng[1])}</b>
        <span class="dim">— ${inRange} of the ${rows.length} years landed in there</span>
      </div>`;

    return `
      <div class="sea-detail" id="seaDetail">
        <div class="sea-detail-head">
          <div>
            <div class="card-title">${esc(x.name)} · ${esc(m.label)}
              ${x.month === thisMonth ? '<span class="sea-flag">this month</span>' : ''}</div>
            <p class="dim small" style="margin:5px 0 0;max-width:74ch">
              Every ${esc(x.name)} on record, ${s.first_year} to ${s.last_year}.</p>
          </div>
          <button class="btn ghost btn-sm" id="seaClose">Close</button>
        </div>

        <div class="sea-facts">
          ${line('hi', s.high_day_range, s.high_in_range, 'High')}
          ${line('lo', s.low_day_range,  s.low_in_range,  'Low')}
        </div>
        <p class="dim small" style="margin:8px 0 0">
          The range is the middle half of the years: the earliest quarter and the latest quarter
          are left out of it. The days inside each range are picked out in colour below — count
          them and you will get the same answer.</p>

        <div class="tbl-wrap" style="margin-top:14px"><table class="sea-years">
          <thead><tr><th>Year</th><th class="num">High formed on</th>
            <th class="num">Low formed on</th></tr></thead>
          <tbody>${rows.map(r => `
            <tr>
              <td class="mono">${r.y}</td>
              <td class="num mono ${inRng(r.h, s.high_day_range) ? 'good' : 'dim'}">${ord(r.h)}</td>
              <td class="num mono ${inRng(r.l, s.low_day_range) ? 'bad' : 'dim'}">${ord(r.l)}</td>
            </tr>`).join('')}</tbody>
        </table></div>

        <div class="card-title small" style="margin-top:20px">How the whole month closed</div>
        <p class="dim small" style="margin:3px 0 0">
          ${x.years} ${esc(x.name)}s, ${x.first_year} to ${x.last_year}. That is a different count
          from the ${rows.length} above: the two checks drop different years, so they are kept
          apart rather than mixed.</p>
        <dl class="sea-kv" style="margin-top:10px">
          <dt>Typical close</dt>
          <dd class="${x.median_change >= 0 ? 'good' : 'bad'}">${pct(x.median_change)}</dd>
          <dt>Up years</dt><dd class="dim">${x.up_count} of ${x.years}</dd>
          <dt>Best</dt><dd class="good">${pct(x.best)} <span class="dim">${x.best_year}</span></dd>
          <dt>Worst</dt><dd class="bad">${pct(x.worst)} <span class="dim">${x.worst_year}</span></dd>
        </dl>
      </div>`;
  }

  const inRng = (d, r) => d >= r[0] && d <= r[1];

  function oneMarket() {
    const m = mk(market);
    if (!m) return '<div class="card"><p class="dim">Nothing for that market.</p></div>';
    const got = m.months.filter(x => x.years);
    const best = got.slice().sort((a, b) => b.median_change - a.median_change)[0];
    const worst = got.slice().sort((a, b) => a.median_change - b.median_change)[0];
    const open = openMonth ? got.find(x => x.month === openMonth) : null;

    return `
      <div class="card">
        <div class="card-title">${esc(m.label)} — what each month usually does</div>
        <p class="dim small" style="margin:5px 0 0">
          ${got[0].first_year} to ${got[0].last_year}</p>

        ${columns(m)}
        ${open ? detail(m, open) : ''}

        <div class="row-gap" style="margin-top:16px">
          <span class="pill good">Strongest: ${esc(best.name)} ${pct(best.median_change)}</span>
          <span class="pill bad">Weakest: ${esc(worst.name)} ${pct(worst.median_change)}</span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">The same months, in numbers</div>
        <div class="tbl-wrap" style="margin-top:12px"><table>
          <thead><tr>
            <th>Month</th><th class="num">Years</th><th class="num">Typical</th>
            <th class="num">Average</th><th class="num">Usual dip</th><th class="num">Usual high</th>
            <th class="num">Usual swing</th><th class="num">Best</th><th class="num">Worst</th>
          </tr></thead>
          <tbody>${got.map(x => `
            <tr class="${x.month === thisMonth ? 'row-hot' : ''}">
              <td><b>${esc(x.name)}</b></td>
              <td class="num dim">${x.years}</td>
              <td class="num ${x.median_change >= 0 ? 'good' : 'bad'}"><b>${pct(x.median_change)}</b></td>
              <td class="num ${x.mean_change >= 0 ? 'good' : 'bad'}">${pct(x.mean_change)}</td>
              <td class="num bad">${pct(x.median_dip)}</td>
              <td class="num good">${pct(x.median_pop)}</td>
              <td class="num dim">${x.median_range.toFixed(1)}%</td>
              <td class="num good small">${pct(x.best)} <span class="dim">${x.best_year}</span></td>
              <td class="num bad small">${pct(x.worst)} <span class="dim">${x.worst_year}</span></td>
            </tr>`).join('')}</tbody>
        </table></div>
        <div class="notice" style="margin-top:14px"><span class="notice-ico"></span><div>
          <b>"Typical" and "average" are different on purpose.</b> Typical is the middle month —
          half were better, half worse. Average gets dragged around by one freak month.
          Where the two are far apart, one or two wild years are doing the talking, and the
          typical number is the one to trust.
          <br><b>"Usual dip" and "usual high"</b> are how far below and above the opening price it
          normally went before the month ended — what you would have had to sit through even in a
          month that finished up.
        </div></div>
      </div>`;
  }

  /* ── All three side by side ─────────────────────────
     Three bars per month so the year reads across in one go.

     The scale is the honest problem here. Bitcoin's typical months run
     from −8% to +28%; the indices live between −1% and +3%. Draw them
     on one ruler and the indices flatten into nothing. Draw them on
     separate rulers and a small index month LOOKS the same size as a
     huge Bitcoin one. Neither is wrong, both mislead on their own — so
     both are offered and the page says which one you are looking at. */
  const MCOL = { sp500: 'a', nasdaq: 'b', btc: 'c' };

  function allMarkets() {
    const ms = (data.markets || []).filter(m => m.months.some(x => x.years));
    const H = 168;

    /* Each market's own biggest typical month, for the side-by-side ruler. */
    const ownMax = {};
    ms.forEach(m => {
      ownMax[m.key] = Math.max(...m.months.filter(x => x.years)
        .map(x => Math.abs(x.median_change)), 0.1);
    });
    const globalMax = Math.max(...Object.values(ownMax));

    /* value → how far up or down from the middle line, as a fraction of 1 */
    const frac = (m, v) => scale === 'true' ? v / globalMax : v / ownMax[m.key];

    const groups = MONTH_SHORT.map((nm, i) => {
      const mo = i + 1;
      const cells = ms.map(m => ({ m, x: m.months.find(y => y.month === mo) }));
      const vals = cells.filter(c => c.x && c.x.years).map(c => c.x.median_change);
      const allUp = vals.length === ms.length && vals.every(v => v > 0);
      const allDown = vals.length === ms.length && vals.every(v => v < 0);
      const agree = allUp ? 'up' : allDown ? 'down' : '';

      return `
        <button class="sea-grp ${mo === thisMonth ? 'now' : ''} ${openMonth === mo ? 'open' : ''} ${agree ? 'agree-' + agree : ''}"
                data-month="${mo}" title="${esc(nm)} — click to compare all three">
          <span class="sea-plot sea-gplot" style="height:${H}px">
            <span class="sea-zero" style="top:50%"></span>
            <span class="sea-bars">
              ${cells.map(({ m, x }) => {
                if (!x || !x.years) return '<span class="sea-slot"></span>';
                const f = Math.max(-1, Math.min(1, frac(m, x.median_change)));
                const h = Math.max(2, Math.abs(f) * (H / 2));
                const up = x.median_change >= 0;
                return `<span class="sea-slot" title="${esc(m.label)} ${esc(x.name)}: ${pct(x.median_change)}">
                  <i class="sea-mini ${MCOL[m.key]} ${up ? 'up' : 'down'}"
                     style="height:${h}px;${up ? 'bottom:50%' : 'top:50%'}"></i></span>`;
              }).join('')}
            </span>
          </span>
          <span class="sea-col-name">${esc(nm)}</span>
          ${agree ? `<span class="sea-agree ${agree}">all ${agree}</span>` : '<span class="sea-agree blank"></span>'}
        </button>`;
    }).join('');

    const open = openMonth
      ? ms.map(m => ({ m, x: m.months.find(y => y.month === openMonth) })).filter(c => c.x && c.x.years)
      : null;

    return `
      <div class="card">
        <div class="row-between wrap">
          <div>
            <div class="card-title">All three together</div>
            <p class="dim small" style="margin:5px 0 0;max-width:80ch">
              The typical move for each month. Where all three lean the same way the pattern is
              about risk in general, not about one market — those months are highlighted.</p>
          </div>
          <div class="seg" id="scaleSeg">
            <button data-scale="own" class="${scale === 'own' ? 'on' : ''}">Each to its own size</button>
            <button data-scale="true" class="${scale === 'true' ? 'on' : ''}">True size</button>
          </div>
        </div>

        <div class="sea-legend">
          ${ms.map(m => `<span class="sea-key"><i class="${MCOL[m.key]}"></i>${esc(m.label)}</span>`).join('')}
        </div>

        <div class="sea-groups">${groups}</div>

        <div class="notice" style="margin-top:14px"><span class="notice-ico"></span><div>
          ${scale === 'true'
            ? `<b>True size.</b> One ruler for all three, so the heights really are comparable.
               Bitcoin moves roughly ten times as far as the indices, so it towers and they look
               flat — that gap is real, not a drawing trick. Switch to the other view to compare
               their shapes.`
            : `<b>Each to its own size.</b> Every market is drawn against its own biggest month,
               so you can compare the <i>shape</i> of the year across all three. Heights are
               <b>not</b> comparable between markets here — a full-height Bitcoin bar is about
               ten times a full-height index bar. Read the numbers below for real size.`}
        </div></div>

        ${open ? compareDetail(open) : ''}
      </div>

      ${allTable(ms)}`;
  }

  /* One month, all three markets, on the numbers that matter for timing. */
  function compareDetail(rows) {
    const name = rows[0].x.name;
    return `
      <div class="sea-detail" id="seaDetail">
        <div class="sea-detail-head">
          <div class="card-title">${esc(name)} — the three side by side
            ${rows[0].x.month === thisMonth ? '<span class="sea-flag">this month</span>' : ''}</div>
          <button class="btn ghost btn-sm" id="seaClose">Close</button>
        </div>

        <div class="tbl-wrap" style="margin-top:12px"><table>
          <thead><tr><th>Market</th><th class="num">Years</th><th class="num">Typical</th>
            <th class="num">Usual dip</th><th class="num">Usual high</th>
            <th class="num">First half</th><th class="num">Second half</th>
            <th>High lands</th><th>Low lands</th></tr></thead>
          <tbody>${rows.map(({ m, x }) => {
            const s = x.shape;
            const win = (r, n, of) => r
              ? `${ord(r[0])}–${ord(r[1])} <span class="dim">${n} of ${of}</span>`
              : '—';
            return `<tr>
              <td><b>${esc(m.label)}</b></td>
              <td class="num dim">${x.years}</td>
              <td class="num ${x.median_change >= 0 ? 'good' : 'bad'}"><b>${pct(x.median_change)}</b></td>
              <td class="num bad">${pct(x.median_dip)}</td>
              <td class="num good">${pct(x.median_pop)}</td>
              <td class="num ${s && s.first_half >= 0 ? 'good' : 'bad'}">${s ? pct2(s.first_half) : '—'}</td>
              <td class="num ${s && s.second_half >= 0 ? 'good' : 'bad'}">${s ? pct2(s.second_half) : '—'}</td>
              <td class="small">${win(s && s.high_day_range, s && s.high_in_range, s && s.years)}</td>
              <td class="small">${win(s && s.low_day_range, s && s.low_in_range, s && s.years)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>

      </div>`;
  }

  function allTable(ms) {
    return `
      <div class="card">
        <div class="card-title">The same months, in numbers</div>
        <p class="dim small" style="margin:5px 0 0">
          Typical close, and how far below the opening price it usually dipped on the way.</p>
        <div class="tbl-wrap" style="margin-top:12px"><table>
          <thead><tr><th>Month</th>
            ${ms.map(m => `<th class="tbl-grp" colspan="2">${esc(m.label)}</th>`).join('')}
            <th>Same way?</th></tr></thead>
          <tbody>
            <tr class="sub-head"><td></td>
              ${ms.map(() => '<td class="num dim small">typical</td><td class="num dim small">usual dip</td>').join('')}
              <td></td></tr>
            ${MONTH_SHORT.map((nm, i) => {
              const cells = ms.map(m => m.months.find(x => x.month === i + 1));
              const vals = cells.filter(c => c && c.years).map(c => c.median_change);
              const allUp = vals.length === ms.length && vals.every(v => v > 0);
              const allDown = vals.length === ms.length && vals.every(v => v < 0);
              return `<tr class="${i + 1 === thisMonth ? 'row-hot' : ''}">
                <td><b>${esc(nm)}</b></td>
                ${cells.map(c => c && c.years
                  ? `<td class="num ${c.median_change >= 0 ? 'good' : 'bad'}"><b>${pct(c.median_change)}</b></td>
                     <td class="num bad small">${pct(c.median_dip)}</td>`
                  : '<td class="num dim">—</td><td class="num dim">—</td>').join('')}
                <td>${allUp ? '<span class="pill good">all up</span>'
                     : allDown ? '<span class="pill bad">all down</span>'
                     : '<span class="dim small">mixed</span>'}</td>
              </tr>`;
            }).join('')}</tbody>
        </table></div>
      </div>`;
  }

  /* ── Render ───────────────────────────────────────── */
  function render() {
    if (loadErr) {
      UI.$('view').innerHTML = `<div class="card"><div class="notice">
        <span class="notice-ico"></span><div><b>The history file has not been built yet.</b><br>
        ${esc(loadErr)}<br><br>Run this once and it will appear:<br>
        <code>cd "JP DASHBOARD 3/seasonality" &amp;&amp; python3 build_seasonality.py</code>
      </div></div></div>`;
      return;
    }
    if (!data) {
      UI.$('view').innerHTML = '<div class="card"><p class="dim">Reading the history…</p></div>';
      return;
    }

    const ms = data.markets || [];
    const flagged = ms.reduce((n, m) => n + (m.flagged || []).length, 0);
    const cur = view === 'one' ? mk(market) : null;
    const single = cur && cur.timing_check && cur.timing_check.single_source;

    UI.$('view').innerHTML = `
      <div class="card">
        <div class="row-between wrap">
          <div class="seg" id="mktSeg">
            ${ms.map(m => `<button data-mkt="${m.key}" class="${view === 'one' && market === m.key ? 'on' : ''}">${esc(m.label)}</button>`).join('')}
            <button data-mkt="__all" class="${view === 'all' ? 'on' : ''}">All three</button>
          </div>
          <span class="dim small">Counted up to the end of ${esc(monthName(data.counts_up_to))}</span>
        </div>

      </div>

      ${view === 'all' ? allMarkets() : oneMarket()}`;

    wire();
  }

  function monthName(ym) {
    if (!ym) return '';
    const [y, m] = String(ym).split('-').map(Number);
    return `${['January','February','March','April','May','June','July','August',
               'September','October','November','December'][m - 1]} ${y}`;
  }

  function wire() {
    UI.$$('#mktSeg button').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.mkt === '__all') { view = 'all'; }
      else { view = 'one'; market = b.dataset.mkt; localStorage.setItem('jp3_seasonality_market', market); }
      localStorage.setItem('jp3_seasonality_view', view);
      render();
    }));

    UI.$$('#scaleSeg button').forEach(b => b.addEventListener('click', () => {
      scale = b.dataset.scale;
      localStorage.setItem('jp3_seasonality_scale', scale);
      render();
    }));

    UI.$$('[data-month]').forEach(b => b.addEventListener('click', () => {
      const m = Number(b.dataset.month);
      openMonth = (openMonth === m) ? null : m;
      render();
      if (openMonth) {
        const d = UI.$('seaDetail');
        if (d) d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }));

    const close = UI.$('seaClose');
    if (close) close.addEventListener('click', () => { openMonth = null; render(); });
  }

  function enter() {
    /* Open the month you are actually in — that is the one she wants. */
    if (openMonth === null) openMonth = thisMonth;
    render();
    if (!data && !loadErr) load();
  }

  return { render: enter, title: 'Calendar',
           sub: () => 'What each month has done, and when inside the month it does it' };
})();
