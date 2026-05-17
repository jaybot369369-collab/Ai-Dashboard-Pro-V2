/* ═══════════════════════════════════════════════════════════
   CLOUD SYNC — auto-backup all jb_* localStorage keys to a
   private GitHub Gist on every change (debounced 5s).

   Storage keys:
     jb_gist_token    — GitHub PAT (gist scope only)
     jb_gist_id       — Gist ID created on first sync
     jb_gist_lastsync — ISO timestamp of last successful sync
     jb_gist_status   — last status: ok | error | dirty | off

   Public API: window.CloudSync
     .isEnabled()
     .setToken(pat)
     .clearToken()
     .syncNow()              → returns Promise<{ok, msg}>
     .restoreFromCloud()     → returns Promise<{ok, msg, count}>
     .markDirty()            → schedules a debounced sync
     .info()                 → { enabled, gistId, lastSync, status }
════════════════════════════════════════════════════════════ */
const CloudSync = (() => {

  const TOKEN_KEY  = 'jb_gist_token';
  const GIST_KEY   = 'jb_gist_id';
  const LAST_KEY   = 'jb_gist_lastsync';
  const STATUS_KEY = 'jb_gist_status';
  const ERROR_KEY  = 'jb_gist_lasterror';
  const FILE_NAME  = 'ai_dashboard_pro_backup.json';
  const DEBOUNCE_MS = 5000;
  // Keys we never want to sync (the sync metadata itself + transient UI state)
  const SKIP_KEYS = new Set([TOKEN_KEY, GIST_KEY, LAST_KEY, STATUS_KEY, ERROR_KEY]);

  let _timer = null;
  let _origSet = null;

  /* ── Helpers ───────────────────────────────────────────── */
  const get = k => localStorage.getItem(k) || '';
  const set = k => v => localStorage.setItem(k, v);
  const setStatus = s => localStorage.setItem(STATUS_KEY, s);

  function isEnabled() { return !!get(TOKEN_KEY); }
  function gistId()    { return get(GIST_KEY); }

  function info() {
    return {
      enabled:  isEnabled(),
      gistId:   gistId() || null,
      lastSync: get(LAST_KEY) || null,
      status:   get(STATUS_KEY) || (isEnabled() ? 'idle' : 'off'),
      lastError: get(ERROR_KEY) || null
    };
  }

  function _collectPayload() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('jb_') && !SKIP_KEYS.has(k)) {
        data[k] = localStorage.getItem(k);
      }
    }
    return {
      _meta: {
        app: 'AI Dashboard Pro',
        synced: new Date().toISOString(),
        keyCount: Object.keys(data).length,
      },
      data
    };
  }

  /* ── GitHub API ────────────────────────────────────────── */
  async function _ghFetch(url, opts = {}) {
    const token = get(TOKEN_KEY);
    if (!token) throw new Error('No GitHub PAT set');
    const r = await fetch(url, {
      ...opts,
      headers: {
        'Accept':        'application/vnd.github+json',
        'Authorization': 'Bearer ' + token,
        'Content-Type':  'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.headers || {})
      }
    });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`GitHub API ${r.status}: ${txt.slice(0, 200)}`);
    }
    return r.json();
  }

  async function _createGist(payload) {
    const body = {
      description: 'AI Dashboard Pro — auto-backup',
      public: false,
      files: {
        [FILE_NAME]: { content: JSON.stringify(payload, null, 2) }
      }
    };
    const j = await _ghFetch('https://api.github.com/gists', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    set(GIST_KEY)(j.id);
    return j.id;
  }

  async function _updateGist(id, payload) {
    const body = {
      files: {
        [FILE_NAME]: { content: JSON.stringify(payload, null, 2) }
      }
    };
    return _ghFetch(`https://api.github.com/gists/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    });
  }

  async function _readGist(id) {
    return _ghFetch(`https://api.github.com/gists/${id}`);
  }

  /* ── Public actions ────────────────────────────────────── */
  function setToken(pat) {
    if (!pat || !pat.trim()) return;
    localStorage.setItem(TOKEN_KEY, pat.trim());
    setStatus('idle');
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(GIST_KEY);
    localStorage.removeItem(LAST_KEY);
    localStorage.removeItem(ERROR_KEY);
    setStatus('off');
  }

  async function syncNow() {
    if (!isEnabled()) return { ok: false, msg: 'Cloud sync not enabled' };
    setStatus('syncing');
    try {
      const payload = _collectPayload();
      let id = gistId();
      if (id) {
        try {
          await _updateGist(id, payload);
        } catch (e) {
          // Gist may have been deleted — recreate
          if (String(e.message).includes('404')) {
            id = await _createGist(payload);
          } else throw e;
        }
      } else {
        id = await _createGist(payload);
      }
      localStorage.setItem(LAST_KEY, new Date().toISOString());
      localStorage.removeItem(ERROR_KEY);
      setStatus('ok');
      return { ok: true, msg: `Synced ${payload._meta.keyCount} keys`, gistId: id };
    } catch (e) {
      setStatus('error');
      localStorage.setItem(ERROR_KEY, e.message || String(e));
      console.error('[CloudSync] sync failed:', e);
      return { ok: false, msg: e.message };
    }
  }

  async function restoreFromCloud() {
    if (!isEnabled()) return { ok: false, msg: 'Cloud sync not enabled' };
    const id = gistId();
    if (!id) return { ok: false, msg: 'No gist ID on file — nothing to restore from' };
    setStatus('restoring');
    try {
      const g = await _readGist(id);
      const file = g.files?.[FILE_NAME];
      if (!file) throw new Error('Backup file not found in gist');
      const parsed = JSON.parse(file.content);
      if (!parsed.data || typeof parsed.data !== 'object') throw new Error('Invalid backup payload');
      const keys = Object.keys(parsed.data);
      // Restore without re-triggering sync
      _suspendAutoSync(() => {
        keys.forEach(k => {
          if (k.startsWith('jb_') && !SKIP_KEYS.has(k)) {
            localStorage.setItem(k, parsed.data[k]);
          }
        });
      });
      setStatus('ok');
      return { ok: true, msg: `Restored ${keys.length} keys from cloud`, count: keys.length };
    } catch (e) {
      setStatus('error');
      localStorage.setItem(ERROR_KEY, e.message || String(e));
      console.error('[CloudSync] restore failed:', e);
      return { ok: false, msg: e.message };
    }
  }

  /* ── Auto-sync wiring (debounced) ──────────────────────── */
  function markDirty() {
    if (!isEnabled()) return;
    setStatus('dirty');
    clearTimeout(_timer);
    _timer = setTimeout(() => {
      syncNow();
    }, DEBOUNCE_MS);
  }

  // Run a block without triggering markDirty (for restore paths)
  let _suspended = false;
  function _suspendAutoSync(fn) {
    _suspended = true;
    try { fn(); } finally { _suspended = false; }
  }

  function _installSetItemHook() {
    if (_origSet) return; // already installed
    _origSet = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function(k, v) {
      _origSet(k, v);
      if (_suspended) return;
      if (typeof k === 'string' && k.startsWith('jb_') && !SKIP_KEYS.has(k)) {
        markDirty();
      }
    };
  }

  function init() {
    _installSetItemHook();
    if (!isEnabled()) setStatus('off');
  }

  return {
    init, isEnabled, info,
    setToken, clearToken,
    syncNow, restoreFromCloud,
    markDirty,
  };
})();

// Auto-install the setItem hook the moment this script loads
CloudSync.init();
