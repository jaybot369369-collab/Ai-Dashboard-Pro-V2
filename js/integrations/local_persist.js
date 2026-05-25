/* ═══════════════════════════════════════════════════════════
   LOCAL PERSIST — server-side persistence for AI Dashboard Pro
   Pushes trades + AI key to the fund API on disk so they survive
   browser localStorage clears (Chrome auto-eviction, "clear browsing
   data", profile switches, cloudflare tunnel rotation, etc).

   Architecture:
     Browser localStorage (jb_trades, jb_ai_key, jb_ai_model)
                  ↕ debounced sync, both directions
     fund.api  http://127.0.0.1:8767/api/dashboard/state
                  ↕ atomic writes
     Disk      fund_data/dashboard_state.json (chmod 600)

   On page load:
     1. Try fetch from fund API
     2. If fund returns data → write into localStorage (overwrite)
     3. If fund unreachable → fall back to whatever's in localStorage
     4. If localStorage also empty → fall back to assets/seed_trades.json

   On every change (DB.addTrade / save AI key / etc):
     - Write to localStorage immediately (existing behaviour, fast)
     - Schedule a debounced (2s) POST to fund API in background
     - Failures are logged but non-fatal (localStorage is still the
       in-session source of truth)
═══════════════════════════════════════════════════════════ */
const LocalPersist = (() => {

  // Auto-detect Railway: localhost → direct port, remote → same-origin /api
  const _lpIsLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const FUND_LOCAL_URL = _lpIsLocal
    ? 'http://127.0.0.1:8767/api/dashboard/state'
    : (window.location.origin + '/api/dashboard/state');
  const DEBOUNCE_MS    = 2000;
  let _timer = null;
  let _available = null;   // null=unknown, true/false after first probe

  /* ── Reachability check (one-shot, cached after first call) ── */
  async function isAvailable() {
    if (_available !== null) return _available;
    try {
      const r = await fetch(FUND_LOCAL_URL, {
        method: 'GET', mode: 'cors', cache: 'no-store',
        signal: AbortSignal.timeout ? AbortSignal.timeout(2500) : undefined,
      });
      _available = r.ok;
    } catch (e) {
      _available = false;
    }
    return _available;
  }

  /* ── Pull from disk → localStorage. Called once on page load. ── */
  async function loadFromFund() {
    if (!(await isAvailable())) return { ok: false, reason: 'fund-api-down' };
    try {
      const r = await fetch(FUND_LOCAL_URL, {
        method: 'GET', mode: 'cors', cache: 'no-store',
      });
      if (!r.ok) return { ok: false, reason: `HTTP ${r.status}` };
      const j = await r.json();

      // Trades — only overwrite if fund has a non-empty list. This
      // prevents an EMPTY fund file (first install, fund just started)
      // from wiping a populated localStorage.
      const fundTrades = Array.isArray(j.trades) ? j.trades : [];
      const localTrades = JSON.parse(localStorage.getItem('jb_trades') || '[]');
      let tradesAction = 'kept-local';
      if (fundTrades.length >= localTrades.length) {
        // Fund has more (or equal) — fund wins
        localStorage.setItem('jb_trades', JSON.stringify(fundTrades));
        tradesAction = `loaded-from-fund (${fundTrades.length})`;
      } else if (fundTrades.length === 0 && localTrades.length > 0) {
        // Fund empty, local has data — push local UP to fund instead
        scheduleSave();
        tradesAction = `pushing-local-up (${localTrades.length})`;
      } else {
        // Local has more (rare — should only happen mid-import)
        // — push local up to fund instead so they reconverge
        scheduleSave();
        tradesAction = `pushing-local-up (${localTrades.length} > ${fundTrades.length})`;
      }

      // API key — fund wins if non-empty (so adding the key once on the
      // server side makes it appear in browsers automatically).
      let keyAction = 'kept-local';
      if (j.ai_key && typeof j.ai_key === 'string' && j.ai_key.length > 10) {
        localStorage.setItem('jb_ai_key', j.ai_key);
        keyAction = 'loaded-from-fund';
      }
      let modelAction = 'kept-local';
      if (j.ai_model && typeof j.ai_model === 'string') {
        localStorage.setItem('jb_ai_model', j.ai_model);
        modelAction = 'loaded-from-fund';
      }

      console.log(`[LocalPersist] hydrated  trades=${tradesAction}  key=${keyAction}  model=${modelAction}  saved_at=${j.saved_at || '(never)'}`);
      return { ok: true, trades: tradesAction, key: keyAction, model: modelAction };
    } catch (e) {
      console.warn('[LocalPersist] loadFromFund failed:', e.message);
      return { ok: false, reason: e.message };
    }
  }

  /* ── Schedule a debounced save. Safe to call frequently. ── */
  function scheduleSave() {
    if (_timer) clearTimeout(_timer);
    _timer = setTimeout(saveNow, DEBOUNCE_MS);
  }

  /* ── Push current localStorage state up to fund API. ── */
  async function saveNow() {
    _timer = null;
    if (!(await isAvailable())) {
      console.log('[LocalPersist] save skipped — fund API down');
      return { ok: false };
    }
    const body = {
      trades:   JSON.parse(localStorage.getItem('jb_trades') || '[]'),
      ai_key:   localStorage.getItem('jb_ai_key')   || '',
      ai_model: localStorage.getItem('jb_ai_model') || '',
    };
    try {
      const r = await fetch(FUND_LOCAL_URL, {
        method: 'POST', mode: 'cors', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const t = await r.text();
        console.warn(`[LocalPersist] save HTTP ${r.status}: ${t.slice(0,200)}`);
        return { ok: false, status: r.status };
      }
      const j = await r.json();
      console.log(`[LocalPersist] saved  trades=${j.trades_count}  key=${j.has_key ? 'yes' : 'no'}  at=${j.saved_at}`);
      return { ok: true, ...j };
    } catch (e) {
      console.warn('[LocalPersist] saveNow failed:', e.message);
      return { ok: false, reason: e.message };
    }
  }

  /* ── Public API ── */
  return {
    isAvailable, loadFromFund, scheduleSave, saveNow,
    info: () => ({ url: FUND_LOCAL_URL, available: _available,
                    pending: !!_timer, debounceMs: DEBOUNCE_MS }),
  };
})();
