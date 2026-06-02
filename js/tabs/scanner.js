/* ═══════════════════════════════════════════════════════════
   DAY TRADE SCANNER TAB — iframes the standalone Signal Deck
   Broadsheet page (port 8771 locally, or the Railway /sd/ API).
   Source toggle [ Local | Railway API ] picks the backend.
   Local is the default on localhost; API is the default when
   the dashboard is served from a non-localhost host (Railway).
════════════════════════════════════════════════════════════ */
const ScannerTab = (() => {

  const _isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);

  // Trailing slash matters: both the iframe src and the relative health
  // probe (base()+'api/health') depend on it.
  const LOCAL_URL = localStorage.getItem('sd_local_url') || 'http://127.0.0.1:8771/';
  const API_URL   = localStorage.getItem('sd_api_url')   || (window.location.origin + '/sd/');

  // Default source: local when on localhost, else the Railway API.
  let source = localStorage.getItem('sd_source') || (_isLocal ? 'local' : 'api');

  const base = () => source === 'api' ? API_URL : LOCAL_URL;

  let _retryTimer = null;

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function _isActiveTab() {
    return document.querySelector('.nav-item.active')?.dataset.tab === 'scanner';
  }

  async function _fetchHealth() {
    try {
      const r = await fetch(`${base()}api/health`, {
        mode: 'cors', cache: 'no-store',
        signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined,
      });
      return r.ok ? r.json() : null;
    } catch { return null; }
  }

  function _toggleHTML() {
    const seg = (id, label) => `
      <button class="sd-src-btn ${source === id ? 'active' : ''}" data-src="${id}">${label}</button>`;
    return `<div class="sd-src-row">${seg('local', 'Local')}${seg('api', 'Railway API')}</div>`;
  }

  function _headHTML() {
    return `
      <div class="page-head">
        <div>
          <h1>Day Trade Scanner</h1>
          <p class="subtitle">5-signal scalper · paper book · ${esc(base())}</p>
        </div>
        <div class="page-head-right" style="display:flex;gap:8px;align-items:center">
          ${_toggleHTML()}
          <a class="btn-ghost" href="${base()}" target="_blank" rel="noopener">↗ Pop out</a>
        </div>
      </div>`;
  }

  function _frameHTML() {
    return `${_headHTML()}<iframe src="${base()}" class="sd-frame" title="Day Trade Scanner"></iframe>`;
  }

  function _offlineHTML() {
    const cmd = source === 'api'
      ? 'Switch to Local, or start the Railway service.'
      : 'cd "_CLAUDE PROJECTS/Signal Deck" &amp;&amp; python3 server.py';
    return `
      ${_headHTML()}
      <div class="lw-offline">
        <div class="lw-offline-icon">📡</div>
        <h2 class="lw-offline-title">Scanner not reachable</h2>
        <p class="lw-offline-sub">Tried <code>${esc(base())}</code> — health check failed.</p>
        <p class="lw-offline-sub" style="font-size:11px;margin-top:6px;">
          Start it locally: <code>${cmd}</code>
        </p>
        <div class="lw-offline-actions" style="margin-top:20px;display:flex;gap:8px;justify-content:center">
          <button class="btn-primary" id="sdRetry">Retry now</button>
          <button class="btn-ghost" id="sdLoadAnyway">Load anyway</button>
        </div>
      </div>`;
  }

  /* Toggle clicks live in BOTH the live and offline views. */
  function _wireToggle() {
    document.querySelectorAll('.sd-src-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.src;
        if (next === source) return;
        source = next;
        localStorage.setItem('sd_source', source);
        render();
      });
    });
  }

  async function render() {
    const content = document.getElementById('content');
    if (!content) return;
    if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }

    content.innerHTML = `${_headHTML()}<div style="padding:40px;color:var(--muted);font-size:13px">Checking scanner…</div>`;
    _wireToggle();

    const health = await _fetchHealth();
    if (health) {
      content.innerHTML = _frameHTML();
      _wireToggle();
      return;
    }

    // Health probe failed. This can be a real outage OR a CORS-blocked probe
    // (localhost dashboard hitting the cross-origin Railway API) where the
    // iframe itself would still load fine — hence the "Load anyway" escape.
    content.innerHTML = _offlineHTML();
    _wireToggle();
    document.getElementById('sdRetry')?.addEventListener('click', () => {
      if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
      render();
    });
    document.getElementById('sdLoadAnyway')?.addEventListener('click', () => {
      if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
      content.innerHTML = _frameHTML();
      _wireToggle();
    });
    _retryTimer = setTimeout(() => {
      if (_isActiveTab()) render(); else _retryTimer = null;
    }, 4000);
  }

  return { render };
})();
