/* ═══════════════════════════════════════════════════════════
   LIQUIDITY WATCHER TAB
   Embeds the standalone Crypto Liquidity Watcher dashboard
   (FastAPI + WS) running on localhost:8766.

   Always probes http://127.0.0.1:8766/ — works from both
   localhost dashboards AND github.io (Chrome treats localhost
   as a secure context even from HTTPS origins).

   No URL input forms. No tunnel handling. If the local server
   is offline, the tab shows a clean retry panel with the start
   command and auto-retries every 3s while the tab is active.
════════════════════════════════════════════════════════════ */
const LiquidityWatcherTab = (() => {

  const LOCAL_URL = 'http://127.0.0.1:8766/';

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function safeUrl(u) {
    if (!u || typeof u !== 'string') return LOCAL_URL;
    return /^https?:\/\//i.test(u) ? u : LOCAL_URL;
  }

  function _isActiveTab() {
    return document.querySelector('.nav-item.active')?.dataset.tab === 'liquidity';
  }

  async function _serverAlive(baseUrl) {
    try {
      const r = await fetch(baseUrl + 'api/health', {
        method: 'GET', mode: 'cors', cache: 'no-store',
        signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined,
      });
      if (!r.ok) return null;
      return await r.json();
    } catch (_) {
      return null;
    }
  }

  function _offlineHTML() {
    return `
      <div class="lw-offline" style="text-align:center; padding:60px 20px;">
        <div class="lw-offline-icon">🌊</div>
        <h2 class="lw-offline-title" style="margin-bottom:12px;">Liquidity Watcher offline</h2>
        <p class="lw-offline-sub" style="opacity:.6;">Trying <code>localhost:8766</code> — retrying automatically…</p>
        <p class="lw-offline-sub" style="opacity:.45; font-size:11px; margin-top:8px;">
          Start it: <code>cd "_CLAUDE PROJECTS/Crypto Liquidity Watcher" &amp;&amp; python3 server.py</code>
        </p>
        <div class="lw-offline-actions" style="margin-top:20px;">
          <button class="btn-primary" id="lwRetry">Retry now</button>
        </div>
      </div>`;
  }

  function _liveHTML(health) {
    const safe = esc(safeUrl(LOCAL_URL));
    return `
      <div class="lw-header">
        <div class="lw-header-left">
          <span class="lw-dot live"></span>
          <span class="lw-status">connected · ${esc(health.universe_size)} assets · ${esc(health.metrics_tracked)} metrics tracked</span>
        </div>
        <div class="lw-header-right">
          <a class="btn-ghost" href="${safe}" target="_blank" rel="noopener" title="Open standalone in new browser tab">↗ Pop out</a>
        </div>
      </div>
      <iframe class="lw-frame" src="${safe}"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        loading="lazy" referrerpolicy="no-referrer"></iframe>`;
  }

  let _retryTimer = null;

  async function render() {
    const content = document.getElementById('content');
    if (!content) return;

    if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }

    content.innerHTML = `<div class="lw-loading">Checking Liquidity Watcher server…</div>`;

    const health = await _serverAlive(LOCAL_URL);

    if (health) {
      content.innerHTML = _liveHTML(health);
    } else {
      content.innerHTML = _offlineHTML();
      _retryTimer = setTimeout(() => {
        if (_isActiveTab()) render();
        else { _retryTimer = null; }   // user moved away — stop the loop
      }, 3000);
      const retry = document.getElementById('lwRetry');
      if (retry) retry.addEventListener('click', () => { clearTimeout(_retryTimer); render(); });
    }
  }

  return { render };
})();
