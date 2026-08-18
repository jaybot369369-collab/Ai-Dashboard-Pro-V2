/* ═══════════════════════════════════════════════════════════
   STATS — pure maths. No saving, no drawing, no fetching.

   Every function takes trades in and gives numbers out, so the
   same figure can never come out different on two pages.

   Jay's own limits, from her risk charter:
     risk per trade   $50
     stop for the day −$100
     stop for the week −$200
     three losses in a row → halve your size
     one loss over $75 → the stop failed, take tomorrow off
════════════════════════════════════════════════════════════ */
const Stats = (() => {
  'use strict';

  const RISK_PER_TRADE = 50;
  const DAY_STOP   = -100;
  const WEEK_STOP  = -200;
  const BIG_LOSS   = -75;
  const START_BALANCE = 5000;

  const num = (v, d = 0) => {
    if (v === null || v === undefined || v === '' || v === '-') return d;
    const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : d;
  };
  const str = v => (v === null || v === undefined) ? '' : String(v).trim();

  /** A trade counts as finished once a money result is written down. */
  const isClosed = t => str(t.result) !== '';
  const isOpen   = t => !isClosed(t);
  const pl       = t => num(t.result);

  const closed = ts => ts.filter(isClosed);
  const open   = ts => ts.filter(isOpen);

  function totals(ts) {
    const c = closed(ts);
    const wins   = c.filter(t => pl(t) > 0);
    const losses = c.filter(t => pl(t) < 0);
    const gross  = wins.reduce((s, t) => s + pl(t), 0);
    const bad    = Math.abs(losses.reduce((s, t) => s + pl(t), 0));
    const fees   = ts.reduce((s, t) => s + num(t.fees), 0);
    return {
      count: ts.length,
      closed: c.length,
      open: ts.length - c.length,
      wins: wins.length,
      losses: losses.length,
      winRate: c.length ? (wins.length / c.length) * 100 : 0,
      total: c.reduce((s, t) => s + pl(t), 0),
      fees,
      netAfterFees: c.reduce((s, t) => s + pl(t), 0) - fees,
      biggestWin: wins.length ? Math.max(...wins.map(pl)) : 0,
      biggestLoss: losses.length ? Math.min(...losses.map(pl)) : 0,
      avgWin: wins.length ? gross / wins.length : 0,
      avgLoss: losses.length ? -bad / losses.length : 0,
      /** How many pounds you make for every pound you lose. */
      moneyMade: gross, moneyLost: bad,
      ratio: bad ? gross / bad : (gross ? Infinity : null),
    };
  }

  const balance = ts => START_BALANCE + totals(ts).total;

  /** Running balance, oldest first — for the line chart. */
  function equity(ts) {
    const c = closed(ts).slice().sort(byDate);
    let run = START_BALANCE;
    return c.map(t => ({ date: t.date, balance: (run += pl(t)), trade: t }));
  }

  const byDate = (a, b) =>
    (String(a.date) + str(a.time)).localeCompare(String(b.date) + str(b.time));

  /** Money made or lost per calendar day. */
  function dailyMoney(ts) {
    const m = {};
    closed(ts).forEach(t => { m[t.date] = (m[t.date] || 0) + pl(t); });
    return m;
  }

  /** How many losses in a row, counting back from the most recent. */
  function lossStreak(ts) {
    const c = closed(ts).slice().sort(byDate);
    let n = 0;
    for (let i = c.length - 1; i >= 0; i--) {
      if (pl(c[i]) < 0) n++; else break;
    }
    return n;
  }

  /* ── Jay's limits, checked ────────────────────────── */
  function limitCheck(ts, todayISO) {
    const today = todayISO || new Date().toISOString().slice(0, 10);
    const d = new Date(today + 'T00:00:00');
    const monday = new Date(d); monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const weekStart = monday.toISOString().slice(0, 10);

    const todays = ts.filter(t => t.date === today);
    const weeks  = ts.filter(t => t.date >= weekStart);
    const dayPL  = totals(todays).total;
    const weekPL = totals(weeks).total;
    const streak = lossStreak(ts);
    const worstToday = todays.length ? Math.min(0, ...closed(todays).map(pl)) : 0;

    const hits = [];
    if (dayPL <= DAY_STOP)  hits.push({ rule: `You have lost $${Math.abs(dayPL).toFixed(0)} today`,
      detail: 'Your limit for one day is $100. Stop now and close the platform.' });
    if (weekPL <= WEEK_STOP) hits.push({ rule: `You have lost $${Math.abs(weekPL).toFixed(0)} this week`,
      detail: 'Your limit for a week is $200. No more trades until your weekly review is written.' });
    if (streak >= 3) hits.push({ rule: `${streak} losses in a row`,
      detail: 'Drop to $25 a trade until you get two wins back to back.' });
    if (worstToday < BIG_LOSS) hits.push({ rule: `One trade lost $${Math.abs(worstToday).toFixed(0)} today`,
      detail: 'A loss that size means the stop did not do its job. Take tomorrow off and write up what happened.' });

    return {
      today, weekStart, dayPL, weekPL, streak, worstToday,
      tradesToday: todays.length,
      hits,
      state: hits.length ? 'RED' : (dayPL <= -RISK_PER_TRADE ? 'AMBER' : 'GREEN'),
      dayLeft: Math.max(0, Math.abs(DAY_STOP) + Math.min(0, dayPL)),
      dayLimit: Math.abs(DAY_STOP),
      weekLimit: Math.abs(WEEK_STOP),
      riskPerTrade: RISK_PER_TRADE,
    };
  }

  /* ── Grouping ─────────────────────────────────────── */
  function groupBy(ts, keyFn) {
    const m = new Map();
    ts.forEach(t => {
      const k = keyFn(t) || '(not filled in)';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(t);
    });
    return [...m.entries()]
      .map(([key, rows]) => ({ key, rows, n: rows.length, ...totals(rows) }))
      .sort((a, b) => b.n - a.n);
  }

  const bySetup   = ts => groupBy(ts, t => str(t.setupType) || (t.setupTypes || [])[0]);
  const bySymbol  = ts => groupBy(ts, t => str(t.symbol).toUpperCase().replace(/[^A-Z]/g, '').replace(/USDT|USDC|PERP|P$/g, '') || '?');
  const bySession = ts => groupBy(ts, t => str(t.session) || 'Not set');
  const byGrade   = ts => groupBy(ts, t => str(t.preGrade) || 'Not graded');
  const byDay     = ts => groupBy(ts, t => ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date(t.date + 'T12:00:00').getDay()]);

  /** Day of week down the side, hour across the top. */
  function dayHourGrid(ts) {
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const grid = days.map(() => Array(24).fill(null));
    closed(ts).forEach(t => {
      const d = new Date(t.date + 'T12:00:00');
      const row = (d.getDay() + 6) % 7;
      const h = parseInt(str(t.time).slice(0, 2), 10);
      if (!Number.isFinite(h)) return;
      grid[row][h] = (grid[row][h] || 0) + pl(t);
    });
    return { days, grid };
  }

  /* ── The habit comparison that drives the desk ───── */
  function habits(ts) {
    const n = ts.length;
    const cut = (label, rule, test, otherLabel, why) => {
      const hit  = ts.filter(test);
      const rest = ts.filter(t => !test(t));
      const a = totals(hit).total, b = totals(rest).total;
      return {
        label, rule, why, otherLabel,
        count: hit.length, of: n,
        pct: n ? Math.round((hit.length / n) * 1000) / 10 : 0,
        pl: a, plOther: b,
        difference: a - b,
        costly: (a - b) < 0,
        tooFew: hit.length < 20,
      };
    };

    return [
      cut('Trades you graded C, D, or never graded', 'Only trade your A and B ideas',
          t => !['A', 'B'].includes(str(t.preGrade)),
          'trades you graded A or B',
          'Only A and B ideas are worth taking. Everything else is a skip.'),
      cut('Trades with no setup name', 'Only trade setups with a name',
          t => str(t.setupType) === Store.NO_SETUP || (!str(t.setupType) && !(t.setupTypes || []).length),
          'trades with a setup name',
          "If it has no name, you don't trade it. A trade with no name is one you made up on the spot."),
      cut('Trades where you never wrote down a stop', 'Always have a stop',
          t => str(t.sl) === '',
          'trades that had a stop',
          'No stop in the market, no trade. You wrote that yourself, and it has no override.'),
      cut('Trades taken outside London, New York or Asia', 'Trade inside your sessions',
          t => ['Other', ''].includes(str(t.session)),
          'trades inside those sessions',
          "You log a session on every trade. 'Other' means the timing had nothing behind it."),
      cut('Short trades taken', 'Learn the short side',
          t => str(t.direction).toLowerCase() === 'short',
          'long trades',
          "Your plan is 20 practice shorts before any go live."),
    ].sort((x, y) => x.difference - y.difference);
  }

  /** Trades written down but never finished off. */
  function unfinished(ts, todayISO) {
    const today = new Date((todayISO || new Date().toISOString().slice(0, 10)) + 'T00:00:00');
    return open(ts).filter(t => t.date).map(t => ({
      ...t,
      ageDays: Math.round((today - new Date(t.date + 'T00:00:00')) / 86400000),
      hasStop: str(t.sl) !== '',
    })).sort((a, b) => b.ageDays - a.ageDays);
  }

  return {
    RISK_PER_TRADE, DAY_STOP, WEEK_STOP, START_BALANCE,
    num, str, isClosed, isOpen, pl, closed, open, byDate,
    totals, balance, equity, dailyMoney, lossStreak, limitCheck,
    groupBy, bySetup, bySymbol, bySession, byGrade, byDay, dayHourGrid,
    habits, unfinished,
  };
})();
