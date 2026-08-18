/* ═══════════════════════════════════════════════════════════
   COMPATIBILITY SHIM

   The Playbook, Tendencies, Level 2 and Radar pages are
   carried over from the old dashboard word for word, so no feature
   gets lost in the move. They expect the old `DB` and `App` names.

   This maps those onto the new Store and Stats. Nothing here holds
   data of its own — it just translates.

   The one rule it enforces: every trade list handed to an old module
   is the current account only. The old code had its own idea of which
   trades counted; here there is only one answer.
════════════════════════════════════════════════════════════ */
const DB = (() => {
  'use strict';

  const num = v => parseFloat(String(v ?? '').replace(/[$,\s]/g, '')) || 0;
  const isClosed = t => t.result !== undefined && t.result !== null && String(t.result).trim() !== '';

  /* ── Trades ── */
  const getTrades    = () => Store.trades();
  const newEraTrades = () => Store.trades();
  const saveTrades   = a => Store.saveTrades(a);
  const updateTrade  = (id, patch) => Store.updateTrade(id, patch);
  const getTradeById = id => Store.tradeById(id);
  const getScreenshots = t =>
    (t.screenshotUrls || (t.screenshotUrl ? [t.screenshotUrl] : [])).filter(Boolean);

  /* Everything is the current account now, so these are pass-throughs. */
  const filterByMode = trades => trades;

  function filterByRange(trades, rangeStr, from, to) {
    if (!rangeStr || rangeStr === 'alltime') return trades;
    if (rangeStr === 'custom' && from && to) {
      return trades.filter(t => t.date >= from && t.date <= to);
    }
    const days = parseInt(rangeStr, 10) || 30;
    const cut = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    return trades.filter(t => t.date >= cut);
  }

  /* ── Stats — same shape the old modules expect ── */
  function calcStats(trades) {
    const t = Stats.totals(trades);
    const closed = trades.filter(isClosed)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    let peak = 0, eq = 0, maxDD = 0;
    closed.forEach(x => {
      eq += num(x.result);
      if (eq > peak) peak = eq;
      if (peak - eq > maxDD) maxDD = peak - eq;
    });
    const avgR = closed.length
      ? closed.reduce((s, x) => s + num(x.rMultiple), 0) / closed.length : 0;
    return {
      total: trades.length, closed: t.closed, wins: t.wins, losses: t.losses,
      totalPL: t.total, winRate: t.winRate, avgR, maxDD,
      totalFees: t.fees, netAfterFees: t.netAfterFees,
    };
  }

  const dailyPLMap = trades => Stats.dailyMoney(trades);
  const equityCurve = trades => Stats.equity(trades)
    .map(p => ({ date: p.date, equity: p.balance - Stats.START_BALANCE }));
  const profitFactor = trades => {
    const t = Stats.totals(trades);
    return { pf: t.ratio, gross: t.moneyMade, loss: t.moneyLost };
  };

  /* ── Playbook ── */
  const getPlaybook  = () => Store.playbook();
  const savePlaybook = a => Store.savePlaybook(a);
  function addSetup(s) {
    const pb = getPlaybook();
    const row = { id: 'sp' + Date.now().toString(36), ...s };
    pb.push(row); savePlaybook(pb); return row;
  }
  function updateSetup(id, patch) {
    savePlaybook(getPlaybook().map(s => s.id === id ? { ...s, ...patch } : s));
  }
  function deleteSetup(id) {
    savePlaybook(getPlaybook().filter(s => s.id !== id));
  }

  const getAdherenceThreshold = () => Store.settings().adherence ?? 0.7;

  /** Recount each setup from the trades. Nothing gets a verdict under 20. */
  function recomputePlaybookStats() {
    const trades = getTrades().filter(isClosed);
    const thr = getAdherenceThreshold();
    const pb = getPlaybook().map(setup => {
      const matching = trades.filter(t => {
        const tags = t.setupTypes || (t.setupType ? [t.setupType] : []);
        return tags.includes(setup.name) || tags.includes(setup.id);
      });
      const wins = matching.filter(t => num(t.result) > 0);
      const avgR = matching.length
        ? matching.reduce((s, t) => s + num(t.rMultiple), 0) / matching.length : null;
      const list = setup.checklist || [];
      const mk = () => ({ n: 0, wins: 0, rSum: 0, pl: 0 });
      const kept = mk(), broke = mk();
      if (list.length) {
        matching.forEach(t => {
          const checks = (t.setupRuleChecks || {})[setup.id];
          if (!Array.isArray(checks)) return;
          const met = list.reduce((n, _, i) => n + (checks[i] ? 1 : 0), 0);
          const b = (met / list.length) >= thr ? kept : broke;
          b.n++; if (num(t.result) > 0) b.wins++;
          b.rSum += num(t.rMultiple); b.pl += num(t.result);
        });
      }
      const fin = o => o.n ? { n: o.n, wr: (o.wins / o.n) * 100, avgR: o.rSum / o.n, pl: o.pl } : null;
      return {
        ...setup,
        tradeCount: matching.length,
        winRate: matching.length ? (wins.length / matching.length) * 100 : null,
        avgR, adhFollowed: fin(kept), adhBroke: fin(broke),
      };
    });
    savePlaybook(pb);
    return pb;
  }

  /* ── Rules, mistakes, strengths ── */
  const getRules      = () => Store.rules();
  const saveRules     = o => Store.saveRules(o);
  const getMistakes   = () => Store.settings().mistakes || [];
  const saveMistakes  = a => Store.saveSettings({ mistakes: a });
  const getStrengths  = () => Store.settings().strengths || [];
  const saveStrengths = a => Store.saveSettings({ strengths: a });
  const getGoals      = () => Store.goals();
  const saveGoals     = o => Store.saveGoals(o);

  /* ── Pattern finder used by Tendencies ── */
  function analyzePatterns(trades) {
    const mistakes = [], strengths = [];
    const closed = trades.filter(isClosed);
    if (!closed.length) return { mistakes, strengths };
    const wr = (Stats.totals(closed).winRate) || 0;
    const ids = arr => arr.map(t => t.id).filter(Boolean);

    const bucket = (keyFn, minN, labelFor) => {
      const g = {};
      closed.forEach(t => {
        const k = keyFn(t);
        if (!k) return;
        (g[k] = g[k] || []).push(t);
      });
      Object.entries(g).forEach(([k, arr]) => {
        if (arr.length < minN) return;
        const w = arr.filter(t => num(t.result) > 0).length;
        const rate = (w / arr.length) * 100;
        const money = arr.reduce((s, t) => s + num(t.result), 0);
        const target = rate < wr - 10 ? mistakes : (rate > wr + 10 ? strengths : null);
        if (!target) return;
        target.push({
          title: labelFor(k, rate < wr - 10),
          description: `${arr.length} trades · you win ${rate.toFixed(0)} out of every 100 here, `
                     + `against ${wr.toFixed(0)} overall. They add up to `
                     + `${money >= 0 ? '+' : '−'}$${Math.abs(money).toFixed(0)}.`
                     + (arr.length < 20 ? ' Only ' + arr.length + ' trades, so treat it as a hint, not a fact.' : ''),
          seenCount: arr.length,
          lastSeen: arr.slice(-1)[0]?.date,
          linkedTradeIds: ids(arr).slice(0, 10),
        });
      });
    };

    bucket(t => t.session, 5, (k, bad) => bad ? `The ${k} session is going badly` : `The ${k} session is working`);
    bucket(t => t.setupType, 5, (k, bad) => bad ? `${k} is losing money` : `${k} is working`);
    bucket(t => t.preGrade, 5, (k, bad) => bad ? `Trades you graded ${k} go badly` : `Trades you graded ${k} do well`);
    bucket(t => (String(t.sl || '').trim() ? null : 'no stop'), 5,
           () => 'Trades with no stop written down');
    return { mistakes, strengths };
  }

  /* Old code read raw keys through DB.get */
  const KEYS = Store.K;
  const get = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };

  return {
    KEYS, get,
    getTrades, newEraTrades, saveTrades, updateTrade, getTradeById, getScreenshots,
    filterByMode, filterByRange,
    calcStats, dailyPLMap, equityCurve, profitFactor,
    getPlaybook, savePlaybook, addSetup, updateSetup, deleteSetup,
    recomputePlaybookStats, getAdherenceThreshold,
    getRules, saveRules, getMistakes, saveMistakes, getStrengths, saveStrengths,
    getGoals, saveGoals, analyzePatterns,
  };
})();

/* Old modules call App.toast / App.confirmDelete / App.navigate.
   App itself is defined later, so attach these once it exists. */
document.addEventListener('DOMContentLoaded', () => {
  if (typeof App === 'undefined') return;
  if (!App.toast)         App.toast = (m, k) => UI.toast(m, k);
  if (!App.confirmDelete) App.confirmDelete = (msg, fn) => { if (confirm(msg)) fn(); };
  if (!App.navigate)      App.navigate = id => App.go(id);
});

/* Tendencies opens a chart popup for a trade. Not carried over yet —
   this keeps the button honest instead of throwing. */
const TradeView = {
  open: () => UI.toast('The trade chart popup is not carried over yet', 'bad'),
  _klines: async () => [],
};
