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
  let _obxadx15m     = null;       // /api/obxadx_trades?bot=15m payload
  let _obxadx1h      = null;       // /api/obxadx_trades?bot=1h payload
  let _riskEvents    = null;       // /api/risk_events payload
  let _escalations   = null;       // /api/escalations payload
  let _recentEvents  = [];         // last N events for the live feed pane
  const FEED_MAX     = 50;

  /* Panel collapse state (persisted across reloads) */
  const PANEL_KEY = 'jb_fund_panel_collapsed';
  const PANEL_IDS = ['bots','feed','open','recent','vetoes','escs','hierarchy','howto'];
  function _isCollapsed(id) {
    try {
      const m = JSON.parse(localStorage.getItem(PANEL_KEY) || '{}');
      return !!m[id];
    } catch { return false; }
  }
  function _toggleCollapsed(id) {
    try {
      const m = JSON.parse(localStorage.getItem(PANEL_KEY) || '{}');
      m[id] = !m[id];
      localStorage.setItem(PANEL_KEY, JSON.stringify(m));
      return m[id];
    } catch { return false; }
  }

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

  /* ── collapsible panel wrapper ───────────────────────── */
  function _panel(id, title, subtitle, bodyHtml) {
    const collapsed = _isCollapsed(id);
    return `<section class="bf-panel ${collapsed ? 'is-collapsed' : ''}" data-panel="${id}">
      <header class="bf-panel-head" data-panel-toggle="${id}">
        <div class="bf-panel-title">
          <span class="bf-panel-chev">${collapsed ? '▸' : '▾'}</span>
          <span>${title}</span>
          ${subtitle ? `<span class="bf-panel-sub">${subtitle}</span>` : ''}
        </div>
      </header>
      <div class="bf-panel-body">${bodyHtml}</div>
    </section>`;
  }

  /* ── current trades (open positions across bots) ─────── */
  function _openTradesHTML() {
    const rows = [];
    /* obxadx-bot-15m + 1h open trades */
    [['obxadx-bot-15m', _obxadx15m], ['obxadx-bot-1h', _obxadx1h]].forEach(([bid, payload]) => {
      if (!payload) return;
      (payload.open_trades || []).forEach(t => rows.push({ ...t, bot: bid }));
    });
    /* fund.db positions (cio / v1_adapter / future bots) */
    if (_positions?.positions) {
      _positions.positions
        .filter(p => p.status === 'open' || p.status === 'partial')
        .forEach(p => rows.push({
          bot: p.source_bot, sym: p.asset, direction: p.side,
          entry: p.entry_price, stop: p.sl, tp1: p.tp1, tp2: p.tp2,
          fill_ts: p.opened_at, dollar_risk: p.risk_usd, size_usd: p.size_usd,
        }));
    }

    if (rows.length === 0) {
      return `<div class="bf-empty">No open trades right now. Bots will fill this when an OB validates inside an active killzone with ADX gate passing.</div>`;
    }
    return `<div class="bf-table-wrap"><table class="bf-table">
      <thead><tr>
        <th>Bot</th><th>Sym</th><th>Dir</th><th>Entry</th><th>Stop</th>
        <th>TP1</th><th>TP2</th><th>Size</th><th>Risk</th><th>Filled</th>
      </tr></thead>
      <tbody>${rows.map(t => `<tr>
        <td><code>${esc(t.bot || '?')}</code></td>
        <td>${esc(t.sym || '?')}</td>
        <td class="${t.direction === 'bull' || t.direction === 'long' ? 'bf-dir-bull' : 'bf-dir-bear'}">${esc(t.direction || '?')}</td>
        <td>${esc(t.entry ?? '—')}</td>
        <td>${esc(t.stop ?? '—')}</td>
        <td>${esc(t.tp1 ?? '—')}</td>
        <td>${esc(t.tp2 ?? '—')}</td>
        <td>${fmtUsd(t.size_usd)}</td>
        <td>${fmtUsd(t.dollar_risk)}</td>
        <td title="${esc(t.fill_ts || '')}">${esc((t.fill_ts || '').slice(5,16).replace('T',' '))}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  }

  /* ── price move % for a closed trade ──────────────────── */
  // close_price is null for TP/SL exits (P&L is R-derived, not price-derived),
  // so we reconstruct the effective price move from the strategy's exit levels.
  // risk distance comes from TP1 (fixed at +1.5R) because the stored `stop`
  // slides to break-even after the partial and can't be trusted for sizing.
  // Returned %; profit-signed (positive = trade made money, matching P&L).
  function _movePct(t) {
    const entry = Number(t.entry);
    const tp1   = Number(t.tp1);
    if (!isFinite(entry) || entry === 0 || !isFinite(tp1)) return null;
    const riskPrice = Math.abs(entry - tp1) / 1.5;   // M3 TP1 = +1.5R
    if (!isFinite(riskPrice) || riskPrice === 0) return null;
    const reason = t.close_reason || '';
    let r;
    if (reason === 'full_win')                            r = 2.25;
    else if (reason === 'sl_after_partial' ||
             reason === 'partial_sl_be')                  r = 0.75;
    else if (reason === 'sl_hit')                         r = -1.0;
    else if (reason === 'forced' && t.close_price != null) {
      const move = (t.direction === 'bull' || t.direction === 'long')
        ? (Number(t.close_price) - entry) : (entry - Number(t.close_price));
      const realized = move / riskPrice;
      r = t.partial_done ? (0.75 + 0.5 * realized) : realized;
    } else if (Number(t.dollar_risk) > 0) {
      r = Number(t.net_pnl) / Number(t.dollar_risk);    // gross-approx fallback
    } else return null;
    return r * riskPrice / entry * 100;
  }

  /* ── recent closed trades ────────────────────────────── */
  function _recentTradesHTML() {
    const rows = [];
    [['obxadx-bot-15m', _obxadx15m], ['obxadx-bot-1h', _obxadx1h]].forEach(([bid, payload]) => {
      if (!payload) return;
      (payload.recent_closed || []).forEach(t => rows.push({ ...t, bot: bid }));
    });
    rows.sort((a, b) => (b.close_ts || '').localeCompare(a.close_ts || ''));
    const limited = rows.slice(0, 30);

    if (limited.length === 0) {
      return `<div class="bf-empty">No closed trades yet. The first trade will appear here once an OB setup fills and resolves (typically via TP, stop, or time exit).</div>`;
    }

    /* small summary footer */
    const wins   = limited.filter(t => t.close_reason && (t.close_reason.includes('win') || (t.net_pnl ?? 0) > 0)).length;
    const losses = limited.filter(t => t.close_reason && (t.close_reason.includes('loss') || (t.net_pnl ?? 0) < 0)).length;
    const totPnl = limited.reduce((s, t) => s + (Number(t.net_pnl) || 0), 0);
    const wr     = (wins + losses) > 0 ? Math.round(100 * wins / (wins + losses)) : null;

    return `<div class="bf-table-wrap"><table class="bf-table">
      <thead><tr>
        <th>Closed</th><th>Bot</th><th>Sym</th><th>Dir</th>
        <th>Entry</th><th>Exit</th><th>Reason</th>
        <th>P&L</th><th title="Net price move in the trade's favour, % of entry">Move %</th><th>Bars</th><th>Bal after</th>
      </tr></thead>
      <tbody>${limited.map(t => {
        const pnl = Number(t.net_pnl) || 0;
        const pnlCls = pnl > 0 ? 'bf-pnl-pos' : pnl < 0 ? 'bf-pnl-neg' : 'bf-pnl-flat';
        const mv = _movePct(t);
        const mvCls = mv === null ? '' : mv > 0 ? 'bf-pnl-pos' : mv < 0 ? 'bf-pnl-neg' : 'bf-pnl-flat';
        const reasonCls = (t.close_reason || '').includes('win') ? 'bf-pnl-pos'
                        : (t.close_reason || '').includes('loss') ? 'bf-pnl-neg' : '';
        return `<tr>
          <td title="${esc(t.close_ts || '')}">${esc((t.close_ts || '').slice(5,16).replace('T',' '))}</td>
          <td><code>${esc(t.bot)}</code></td>
          <td>${esc(t.sym || '?')}</td>
          <td class="${t.direction === 'bull' || t.direction === 'long' ? 'bf-dir-bull' : 'bf-dir-bear'}">${esc(t.direction || '?')}</td>
          <td>${esc(t.entry ?? '—')}</td>
          <td>${esc(t.close_price ?? '—')}</td>
          <td class="${reasonCls}">${esc(t.close_reason || '—')}</td>
          <td class="${pnlCls}">${fmtUsd(pnl)}</td>
          <td class="${mvCls}">${mv === null ? '—' : (mv > 0 ? '+' : '') + mv.toFixed(2) + '%'}</td>
          <td>${esc(t.bars_held ?? '—')}</td>
          <td>${fmtUsd(t.balance_after)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    <div class="bf-table-foot">
      ${limited.length} trades · WR ${wr === null ? '—' : wr + '%'}
      · wins ${wins} · losses ${losses}
      · net <span class="${totPnl > 0 ? 'bf-pnl-pos' : totPnl < 0 ? 'bf-pnl-neg' : ''}">${fmtUsd(totPnl)}</span>
    </div>`;
  }

  /* ── what didn't go through: risk vetoes ──────────────── */
  function _vetoesHTML() {
    const evs = _riskEvents?.risk_events || [];
    if (evs.length === 0) {
      return `<div class="bf-empty">No risk vetoes recorded. When a bot's trade signal is blocked by the pre-trade risk gate (max concurrent positions, daily loss halt, micro regime veto, etc.) it shows up here.</div>`;
    }
    return `<div class="bf-table-wrap"><table class="bf-table">
      <thead><tr><th>When</th><th>Type</th><th>Reason</th><th>Intent</th></tr></thead>
      <tbody>${evs.slice(0, 30).map(e => `<tr>
        <td title="${esc(e.ts || '')}">${esc((e.ts || '').slice(5,16).replace('T',' '))}</td>
        <td><span class="bf-tag bf-tag-${esc((e.event_type||'').toLowerCase())}">${esc(e.event_type || '—')}</span></td>
        <td>${esc(e.reason || '—')}</td>
        <td><code class="bf-uid">${esc(e.intent_id || '—')}</code></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  }

  /* ── escalations ─────────────────────────────────────── */
  function _escalationsHTML() {
    const evs = _escalations?.escalations || [];
    if (evs.length === 0) {
      return `<div class="bf-empty">No escalations. Tier-1 alerts (bot down &gt; 90s, daily-loss halt, 5-restart-cap, schema failure) surface here.</div>`;
    }
    return `<div class="bf-table-wrap"><table class="bf-table">
      <thead><tr><th>When</th><th>Tier</th><th>Reason</th><th>Summary</th></tr></thead>
      <tbody>${evs.slice(0, 20).map(e => `<tr>
        <td title="${esc(e.ts || '')}">${esc((e.ts || '').slice(5,16).replace('T',' '))}</td>
        <td><span class="bf-tier-${e.tier}">T${esc(String(e.tier ?? '?'))}</span></td>
        <td>${esc(e.reason || '—')}</td>
        <td>${esc(e.summary || '')}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  }

  /* ── bot hierarchy diagram ───────────────────────────── */
  function _hierarchyHTML() {
    return `<div class="bf-hier">
      <div class="bf-hier-row bf-hier-trader">
        <div class="bf-hier-node bf-hier-primary">
          <div class="bf-hier-icon">⚡</div>
          <div class="bf-hier-name">obxadx-bot-15m</div>
          <div class="bf-hier-role">Sole live trader · 15m OB detection + 4h ADX gate + M3 management</div>
        </div>
        <div class="bf-hier-node bf-hier-secondary">
          <div class="bf-hier-icon">🔬</div>
          <div class="bf-hier-name">obxadx-bot-1h</div>
          <div class="bf-hier-role">Shadow / backtest variant · same strategy, 1h timeframe</div>
        </div>
      </div>
      <div class="bf-hier-arrow">▾ feed signals to + are governed by ▾</div>
      <div class="bf-hier-row bf-hier-governance">
        <div class="bf-hier-node">
          <div class="bf-hier-icon">🛡️</div>
          <div class="bf-hier-name">risk-1</div>
          <div class="bf-hier-role">Pre-trade risk gate · monitors veto rate · daily loss halt</div>
        </div>
        <div class="bf-hier-node">
          <div class="bf-hier-icon">🩺</div>
          <div class="bf-hier-name">ops-1</div>
          <div class="bf-hier-role">Tech nurse · audits heartbeats · auto-restarts the trader · escalates after 5 restarts/day</div>
        </div>
        <div class="bf-hier-node">
          <div class="bf-hier-icon">🌊</div>
          <div class="bf-hier-name">micro-1</div>
          <div class="bf-hier-role">Polls Liquidity Watcher · publishes regime_view to fund.db (feeds the micro-veto gate)</div>
        </div>
        <div class="bf-hier-node">
          <div class="bf-hier-icon">📊</div>
          <div class="bf-hier-name">markov-1</div>
          <div class="bf-hier-role">Daily kline → 3×3 transition matrix per symbol · sizes / vetoes via Markov gate</div>
        </div>
        <div class="bf-hier-node">
          <div class="bf-hier-icon">🧠</div>
          <div class="bf-hier-name">sensei-1</div>
          <div class="bf-hier-role">Once-daily AI coach report · tier-1 escalation if budget exhausted or schema fails</div>
        </div>
      </div>
      <div class="bf-hier-foot">
        All five governance bots write to <code>fund.db</code> (heartbeats, messages, risk_events, escalations) and read each other's state via the message bus. obxadx-bot-15m is the only bot that places trades; the others advise + audit it.
      </div>
    </div>`;
  }

  /* ── how-to-use guide ─────────────────────────────────── */
  function _howToHTML() {
    return `<div class="bf-howto">
      <h4>What you're looking at</h4>
      <p>This is the operator console for the live paper-trading bot farm. Everything updates in real time over the SSE event stream (look for the 🟢 live pill at the top — that means the connection is open and events are arriving as they happen).</p>

      <h4>Reading the panels</h4>
      <ol>
        <li><strong>Bot cards</strong> — one per bot. The dot tells you live status; 24h actions counts trades for traders + ticks for governance bots; 7-day P&L is only meaningful for traders. Click a card to expand its detail (coming soon).</li>
        <li><strong>Live event feed</strong> — every heartbeat (5 s), message, escalation, and risk event flows here. Useful for "is anything happening right now?" sanity checks.</li>
        <li><strong>Open trades</strong> — anything currently in play across the bot farm. Empty most of the time — the strategy fires ~1–2 trades per symbol per week.</li>
        <li><strong>Recent trades</strong> — last 30 closed trades, newest first. The footer shows WR and net P&L for the visible window.</li>
        <li><strong>Vetoes</strong> — trade signals that the risk gate blocked. If this fills up, the strategy is firing but the gate doesn't like the conditions (over concurrency cap, daily-loss-halted, micro regime contradicting bias, etc.).</li>
        <li><strong>Escalations</strong> — anything tier-1. Should be empty most days. Bot-down &gt; 90 s, daily loss halt, 5-restart cap, sensei schema failure all surface here.</li>
        <li><strong>Hierarchy</strong> — visual map of which bots advise the trader.</li>
      </ol>

      <h4>Action shortcuts</h4>
      <ul>
        <li><strong>↻ Refresh</strong> — re-fetches everything. Mostly redundant when 🟢 live.</li>
        <li><strong>🧠 Run Sensei</strong> — fires the daily coach report on demand (Sonnet, ~$0.10).</li>
        <li><strong>↗ Pop out</strong> — opens the raw fund API HTML view in a new tab.</li>
      </ul>

      <h4>If the 🟢 pill turns 🟡 or 🔴</h4>
      <ul>
        <li>🟡 reconnecting — single hiccup, browser auto-retries. Wait 5 s.</li>
        <li>🔴 offline — fund.api isn't responding. Check Railway logs.</li>
        <li>⚪ polling — SSE failed 3× in a row. Falls back to 15 s polling automatically; reopens SSE on each poll.</li>
      </ul>

      <h4>Common questions</h4>
      <ul>
        <li><strong>"All my trade tables are empty"</strong> — normal post-deploy. The bots fire ~1–2 setups per week per symbol; expect 0–3 entries per day across all 5 symbols. The 6 historical trades from your Mac are visible under <em>Recent trades</em>.</li>
        <li><strong>"24h actions is 0"</strong> — actions counts trades opened / closed, not heartbeats. For governance bots it counts published messages.</li>
        <li><strong>"What's the difference between obxadx-15m and obxadx-1h?"</strong> — only the 15m bot trades live. The 1h variant runs the same logic on a slower timeframe so we can compare PFs without risking double-counted signals.</li>
      </ul>
    </div>`;
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

    const openN  = ((_obxadx15m?.open_trades?.length) || 0)
                  + ((_obxadx1h?.open_trades?.length)  || 0)
                  + ((_positions?.positions || []).filter(p => p.status === 'open' || p.status === 'partial').length);
    const closedN = ((_obxadx15m?.recent_closed?.length) || 0)
                  + ((_obxadx1h?.recent_closed?.length)  || 0);
    const vetoN  = (_riskEvents?.risk_events || []).length;
    const escN   = (_escalations?.escalations || []).length;

    return `
      ${_pageHeadHTML(overview)}
      ${_kpiStripHTML(overview)}

      ${_panel('bots', '🤖 Bots', `${bots.length} total · click a card for details`,
        `<div class="bf-bot-grid">${sortedBots.map(b => _botCardHTML(b, killState)).join('')}</div>`)}

      ${_panel('open', '🎯 Open trades', openN > 0 ? `${openN} in play` : 'none right now',
        _openTradesHTML())}

      ${_panel('recent', '📈 Recent trades', closedN > 0 ? `last ${Math.min(closedN, 30)} closed` : 'none yet',
        _recentTradesHTML())}

      ${_panel('vetoes', '🛡️ What didn’t go through (vetoes)',
        vetoN > 0 ? `${vetoN} blocked` : 'clean',
        _vetoesHTML())}

      ${_panel('escs', '🚨 Escalations',
        escN > 0 ? `${escN} alerts` : 'clean',
        _escalationsHTML())}

      ${_panel('feed', '📡 Live event feed',
        `${_recentEvents.length} events in window`,
        _liveFeedHTML())}

      ${_panel('hierarchy', '🧬 Bot hierarchy', 'how the farm wires together', _hierarchyHTML())}

      ${_panel('howto', '📖 How to use this tab', 'guide + FAQ', _howToHTML())}

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
    /* Re-render in place. Cheap because content already exists.
       MUST guard with _isActiveTab() — without this, the SSE health
       event handler (fires every ~5s) blows away whatever the user
       is currently viewing on a different tab. Symptom: Confluence /
       Daily Report / AI Coach tabs "flick back to Bot Farm" while
       you're on them. Also close the stream so we don't keep
       hammering it for nothing. */
    if (!_isActiveTab()) {
      _closeStream();
      _stopPolling();
      return;
    }
    const content = document.getElementById('content');
    if (!content || !_overview) return;
    content.innerHTML = _liveHTML(_overview);
    _wireLive(_resolveUrl());
    _wirePanels();
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
      const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
      btn.disabled = true;
      // Sensei's brain is the FREE local Claude CLI — it only runs on the
      // Mac. From localhost we can trigger it via the local AI server
      // (:8770). From the Railway HTTPS page Chrome PNA blocks localhost,
      // so we can't reach it — tell the user to run it from their Mac.
      if (!isLocal) {
        btn.textContent = '🖥️ Run from your Mac';
        alert('Sensei runs on your Mac for free (local Claude CLI — no API spend).\n\n'
            + 'To generate a report now, either:\n'
            + '  • open this dashboard at localhost:8768 and click Run Sensei, or\n'
            + '  • run:  python3 -m fund.tools.sensei_local\n\n'
            + 'The report saves to the cloud (fund.db) automatically and shows here on refresh.');
        setTimeout(() => { btn.textContent = '🧠 Run Sensei'; btn.disabled = false; }, 4000);
        return;
      }
      btn.textContent = '⏳ Running…';
      try {
        const r = await fetch('http://127.0.0.1:8770/run-sensei', {
          method: 'POST', mode: 'cors', cache: 'no-store',
          signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
        });
        btn.textContent = r.ok ? '✓ Generating…' : '✗ Local server off';
      } catch { btn.textContent = '✗ Start local AI server'; }
      setTimeout(() => { btn.textContent = '🧠 Run Sensei'; btn.disabled = false; }, 4000);
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
    /* Parallel — independent endpoints */
    const [pos, ob15, ob1h, risks, escs] = await Promise.all([
      _fetchJson(url, 'api/positions?status=open,partial,closed&limit=500'),
      _fetchJson(url, 'api/obxadx_trades?bot=15m&limit=30'),
      _fetchJson(url, 'api/obxadx_trades?bot=1h&limit=30'),
      _fetchJson(url, 'api/risk_events?limit=30'),
      _fetchJson(url, 'api/escalations?limit=20'),
    ]);
    _positions   = pos;
    _obxadx15m   = ob15;
    _obxadx1h    = ob1h;
    _riskEvents  = risks;
    _escalations = escs;
    _overview    = overview;
    _recentEvents = [];

    content.innerHTML = _liveHTML(overview);
    _wireLive(url);
    _wirePanels();
    _setConn('reconnect');     // start in 'reconnect' until SSE 'ready' fires
    _startStream(url);
  }

  function _wirePanels() {
    document.querySelectorAll('[data-panel-toggle]').forEach(head => {
      head.addEventListener('click', () => {
        const id = head.dataset.panelToggle;
        const sec = document.querySelector(`section.bf-panel[data-panel="${id}"]`);
        if (!sec) return;
        const nowCollapsed = _toggleCollapsed(id);
        sec.classList.toggle('is-collapsed', nowCollapsed);
        const chev = sec.querySelector('.bf-panel-chev');
        if (chev) chev.textContent = nowCollapsed ? '▸' : '▾';
      });
    });
  }

  return { render };
})();
