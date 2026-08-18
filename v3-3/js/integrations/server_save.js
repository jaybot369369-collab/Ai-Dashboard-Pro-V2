/* ═══════════════════════════════════════════════════════════
   BACKGROUND SAVING

   Your browser stays the fast copy — every change lands there
   straight away. A few seconds later a quiet copy goes to the
   server, so clearing your browser cannot lose anything.

   The old dashboard only ever saved trades. That is how your
   journal, playbook and rules ended up in no backup at all.
   This saves the whole lot.

   With no internet it keeps working. The save is marked as
   owed, and goes out as soon as you are back on.

   Your key, your PIN and your uploader address are stripped
   before anything leaves the browser — the server strips them
   again on arrival.
════════════════════════════════════════════════════════════ */
const ServerSave = (() => {
  'use strict';

  const WAIT_MS = 3000;          // hold on a few seconds so a burst of edits is one save
  const RETRY_MS = 30000;        // how often to try again after a failure
  const LS_OWED = 'jp3_save_owed';
  const LS_LAST = 'jp3_save_last';

  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  const BASE = isLocal ? 'http://127.0.0.1:8767' : '';

  let timer = null, retry = null, inFlight = false;
  let reachable = null;          // null = not tried yet
  const listeners = [];

  const owed  = () => localStorage.getItem(LS_OWED) === '1';
  const setOwed = v => localStorage.setItem(LS_OWED, v ? '1' : '0');
  const lastSaved = () => localStorage.getItem(LS_LAST);

  function onChange(fn) { listeners.push(fn); }
  function announce() {
    const s = status();
    listeners.forEach(fn => { try { fn(s); } catch (e) {} });
  }

  function status() {
    return {
      reachable,
      owed: owed(),
      lastSaved: lastSaved(),
      saving: inFlight,
      where: isLocal ? 'this computer' : 'the server',
    };
  }

  /** Everything worth keeping, with the secrets taken out. */
  function payload() {
    const out = Store.exportAll();      // already strips key, PIN and uploader
    return out.data;
  }

  async function saveNow() {
    if (inFlight) return false;
    inFlight = true; announce();
    try {
      const r = await fetch(BASE + '/api/v3/state', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload()),
        signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined,
      });
      if (!r.ok) throw new Error('server said ' + r.status);
      const j = await r.json();
      reachable = true;
      setOwed(false);
      localStorage.setItem(LS_LAST, new Date().toISOString());
      clearTimeout(retry); retry = null;
      console.info(`[save] kept ${j.trade_count} trades on ${isLocal ? 'this computer' : 'the server'}`);
      return true;
    } catch (e) {
      reachable = false;
      setOwed(true);
      // Keep trying quietly. No pop-ups — the browser copy is still fine.
      if (!retry) retry = setTimeout(() => { retry = null; saveNow(); }, RETRY_MS);
      return false;
    } finally {
      inFlight = false; announce();
    }
  }

  /** Call after any change. Waits a few seconds so a burst becomes one save. */
  function schedule() {
    setOwed(true); announce();
    clearTimeout(timer);
    timer = setTimeout(saveNow, WAIT_MS);
  }

  /** Pull the server's copy. Only used when this browser has nothing. */
  async function loadFromServer() {
    try {
      const r = await fetch(BASE + '/api/v3/state', { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      reachable = true;
      return (j && j.state && Object.keys(j.state).length) ? j.state : null;
    } catch (e) {
      reachable = false;
      return null;
    }
  }

  /* Try again the moment the connection comes back, and save on the way out. */
  window.addEventListener('online', () => { if (owed()) saveNow(); });
  window.addEventListener('beforeunload', () => {
    if (!owed() || !navigator.sendBeacon) return;
    try {
      navigator.sendBeacon(BASE + '/api/v3/state',
        new Blob([JSON.stringify(payload())], { type: 'application/json' }));
    } catch (e) {}
  });

  return { schedule, saveNow, loadFromServer, status, onChange, lastSaved, owed };
})();
