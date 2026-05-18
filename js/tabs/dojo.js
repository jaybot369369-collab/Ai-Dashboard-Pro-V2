/* ═══════════════════════════════════════════════════════════
   ICT DOJO TAB — Canonical-identifier dashboard (v3)
   Thin renderer over js/data/sb_watcher.json (the GHA-cron
   watcher running automation/sb_live_watcher.py, which uses
   the locked Phase-1 identifiers + Phase-2 LIVE_CONFIG).

   Sections:
     1. Symbol header  — price, AMD pill, killzone pill
     2. SB Setup card  — BREWING/ARMED/TRIGGER + entry/SL/TPs
     3. PD Arrays      — active FVGs + OBs (Phase B fields)
     4. Recent Sweeps  — BSL/SSL pools w/ reclaim flag
     5. Structure      — dealing range, P/D, last MSB
     6. Extended       — cheap in-browser context (vola, prev-day)
     7. Custom Tickers — absorbed from old SB Watcher tab
════════════════════════════════════════════════════════════ */
const DojoTab = (() => {

  /* ── Constants ──────────────────────────────────────── */
  const PROTECTED   = ['BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'SOLUSDT'];
  const REFRESH_MS  = 60 * 1000;          // re-fetch JSON & ticker every 60s
  const CUSTOM_KEY  = 'jb_custom_symbols'; // shared with old SBWatcherTab — DON'T rename
  const CUSTOM_PATH = 'js/data/custom_symbols.json';

  /* ── Local state ────────────────────────────────────── */
  let _pair      = localStorage.getItem('jb_dojo_pair') || 'BTCUSDT';
  let _custom    = loadCustomSymbols();
  let _data      = null;       // parsed sb_watcher.json
  let _ticker    = null;       // Binance 24h ticker for current pair
  let _ext       = null;       // Extended (in-browser) signals for current pair
  let _err       = null;
  let _loading   = false;
  let _lastFetch = null;
  let _pollTimer = null;
  // Top Down Analysis cache: { [pair]: { result, ts, err, loading } }
  let _td        = JSON.parse(localStorage.getItem('jb_dojo_td') || '{}');
  function saveTd() { localStorage.setItem('jb_dojo_td', JSON.stringify(_td)); }

  /* ── Persistence helpers ────────────────────────────── */
  function loadCustomSymbols() {
    try {
      const raw = localStorage.getItem(CUSTOM_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return ['SUIUSDT'];
  }
  function saveCustomSymbols(list) {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  }

  /* ── Format helpers ─────────────────────────────────── */
  const dp   = sym => sym && sym.includes('BTC') ? 2 : 4;
  const fmtP = (n, sym) => n == null ? '—'
    : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: dp(sym||_pair), maximumFractionDigits: dp(sym||_pair) });
  const ago  = ms => { if (!ms) return '—'; const s = Math.round((Date.now()-ms)/1000); return s < 60 ? `${s}s ago` : `${Math.round(s/60)}m ago`; };
  const esc  = s => String(s ?? '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
  // Symbols must be uppercase alphanumeric (e.g. BTCUSDT). Reject anything else
  // — protects the onclick="...('${sym}')" interpolations downstream from XSS
  // via crafted localStorage values.
  const safeSym = s => typeof s === 'string' && /^[A-Z0-9]+$/.test(s);
  const onDojoTab = () => document.querySelector('.nav-item.active')?.dataset.tab === 'dojo';

  /* ══════════════════════════════════════════════════════
     DATA LAYER — sb_watcher.json + Binance ticker
  ══════════════════════════════════════════════════════ */
  async function fetchWatcher() {
    const r = await fetch('js/data/sb_watcher.json?t=' + Date.now());
    if (!r.ok) throw new Error('sb_watcher.json HTTP ' + r.status);
    return r.json();
  }
  async function fetchTicker(sym) {
    try {
      const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}`);
      if (!r.ok) return null;
      return await r.json();
    } catch (_) { return null; }
  }
  async function fetchExtended(sym) {
    // Cheap in-browser context: 1d candles for prev-day H/L + 14d ATR-ish vola.
    // Stays in-browser because these are non-canonical context, not signals.
    try {
      const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&limit=15`);
      if (!r.ok) return null;
      const k = (await r.json()).map(x => ({ o:+x[1], h:+x[2], l:+x[3], c:+x[4] }));
      if (k.length < 2) return null;
      const prev = k[k.length - 2];
      const today = k[k.length - 1];
      const ranges = k.slice(0, -1).map(b => b.h - b.l);
      const avgRange = ranges.reduce((s,r) => s + r, 0) / ranges.length;
      const todayRange = today.h - today.l;
      const usedPct = avgRange ? Math.min(100, (todayRange / avgRange) * 100) : null;
      return {
        prevDayHigh: prev.h, prevDayLow: prev.l,
        todayHigh:   today.h, todayLow:  today.l,
        avgRange14:  avgRange,
        rangeUsedPct: usedPct,
      };
    } catch (_) { return null; }
  }

  async function loadAll() {
    if (_loading) return;
    _loading = true;
    _err = null;
    updateBody();
    try {
      const [watcher, ticker, ext] = await Promise.all([
        fetchWatcher(),
        fetchTicker(_pair),
        fetchExtended(_pair),
      ]);
      _data   = watcher;
      _ticker = ticker;
      _ext    = ext;
      _lastFetch = Date.now();
    } catch (e) {
      _err = e.message;
    } finally {
      _loading = false;
      updateBody();
      // Top bar shows live price + last-updated stamp; refresh it too so a
      // pair switch doesn't leave the previous pair's price visible.
      const tb = document.getElementById('dojoTopBar');
      if (tb) tb.innerHTML = renderTopBar();
    }
  }

  /* ══════════════════════════════════════════════════════
     LOOKUPS
  ══════════════════════════════════════════════════════ */
  function symData() {
    if (!_data || !_data.symbols) return null;
    return _data.symbols[_pair] || null;
  }

  function bestSetup(sym) {
    if (!sym || !Array.isArray(sym.active_setups) || !sym.active_setups.length) return null;
    const order = { TRIGGER: 0, ARMED: 1, BREWING: 2 };
    return [...sym.active_setups].sort((a, b) => (order[a.tier] ?? 9) - (order[b.tier] ?? 9))[0];
  }

  /* ══════════════════════════════════════════════════════
     RENDER — top bar + chips
  ══════════════════════════════════════════════════════ */
  function renderPairChips() {
    const all = [...PROTECTED, ..._custom.filter(s => !PROTECTED.includes(s))].filter(safeSym);
    return `<div class="dojo-pair-chips">
      ${all.map(sym => {
        const label = sym.replace('USDT', '');
        const removable = !PROTECTED.includes(sym);
        return `<span class="dojo-pair-chip${sym === _pair ? ' active' : ''}" onclick="DojoTab._pair('${sym}')">
          ${esc(label)}
          ${removable ? `<button class="dojo-chip-x" onclick="event.stopPropagation();DojoTab._removePair('${sym}')" title="Remove">✕</button>` : ''}
        </span>`;
      }).join('')}
      <input id="dojoAddPair" class="dojo-add-pair" placeholder="+ ADDUSDT" onkeydown="if(event.key==='Enter'){DojoTab._addPair(this.value);this.value='';}">
    </div>`;
  }

  function renderTopBar() {
    const tickerHtml = _ticker
      ? (() => {
          const px = parseFloat(_ticker.lastPrice);
          const chg = parseFloat(_ticker.priceChangePercent);
          const col = chg >= 0 ? 'var(--green)' : 'var(--red)';
          return `<span class="dojo-price">${fmtP(px)}</span>
            <span style="color:${col};font-size:.85rem;margin-left:8px">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% 24h</span>`;
        })()
      : '<span class="text-dim">—</span>';
    const status = _err
      ? `<span style="color:var(--red)">⚠ ${esc(_err)}</span>`
      : (_loading ? 'Fetching…' : (_lastFetch ? `Updated ${ago(_lastFetch)}` : 'Connecting…'));
    return `<div class="dojo-top-bar">
      ${renderPairChips()}
      <div class="dojo-ticker">${tickerHtml}</div>
      <div class="text-dim" style="font-size:.78rem">${status}</div>
      <button class="btn-ghost btn-sm" onclick="DojoTab._refresh()">↻ Refresh</button>
    </div>`;
  }

  /* ══════════════════════════════════════════════════════
     RENDER — section 1: symbol header pills
  ══════════════════════════════════════════════════════ */
  const AMD_META = {
    bull_amd:  { label: 'BULL AMD',   color: '#3aa260', icon: '🟢' },
    bear_amd:  { label: 'BEAR AMD',   color: '#d04545', icon: '🔴' },
    two_sided: { label: 'TWO-SIDED',  color: '#999',    icon: '⚪' },
    trending:  { label: 'TRENDING',   color: '#5a9fd4', icon: '➡️' },
    no_sweep:  { label: 'NO SWEEP',   color: '#666',    icon: '⚫' },
  };

  function renderHeaderPills(sym) {
    if (!sym) {
      // Placeholder pills for custom tickers without watcher data
      return `<div class="dojo-cards" style="grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
        <div class="dojo-card" style="border-left:3px solid var(--text-sub)">
          <div class="dojo-card-lbl">AMD Profile (today)</div>
          <div class="dojo-card-val text-dim">— PENDING</div>
          <div class="dojo-card-sub">awaiting watcher tick</div>
        </div>
        <div class="dojo-card" style="border-left:3px solid var(--text-sub)">
          <div class="dojo-card-lbl">Killzone</div>
          <div class="dojo-card-val text-dim">—</div>
          <div class="dojo-card-sub">awaiting watcher tick</div>
        </div>
      </div>`;
    }
    const amd = sym.amd || {};
    const amdMeta = AMD_META[amd.profile] || AMD_META.no_sweep;
    const kz   = sym.killzone || {};       // Phase-B field; falls back to next_window
    const next = sym.next_window || {};
    const inKZ = kz.current && kz.current !== 'none';
    const kzLabel = inKZ ? kz.current : (next.name ? `Next: ${next.name}` : '—');
    const mins = inKZ ? null : (next.minutes_until ?? kz.minutes_to_next);
    const kzColor = inKZ ? '#3aa260' : '#999';
    const dist = amd.dist_direction ? ` · dist ${amd.dist_direction}` : (amd.manip_direction ? ` · manip ${amd.manip_direction}` : '');
    return `<div class="dojo-cards" style="grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div class="dojo-card" style="border-left:3px solid ${amdMeta.color}">
        <div class="dojo-card-lbl">AMD Profile (today)</div>
        <div class="dojo-card-val">${amdMeta.icon} ${amdMeta.label}</div>
        <div class="dojo-card-sub">${amd.date || ''}${dist}</div>
      </div>
      <div class="dojo-card" style="border-left:3px solid ${kzColor}">
        <div class="dojo-card-lbl">Killzone</div>
        <div class="dojo-card-val">${esc(kzLabel)}</div>
        <div class="dojo-card-sub">${mins != null ? `opens in ${mins}m` : (inKZ ? 'ACTIVE' : '—')}</div>
      </div>
    </div>`;
  }

  /* ══════════════════════════════════════════════════════
     RENDER — section 2: SB Setup card
  ══════════════════════════════════════════════════════ */
  const TIER_META = {
    BREWING: { color: '#d4af37', desc: 'FVG forming, awaiting retrace into mid' },
    ARMED:   { color: '#e0883a', desc: 'Touched FVG mid, awaiting confirmation close' },
    TRIGGER: { color: '#3aa260', desc: 'Confirmation closed — paper trader would enter' },
  };

  function renderConfluenceFlags(flags) {
    if (!flags) return '';
    const order = ['has_sweep', 'has_displacement', 'pd_aligned', 'has_confirmation', 'msb_confirmed'];
    return order.map(k => {
      const on = !!flags[k];
      return `<span title="${k}" style="display:inline-block;width:10px;height:10px;border-radius:50%;
        background:${on ? '#3aa260' : 'var(--bg-mid)'};border:1px solid var(--border);margin-right:3px"></span>`;
    }).join('');
  }

  function renderSetupCard(sym) {
    const setup = bestSetup(sym);
    if (!setup) {
      return `<div class="dojo-section">
        <div class="dojo-sec-hdr">⚡ Silver Bullet Setup</div>
        <div class="empty-state" style="padding:24px"><div style="font-size:.9rem;color:var(--text-sub)">No active setup. Watcher will surface BREWING / ARMED / TRIGGER as windows open.</div></div>
      </div>`;
    }
    const meta = TIER_META[setup.tier] || TIER_META.BREWING;
    const dir = (setup.direction || setup.dir || '').toLowerCase();
    const rrText = setup.rr ? `${parseFloat(setup.rr).toFixed(2)}R` : '—';
    return `<div class="dojo-section" style="border-top:3px solid ${meta.color}">
      <div class="dojo-sec-hdr">
        <span style="font-size:1rem">⚡ Silver Bullet Setup</span>
        <span style="background:${meta.color};color:#fff;font-weight:700;padding:3px 10px;border-radius:6px;font-size:.78rem;margin-left:auto">
          ${setup.tier}
        </span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4, minmax(120px, 1fr));gap:10px;margin-top:10px">
        <div class="dojo-card"><div class="dojo-card-lbl">Strategy</div><div class="dojo-card-val">${esc(setup.strategy || 'silver_bullet')}</div><div class="dojo-card-sub">${esc(setup.window || setup.session || '—')}</div></div>
        <div class="dojo-card"><div class="dojo-card-lbl">Direction</div><div class="dojo-card-val" style="color:${dir==='long'?'var(--green)':'var(--red)'}">${dir.toUpperCase() || '—'}</div><div class="dojo-card-sub">R:R ${rrText}</div></div>
        <div class="dojo-card"><div class="dojo-card-lbl">Entry / Stop</div><div class="dojo-card-val">${fmtP(setup.entry)}</div><div class="dojo-card-sub">SL ${fmtP(setup.stop)}</div></div>
        <div class="dojo-card"><div class="dojo-card-lbl">Targets</div><div class="dojo-card-val">${fmtP(setup.tp1)}</div><div class="dojo-card-sub">TP2 ${fmtP(setup.tp2)}</div></div>
      </div>
      <div style="margin-top:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span class="text-dim" style="font-size:.78rem">Confluence ${setup.confluence_score ?? '—'}/5</span>
        <span>${renderConfluenceFlags(setup.confluence_flags)}</span>
        <span class="text-dim" style="font-size:.78rem;font-style:italic">${meta.desc}</span>
      </div>
      ${setup.narrative ? `<div style="margin-top:8px;font-size:.82rem;color:var(--text-sub);border-left:2px solid var(--border);padding-left:8px">${esc(setup.narrative)}</div>` : ''}
    </div>`;
  }

  /* ── (PD Arrays and Recent Sweeps panels removed per user request
        2026-05-07 — too noisy; the SB Setup card already surfaces the
        canonical FVG/sweep that's actually actionable.) ── */
  function _UNUSED_renderPDArrays_(sym) {
    const pda = sym && sym.pd_arrays;
    if (!pda) {
      return `<div class="dojo-section">
        <div class="dojo-sec-hdr">📐 Active PD Arrays</div>
        <div class="text-dim" style="font-size:.85rem;padding:10px">Watcher hasn't emitted PD-array fields yet (Phase B). Active FVGs + Order Blocks will appear here once <code>sb_live_watcher.py</code> includes <code>pd_arrays</code> in its output.</div>
      </div>`;
    }
    const fvgs = pda.active_fvgs || [];
    const obs  = pda.active_obs  || [];
    const fvgRows = fvgs.length
      ? fvgs.map(f => `<tr>
          <td><span class="badge" style="background:${f.grade==='A'?'var(--gold)':'var(--bg-mid)'};color:${f.grade==='A'?'#000':'var(--text)'}">${esc(f.grade || '?')}</span></td>
          <td style="color:${f.dir==='bull'?'var(--green)':'var(--red)'};font-weight:600">${esc((f.dir||'').toUpperCase())}</td>
          <td>${fmtP(f.top)}</td>
          <td>${fmtP(f.mid)}</td>
          <td>${fmtP(f.bot)}</td>
          <td class="text-dim">${f.rebalanced ? 'rebalanced' : 'fresh'}</td>
        </tr>`).join('')
      : `<tr><td colspan="6" class="text-dim" style="text-align:center;padding:8px">No active FVGs.</td></tr>`;
    const obRows = obs.length
      ? obs.map(o => `<tr>
          <td style="color:${o.dir==='bull'?'var(--green)':'var(--red)'};font-weight:600">${esc((o.dir||'').toUpperCase())}</td>
          <td>${fmtP(o.high)}</td>
          <td>${fmtP(o.low)}</td>
          <td class="text-dim">${o.tested ? 'tested' : 'untouched'}</td>
        </tr>`).join('')
      : `<tr><td colspan="4" class="text-dim" style="text-align:center;padding:8px">No active OBs.</td></tr>`;
    return `<div class="dojo-section">
      <div class="dojo-sec-hdr">📐 Active PD Arrays</div>
      <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:14px;margin-top:8px">
        <div>
          <div class="dojo-pd-col-hdr">Fair Value Gaps</div>
          <table class="data-table" style="width:100%;font-size:.82rem">
            <thead><tr><th>Grade</th><th>Dir</th><th>Top</th><th>Mid</th><th>Bot</th><th>State</th></tr></thead>
            <tbody>${fvgRows}</tbody>
          </table>
        </div>
        <div>
          <div class="dojo-pd-col-hdr">Order Blocks</div>
          <table class="data-table" style="width:100%;font-size:.82rem">
            <thead><tr><th>Dir</th><th>High</th><th>Low</th><th>State</th></tr></thead>
            <tbody>${obRows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  }

  function _UNUSED_renderSweeps_(sym) {
    const sw = sym && sym.sweeps;
    if (!sw) {
      return `<div class="dojo-section">
        <div class="dojo-sec-hdr">💧 Recent Sweeps</div>
        <div class="text-dim" style="font-size:.85rem;padding:10px">Watcher hasn't emitted sweep fields yet (Phase B). BSL/SSL pools with reclaim status will appear here once <code>sb_live_watcher.py</code> includes <code>sweeps</code>.</div>
      </div>`;
    }
    const renderRow = (p, side) => `<tr>
      <td><span class="badge" style="background:${side==='BSL'?'var(--green-dim)':'var(--red-dim)'};color:var(--text)">${side}</span></td>
      <td>${fmtP(p.level)}</td>
      <td class="text-dim">${esc(p.kind || '—')}</td>
      <td>${p.reclaimed ? '<span style="color:var(--gold)">✓ reclaimed</span>' : '<span class="text-dim">unreclaimed</span>'}</td>
      <td class="text-dim" style="font-size:.74rem">${esc(p.ts || '')}</td>
    </tr>`;
    const rows = [
      ...(sw.recent_bsl || []).slice(0, 4).map(p => renderRow(p, 'BSL')),
      ...(sw.recent_ssl || []).slice(0, 4).map(p => renderRow(p, 'SSL')),
    ];
    return `<div class="dojo-section">
      <div class="dojo-sec-hdr">💧 Recent Sweeps</div>
      <table class="data-table" style="width:100%;font-size:.82rem;margin-top:6px">
        <thead><tr><th>Side</th><th>Level</th><th>Kind</th><th>State</th><th>When</th></tr></thead>
        <tbody>${rows.length ? rows.join('') : `<tr><td colspan="5" class="text-dim" style="text-align:center;padding:8px">No recent pools detected.</td></tr>`}</tbody>
      </table>
    </div>`;
  }

  /* ══════════════════════════════════════════════════════
     RENDER — section 5: Market Structure  [Phase B fields]
  ══════════════════════════════════════════════════════ */
  function renderStructure(sym) {
    const st = sym && sym.structure;
    if (!st) {
      return `<div class="dojo-section">
        <div class="dojo-sec-hdr">🏛 Market Structure</div>
        <div class="text-dim" style="font-size:.85rem;padding:10px">Watcher hasn't emitted structure fields yet (Phase B). Dealing range, premium/discount, and last MSB will appear once <code>sb_live_watcher.py</code> includes <code>structure</code>.</div>
      </div>`;
    }
    const dr = st.dealing_range || {};
    const pdLabel = (st.premium_discount || '—').toUpperCase();
    const pdColor = st.premium_discount === 'discount' ? 'var(--green)'
                  : st.premium_discount === 'premium'  ? 'var(--red)'
                  : 'var(--text-sub)';
    const msb = st.last_msb || {};
    return `<div class="dojo-section">
      <div class="dojo-sec-hdr">🏛 Market Structure</div>
      <div class="dojo-cards" style="grid-template-columns:repeat(3,1fr);gap:10px;margin-top:8px">
        <div class="dojo-card"><div class="dojo-card-lbl">Dealing Range</div><div class="dojo-card-val">${fmtP(dr.high)}</div><div class="dojo-card-sub">low ${fmtP(dr.low)}</div></div>
        <div class="dojo-card" style="border-left:3px solid ${pdColor}"><div class="dojo-card-lbl">Premium / Discount</div><div class="dojo-card-val" style="color:${pdColor}">${pdLabel}</div><div class="dojo-card-sub">96-bar dealing range</div></div>
        <div class="dojo-card"><div class="dojo-card-lbl">Last MSB</div><div class="dojo-card-val" style="color:${msb.dir==='bullish'?'var(--green)':msb.dir==='bearish'?'var(--red)':'var(--text)'}">${esc((msb.dir||'—').toUpperCase())}</div><div class="dojo-card-sub">@ ${fmtP(msb.level)}</div></div>
      </div>
    </div>`;
  }

  /* ══════════════════════════════════════════════════════
     TOP DOWN ANALYSIS — Claude-driven M→W→D→4H→5m cascade
     Mirrors ICT_Methodology/skill/top_down_workflow/.
     Calls AICoachTab.callClaude() with multi-TF candle samples;
     result cached per-pair in localStorage so it survives renders.
  ══════════════════════════════════════════════════════ */
  const TD_TFS = [
    { tf: '1M', interval: '1M', limit: 12 },
    { tf: '1W', interval: '1w', limit: 26 },
    { tf: '1D', interval: '1d', limit: 30 },
    { tf: '4H', interval: '4h', limit: 30 },
    { tf: '5m', interval: '5m', limit: 60 },
  ];

  async function fetchTDCandles(sym) {
    const out = {};
    let lastErr = null;
    await Promise.all(TD_TFS.map(async ({ tf, interval, limit }) => {
      try {
        const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${limit}`);
        if (!r.ok) {
          // Surface useful detail (Binance returns a JSON body for invalid
          // symbols: {"code":-1121,"msg":"Invalid symbol."})
          let detail = `HTTP ${r.status}`;
          try {
            const j = await r.json();
            if (j && j.msg) detail = `${j.msg} (${j.code || r.status})`;
          } catch (_) {}
          lastErr = `${tf}: ${detail}`;
          out[tf] = null;
          return;
        }
        const k = await r.json();
        out[tf] = k.map(x => [
          new Date(x[0]).toISOString().slice(0, 16),
          +parseFloat(x[1]).toPrecision(8),
          +parseFloat(x[2]).toPrecision(8),
          +parseFloat(x[3]).toPrecision(8),
          +parseFloat(x[4]).toPrecision(8),
        ]);
      } catch (e) {
        lastErr = `${tf}: ${e.message}`;
        out[tf] = null;
      }
    }));
    return { candles: out, lastErr };
  }

  const TD_SYSTEM = `You are an ICT (Inner Circle Trader) analyst running a top-down cascade on a crypto pair.

Workflow: Monthly → Weekly → Daily → 4H → 5m. Each TF outputs a bias (direction + key PD arrays + invalidation) that becomes the input to the next TF down. You do not skip steps.

Universal principles:
- Time then price. Calendar/seasonal first, then technicals.
- Internal vs external liquidity is the master split. Internal = trade inside a defined range (OTE entries). External = trade the sweep of the range edge (turtle-soup reversals).
- PD Array Matrix decides "where". Every level is a premium array (sell zone if bear, TP if bull) or discount array (buy zone if bull, TP if bear).
- A bias is direction + key levels + invalidation, NOT a price target.
- If a TF is unclear (consolidation, no obvious direction), drop one TF down and let it lead — don't force a bias.

You will receive OHLC data per TF (compact rows: [openTime, o, h, l, c]). Return JSON ONLY in this exact schema, no markdown, no prose outside the JSON:

{
  "pair": "<symbol>",
  "as_of": "<ISO timestamp from latest 5m bar>",
  "monthly":  { "bias": "bullish|bearish|neutral", "key_levels": ["..."], "invalidation": "...", "rationale": "1-2 sentences" },
  "weekly":   { "bias": "...", "key_levels": ["..."], "invalidation": "...", "rationale": "..." },
  "daily":    { "bias": "...", "key_levels": ["..."], "invalidation": "...", "rationale": "..." },
  "fourH":    { "bias": "...", "key_levels": ["..."], "invalidation": "...", "rationale": "..." },
  "fiveM":    { "bias": "...", "draw_on_liquidity": "...", "intraday_plan": "1-2 sentences on what to hunt this session", "rationale": "..." },
  "verdict":  { "tradeable": true|false, "best_setup": "OTE|FVG|Sweep|Order Block|None", "direction": "long|short|none", "confluence_note": "what aligns across TFs", "wait_for": "what would need to happen for a clean entry" }
}

Be concise but specific — every "key_level" must be a price (e.g. "63420" or "63,400 swing high"). Every "rationale" must reference what you see in the data, not generic ICT theory.`;

  const LOCAL_AI_URL = 'http://127.0.0.1:8770';

  // Self-contained API caller — tries local proxy first, falls back to Anthropic API.
  async function callClaudeDirect({ system, user, maxTokens }) {
    // Use local Claude Code proxy if in local mode or no API key
    const localMode = localStorage.getItem('jb_ai_local') === 'on';
    const apiKey = localStorage.getItem('jb_ai_key') || '';

    if (localMode || !apiKey) {
      try {
        const r = await fetch(LOCAL_AI_URL + '/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: user, system }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `Local AI ${r.status}`);
        return { text: j.text };
      } catch (e) {
        if (!apiKey) throw new Error('No API key and local server (localhost:8770) not reachable. Enable local mode in AI Coach → Settings.');
        // fall through to cloud if local failed but key exists
      }
    }

    if (!apiKey) throw new Error('No API key. Enable Local mode in AI Coach → Settings (free via Claude Code).');
    const model = localStorage.getItem('jb_ai_model') || 'claude-sonnet-4-5';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model, max_tokens: maxTokens, system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `API ${res.status}`);
    return { text: (json.content || []).map(b => b.type === 'text' ? b.text : '').join('') };
  }

  function hasApiKey() {
    if (localStorage.getItem('jb_ai_local') === 'on') return true; // local mode = always "has key"
    if (window.AICoachTab && AICoachTab.hasKey) return AICoachTab.hasKey();
    return !!localStorage.getItem('jb_ai_key');
  }

  async function runTopDown(sym) {
    if (!hasApiKey()) {
      throw new Error('No API key. Enable Local mode in AI Coach → Settings (free via Claude Code).');
    }
    const { candles, lastErr } = await fetchTDCandles(sym);
    const got = Object.values(candles).filter(c => c && c.length).length;
    if (got === 0) {
      throw new Error(`Binance returned no data for ${sym}. ${lastErr || 'Symbol may be invalid or geo-blocked.'} Verify the pair exists on Binance (try ${sym.replace(/USDT$/, '')}USDT or ${sym.replace(/USDC$/, '')}USDT).`);
    }
    const userMsg = `Pair: ${sym}\n\nOHLC data (rows: [openTime, o, h, l, c]):\n` +
      Object.entries(candles).map(([tf, rows]) => `\n=== ${tf} ===\n${rows ? JSON.stringify(rows) : 'unavailable'}`).join('\n');
    // Prefer AICoachTab.callClaude if available (gives shared spend tracking),
    // fall back to direct call so a stale ai_coach.js cache doesn't block us.
    const caller = (window.AICoachTab && AICoachTab.callClaude)
      ? AICoachTab.callClaude
      : callClaudeDirect;
    const { text } = await caller({ system: TD_SYSTEM, user: userMsg, maxTokens: 2200 });
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Claude did not return JSON. Raw: ' + text.slice(0, 200));
    try {
      return JSON.parse(match[0]);
    } catch (e) {
      throw new Error('Could not parse JSON from Claude (' + e.message + '). Raw: ' + match[0].slice(0, 200));
    }
  }

  function biasIcon(b) {
    const x = (b || '').toLowerCase();
    if (x === 'bullish') return '<span style="color:var(--green)">▲ BULLISH</span>';
    if (x === 'bearish') return '<span style="color:var(--red)">▼ BEARISH</span>';
    return '<span class="text-dim">◆ NEUTRAL</span>';
  }

  function renderTopDown() {
    const cache = _td[_pair] || {};
    const localOn = localStorage.getItem('jb_ai_local') === 'on';
    const hasKey = hasApiKey();
    const localToggle = `<button class="btn-ghost btn-sm" title="${localOn ? 'Using local Claude Code (port 8770) — click to switch to API' : 'Switch to local mode (uses Claude Code subscription, no API credits)'}"
      style="${localOn ? 'color:var(--green);border-color:var(--green)' : ''}"
      onclick="DojoTab._toggleLocalMode()">🖥️ ${localOn ? 'Local ✓' : 'Local'}</button>`;
    const headerBtn = cache.loading
      ? `<button class="btn-ghost btn-sm" disabled>⏳ Analyzing…</button>`
      : `<button class="btn-ghost btn-sm" onclick="DojoTab._runTopDown()">${cache.result ? '↻ Re-run' : '🔍 Run'} Top Down on ${esc(_pair.replace('USDT',''))}</button>`;
    const localHint = localOn ? `<div style="margin-top:8px;padding:9px 12px;background:var(--bg-mid);border:1px solid var(--border);border-radius:6px;font-size:.8rem">
        🖥️ <strong>Local mode on</strong> — routes to <code>http://127.0.0.1:8770/chat</code>.
        Start the server first: <code style="background:var(--bg);padding:2px 6px;border-radius:3px">python3 scripts/local_ai_server.py</code>
        <span class="text-dim" style="margin-left:6px">Uses your Claude Code subscription — no API credits.</span>
      </div>` : '';
    const keyHint = (!hasKey && !localOn) ? `<div style="margin-top:8px;padding:10px;background:var(--bg-mid);border:1px solid var(--border);border-radius:6px">
        <div style="font-size:.82rem;margin-bottom:6px">⚠ <strong>No API key</strong> — use Local mode (🖥️ button above) or add an Anthropic key below.</div>
        <div style="display:flex;gap:6px;align-items:center">
          <input id="dojoApiKeyIn" type="password" placeholder="sk-ant-…" style="flex:1;padding:5px 8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--mono);font-size:.78rem"
            onkeydown="if(event.key==='Enter'){DojoTab._saveApiKey(this.value)}">
          <button class="btn-ghost btn-sm" onclick="DojoTab._saveApiKey(document.getElementById('dojoApiKeyIn').value)">Save Key</button>
        </div>
        <div class="text-dim" style="font-size:.72rem;margin-top:5px">Stored in localStorage as <code>jb_ai_key</code>. Never sent anywhere except direct to api.anthropic.com.</div>
      </div>` : '';
    let body;
    if (cache.err) {
      body = `<div style="color:var(--red);font-size:.85rem;padding:10px">⚠ ${esc(cache.err)}</div>`;
    } else if (cache.loading) {
      body = `<div class="loading-state" style="padding:14px">Cascading M → W → D → 4H → 5m… (~10-20s)</div>`;
    } else if (!cache.result) {
      body = `<div class="text-dim" style="font-size:.85rem;padding:10px">Click <strong>Run Top Down</strong> to send a 5-TF OHLC sample to Claude and get a cascading bias (Monthly → Weekly → Daily → 4H → 5m) following the ICT methodology workflow. Result is cached per pair.</div>`;
    } else {
      const r = cache.result;
      const tfRow = (label, k) => {
        const x = r[k] || {};
        const lvls = (x.key_levels || []).map(l =>
          `<div style="font-size:.75rem;padding:2px 0;border-bottom:1px solid var(--border-sub,#f0f0f0);line-height:1.4;word-break:break-word">${esc(l)}</div>`
        ).join('') || '<span class="text-dim">—</span>';
        return `<tr style="vertical-align:top">
          <td style="font-weight:700;padding-top:8px;white-space:nowrap">${label}</td>
          <td style="padding-top:8px;white-space:nowrap">${biasIcon(x.bias)}</td>
          <td style="padding:6px 8px">${lvls}</td>
          <td style="color:var(--text-sub);font-size:.78rem;padding:8px 8px 8px 0;word-break:break-word">${esc(x.invalidation || '—')}</td>
          <td style="color:var(--text-sub);font-size:.78rem;font-style:italic;padding:8px 0;word-break:break-word">${esc(x.rationale || '')}</td>
        </tr>`;
      };
      const v = r.verdict || {};
      const verdictColor = v.tradeable ? 'var(--green)' : 'var(--text-sub)';
      const fiveM = r.fiveM || {};
      body = `
        <table class="data-table" style="width:100%;font-size:.82rem;margin-top:6px;table-layout:fixed">
          <colgroup>
            <col style="width:38px">
            <col style="width:100px">
            <col style="width:34%">
            <col style="width:22%">
            <col>
          </colgroup>
          <thead><tr><th>TF</th><th>Bias</th><th>Key Levels</th><th>Invalidation</th><th>Rationale</th></tr></thead>
          <tbody>
            ${tfRow('1M', 'monthly')}
            ${tfRow('1W', 'weekly')}
            ${tfRow('1D', 'daily')}
            ${tfRow('4H', 'fourH')}
            <tr>
              <td style="font-weight:700">5m</td>
              <td>${biasIcon(fiveM.bias)}</td>
              <td colspan="3" style="font-size:.78rem">
                <div><strong>Draw on liquidity:</strong> ${esc(fiveM.draw_on_liquidity || '—')}</div>
                <div style="margin-top:2px"><strong>Intraday plan:</strong> ${esc(fiveM.intraday_plan || '—')}</div>
                <div class="text-dim" style="font-style:italic;margin-top:2px">${esc(fiveM.rationale || '')}</div>
              </td>
            </tr>
          </tbody>
        </table>
        <div style="margin-top:10px;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-mid);border-left:3px solid ${verdictColor}">
          <div style="font-weight:700;font-size:.85rem;margin-bottom:6px">
            ${v.tradeable ? '✅ TRADEABLE' : '⏸ WAIT'}
            ${v.best_setup ? ` · ${esc(v.best_setup)}` : ''}
            ${v.direction && v.direction !== 'none' ? ` · ${esc(v.direction.toUpperCase())}` : ''}
          </div>
          ${v.confluence_note ? `<div style="font-size:.8rem"><strong>Confluence:</strong> ${esc(v.confluence_note)}</div>` : ''}
          ${v.wait_for ? `<div style="font-size:.8rem;margin-top:3px"><strong>Wait for:</strong> ${esc(v.wait_for)}</div>` : ''}
        </div>
        ${cache.ts ? `<div class="text-dim" style="font-size:.72rem;margin-top:6px">Generated ${ago(cache.ts)} · ${esc(r.as_of || '')}</div>` : ''}
      `;
    }
    return `<div class="dojo-section">
      <div class="dojo-sec-hdr">
        🔍 Top Down Analysis (M→W→D→4H→5m)
        <span style="margin-left:auto;display:flex;gap:6px;align-items:center">${localToggle}${headerBtn}</span>
      </div>
      ${body}
      ${localHint}
      ${keyHint}
    </div>`;
  }

  /* ══════════════════════════════════════════════════════
     RENDER — section 6: Extended (in-browser cheap context)
  ══════════════════════════════════════════════════════ */
  function renderExtended() {
    if (!_ext) return '';
    const usedCol = _ext.rangeUsedPct == null ? 'var(--text-sub)'
                  : _ext.rangeUsedPct > 90 ? 'var(--red)'
                  : _ext.rangeUsedPct > 70 ? 'var(--gold)'
                  : 'var(--green)';
    return `<div class="dojo-section">
      <div class="dojo-sec-hdr">📊 Extended Context <span class="text-dim" style="font-size:.7rem;font-weight:400">(in-browser, non-canonical)</span></div>
      <div class="dojo-cards" style="grid-template-columns:repeat(4,1fr);gap:10px;margin-top:8px">
        <div class="dojo-card"><div class="dojo-card-lbl">Prev-Day H</div><div class="dojo-card-val">${fmtP(_ext.prevDayHigh)}</div><div class="dojo-card-sub">L ${fmtP(_ext.prevDayLow)}</div></div>
        <div class="dojo-card"><div class="dojo-card-lbl">Today H</div><div class="dojo-card-val">${fmtP(_ext.todayHigh)}</div><div class="dojo-card-sub">L ${fmtP(_ext.todayLow)}</div></div>
        <div class="dojo-card"><div class="dojo-card-lbl">Avg Range (14d)</div><div class="dojo-card-val">${fmtP(_ext.avgRange14)}</div><div class="dojo-card-sub">prior 14 sessions</div></div>
        <div class="dojo-card" style="border-left:3px solid ${usedCol}"><div class="dojo-card-lbl">Day Range Used</div><div class="dojo-card-val" style="color:${usedCol}">${_ext.rangeUsedPct == null ? '—' : _ext.rangeUsedPct.toFixed(0) + '%'}</div><div class="dojo-card-sub">vs avg</div></div>
      </div>
    </div>`;
  }

  /* ══════════════════════════════════════════════════════
     RENDER — section 7: Custom Tickers (absorbed from SBWatcher)
  ══════════════════════════════════════════════════════ */
  function renderCustomTickers() {
    const hasPat = (window.RepoWriter && RepoWriter.hasPat());
    const status = hasPat
      ? `<span style="color:var(--green)">● PAT set — changes auto-sync to repo</span>`
      : `<span style="color:var(--gold)">● No PAT — local-only.
          <a href="javascript:DojoTab._setPat()">Save PAT</a></span>`;
    const chips = _custom.filter(safeSym).map(s => `<span class="dojo-pair-chip" style="cursor:default">
      <code>${esc(s)}</code>
      <button class="dojo-chip-x" onclick="DojoTab._removePair('${s}')" title="Remove">✕</button>
    </span>`).join('') || `<span class="text-dim" style="font-size:.85rem">No custom tickers yet.</span>`;
    return `<div class="dojo-section">
      <div class="dojo-sec-hdr">⭐ Custom Tickers <span class="text-dim" style="font-size:.72rem;font-weight:400;margin-left:8px">${status}</span></div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0">${chips}</div>
      <div style="display:flex;gap:6px;align-items:center">
        <input id="dojoCustomAdd" class="dojo-add-pair" placeholder="ADDUSDT" style="max-width:140px"
               onkeydown="if(event.key==='Enter'){DojoTab._addPair(this.value);this.value='';}">
        <button class="btn-ghost btn-sm" onclick="DojoTab._addPair(document.getElementById('dojoCustomAdd').value);document.getElementById('dojoCustomAdd').value=''">+ Add</button>
        ${hasPat ? `<button class="btn-ghost btn-sm" onclick="DojoTab._syncCustom()">⇪ Sync to repo</button>` : ''}
      </div>
      <div class="text-dim" style="font-size:.74rem;margin-top:6px">
        The watcher reads <code>js/data/custom_symbols.json</code> on its next tick (≤5min) and starts emitting state for new symbols.
      </div>
    </div>`;
  }

  /* ══════════════════════════════════════════════════════
     RENDER — body assembly
  ══════════════════════════════════════════════════════ */
  function updateBody() {
    const el = document.getElementById('dojoBody');
    if (!el) return;
    if (_err) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">📡</div>
        <p>Could not load watcher data: ${esc(_err)}</p>
        <p class="text-dim" style="font-size:.85rem">The dashboard reads <code>js/data/sb_watcher.json</code>, written by the GHA cron (<code>automation/sb_live_watcher.py</code>).</p></div>`;
      return;
    }
    if (_loading && !_data) {
      el.innerHTML = `<div class="loading-state">Loading canonical watcher state…</div>`;
      return;
    }
    const sym = symData();
    if (!sym) {
      // Custom ticker / pair the watcher hasn't seen yet. Don't dead-end —
      // render the panels that work without watcher data: live price (top
      // bar), Top Down (uses Binance directly), Extended, Custom Tickers.
      const hasPat = (window.RepoWriter && RepoWriter.hasPat());
      const explainer = hasPat
        ? `Watcher will pick up <code>${esc(_pair)}</code> on its next tick (≤5min) and start emitting AMD / Killzone / SB Setup / Structure data here.`
        : `<strong>No GitHub PAT set</strong> — custom tickers won't reach the cron watcher. Top Down Analysis still works (uses Binance directly). To enable full canonical data, click <a href="javascript:DojoTab._setPat()">Save PAT</a> below.`;
      el.innerHTML =
        renderHeaderPills(null) +
        `<div class="dojo-section" style="border-left:3px solid var(--gold)">
          <div style="font-size:.85rem;padding:8px 4px"><strong>📡 No watcher data yet for <code>${esc(_pair)}</code>.</strong></div>
          <div class="text-dim" style="font-size:.8rem;padding:0 4px 6px">${explainer}</div>
        </div>` +
        renderTopDown() +
        renderExtended() +
        renderCustomTickers();
      return;
    }
    el.innerHTML =
      renderHeaderPills(sym) +
      renderSetupCard(sym) +
      renderTopDown() +
      renderStructure(sym) +
      renderExtended() +
      renderCustomTickers();
  }

  /* ══════════════════════════════════════════════════════
     Custom-symbols repo sync (PAT)
  ══════════════════════════════════════════════════════ */
  async function pushCustomToRepo() {
    if (!window.RepoWriter || !RepoWriter.hasPat()) {
      throw new Error('No GitHub PAT set. Click "Save PAT" first.');
    }
    const writer = RepoWriter.create({
      owner: 'jaybot369369-collab',
      repo:  'Ai-Dashboard-Pro',
      branch: 'main',
    });
    const payload = {
      symbols: _custom,
      updated: new Date().toISOString(),
      note: 'Custom watchlist symbols added via dashboard ICT Dojo tab.',
    };
    return writer.writeFile(CUSTOM_PATH, JSON.stringify(payload, null, 2),
                            `Custom symbols updated: ${_custom.join(', ')}`);
  }

  function renderDojoHero() {
    const now = new Date();
    const hour = now.getUTCHours();
    let session = 'Asia', sessionColor = '#3b82f6';
    if (hour >= 2 && hour < 10)  { session = 'London'; sessionColor = '#7c5cff'; }
    if (hour >= 12 && hour < 21) { session = 'New York'; sessionColor = '#16a34a'; }
    return `
      <div class="page-head" style="margin-bottom:20px">
        <div>
          <h1 style="margin:0;font-size:22px;font-weight:700;color:var(--text)">ICT Dojo</h1>
          <div style="font-size:13px;color:var(--text-2);margin-top:3px">Inner Circle Trader methodology · <span style="color:${sessionColor};font-weight:600">${session} session</span> active</div>
        </div>
      </div>
    `;
  }

  /* ══════════════════════════════════════════════════════
     RENDER — entry point
  ══════════════════════════════════════════════════════ */
  function render() {
    if (_pollTimer) clearInterval(_pollTimer);
    const content = document.getElementById('content');
    content.innerHTML = renderDojoHero() + `<div class="dojo-wrap">
      <div id="dojoTopBar">${renderTopBar()}</div>
      <div id="dojoBody"><div class="loading-state">Loading…</div></div>
    </div>`;
    loadAll();
    _pollTimer = setInterval(() => {
      // Pause polling when user has switched to another tab — saves
      // Binance API calls + sb_watcher.json fetches every 60s.
      if (!onDojoTab()) return;
      if (!_lastFetch || (Date.now() - _lastFetch) > REFRESH_MS - 1000) loadAll();
      // Re-render top bar so the "Updated Xs ago" text is fresh
      const tb = document.getElementById('dojoTopBar');
      if (tb) tb.innerHTML = renderTopBar();
    }, REFRESH_MS);
  }

  /* ══════════════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════════════ */
  return {
    render,
    _pair: sym => {
      if (!safeSym(sym)) return;
      _pair = sym;
      localStorage.setItem('jb_dojo_pair', sym);
      // Re-fetch ticker + extended for the new pair, but reuse cached watcher JSON
      Promise.all([fetchTicker(sym), fetchExtended(sym)]).then(([t, e]) => {
        _ticker = t; _ext = e;
        const tb = document.getElementById('dojoTopBar');
        if (tb) tb.innerHTML = renderTopBar();
        updateBody();
      });
      updateBody();
    },
    _refresh: () => loadAll(),
    _addPair: raw => {
      // Strip everything that isn't A-Z 0-9 — protects against XSS via crafted
      // input ending up in the onclick="...('${sym}')" interpolations downstream.
      const sym = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!sym) return;
      // Recognize known quote currencies — don't double-suffix things like
      // XLMUSDC (which would become invalid XLMUSDCUSDT). Order matters:
      // longest known suffixes first so USDT/USDC/FDUSD don't lose chars.
      const QUOTES = ['USDT', 'USDC', 'FDUSD', 'TUSD', 'BUSD', 'USD', 'BTC', 'ETH', 'BNB', 'EUR', 'GBP'];
      const hasQuote = QUOTES.some(q => sym.endsWith(q) && sym.length > q.length);
      const full = hasQuote ? sym : sym + 'USDT';
      if (!safeSym(full)) return;
      if (!PROTECTED.includes(full) && !_custom.includes(full)) {
        _custom.push(full);
        saveCustomSymbols(_custom);
        if (window.RepoWriter && RepoWriter.hasPat()) {
          pushCustomToRepo().catch(e => App.toast('Repo sync failed: ' + e.message, 'error'));
        }
      }
      _pair = full;
      localStorage.setItem('jb_dojo_pair', full);
      render();
    },
    _removePair: sym => {
      if (!safeSym(sym)) return;
      if (PROTECTED.includes(sym)) return;
      _custom = _custom.filter(s => s !== sym);
      saveCustomSymbols(_custom);
      if (_pair === sym) _pair = PROTECTED[0];
      if (window.RepoWriter && RepoWriter.hasPat()) {
        pushCustomToRepo().catch(e => App.toast('Repo sync failed: ' + e.message, 'error'));
      }
      render();
    },
    _syncCustom: () => {
      pushCustomToRepo()
        .then(() => App.toast('Custom symbols synced to repo'))
        .catch(e => App.toast('Sync failed: ' + e.message, 'error'));
    },
    _saveApiKey: (key) => {
      const k = (key || '').trim();
      if (!k) { App.toast('Paste your API key first', 'error'); return; }
      if (!k.startsWith('sk-ant-')) { App.toast('Anthropic keys start with sk-ant-', 'error'); return; }
      // Write directly to the same localStorage slot AICoachTab uses
      // (jb_ai_key). Avoids depending on AICoachTab.saveKey being exposed,
      // which can lag on a freshly deployed cache.
      try {
        localStorage.setItem('jb_ai_key', k);
        if (window.AICoachTab && AICoachTab.saveKey) AICoachTab.saveKey(k);
        if (typeof LocalPersist !== 'undefined') LocalPersist.scheduleSave();
        App.toast('API key saved');
        updateBody();
      } catch (e) {
        App.toast('Save failed: ' + e.message, 'error');
      }
    },
    _toggleLocalMode: () => {
      const was = localStorage.getItem('jb_ai_local') === 'on';
      localStorage.setItem('jb_ai_local', was ? 'off' : 'on');
      // Clear any stale API error so it doesn't bleed into the new mode
      if (_td[_pair]) { _td[_pair] = { ..._td[_pair], err: null }; saveTd(); }
      updateBody();
    },
    _runTopDown: async () => {
      const sym = _pair;
      _td[sym] = { ..._td[sym], loading: true, err: null };
      saveTd();
      updateBody();
      try {
        const result = await runTopDown(sym);
        _td[sym] = { result, ts: Date.now(), loading: false };
      } catch (e) {
        _td[sym] = { ..._td[sym], err: e.message, loading: false };
      }
      saveTd();
      updateBody();
    },
    _setPat: () => {
      const pat = prompt('Paste your GitHub PAT (repo scope, Ai-Dashboard-Pro):');
      if (!pat) return;
      if (window.RepoWriter && RepoWriter.setPat) {
        RepoWriter.setPat(pat.trim());
        App.toast('PAT saved');
        render();
      } else {
        App.toast('RepoWriter not available', 'error');
      }
    },
  };
})();
