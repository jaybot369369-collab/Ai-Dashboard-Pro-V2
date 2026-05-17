/* ═══════════════════════════════════════════════════════════
   LOCK — PIN lock screen + idle auto-lock
   PIN stored as SHA-256 hex in localStorage key 'jb_pin'.
   Idle timeout stored in 'jb_idle_mins' (default 15).
   To reset PIN: localStorage.removeItem('jb_pin') in devtools.
════════════════════════════════════════════════════════════ */
const Lock = (() => {

  const PIN_KEY   = 'jb_pin';
  const IDLE_KEY  = 'jb_idle_mins';

  let _idleTimer  = null;
  let _entry      = '';        // current PIN digits typed
  let _onUnlock   = null;      // callback after successful unlock

  /* ── Crypto helpers ─────────────────────────────────── */
  async function hashPin(pin) {
    const enc = new TextEncoder().encode(pin);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  /* ── Public API ─────────────────────────────────────── */
  function isSet() {
    return !!localStorage.getItem(PIN_KEY);
  }

  async function setup(pin) {
    const h = await hashPin(String(pin));
    localStorage.setItem(PIN_KEY, h);
  }

  async function verify(pin) {
    const stored = localStorage.getItem(PIN_KEY);
    if (!stored) return true; // no PIN = always open
    const h = await hashPin(String(pin));
    return h === stored;
  }

  function remove() {
    localStorage.removeItem(PIN_KEY);
  }

  function getIdleMins() {
    return parseInt(localStorage.getItem(IDLE_KEY) || '15');
  }

  function setIdleMins(mins) {
    localStorage.setItem(IDLE_KEY, String(mins));
  }

  /* ── Idle watcher ───────────────────────────────────── */
  function _resetIdleTimer() {
    clearTimeout(_idleTimer);
    const ms = getIdleMins() * 60 * 1000;
    _idleTimer = setTimeout(() => {
      if (isSet()) show();
    }, ms);
  }

  function startIdleWatch() {
    if (!isSet()) return;
    ['mousemove','keydown','click','touchstart'].forEach(ev =>
      document.addEventListener(ev, _resetIdleTimer, { passive: true })
    );
    _resetIdleTimer();
  }

  function stopIdleWatch() {
    clearTimeout(_idleTimer);
    ['mousemove','keydown','click','touchstart'].forEach(ev =>
      document.removeEventListener(ev, _resetIdleTimer)
    );
  }

  /* ── Lock screen UI ─────────────────────────────────── */
  function _buildOverlay() {
    const el = document.createElement('div');
    el.id = 'lockOverlay';
    el.tabIndex = -1; // focusable so it can capture key events
    el.innerHTML = `
      <div class="lock-panel">
        <div class="lock-logo">🔒</div>
        <div class="lock-title">Dashboard Locked</div>
        <div class="lock-dots" id="lockDots">
          <span class="lock-dot" id="ld0"></span>
          <span class="lock-dot" id="ld1"></span>
          <span class="lock-dot" id="ld2"></span>
          <span class="lock-dot" id="ld3"></span>
        </div>
        <div class="lock-err" id="lockErr"></div>
        <div class="lock-pad">
          ${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map((k,i) =>
            k === ''
              ? `<span></span>`
              : `<button class="lock-key" data-key="${k}" onclick="Lock._key('${k}')">${k}</button>`
          ).join('')}
        </div>
      </div>
    `;
    return el;
  }

  function _updateDots() {
    for (let i = 0; i < 4; i++) {
      const dot = document.getElementById('ld' + i);
      if (dot) dot.classList.toggle('filled', i < _entry.length);
    }
  }

  async function _key(k) {
    const err = document.getElementById('lockErr');
    if (k === '⌫') {
      _entry = _entry.slice(0, -1);
      _updateDots();
      if (err) err.textContent = '';
      return;
    }
    if (_entry.length >= 4) return;
    _entry += String(k);
    _updateDots();
    if (_entry.length === 4) {
      const ok = await verify(_entry);
      if (ok) {
        hide();
        if (_onUnlock) _onUnlock();
        startIdleWatch();
      } else {
        if (err) { err.textContent = 'Incorrect PIN'; }
        setTimeout(() => {
          _entry = '';
          _updateDots();
          if (err) err.textContent = '';
        }, 800);
      }
    }
  }

  function _onKeydown(e) {
    // Only react while the lock overlay is visible
    if (!document.getElementById('lockOverlay')) return;
    if (e.key >= '0' && e.key <= '9') {
      e.preventDefault();
      _key(e.key);
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      _key('⌫');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      _entry = '';
      _updateDots();
      const err = document.getElementById('lockErr');
      if (err) err.textContent = '';
    }
  }

  function show(onUnlock) {
    stopIdleWatch();
    _entry = '';
    _onUnlock = onUnlock || null;
    if (document.getElementById('lockOverlay')) return; // already shown
    const overlay = _buildOverlay();
    document.body.appendChild(overlay);
    _updateDots();
    // Capture-phase listener on window so we win against any other handler
    window.addEventListener('keydown', _onKeydown, true);
    // Focus the overlay so the browser routes key events here
    setTimeout(() => overlay.focus(), 0);
  }

  function hide() {
    const el = document.getElementById('lockOverlay');
    if (el) el.remove();
    _entry = '';
    window.removeEventListener('keydown', _onKeydown, true);
  }

  return { isSet, setup, verify, remove, show, hide, startIdleWatch, stopIdleWatch, getIdleMins, setIdleMins, _key };
})();
