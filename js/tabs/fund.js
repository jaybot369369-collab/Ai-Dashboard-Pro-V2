/* ═══════════════════════════════════════════════════════════
   BOT FARM TAB  v4 — LIVE EVENT FEED via SSE
   Initial snapshot from /api/overview + /api/positions, then
   subscribes to /api/events for incremental updates. Falls back
   to 15s polling if SSE fails 3 times in a row. Connection-status
   pill in the header shows 🟢 live / 🟡 reconnecting / 🔴 offline
   / ⚪ polling.
═══════════════════════════════════════════════════════════ */
const FundTab = (() => {

  const LOCAL_URL = 'http://127.0.0.1:8767/';
  const LS_KEY    = 'fund_remote_url';
  const _isLocal  = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const REMOTE_URL = window.location.origin + '/';

  /* Per-tab state */
  let _retryTimer    = null;
  let _pollTimer     = null;       // polling fallback timer
  let _evtSource     = null;       // active EventSource
  let _evtFails      = 0;          // consecutive failures
  let _connState     = 'idle';     // idle | live | reconnect | offline | polling
  let _overview      = null;
  let _positions     = null;
  let _recentEvents  = [];         // last N events for the live feed pane
  const FEED_MAX     = 50;

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

  /* ── URL resolution + override hygiene ───────────────── */
  function _resolveUrl() {
    if (!_isLocal) {
      /* Hard reset any stale dev override that would point a Railway
         tab at localhost:8767. Surface a toast once. */
      const stale = (localStorage.getItem(LS_KEY) || '').trim();
      if (stale) {
        localStorage.removeItem(LS_KEY);
        try {
          if (window.Toast?.show) Toast.show('Cleared stale fund_remote_url override (was pointing at ' + stale + ')');
          else console.warn('[fund] cleared stale fund_remote_url override:', stale);
        } catch (_) {}
      }
      return REMOTE_URL;
    }
    const override = (localStorage.getItem(LS_KEY) || '').trim();
    if (override) return safeUrl(override).replace(/\/?$/, '/');
    return LOCAL_URL;
  }
  async function _fetchJson(baseUrl, path) {
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

  /* ── connection pill ──────────────────────────────────── */
  function _connPillHTML() {
    const map = {
      live:      { emoji: '🟢', label: 'live',         cls: 'bf-conn-live' },
      reconnect: { emoji: '🟡', label: 'reconnecting', cls: 'bf-conn-warn' },
      offline:   { emoji: '🔴', label: 'offline',      cls: 'bf-conn-err'  },
      polling:   { emoji: '⚪', label: 'polling',      cls: 'bf-conn-dim'  },
      idle:      { emoji: '⚪', label: '…',            cls: 'bf-conn-dim'  },
    };
    const m = map[_connState] || map.idle;
    return `<span class="bf-conn-pill ${m.cls}" id="bfConnPill" title="Live feed: ${m.label}">${m.emoji} ${m.label}</span>`;
  }
  function _updateConnPill() {
    const el = document.getElementById('bfConnPill');
    if (!el) return;
    const map = {
      live:      { emoji: '🟢', label: 'live',         cls: 'bf-conn-live' },
      reconnect: { emoji: '🟡', label: 'reconnecting', cls: 'bf-conn-warn' },
      offline:   { emoji: '🔴', label: 'offline',      cls: 'bf-conn-err'  },
      polling:   { emoji: '⚪', label: 'polling',      cls: 'bf-conn-dim'  },
      idle:      { emoji: '⚪', label: '…',            cls: 'bf-conn-dim'  },
    };
    const m = map[_connState] || map.idle;
    el.className = `bf-conn-pill ${m.cls}`;
    el.title     = `Live feed: ${m.label}`;
    el.textContent = `${m.emoji} ${m.label}`;
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
    return `<div class="card bf-bot-card" data-bot="${esc(bot.bot_id)}">
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

  /* ── page head + live event feed ──────────────────────── */
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
        <h1>Bot Farm  ${_connPillHTML()}</h1>
        <p class="subtitle">${live} live · ${total} bots · ${cap} allocated · <span class="lw-dot ${dotCls}" style="display:inline-block;vertical-align:middle"></span> <span style="font-size:12px;color:var(--muted)">kill_state = ${esc(ks)}</span></p>
      </div>
      <div class="page-head-right" style="display:flex;gap:8px;align-items:center">
        <button class="btn-ghost" id="fundRunSensei" title="Trigger Sensei AI coach report (~2 min)">🧠 Run Sensei</button>
        <button class="btn-ghost" id="fundRefresh">↺ Refresh</button>
        <a class="btn-ghost" href="${esc(url)}" target="_blank" rel="noopener">↗ Pop out</a>
      </div>
    </div>`;
  }

  function _liveFeedHTML() {
    if (_recentEvents.length === 0) {
      return `<div class="bf-feed-empty" id="bfFeed">Waiting for events…</div>`;
    }
    const rowsHtml = _recentEvents.map(_feedRowHTML).join('');
    return `<div class="bf-feed" id="bfFeed">${rowsHtml}</div>`;
  }
  function _feedRowHTML(ev) {
    const time = ev.ts ? new Date(ev.ts).toLocaleTimeString() : '';
    const kind = ev.kind || 'event';
    const klsByKind = {
      message: 'bf-feed-msg', escalation: 'bf-feed-esc',
      risk_event: 'bf-feed-risk', health: 'bf-feed-health',
    };
    const kls = klsByKind[kind] || 'bf-feed-default';
    return `<div class="bf-feed-row ${kls}">
      <span class="bf-feed-time">${esc(time)}</span>
      <span class="bf-feed-kind">${esc(kind)}</span>
      <span class="bf-feed-text">${esc(ev.text)}</span>
    </div>`;
  }
  function _pushFeed(ev) {
    _recentEvents.unshift(ev);
    if (_recentEvents.length > FEED_MAX) _recentEvents.length = FEED_MAX;
    const feedEl = document.getElementById('bfFeed');
    if (!feedEl) return;
    if (feedEl.classList.contains('bf-feed-empty')) {
      feedEl.outerHTML = _liveFeedHTML();
    } else {
      feedEl.insertAdjacentHTML('afterbegin', _feedRowHTML(ev));
      while (feedEl.children.length > FEED_MAX) feedEl.removeChild(feedEl.lastChild);
    }
  }

  /* ── live page render ─────────────────────────────────── */
  function _liveHTML(overview) {
    const killState = overview.kill_state && overview.kill_state.state;
    const bots = overview.bots || [];
    const sortedBots = [...bots].sort((a, b) => {
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
      <h2 style="margin-top:24px;margin-bottom:8px;font-size:15px">Live event feed</h2>
      ${_liveFeedHTML()}
      <p style="font-size:11px;color:var(--muted-2);margin-top:14px;text-align:right" id="fundLastRefresh">
        connected ${new Date().toLocaleTimeString()}
      </p>`;
  }

  /* ── offline panel ────────────────────────────────────── */
  function _offlineHTML() {
    const saved = (localStorage.getItem(LS_KEY) || '').trim();
    return `<div class="page-head"><h1>Bot Farm</h1><p class="subtitle">Automated trading bots</p></div>
      <div class="lw-offline" style="text-align:center; padding:60px 20px; max-width:560px; margin:0 auto;">
        <div class="lw-offline-icon">🏦</div>
        <h2 class="lw-offline-title" style="margin-bottom:12px;">Bot Farm API offline</h2>
        <p class="lw-offline-sub" style="opacity:.6;">Tried <code>${_isLocal ? 'localhost:8767' : window.location.origin + '/api'}</code>${saved && _isLocal ? ` and <code>${esc(saved)}</code>` : ''} — not reachable.</p>
        <p class="lw-offline-sub" style="opacity:.45; font-size:11px; margin-top:6px;">
          Start locally: <code>cd "Mini Hedge Fund" &amp;&amp; python3 -m fund.api</code>
        </p>
        <div class="lw-offline-actions" style="margin-top:22px;">
          <button class="btn-ghost" id="fundRetry">Retry now</button>
        </div>
      </div>`;
  }

  /* ── SSE wiring ───────────────────────────────────────── */
  function _setConn(state) {
    _connState = state;
    _updateConnPill();
  }
  function _closeStream() {
    if (_evtSource) {
      try { _evtSource.close(); } catch (_) {}
      _evtSource = null;
    }
  }
  function _startStream(url) {
    _closeStream();
    let es;
    try {
      es = new EventSource(url + 'api/events');
    } catch (e) {
      _evtFails++; _setConn('offline');
      return;
    }
    _evtSource = es;

    es.addEventListener('ready', () => {
      _evtFails = 0;
      _setConn('live');
      _stopPolling();
    });

    es.addEventListener('health', (msg) => {
      try {
        const d = JSON.parse(msg.data);
        if (d && d.bots) {
          /* Splice fresh heartbeats into our cached overview + re-render
             only the bot grid + KPI strip (no full reload). */
          if (_overview) {
            const byId = new Map(d.bots.map(b => [b.bot_id, b]));
            _overview.bots = (_overview.bots || []).map(b => {
              const fresh = byId.get(b.bot_id);
              return fresh ? { ...b, ...fresh } : b;
            });
            _overview.kill_state = d.kill_state || _overview.kill_state;
            _patchOverviewView();
          }
        }
      } catch (e) {}
    });

    es.addEventListener('message', (msg) => {
      try {
        const m = JSON.parse(msg.data);
        const txt = `${esc(m.source || m.type || '?')} · ${esc(m.type || '')}${m.payload_json ? ' — ' + esc((m.payload_json || '').slice(0,120)) : ''}`;
        _pushFeed({ ts: m.ts, kind: 'message', text: txt });
      } catch (e) {}
    });

    es.addEventListener('escalation', (msg) => {
      try {
        const e_ = JSON.parse(msg.data);
        _pushFeed({ ts: e_.ts, kind: 'escalation',
                    text: `T${e_.tier} · ${esc(e_.reason)} — ${esc(e_.summary || '')}` });
      } catch (e) {}
    });

    es.addEventListener('risk_event', (msg) => {
      try {
        const r = JSON.parse(msg.data);
        _pushFeed({ ts: r.ts, kind: 'risk_event',
                    text: `${esc(r.event_type)} — ${esc(r.reason)}` });
      } catch (e) {}
    });

    es.addEventListener('ticker', (msg) => {
      try {
        const d = JSON.parse(msg.data);
        if (_overview) {
          _overview._ticker = d.prices || {};
        }
      } catch (e) {}
    });

    es.onerror = () => {
      /* Browser auto-retries. We just track state + maybe escalate. */
      _evtFails++;
      if (_evtFails <= 2) {
        _setConn('reconnect');
      } else {
        _setConn('polling');
        _closeStream();
        _startPolling(url);
      }
    };
  }

  function _patchOverviewView() {
    /* Re-render in place. Cheap because content already exists. */
    const content = document.getElementById('content');
    if (!content || !_overview) return;
    content.innerHTML = _liveHTML(_overview);
    _wireLive(_resolveUrl());
  }

  /* ── polling fallback ────────────────────────────────── */
  function _startPolling(url) {
    if (_pollTimer) return;
    _setConn('polling');
    _pollTimer = setInterval(async () => {
      if (!_isActiveTab()) { _stopPolling(); return; }
      const fresh = await _fetchJson(url, 'api/overview');
      if (fresh) {
        _overview = fresh;
        _positions = await _fetchJson(url, 'api/positions?status=closed&limit=500');
        _patchOverviewView();
        /* Try to reopen SSE periodically */
        _evtFails = 0;
        _startStream(url);
      }
    }, 15000);
  }
  function _stopPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
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
        btn.textContent = r.ok ? '✓ Queued' : '✗ Error';
      } catch { btn.textContent = '✗ Offline'; }
      setTimeout(() => { btn.textContent = '🧠 Run Sensei'; btn.disabled = false; }, 3500);
    });
    document.getElementById('fundRefresh')?.addEventListener('click', () => render());
  }
  function _wireOffline() {
    document.getElementById('fundRetry')?.addEventListener('click', () => { clearTimeout(_retryTimer); render(); });
  }

  /* ── main render ──────────────────────────────────────── */
  async function render() {
    const content = document.getElementById('content');
    if (!content) return;
    if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
    _stopPolling();
    _closeStream();
    _evtFails = 0;
    _setConn('idle');

    content.innerHTML = `<div style="padding:40px;color:var(--muted);font-size:13px">Checking Bot Farm API…</div>`;

    const url = _resolveUrl();
    const overview = await _fetchJson(url, 'api/overview');
    if (!overview) {
      content.innerHTML = _offlineHTML();
      _wireOffline();
      _retryTimer = setTimeout(() => { if (_isActiveTab()) render(); else _retryTimer = null; }, 5000);
      return;
    }
    _positions = await _fetchJson(url, 'api/positions?status=closed&limit=500');
    _overview  = overview;
    _recentEvents = [];

    content.innerHTML = _liveHTML(overview);
    _wireLive(url);
    _setConn('reconnect');     // start in 'reconnect' until SSE 'ready' fires
    _startStream(url);
  }

  return { render };
})();
