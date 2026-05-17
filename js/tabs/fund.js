/* ═══════════════════════════════════════════════════════════
   BOT FARM TAB
   Embeds the fund's read-only dashboard (FastAPI on 8767).

   Local access (dashboard opened on host): http://127.0.0.1:8767/
   Remote access (dashboard via tunnel):    user-set public URL,
                                             persisted in localStorage.

   The standalone dashboard exposes status + bot health + positions
   + intents + escalations + risk events, plus PIN-gated
   /halt /resume /unlock buttons. Starting it:

       cd "Mini Hedge Fund" && python3 -m fund.api
═══════════════════════════════════════════════════════════ */
const FundTab = (() => {

  const LOCAL_URL  = 'http://127.0.0.1:8767/';
  const PUBLIC_FALLBACK = '';                        // No public default; user must set
  const LS_KEY = 'fund_remote_url';

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function safeUrl(u) {
    if (!u || typeof u !== 'string') return LOCAL_URL;
    return /^https?:\/\//i.test(u) ? u : LOCAL_URL;
  }

  function _isLocal() {
    const h = window.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '' || h === '0.0.0.0';
  }

  function _isActiveTab() {
    return document.querySelector('.nav-item.active')?.dataset.tab === 'fund';
  }

  function _resolveUrl() {
    // Always prefer an explicit override the user has saved.
    // Otherwise fall back to localhost regardless of where the
    // dashboard itself is served from (github.io, tunnel, etc.).
    const override = (localStorage.getItem(LS_KEY) || '').trim();
    const candidate = override || LOCAL_URL;
    return safeUrl(candidate).replace(/\/?$/, '/');
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
        <div class="lw-offline-icon">🏦</div>
        <h2 class="lw-offline-title" style="margin-bottom:12px;">Bot Farm API offline</h2>
        <p class="lw-offline-sub" style="opacity:.6;">Trying <code>localhost:8767</code> — retrying automatically…</p>
        <p class="lw-offline-sub" style="opacity:.45; font-size:11px; margin-top:8px;">
          Start it: <code>cd "Mini Hedge Fund" &amp;&amp; python3 -m fund.api</code>
        </p>
        <div class="lw-offline-actions" style="margin-top:20px;">
          <button class="btn-primary" id="fundRetry">Retry now</button>
        </div>
      </div>`;
  }

  function _liveHTML(url, health) {
    const safe = esc(safeUrl(url));
    const ks = (health && health.kill_state && health.kill_state.state) || 'unknown';
    const nBots = (health && health.bots) ? health.bots.length : 0;
    const nHealthy = (health && health.bots)
      ? health.bots.filter(b => b.status === 'healthy').length : 0;
    const dotClass = ks === 'running' ? 'live' : 'warn';
    return `
      <div class="lw-header">
        <div class="lw-header-left">
          <span class="lw-dot ${dotClass}"></span>
          <span class="lw-status">kill_state = ${esc(ks)} · ${nHealthy}/${nBots} bots healthy</span>
        </div>
        <div class="lw-header-right">
          <button class="btn-ghost" id="fundRunSensei" title="Trigger Sensei AI coach report (runs in ~2 min)">🧠 Run Sensei</button>
          <a class="btn-ghost" href="${safe}" target="_blank" rel="noopener" title="Open standalone in new browser tab">↗ Pop out</a>
        </div>
      </div>
      <iframe class="lw-frame" src="${safe}"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        referrerpolicy="no-referrer"></iframe>`;
  }

  let _retryTimer = null;

  async function render() {
    const content = document.getElementById('content');
    if (!content) return;

    // Cancel any pending auto-retry before starting a fresh render
    if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }

    content.innerHTML = `<div class="lw-loading">Checking Bot Farm API…</div>`;

    // Step 1: always silently probe localhost first, regardless of
    // where the dashboard is hosted (github.io, tunnel, anywhere).
    let url = LOCAL_URL;
    let health = await _serverAlive(LOCAL_URL);

    // Step 2: if localhost didn't respond, try any saved override URL.
    if (!health) {
      const override = (localStorage.getItem(LS_KEY) || '').trim();
      if (override && override !== LOCAL_URL) {
        url = safeUrl(override).replace(/\/?$/, '/');
        health = await _serverAlive(url);
      }
    }

    if (health) {
      content.innerHTML = _liveHTML(url, health);
      // Wire "Run Sensei" button
      const senseiBtn = document.getElementById('fundRunSensei');
      if (senseiBtn) {
        senseiBtn.addEventListener('click', async () => {
          senseiBtn.disabled = true;
          senseiBtn.textContent = '⏳ Running…';
          try {
            const r = await fetch(url + 'api/coach/run_now', {
              method: 'POST', mode: 'cors', cache: 'no-store',
              signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
            });
            const d = await r.json().catch(() => ({}));
            if (r.ok) {
              senseiBtn.textContent = '✓ Queued';
              setTimeout(() => { senseiBtn.textContent = '🧠 Run Sensei'; senseiBtn.disabled = false; }, 4000);
            } else {
              senseiBtn.textContent = '✗ Error';
              setTimeout(() => { senseiBtn.textContent = '🧠 Run Sensei'; senseiBtn.disabled = false; }, 3000);
            }
          } catch (_) {
            senseiBtn.textContent = '✗ Offline';
            setTimeout(() => { senseiBtn.textContent = '🧠 Run Sensei'; senseiBtn.disabled = false; }, 3000);
          }
        });
      }
    } else {
      // Neither localhost nor override responded — auto-retry every 3s.
      // Only show the URL input form if the user has explicitly opened it.
      content.innerHTML = _offlineHTML();
      _retryTimer = setTimeout(() => {
        if (_isActiveTab()) render();
        else { _retryTimer = null; }   // user moved away — stop the loop
      }, 3000);
      const retry = document.getElementById('fundRetry');
      if (retry) retry.addEventListener('click', () => { clearTimeout(_retryTimer); render(); });
    }
  }

  return { render };
})();
