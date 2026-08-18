/* ═══════════════════════════════════════════════════════════
   STORE — the only place that touches saved data.

   Everything lives in the browser under jp3_* keys. On the very
   first run it loads data/seed.json (Jay's 81 real trades from 27 April
   onward, plus her playbook, rules and goals) and copies it in. After
   that the browser copy is the live one.

   Split on purpose: this file reads and writes, stats.js does the
   maths, the pages do the drawing. Nothing else calls localStorage.

   WRITING RULE: plain simple English on screen. No jargon.
════════════════════════════════════════════════════════════ */
const Store = (() => {
  'use strict';

  const K = {
    trades:   'jp3_trades',
    playbook: 'jp3_playbook',
    rules:    'jp3_rules',
    checklist:'jp3_checklist',
    goals:    'jp3_goals',
    journal:  'jp3_journal',
    reviews:  'jp3_reviews',
    events:   'jp3_events',
    decisions:'jp3_decisions',
    eventPlan:'jp3_event_decisions',
    settings: 'jp3_settings',
    seeded:   'jp3_seeded_v1',
    lastExport:'jp3_last_export',
  };

  /* Fields inside `settings` that must NEVER reach an export file.
     These live inside the settings object, not as their own keys — the first
     version of this list named top-level keys that do not exist, so the filter
     silently did nothing and the key went into the file anyway. Same class of
     bug that put a live token in Downloads on the old dashboard. */
  const SECRET_FIELDS = ['aiKey', 'pin', 'uploadUrl', 'gistToken', 'tgToken'];

  /* Jay restarted the account on this date. The 1,430 imported trades from
     before it were dropped on 2026-08-14 — they were noise: none had a stop,
     none had a grade, only 2 in 100 had a setup name, and four fifths had no
     result recorded at all. Full copy kept in _archive_full_history/.

     Enforced in four places so nothing older can creep back in: first load,
     saving a trade, importing a backup, and exporting one. */
  const ACCOUNT_START = '2026-04-27';

  /** True if this trade belongs to the current account. */
  const isCurrentAccount = t => String((t && t.date) || '').slice(0, 10) >= ACCOUNT_START;

  const NO_SETUP = '— NO SETUP —';

  let _cache = {};

  function read(key, fallback) {
    if (key in _cache) return _cache[key];
    try {
      const v = JSON.parse(localStorage.getItem(key));
      _cache[key] = (v === null || v === undefined) ? fallback : v;
    } catch { _cache[key] = fallback; }
    return _cache[key];
  }

  function write(key, val) {
    _cache[key] = val;
    try {
      localStorage.setItem(key, JSON.stringify(val));
      // Ask for a quiet background copy to the server. Debounced in there,
      // so a burst of edits becomes one save.
      if (typeof ServerSave !== 'undefined') ServerSave.schedule();
      return true;
    } catch (e) {
      const full = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
      if (full) {
        alert('The browser storage is full, so that did not save.\n\n'
            + 'Go to Settings and move your screenshots to cloud storage, '
            + 'or export a backup and clear some space.');
      }
      console.error('[store] save failed', key, e);
      return false;
    }
  }

  /* ── First run: copy the real data in ─────────────── */
  async function init() {
    /* ?fresh=1 — reload the starting data from data/seed.json.

       The seeding below runs ONCE per browser and then never looks at the
       file again, which is exactly right for a real dashboard: a deploy can
       never overwrite what you have written. On a preview copy it means an
       updated seed file is invisible to anyone who opened the page earlier,
       with no way out short of clearing site data. This is that way out. */
    if (/[?&]fresh=1\b/.test(location.search)) {
      /* Reset to the starting data, WITHOUT a dialog.

         The first version of this asked with confirm(). That was wrong twice
         over: a modal on page load blocks the whole tab until it is answered,
         and it cannot be dismissed by anything except a human hand — so the
         reset silently did nothing wherever a dialog is auto-dismissed.

         The guard is now the data itself. Everything the demo seeds carries a
         "demo" id, so if every stored trade is demo data there is nothing of
         anyone's to lose and it resets. The moment one real trade is present
         it refuses and says so. A dashboard holding real trades cannot be
         wiped by this, with or without a dialog. */
      const held = read(K.trades, []) || [];
      const allDemo = held.every(t => String(t && t.id || '').startsWith('demo'));
      if (allDemo) {
        Object.values(K).forEach(k => localStorage.removeItem(k));
        clearCache();
        console.info('[fresh] starting data reloaded');
      } else {
        const real = held.filter(t => !String(t && t.id || '').startsWith('demo')).length;
        console.warn(`[fresh] refused — ${real} real trade(s) here. Nothing was changed.`);
        try {
          sessionStorage.setItem('jp3_fresh_refused', String(real));
        } catch (e) {}
      }
      history.replaceState(null, '', location.pathname + location.hash);
    }

    if (localStorage.getItem(K.seeded)) { cleanOutOldTrades(); return { seeded: false }; }
    const r = await fetch('data/seed.json?t=' + Date.now());
    if (!r.ok) throw new Error('Could not load your starting data (seed.json)');
    const s = await r.json();

    const kept = (s.trades || []).filter(isCurrentAccount).map(normaliseTrade);
    write(K.trades,   kept);
    write(K.playbook, s.playbook || []);
    write(K.rules,    s.rules || {});
    write(K.checklist,s.checklist || {});
    write(K.goals,    s.goals || {});
    write(K.journal,  s.journal || {});
    write(K.reviews,  s.reviews || []);
    localStorage.setItem(K.seeded, new Date().toISOString());
    return { seeded: true, count: kept.length, dropped: (s.trades || []).length - kept.length };
  }

  /* ── Trades ───────────────────────────────────────── */
  function normaliseTrade(t) {
    const out = { ...t };
    if (!out.id) out.id = 'id' + Math.random().toString(36).slice(2, 12);
    out.date = String(out.date || '').slice(0, 10);
    // An empty setup box is a real thing that happened: a trade taken with no
    // plan. Label it so it shows up in the numbers instead of hiding as a blank.
    const tag = String(out.setupType || '').trim();
    if (!tag && !(Array.isArray(out.setupTypes) && out.setupTypes.length)) {
      out.setupType = NO_SETUP;
      out._autoNoSetup = true;   // flagged so Jay can correct the guess
    }
    return out;
  }

  /* Deletes anything older than day one out of the browser for good.
     Runs on every start, not just the first one.

     Why this exists: the cut-off used to be applied only when the data was
     first copied in. Any browser that had already loaded the dashboard kept
     its old copy of all 1,511 trades, because the "already loaded" flag
     stopped it ever refreshing. Testing on a freshly cleared browser hid the
     problem completely — it only showed up on a browser that had been open
     before the change. */
  function cleanOutOldTrades() {
    let raw;
    try { raw = JSON.parse(localStorage.getItem(K.trades)) || []; }
    catch { return 0; }
    if (!Array.isArray(raw)) return 0;
    const kept = raw.filter(isCurrentAccount);
    const removed = raw.length - kept.length;
    if (removed > 0) {
      localStorage.setItem(K.trades, JSON.stringify(kept));
      _cache = {};
      console.info(`[store] removed ${removed} trades from before ${ACCOUNT_START}`);
    }
    return removed;
  }

  /* Reading also filters, so even if something slipped past the cleanup
     nothing older can reach a page or a number. */
  const trades     = () => read(K.trades, []).filter(isCurrentAccount);
  const saveTrades = a => write(K.trades, (a || []).filter(isCurrentAccount));
  /** Same list. Kept as a second name so every page reads the same way. */
  const liveTrades = () => trades();

  function addTrade(t) {
    const all = trades();
    const row = normaliseTrade({ ...t, id: 'id' + Date.now().toString(36), createdAt: new Date().toISOString(), source: 'manual' });
    all.push(row);
    saveTrades(all);
    return row;
  }
  function updateTrade(id, patch) {
    saveTrades(trades().map(t => t.id === id ? normaliseTrade({ ...t, ...patch }) : t));
  }
  function deleteTrade(id) { saveTrades(trades().filter(t => t.id !== id)); }
  const tradeById = id => trades().find(t => t.id === id);

  /* ── Everything else ──────────────────────────────── */
  const playbook     = () => read(K.playbook, []);
  const savePlaybook = a => write(K.playbook, a);
  const rules        = () => read(K.rules, { scalp: [], swing: [], longterm: [], redFlags: [] });
  const saveRules    = o => write(K.rules, o);
  const goals        = () => read(K.goals, {});
  const saveGoals    = o => write(K.goals, o);
  const journal      = () => read(K.journal, {});
  const saveJournal  = o => write(K.journal, o);
  const reviews      = () => read(K.reviews, []);
  const saveReviews  = a => write(K.reviews, a);
  const events       = () => read(K.events, null);
  const saveEvents   = a => write(K.events, a);
  const decisions    = () => read(K.decisions, []);
  const saveDecisions= a => write(K.decisions, a);
  const eventPlan    = () => read(K.eventPlan, {});
  const saveEventPlan= o => write(K.eventPlan, o);
  const settings     = () => read(K.settings, {});
  function saveSettings(patch) { return write(K.settings, { ...settings(), ...patch }); }

  /* ── Backup ───────────────────────────────────────── */
  /** One export route, and it can never carry a password or key. */
  function exportAll() {
    const data = {};
    const odd = [];
    Object.entries(K).forEach(([name, key]) => {
      if (name === 'seeded') return;
      const v = localStorage.getItem(key);
      if (v === null) return;
      /* Not everything in here is JSON. markExported() writes a bare ISO
         date string, so a plain JSON.parse threw "Unexpected non-whitespace
         character at position 4" — right after the year — and every backup
         AFTER the first one failed. Both the zip and the plain export.

         The old code special-cased `seeded` for exactly this reason and
         missed `lastExport`, which is the tell: a skip-list only fixes the
         key you already know about. Anything that will not parse is kept as
         the raw string instead, so the next bare value cannot break saving
         a backup again. */
      try {
        data[name] = JSON.parse(v);
      } catch {
        data[name] = v;
        odd.push(name);
      }
    });

    // Strip the secrets out of settings before anything leaves the browser.
    const removed = [];
    if (data.settings && typeof data.settings === 'object') {
      data.settings = { ...data.settings };
      SECRET_FIELDS.forEach(f => {
        if (data.settings[f]) { delete data.settings[f]; removed.push(f); }
      });
    }

    // Nothing older than day one goes in the file, even if something older
    // somehow got in. The backup should be as clean as the dashboard.
    let older = 0;
    if (Array.isArray(data.trades)) {
      const before = data.trades.length;
      data.trades = data.trades.filter(isCurrentAccount);
      older = before - data.trades.length;
    }

    return {
      _about: 'JP Dashboard 3 backup. Trades from 27 April 2026 onward only. '
            + 'Your key, PIN and upload address are deliberately left out.',
      _saved: new Date().toISOString(),
      _from: ACCOUNT_START,
      _tradeCount: (data.trades || []).length,
      _leftOut: removed,
      _olderTradesSkipped: older,
      _notJson: odd,          // kept as raw text rather than crashing the export
      data,
    };
  }

  /** Proves the strip actually works. Used by the Settings page. */
  function exportIsClean() {
    const text = JSON.stringify(exportAll());
    const s = settings();
    const leaked = SECRET_FIELDS.filter(f => s[f] && text.includes(String(s[f])));
    return { clean: leaked.length === 0, leaked };
  }

  /** Loading a backup in. Older trades are dropped on the way through, so an
      old V2 export can't put the 1,430 back. Says how many it skipped. */
  function importAll(obj) {
    const d = (obj && obj.data) ? obj.data : obj;
    let n = 0, skipped = 0;
    Object.entries(K).forEach(([name, key]) => {
      if (name === 'seeded') return;
      if (d[name] === undefined) return;
      let val = d[name];
      if (name === 'trades' && Array.isArray(val)) {
        const before = val.length;
        val = val.filter(isCurrentAccount).map(normaliseTrade);
        skipped = before - val.length;
      }
      write(key, val); n++;
    });
    localStorage.setItem(K.seeded, new Date().toISOString());
    _cache = {};
    return { restored: n, tradesKept: (read(K.trades, []) || []).length, skipped };
  }

  const lastExport     = () => localStorage.getItem(K.lastExport);
  const markExported   = () => localStorage.setItem(K.lastExport, new Date().toISOString());
  const daysSinceExport = () => {
    const t = lastExport();
    return t ? Math.floor((Date.now() - new Date(t)) / 86400000) : null;
  };

  function storageUsedMB() {
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      n += (k.length + (localStorage.getItem(k) || '').length) * 2;
    }
    return n / 1048576;
  }

  function clearCache() { _cache = {}; }

  return {
    K, init, ACCOUNT_START, NO_SETUP, SECRET_FIELDS, exportIsClean, isCurrentAccount,
    cleanOutOldTrades,
    trades, liveTrades, saveTrades, addTrade, updateTrade, deleteTrade, tradeById,
    playbook, savePlaybook, rules, saveRules, goals, saveGoals,
    journal, saveJournal, reviews, saveReviews,
    events, saveEvents, decisions, saveDecisions, eventPlan, saveEventPlan,
    settings, saveSettings,
    exportAll, importAll, lastExport, markExported, daysSinceExport,
    storageUsedMB, clearCache,
  };
})();
