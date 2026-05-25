/* ═══════════════════════════════════════════════════════════
   BOT FARM TAB  v3 — Claude.ai design
   Native card UI fed by /api/overview + /api/status + /api/positions
   (no iframe). Standalone fund dashboard still reachable via ↗ Pop out.
   Preserves: kill_state indicator, Run Sensei, offline retry,
              tunnel URL override for remote dashboards.
═══════════════════════════════════════════════════════════ */
const FundTab = (() => {

  const LOCAL_URL = 'http://127.0.0.1:8767/';
  const LS_KEY    = 'fund_remote_url';
  // Auto-detect Railway: if not on localhost, use same origin (nginx proxies /api/)
  const _isLocal  = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const REMOTE_URL = window.location.origin + '/';

  let _retryTimer   = null;
  let _refreshTimer = null;
  let _overview     = null;
  let _positions    = null;

  /* ── helpers ─────────────────────────────────────────── */
  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function safeUrl(u) {
    if (!u || typeof u !== 'string') return LOCAL_URL;
    return /^https?:\/\//i.test(u) ? u : LOCAL_URL;
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    const v = Number(n);
    const sign = v > 0 ? '+' : v < 0 ? '−' : '';
    const abs = Math.abs(v);
    return `${sign}$${abs.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }
  function fmtUsdK(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    const v = Math.abs(Number(n));
    if (v >= 1000) return `$${(v/1000).toFixed(1)}k`;
    return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }
  function fmtAgo(seconds) {
    if (seconds === null || seconds === undefined) return '—';
    const s = Math.round(seconds);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.round(s/60)}m`;
    if (s < 86400) return `${Math.round(s/3600)}h`;
    return `${Math.round(s/86400)}d`;
  }
  function _isActiveTab() {
    return document.querySelector('.nav-item.active')?.dataset.tab === 'fund';
  }
  function _resolveUrl() {
    // On Railway / any non-localhost host: ALWAYS use same-origin /api/.
    // Ignore any stale fund_remote_url override that pointed at a tunnel
    // or localhost from a previous session — those break Bot Farm here.
    if (!_isLocal) return REMOTE_URL;
    // Localhost: allow override (tunnel testing pattern), else default LOCAL.
    const override = (localStorage.getItem(LS_KEY) || '').trim();
    if (override) return safeUrl(override).replace(/\/?$/, '/');
    return LOCAL_URL;
  }
  async function _fetchJson(baseUrl, path) {
    // 12s timeout (was 5s). Railway containers can take 6-10s to respond
    // on cold start, especially when supervisord is still spinning up
    // child processes after a fresh deploy.
    try {
      const r = await fetch(baseUrl + path, {
        cache: 'no-store',
        signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined,
      });
      return r.ok ? r.json() : null;
    } catch { return null; }
  }

  /* ── status / badge logic ─────────────────────────────── */
  function _statusBadge(bot, killState) {
    if (killState && killState !== 'running') {
      return `<span class="bf-badge bf-badge-paused">PAUSED</span>`;
    }
    const s = bot.status;
    if (s === 'healthy')   return `<span class="bf-badge bf-badge-live">● LIVE</span>`;
    if (s === 'degraded')  return `<span class="bf-badge bf-badge-warn">DEGRADED</span>`;
    if (s === 'down' || s === 'silent') return `<span class="bf-badge bf-badge-error">ERROR</span>`;
    return `<span class="bf-badge bf-badge-dim">${esc(s || 'UNKNOWN').toUpperCase()}</span>`;
  }

  function _tierLabel(tier) {
    if (tier === 1) return 'Trading';
    if (tier === 2) return 'Monitor';
    if (tier === 3) return 'Ops';
    return '—';
  }

  /* ── per-bot 7d P&L from positions feed ───────────────── */
  function _bot7dPnl(botId) {
    if (!_positions || !_positions.positions) return null;
    const cutoff = Date.now() - 7 * 86400000;
    let sum = 0, n = 0;
    for (const p of _positions.positions) {
      if (p.source_bot !== botId) continue;
      if (!p.closed_at) continue;
      const t = Date.parse(p.closed_at);
      if (isNaN(t) || t < cutoff) continue;
      if (typeof p.pnl_usd === 'number') { sum += p.pnl_usd; n++; }
    }
    return n > 0 ? sum : null;
  }

  /* ── KPI strip ────────────────────────────────────────── */
  function _kpiStripHTML(overview) {
    const bots    = overview.bots || [];
    const live    = bots.filter(b => b.status === 'healthy').length;
    const total   = bots.length;
    const pnl7d   = overview.pnl_7d_usd;
    const equity  = overview.equity_usd;
    const actions = bots.reduce((s, b) => s + (b.actions_24h || 0), 0);
    const pnlCls  = pnl7d > 0 ? 'bf-pnl-pos' : pnl7d < 0 ? 'bf-pnl-neg' : '';

    const kpi = (icon, value, label, valueCls = '') => `
      <div class="bf-kpi-card">
        <div class="bf-kpi-icon">${icon}</div>
        <div class="bf-kpi-body">
          <div class="bf-kpi-value ${valueCls}">${value}</div>
          <div class="bf-kpi-label">${label}</div>
        </div>
      </div>`;

    return `<div class="bf-kpi-row">
      ${kpi('⚡', `${live}/${total}`, 'Bots live')}
      ${kpi('📈', fmtUsd(pnl7d), '7-day farm P&L', pnlCls)}
      ${kpi('💰', fmtUsd(equity), 'Capital allocated')}
      ${kpi('🎯', String(actions), 'Actions · 24h')}
    </div>`;
  }

  /* ── single bot card ──────────────────────────────────── */
  function _botCardHTML(bot, killState) {
    const initials = (bot.icon && bot.icon.toString().trim()[0]) || (bot.display_name || bot.bot_id || '?')[0];
    const name     = esc(bot.display_name || bot.bot_id);
    const blurb    = esc(bot.blurb || bot.role || '');
    const tier     = _tierLabel(bot.tier);
    const lastAct  = esc(bot.last_action || '—');
    const ageStr   = fmtAgo(bot.beat_age_seconds);
    const actions  = bot.actions_24h ?? 0;
    const pnl      = _bot7dPnl(bot.bot_id);
    const pnlStr   = pnl !== null ? fmtUsd(pnl) : '—';
    const pnlCls   = pnl > 0 ? 'bf-pnl-pos' : pnl < 0 ? 'bf-pnl-neg' : 'bf-pnl-flat';

    return `<div class="card bf-bot-card">
      <div class="bf-bot-head">
        <div class="bf-avatar">${esc(initials.toUpperCase())}</div>
        <div class="bf-bot-id">
          <div class="bf-bot-name">${name} ${_statusBadge(bot, killState)}</div>
          <div class="bf-bot-sub">${blurb}</div>
        </div>
        <div class="bf-bot-pnl">
          <div class="${pnlCls}" style="font-weight:700;font-size:15px">${pnlStr}</div>
          <div class="bf-bot-pnl-lbl">7-day</div>
        </div>
      </div>
      <div class="bf-bot-meta">
        <span class="bf-tier-chip">${tier}</span>
        <span class="bf-bot-last" title="Last action: ${esc(bot.last_action_ts || '')}">${lastAct}</span>
      </div>
      <div class="bf-stat-grid">
        <div><div class="bf-stat-lbl">Actions · 24h</div><div class="bf-stat-val">${actions}</div></div>
        <div><div class="bf-stat-lbl">Last beat</div><div class="bf-stat-val">${ageStr}</div></div>
        <div><div class="bf-stat-lbl">Status</div><div class="bf-stat-val">${esc(bot.status || '—')}</div></div>
      </div>
    </div>`;
  }

  /* ── page head + actions ──────────────────────────────── */
  function _pageHeadHTML(overview) {
    const bots    = overview.bots || [];
    const live    = bots.filter(b => b.status === 'healthy').length;
    const total   = bots.length;
    const cap     = fmtUsdK(overview.equity_usd);
    const ks      = (overview.kill_state && overview.kill_state.state) || 'unknown';
    const dotCls  = ks === 'running' ? 'live' : 'warn';
    const url     = _resolveUrl();

    return `<div class="page-head">
      <div>
        <h1>Bot Farm</h1>
        <p class="subtitle">${live} live · ${total} bots · ${cap} allocated · <span class="lw-dot ${dotCls}" style="display:inline-block;vertical-align:middle"></span> <span style="font-size:12px;color:var(--muted)">kill_state = ${esc(ks)}</span></p>
      </div>
      <div class="page-head-right" style="display:flex;gap:8px;align-items:center">
        <button class="btn-ghost" id="fundRunSensei" title="Trigger Sensei AI coach report (~2 min)">🧠 Run Sensei</button>
        <button class="btn-ghost" id="fundRefresh">↺ Refresh</button>
        <a class="btn-ghost" href="${esc(url)}" target="_blank" rel="noopener">↗ Pop out</a>
      </div>
    </div>`;
  }

  /* ── live page render ─────────────────────────────────── */
  function _liveHTML(overview) {
    const killState = overview.kill_state && overview.kill_state.state;
    const bots = overview.bots || [];

    const sortedBots = [...bots].sort((a, b) => {
      /* trading bots first (tier 1), then monitor (2), then ops (3) */
      const ta = a.tier ?? 9, tb = b.tier ?? 9;
      if (ta !== tb) return ta - tb;
      return (a.display_name || '').localeCompare(b.display_name || '');
    });

    return `
      ${_pageHeadHTML(overview)}
      ${_kpiStripHTML(overview)}
      <div class="bf-bot-grid">
        ${sortedBots.map(b => _botCardHTML(b, killState)).join('')}
      </div>
      <p style="font-size:11px;color:var(--muted-2);margin-top:14px;text-align:right" id="fundLastRefresh">
        updated ${new Date().toLocaleTimeString()}
      </p>`;
  }

  /* ── offline panel (kept from v2) ─────────────────────── */
  function _offlineHTML() {
    const saved = (localStorage.getItem(LS_KEY) || '').trim();
    return `<div class="page-head"><h1>Bot Farm</h1><p class="subtitle">Automated trading bots</p></div>
      <div class="lw-offline" style="text-align:center; padding:60px 20px; max-width:560px; margin:0 auto;">
        <div class="lw-offline-icon">🏦</div>
        <h2 class="lw-offline-title" style="margin-bottom:12px;">Bot Farm API offline</h2>
        <p class="lw-offline-sub" style="opacity:.6;">Tried <code>${_isLocal ? 'localhost:8767' : window.location.origin + '/api'}</code>${saved ? ` and <code>${esc(saved)}</code>` : ''} — not reachable.</p>
        <p class="lw-offline-sub" style="opacity:.45; font-size:11px; margin-top:6px;">
          Start locally: <code>cd "Mini Hedge Fund" &amp;&amp; python3 -m fund.api</code>
        </p>
        <div style="margin-top:22px; text-align:left; background:var(--surface2); border:1px solid var(--border); border-radius:12px; padding:16px 18px;">
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; margin-bottom:10px;">Accessing via Cloudflare tunnel?</div>
          <p style="font-size:12px; color:var(--text-sub); margin-bottom:10px;">Run a separate tunnel for the fund API, then paste the URL below:</p>
          <code style="font-size:11px; display:block; background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:8px 10px; margin-bottom:12px; color:var(--muted);">./bin/cloudflared tunnel --url http://localhost:8767</code>
          <div style="display:flex; gap:8px; align-items:center;">
            <input id="fundUrlInput" type="url" placeholder="https://xxxx.trycloudflare.com"
              value="${esc(saved)}"
              style="flex:1; padding:8px 10px; border-radius:8px; border:1px solid var(--border); background:var(--bg); color:var(--text); font-size:13px; outline:none;" />
            <button class="btn-primary" id="fundSetUrl" style="white-space:nowrap;">Save &amp; Connect</button>
          </div>
          ${saved ? `<button id="fundClearUrl" style="margin-top:8px; font-size:11px; color:var(--muted); background:none; border:none; cursor:pointer; padding:0;">✕ Clear saved URL</button>` : ''}
        </div>
        <div class="lw-offline-actions" style="margin-top:16px;">
          <button class="btn-ghost" id="fundRetry">Retry now</button>
        </div>
      </div>`;
  }

  /* ── wire dynamic buttons ─────────────────────────────── */
  function _wireLive(url) {
    document.getElementById('fundRunSensei')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true; btn.textContent = '⏳ Running…';
      try {
        const r = await fetch(url + 'api/coach/run_now', {
          method: 'POST', mode: 'cors', cache: 'no-store',
          signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
        });
        if (r.ok) btn.textContent = '✓ Queued';
        else      btn.textContent = '✗ Error';
      } catch { btn.textContent = '✗ Offline'; }
      setTimeout(() => { btn.textContent = '🧠 Run Sensei'; btn.disabled = false; }, 3500);
    });
    document.getElementById('fundRefresh')?.addEventListener('click', () => {
      if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
      render();
    });
  }
  function _wireOffline() {
    document.getElementById('fundRetry')?.addEventListener('click', () => { clearTimeout(_retryTimer); render(); });
    document.getElementById('fundSetUrl')?.addEventListener('click', () => {
      const v = (document.getElementById('fundUrlInput')?.value || '').trim();
      if (v) { localStorage.setItem(LS_KEY, v); clearTimeout(_retryTimer); render(); }
    });
    document.getElementById('fundClearUrl')?.addEventListener('click', () => {
      localStorage.removeItem(LS_KEY); clearTimeout(_retryTimer); render();
    });
  }

  /* ── main render ──────────────────────────────────────── */
  async function render() {
    const content = document.getElementById('content');
    if (!content) return;
    if (_retryTimer)   { clearTimeout(_retryTimer);   _retryTimer = null; }
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }

    content.innerHTML = `<div style="padding:40px;color:var(--muted);font-size:13px">Checking Bot Farm API…</div>`;

    /* Use _resolveUrl() so Railway hits same-origin /api/ and localhost
       hits the local fund.api (with optional override). Previously this
       hardcoded LOCAL_URL which broke Bot Farm on Railway. */
    let url = _resolveUrl();
    let overview = await _fetchJson(url, 'api/overview');
    if (!overview && _isLocal) {
      const override = (localStorage.getItem(LS_KEY) || '').trim();
      if (override && override !== LOCAL_URL) {
        url = safeUrl(override).replace(/\/?$/, '/');
        overview = await _fetchJson(url, 'api/overview');
      }
    }

    if (!overview) {
      content.innerHTML = _offlineHTML();
      _wireOffline();
      _retryTimer = setTimeout(() => { if (_isActiveTab()) render(); else _retryTimer = null; }, 3000);
      return;
    }

    /* Fetch positions for per-bot P&L (best-effort) */
    _positions = await _fetchJson(url, 'api/positions?status=closed&limit=500');
    _overview  = overview;

    content.innerHTML = _liveHTML(overview);
    _wireLive(url);

    /* Auto-refresh every 15s while tab active */
    _refreshTimer = setInterval(async () => {
      if (!_isActiveTab()) { clearInterval(_refreshTimer); _refreshTimer = null; return; }
      const fresh = await _fetchJson(url, 'api/overview');
      if (fresh) {
        _positions = await _fetchJson(url, 'api/positions?status=closed&limit=500');
        _overview = fresh;
        content.innerHTML = _liveHTML(fresh);
        _wireLive(url);
      }
    }, 15000);
  }

  return { render };
})();
