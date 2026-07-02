/* ═══════════════════════════════════════════════════════════
   TRADE VIEW — TradeZella-style per-trade popup
   Left: full trade detail panel.
   Right: two chart modes —
     📍 Trade chart  — Lightweight Charts (vendored, Apache-2.0):
        candles auto-located at the trade date, entry/SL/TP/exit
        price lines, green/red trade zones, entry/exit markers,
        and bar REPLAY (roadmap #4 "replay your own trades").
     📊 Live TradingView — official TV embed widget (full TV
        toolbar, indicators, drawing tools; can't locate trades).
   Opened by clicking any row in the Trade Log tab.
════════════════════════════════════════════════════════════ */
const TradeView = (() => {

  let _ids = [];       // ordered trade ids for ‹ › navigation
  let _curId = null;
  let _overlay = null;
  let _keyHandler = null;
  let _shotUrls = [];  // screenshots of the currently-rendered trade (for the lightbox)

  // chart mode + timeframe (persisted)
  let _mode = localStorage.getItem('jb_tradeview_mode') || 'trade';   // 'trade' | 'live'
  let _tf   = localStorage.getItem('jb_tradeview_tf')   || '15m';    // 15m | 1h | 4h | D

  // Lightweight Charts lifecycle
  let _lw = null;        // { chart, series, vol, canvas, ro }
  let _bars = [];        // chronological {t(ms),o,h,l,c,v}
  let _anchors = null;   // { entryIdx (replay start), entryMk, exitMk (data-backed marker bars | null), entry, sl, tp, dir }
  let _zoneOn = false;   // rAF zone painter flag
  let _replay = null;    // { idx, timer } | null

  /* ── generic helpers ─────────────────────────────────── */
  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function num(v) { const n = parseFloat(v); return isFinite(n) ? n : null; }
  function fmt$(n) {
    const abs = Math.abs(n);
    const str = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '-$' : '+$') + str;
  }
  function fmtPx(v) {
    const n = num(v);
    return n === null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 8 });
  }

  // Decimals for the chart's price scale — taken from the trade's own logged strings
  // (entry '0.194711' → 6) so the axis can actually resolve the logged levels;
  // falls back to price magnitude when no level carries decimals.
  function pxDecimals(t, bars) {
    let d = 0;
    for (const k of ['entry', 'sl', 'tp', 'exitPrice']) {
      const m = String(t[k] ?? '').match(/\.(\d+)/);
      if (m) d = Math.max(d, m[1].length);
    }
    if (!d) {
      const px = (bars && bars.length) ? bars[bars.length - 1].c : (num(t.entry) || 1);
      d = px >= 1000 ? 2 : px >= 100 ? 3 : px >= 1 ? 4 : px >= 0.1 ? 6 : 8;
    }
    return Math.min(8, Math.max(2, d));
  }

  // 'BTC/USDT' | 'btcusdt' | 'XLMUSDC' | 'HBARUSDT.P' → { base, quote, isPerp, pair }
  // The traded pair is preserved exactly (USDC stays USDC) — charting the USDT twin
  // of a USDC fill puts the candles 0.1–0.3% away from the logged levels, which is
  // several times a tight scalp's whole stop distance. '.P' marks a perp (linear klines).
  function parseSym(sym) {
    let s = String(sym || '').toUpperCase();
    let isPerp = /\.P$/.test(s);
    s = s.replace(/\.P$/, '').replace(/[^A-Z0-9]/g, '');
    let base = s, quote = 'USDT';
    for (const q of ['USDT', 'USDC', 'PERP', 'USD']) {
      if (s.length > q.length && s.endsWith(q)) {
        base = s.slice(0, -q.length);
        if (q === 'PERP') { isPerp = true; }        // 'BTCPERP' → BTC perp
        else if (q !== 'USD') { quote = q; }        // bare 'USD' has no spot pair — chart USDT twin
        break;
      }
    }
    if (!base) base = 'BTC';
    return { base, quote, isPerp, pair: base + quote };
  }
  function baseSym(sym) { return parseSym(sym).base; }
  function tvSymbol(sym) {
    const p = parseSym(sym);
    return 'BYBIT:' + p.pair + (p.isPerp ? '.P' : '');
  }

  // Entry anchor timestamp (ms, UTC). Uses optional t.time (HH:MM) when present.
  function entryMs(t) {
    const d = t.date || new Date().toISOString().slice(0, 10);
    const tm = /^\d{2}:\d{2}/.test(t.time || '') ? t.time.slice(0, 5) : '00:00';
    const ms = Date.parse(`${d}T${tm}:00Z`);
    return isFinite(ms) ? ms : Date.now();
  }
  function exitMs(t) {
    if (t.dateEnd) {
      const ms = Date.parse(`${t.dateEnd}T23:59:00Z`);
      if (isFinite(ms)) return ms;
    }
    return null;
  }

  // Same ordering as the Trade Log default view: manual trades, newest first
  function orderedIds() {
    const raw = (typeof DB.getTradesRaw === 'function') ? DB.getTradesRaw() : DB.getTrades();
    const manual = (typeof DB.filterByMode === 'function') ? DB.filterByMode(raw, 'new') : raw;
    manual.sort((a, b) => {
      const d = new Date(b.date || 0) - new Date(a.date || 0);
      if (d) return d;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
    return manual.map(t => t.id);
  }

  /* ── open / close / navigate ─────────────────────────── */
  function open(id, ids) {
    const t = DB.getTradeById(id);
    if (!t) { if (window.App && App.toast) App.toast('Trade not found', 'error'); return; }
    _ids = Array.isArray(ids) && ids.length ? ids : orderedIds();
    _curId = id;
    ensureOverlay();
    render();
    _keyHandler = e => {
      if (e.key === 'Escape') {
        // close the screenshot lightbox first if it's open, the modal otherwise
        const lb = document.getElementById('tvShotLightbox');
        if (lb) { lb.remove(); return; }
        close();
      }
      else if (e.key === 'ArrowLeft') nav(-1);
      else if (e.key === 'ArrowRight') nav(1);
    };
    document.addEventListener('keydown', _keyHandler);
  }

  // Full-size screenshot lightbox. window.open(dataUrl) is blocked by Chrome
  // (top-level data: navigation → about:blank), so render in-app instead.
  // Loads via an Image object with explicit loading/error states so a slow or
  // dead URL never leaves the user staring at a silent black overlay.
  function showShot(i) {
    const url = _shotUrls[i];
    if (!url) return;
    document.getElementById('tvShotLightbox')?.remove();
    const lb = document.createElement('div');
    lb.id = 'tvShotLightbox';
    lb.className = 'tv-shot-lightbox';
    lb.innerHTML = `<div class="tv-shot-lb-msg" id="tvShotLbMsg">Loading screenshot…</div>
      <button class="modal-close tv-shot-lb-close" title="Close (Esc)">✕</button>`;
    const img = new Image();
    img.alt = 'trade screenshot';
    img.onload = () => {
      document.getElementById('tvShotLbMsg')?.remove();
      lb.insertBefore(img, lb.firstChild);
    };
    img.onerror = () => {
      const m = document.getElementById('tvShotLbMsg');
      if (m) m.innerHTML = `Couldn't load this screenshot.<br>
        <span class="tv-shot-lb-url">${esc(String(url).slice(0, 120))}</span>`;
    };
    img.src = url;
    lb.addEventListener('click', () => lb.remove());
    document.body.appendChild(lb);
  }

  function close() {
    destroyChart();
    document.getElementById('tvShotLightbox')?.remove();
    if (_overlay) { _overlay.remove(); _overlay = null; }
    if (_keyHandler) { document.removeEventListener('keydown', _keyHandler); _keyHandler = null; }
    _curId = null;
  }

  function nav(step) {
    const i = _ids.indexOf(_curId);
    if (i === -1) return;
    const next = _ids[i + step];
    if (!next) return;
    _curId = next;
    render();
  }

  function edit() {
    const id = _curId;
    close();
    if (window.App && App.openTradeModal) App.openTradeModal(id);
  }

  function setMode(m) {
    _mode = m === 'live' ? 'live' : 'trade';
    localStorage.setItem('jb_tradeview_mode', _mode);
    render();
  }
  function setTF(tf) {
    if (!['15m', '1h', '4h', 'D'].includes(tf)) return;
    _tf = tf;
    localStorage.setItem('jb_tradeview_tf', _tf);
    render();
  }

  function ensureOverlay() {
    if (_overlay) return;
    _overlay = document.createElement('div');
    _overlay.className = 'tv-view-overlay';
    _overlay.addEventListener('click', e => { if (e.target === _overlay) close(); });
    document.body.appendChild(_overlay);
  }

  /* ── render ──────────────────────────────────────────── */
  function render() {
    const t = DB.getTradeById(_curId);
    if (!t) { close(); return; }
    destroyChart();
    const i = _ids.indexOf(_curId);

    const pl = (t.result !== '' && t.result !== undefined && t.result !== null) ? parseFloat(t.result) : null;
    const dirCls = t.direction === 'Long' ? 'badge-green' : t.direction === 'Short' ? 'badge-red' : 'badge-dim';
    const dirArrow = t.direction === 'Long' ? '▲' : t.direction === 'Short' ? '▼' : '';

    _overlay.innerHTML = `
      <div class="tv-view-modal" onclick="event.stopPropagation()">
        <div class="tv-view-header">
          <button class="btn-icon" title="Previous trade (←)" ${i <= 0 ? 'disabled' : ''} onclick="TradeView._nav(-1)">‹</button>
          <button class="btn-icon" title="Next trade (→)" ${i >= _ids.length - 1 ? 'disabled' : ''} onclick="TradeView._nav(1)">›</button>
          <div class="tv-view-title">
            <strong>${esc(t.symbol || '—')}</strong>
            <span class="badge ${dirCls}">${dirArrow} ${esc(t.direction || '—')}</span>
            <span class="tv-view-date">${esc(t.date || '')}${t.time ? ' ' + esc(t.time) : ''}${t.dateEnd ? ' → ' + esc(t.dateEnd) : ''}</span>
            <span class="tv-view-count">${i + 1} / ${_ids.length}</span>
          </div>
          <div class="tv-view-actions">
            <a class="btn-ghost btn-sm" href="https://www.tradingview.com/symbols/${esc(parseSym(t.symbol).pair)}/" target="_blank" rel="noopener">Open in TradingView ↗</a>
            <button class="btn-ghost btn-sm" onclick="TradeView._edit()">✏️ Edit</button>
            <button class="modal-close" onclick="TradeView.close()">✕</button>
          </div>
        </div>
        <div class="tv-view-body">
          <div class="tv-view-left">${leftPanelHTML(t, pl)}</div>
          <div class="tv-view-right">
            <div class="tv-view-chartbar">${chartBarHTML(t)}</div>
            <div class="tv-view-chart" id="tvViewChart"></div>
          </div>
        </div>
      </div>`;

    const target = document.getElementById('tvViewChart');
    if (_mode === 'trade') mountTradeChart(target, t);
    else mountWidget(target, t);
  }

  /* ── chart bar: mode pills, TF pills, replay, level chips ── */
  function chartBarHTML(t) {
    const chip = (label, val, cls) => num(val) !== null
      ? `<span class="tv-lvl-chip ${cls}">${label} <b class="mono-num">${fmtPx(val)}</b></span>` : '';

    const modes = `
      <span class="tv-mode-group">
        <button class="tv-mode-pill${_mode === 'trade' ? ' active' : ''}" onclick="TradeView._setMode('trade')">📍 Trade chart</button>
        <button class="tv-mode-pill${_mode === 'live' ? ' active' : ''}" onclick="TradeView._setMode('live')">📊 Live TradingView</button>
      </span>`;

    const tfs = _mode === 'trade' ? `
      <span class="tv-tf-group">
        ${['15m','1h','4h','D'].map(tf => `<button class="tv-tf-pill${_tf === tf ? ' active' : ''}" onclick="TradeView._setTF('${tf}')">${tf}</button>`).join('')}
      </span>` : '';

    const replay = _mode === 'trade' ? `
      <span class="tv-replay-group" id="tvReplayGroup">
        <button class="tv-replay-btn" title="Reset replay to entry" onclick="TradeView._replayReset()">⏮</button>
        <button class="tv-replay-btn" id="tvReplayPlay" title="Replay bars after entry" onclick="TradeView._replayToggle()">▶</button>
        <button class="tv-replay-btn" title="Step one bar" onclick="TradeView._replayStep()">⏭</button>
      </span>` : '';

    const hint = _mode === 'trade'
      ? `<span class="tv-chartbar-hint">${t.time ? '' : 'Add a Time to the trade for exact bar placement · '}▶ replays the bars after entry</span>`
      : `<span class="tv-chartbar-hint">Live TradingView chart — full toolbar, indicators & drawing tools (can't auto-locate the trade)</span>`;

    return modes + tfs + replay
      + chip('Entry', t.entry, 'chip-entry')
      + chip('SL', t.sl, 'chip-sl')
      + chip('TP', t.tp, 'chip-tp')
      + chip('Exit', t.exitPrice, 'chip-exit')
      + hint;
  }

  /* ── left panel (unchanged from first mockup) ────────── */
  function leftPanelHTML(t, pl) {
    const entry = num(t.entry), sl = num(t.sl), tp = num(t.tp), size = num(t.size);
    const plannedRR = (entry !== null && sl !== null && tp !== null && entry !== sl)
      ? Math.abs(tp - entry) / Math.abs(entry - sl) : null;
    const riskUsd = (entry && sl !== null && size) ? size * Math.abs(entry - sl) / entry : null;
    const rMult = (t.rMultiple !== '' && t.rMultiple !== undefined && t.rMultiple !== null) ? parseFloat(t.rMultiple) : null;

    const setups = (t.setupTypes || (t.setupType ? [t.setupType] : [])).filter(Boolean);

    const heroCls = pl === null ? 'flat' : pl >= 0 ? 'win' : 'loss';
    const hero = `
      <div class="tv-view-hero ${heroCls}">
        <div class="tvh-label">Net P&L</div>
        <div class="tvh-pl">${pl !== null ? fmt$(pl) : 'OPEN'}</div>
        <div class="tvh-sub">
          ${rMult !== null ? `<span>${rMult >= 0 ? '+' : ''}${rMult.toFixed(2)}R realized</span>` : ''}
          ${plannedRR !== null ? `<span>${plannedRR.toFixed(2)}R planned</span>` : ''}
        </div>
      </div>`;

    const lvl = (label, val, cls) => `
      <div class="tv-lvl-row">
        <span class="tv-lvl-label"><i class="tv-lvl-dot ${cls}"></i>${label}</span>
        <span class="tv-lvl-val mono-num">${fmtPx(val)}</span>
      </div>`;
    const levels = `
      <div class="tv-view-section">
        <div class="tvs-title">Levels</div>
        ${lvl('Entry', t.entry, 'dot-entry')}
        ${lvl('Stop loss', t.sl, 'dot-sl')}
        ${lvl('Take profit', t.tp, 'dot-tp')}
        ${lvl('Exit', t.exitPrice, 'dot-exit')}
        ${riskUsd !== null ? `<div class="tv-lvl-row"><span class="tv-lvl-label">Trade risk</span><span class="tv-lvl-val mono-num text-red">-$${riskUsd.toFixed(2)}</span></div>` : ''}
      </div>`;

    const metaRow = (l, v) => (v !== undefined && v !== null && v !== '')
      ? `<div class="tv-meta-row"><span>${esc(l)}</span><span>${esc(v)}</span></div>` : '';
    const meta = `
      <div class="tv-view-section">
        <div class="tvs-title">Details</div>
        ${metaRow('Session', t.session)}
        ${metaRow('HTF bias', t.htfBias)}
        ${metaRow('Size ($)', size !== null ? size.toLocaleString() : '')}
        ${metaRow('Pre-grade', t.preGrade)}
        ${metaRow('Post-grade', t.postGrade)}
        ${t.confluenceScore !== undefined && t.confluenceScore !== null && t.confluenceScore !== '' ? metaRow('Confluence', t.confluenceScore + '/10') : ''}
        ${metaRow('MFE', t.mfe !== undefined && t.mfe !== '' ? t.mfe + 'R' : '')}
        ${metaRow('MAE', t.mae !== undefined && t.mae !== '' ? t.mae + 'R' : '')}
        ${metaRow('Source', t.source || 'manual')}
      </div>`;

    const setupsHtml = setups.length ? `
      <div class="tv-view-section">
        <div class="tvs-title">Setups</div>
        <div class="tv-chip-row">${setups.map(s => `<span class="badge badge-accent">${esc(s)}</span>`).join('')}</div>
      </div>` : '';

    const factors = (t.confluenceFactors || []).filter(Boolean);
    const factorsHtml = factors.length ? `
      <div class="tv-view-section">
        <div class="tvs-title">Confluence factors</div>
        <div class="tv-chip-row">${factors.map(f => `<span class="badge badge-dim">${esc(f)}</span>`).join('')}</div>
      </div>` : '';

    const gradeNotes = [
      t.preGradeNotes ? `<div class="tv-note-block"><span class="tvs-mini">Pre-trade plan</span>${esc(t.preGradeNotes)}</div>` : '',
      t.postGradeNotes ? `<div class="tv-note-block"><span class="tvs-mini">Execution review</span>${esc(t.postGradeNotes)}</div>` : '',
    ].join('');

    const critique = t.aiCritique ? critiqueHTML(t.aiCritique) : '';

    const notes = t.notes ? `
      <div class="tv-view-section">
        <div class="tvs-title">Notes</div>
        <div class="tv-view-notes">${esc(t.notes)}</div>
      </div>` : '';

    const urls = (DB.getScreenshots(t) || []).filter(u => typeof u === 'string' && /^(https?:|data:image\/)/i.test(u));
    _shotUrls = urls;
    // NOTE: no window.open(dataUrl) here — Chrome blocks top-level data: URLs
    // (opens about:blank). Full-size view is an in-app lightbox instead.
    const shots = urls.length ? `
      <div class="tv-view-section">
        <div class="tvs-title">Screenshots (${urls.length})</div>
        <div class="tv-shot-grid">
          ${urls.map((u, i) => `<img src="${esc(u)}" loading="lazy" onclick="TradeView._shot(${i})" onerror="this.style.opacity=0.3" />`).join('')}
        </div>
      </div>` : '';

    return hero + levels + meta + setupsHtml + factorsHtml
      + (gradeNotes ? `<div class="tv-view-section"><div class="tvs-title">Grade notes</div>${gradeNotes}</div>` : '')
      + critique + notes + shots;
  }

  function critiqueHTML(c) {
    const gradeColor = { A:'#22c55e', B:'#86efac', C:'#f59e0b', D:'#ef4444' }[c.grade] || '#888';
    return `<div class="tv-view-section">
      <div class="tvs-title">🤖 AI Critique</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span class="scan-grade-pill" style="background:${gradeColor}22;color:${gradeColor};border-color:${gradeColor}55">Grade ${esc(c.grade || '?')}</span>
        ${c.generated_at ? `<span class="text-xs text-sub">${esc((c.generated_at || '').slice(0,10))}</span>` : ''}
      </div>
      ${(c.strengths || []).length ? `<div><strong style="color:#22c55e;font-size:.72rem">✓ Strengths</strong><ul class="tv-crit-list">${c.strengths.map(s=>`<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
      ${(c.weaknesses || []).length ? `<div><strong style="color:#ef4444;font-size:.72rem">✗ Weaknesses</strong><ul class="tv-crit-list">${c.weaknesses.map(s=>`<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
      ${c.rr_assessment ? `<div class="text-xs text-sub" style="margin-top:4px;font-style:italic">${esc(c.rr_assessment)}</div>` : ''}
    </div>`;
  }

  /* ═══════════════════════════════════════════════════════
     TRADE CHART MODE — Lightweight Charts
  ════════════════════════════════════════════════════════ */

  // Historical kline window around the trade. Bybit → Binance → OKX.
  const TF_MS    = { '15m': 15*60e3, '1h': 3600e3, '4h': 4*3600e3, 'D': 86400e3 };
  const TF_SPAN  = { '15m': 4*86400e3, '1h': 14*86400e3, '4h': 60*86400e3, 'D': 180*86400e3 };
  const TF_BYBIT = { '15m': '15',  '1h': '60', '4h': '240', 'D': 'D'  };
  const TF_BIN   = { '15m': '15m', '1h': '1h', '4h': '4h',  'D': '1d' };
  const TF_OKX   = { '15m': '15m', '1h': '1H', '4h': '4H',  'D': '1D' };

  function _sig(ms) { return AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined; }

  // Each fetcher takes the parsed symbol {base, quote, isPerp, pair} and requests
  // the EXACT traded pair on the exact market (spot vs linear perp).
  async function _rangeBybit(ps, tf, startMs, endMs) {
    const cat = ps.isPerp ? 'linear' : 'spot';
    const url = `https://api.bybit.com/v5/market/kline?category=${cat}&symbol=${ps.pair}&interval=${TF_BYBIT[tf]}&start=${startMs}&end=${endMs}&limit=1000`;
    const r = await fetch(url, { mode: 'cors', cache: 'no-store', signal: _sig(8000) });
    if (!r.ok) throw new Error(`bybit ${r.status}`);
    const j = await r.json();
    if (j.retCode !== 0 || !j.result?.list?.length) throw new Error('bybit bad payload');
    return j.result.list.slice().reverse().map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
  }
  async function _rangeBinance(ps, tf, startMs, endMs) {
    // spot API only — Binance futures REST is a separate geo-blocked host, and Bybit
    // linear already covers perps as the primary source
    if (ps.isPerp) throw new Error('binance skipped for perp');
    const url = `https://api.binance.com/api/v3/klines?symbol=${ps.pair}&interval=${TF_BIN[tf]}&startTime=${startMs}&endTime=${endMs}&limit=1000`;
    const r = await fetch(url, { mode: 'cors', cache: 'no-store', signal: _sig(8000) });
    if (!r.ok) throw new Error(`binance ${r.status}`);
    const raw = await r.json();
    if (!raw.length) throw new Error('binance empty');
    return raw.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
  }
  async function _rangeOKX(ps, tf, startMs, endMs) {
    // history-candles paginates backwards from `after`; max ~100 bars/req — partial window as last resort
    const inst = `${ps.base}-${ps.quote}${ps.isPerp ? '-SWAP' : ''}`;
    const url = `https://www.okx.com/api/v5/market/history-candles?instId=${inst}&bar=${TF_OKX[tf]}&after=${endMs}&limit=100`;
    const r = await fetch(url, { mode: 'cors', cache: 'no-store', signal: _sig(8000) });
    if (!r.ok) throw new Error(`okx ${r.status}`);
    const j = await r.json();
    if (j.code !== '0' || !j.data?.length) throw new Error('okx bad payload');
    return j.data.slice().reverse().map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
  }

  // → { bars, pair, fallback } — tries the exact traded pair on every source first;
  // only if ALL sources fail does it retry the chain on the USDT twin, and then
  // `fallback:true` so the chart shows an honest "not your traded pair" notice.
  async function fetchKlinesRange(sym, tf, startMs, endMs) {
    const ps = parseSym(sym);
    const attempts = [ps];
    if (ps.quote !== 'USDT') attempts.push({ ...ps, quote: 'USDT', pair: ps.base + 'USDT', _twin: true });
    let lastErr = null;
    for (const att of attempts) {
      for (const fn of [_rangeBybit, _rangeBinance, _rangeOKX]) {
        try {
          const bars = await fn(att, tf, Math.floor(startMs), Math.floor(endMs));
          return { bars, pair: att.pair + (att.isPerp ? ' perp' : ''), fallback: !!att._twin, traded: ps.pair };
        } catch (e) { lastErr = e; console.warn(`[TradeView] kline source failed (${att.pair}):`, e.message); }
      }
    }
    throw lastErr || new Error('all kline sources failed');
  }

  function destroyChart() {
    _zoneOn = false;
    if (_replay) { clearInterval(_replay.timer); _replay = null; }
    if (_lw) {
      try { if (_lw.ro) _lw.ro.disconnect(); } catch {}
      try { _lw.chart.remove(); } catch {}
      _lw = null;
    }
    _bars = [];
    _anchors = null;
  }

  async function mountTradeChart(target, t) {
    if (!target) return;
    if (typeof LightweightCharts === 'undefined') {
      target.innerHTML = `<div class="tv-chart-msg">Chart library not loaded — hard-refresh the page (⌘⇧R), or use 📊 Live TradingView.</div>`;
      return;
    }
    const psym = parseSym(t.symbol);
    target.innerHTML = `<div class="tv-chart-msg">Loading ${esc(psym.pair)}${psym.isPerp ? ' perp' : ''} ${esc(_tf)} candles around ${esc(t.date || '')}…</div>`;

    const anchor = entryMs(t);
    const span = TF_SPAN[_tf] || TF_SPAN['15m'];
    let start = anchor - span * 0.4;
    let end   = anchor + span * 0.6;
    const now = Date.now();
    if (end > now) { end = now; start = Math.max(start, end - span); }

    let bars, pairNote = '';
    try {
      const res = await fetchKlinesRange(t.symbol, _tf, start, end);
      // Some sources ignore `start` and back-fill up to `limit` bars ending
      // at `end` — clamp to the requested window client-side.
      bars = res.bars.filter(b => b.t >= start - TF_MS[_tf] && b.t <= end + TF_MS[_tf]);
      if (res.fallback) pairNote = `⚠ Showing ${res.pair} candles — ${res.traded} history unavailable from data sources`;
    } catch (e) {
      target.innerHTML = `<div class="tv-chart-msg">Couldn't load candles for ${esc(psym.pair)} (${esc(e.message)}).<br>
        <button class="btn-ghost btn-sm" style="margin-top:8px" onclick="TradeView._setMode('live')">Use 📊 Live TradingView instead</button></div>`;
      return;
    }
    // Guard: user may have navigated away / switched mode while fetching
    if (!document.body.contains(target) || _mode !== 'trade' || _curId !== t.id) return;
    if (!bars || bars.length < 5) {
      target.innerHTML = `<div class="tv-chart-msg">No candle history available for ${esc(psym.pair)} at ${esc(_tf)} around ${esc(t.date || '')}.</div>`;
      return;
    }
    _bars = bars;

    // ── anchors: pin entry/exit markers to bars the DATA actually supports ──
    // Without a logged time, the old code snapped markers to the 00:00 bar —
    // a guess that lands at prices far from the real levels and reads like an
    // extra entry/exit (RULE #2). Now: exact bar when t.time exists, else the
    // first/last bar INSIDE the trade window whose range contains the logged
    // price. No supporting bar → no marker; the dashed price lines remain.
    const snap = ms => {
      let idx = 0;
      for (let i = 0; i < bars.length; i++) { if (bars[i].t <= ms) idx = i; else break; }
      return idx;
    };
    const entryPx = num(t.entry), exitPx = num(t.exitPrice);
    const winStart = Date.parse(`${t.date}T00:00:00Z`);
    const winEnd = Date.parse(`${(t.dateEnd || t.date)}T23:59:59Z`);
    const hasTime = /^\d{2}:\d{2}/.test(t.time || '');
    let entryMk = null, exitMk = null;
    if (hasTime) entryMk = snap(anchor);
    else if (entryPx !== null) {
      for (let i = 0; i < bars.length; i++) {
        if (bars[i].t < winStart || bars[i].t > winEnd) continue;
        if (bars[i].l <= entryPx && entryPx <= bars[i].h) { entryMk = i; break; }
      }
    }
    const closed = (t.exitPrice !== undefined && t.exitPrice !== '') || (t.result !== undefined && t.result !== '' && t.result !== null);
    if (closed && exitPx !== null) {
      for (let i = bars.length - 1; i >= 0; i--) {
        if (bars[i].t > winEnd) continue;
        if (bars[i].t < winStart || (entryMk !== null && i < entryMk)) break;
        if (bars[i].l <= exitPx && exitPx <= bars[i].h) { exitMk = i; break; }
      }
    }
    // replay still starts from the dated bar even when no entry marker is shown
    const entryIdx = entryMk !== null ? entryMk : snap(anchor);
    _anchors = { entryIdx, entryMk, exitMk, entry: entryPx, sl: num(t.sl), tp: num(t.tp), dir: t.direction };

    // ── build chart ──
    target.innerHTML = '';
    target.style.position = 'relative';
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const chart = LightweightCharts.createChart(target, {
      autoSize: true,
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: dark ? '#cbd5e1' : '#475569',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: dark ? 'rgba(148,163,184,0.07)' : 'rgba(100,116,139,0.08)' },
        horzLines: { color: dark ? 'rgba(148,163,184,0.07)' : 'rgba(100,116,139,0.08)' },
      },
      rightPriceScale: { borderColor: dark ? 'rgba(148,163,184,0.2)' : 'rgba(100,116,139,0.25)' },
      timeScale: {
        borderColor: dark ? 'rgba(148,163,184,0.2)' : 'rgba(100,116,139,0.25)',
        timeVisible: true, secondsVisible: false,
      },
      crosshair: { mode: 0 },
    });
    // Price-scale precision: Lightweight Charts defaults to 2 decimals, which
    // flattens sub-cent symbols (XLM 0.194711 → "0.19") so entry/SL/exit labels all
    // read identically. Resolve to the decimals the user actually logged.
    const dec = pxDecimals(t, bars);
    const series = chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
      borderVisible: false,
      priceFormat: { type: 'price', precision: dec, minMove: Math.pow(10, -dec) },
    });
    const vol = chart.addHistogramSeries({ priceScaleId: '', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    setSeriesData(series, vol, bars);
    applyMarkers(series, t, bars[bars.length - 1].t);

    // price lines
    const mkLine = (price, color, title, w) => { if (price !== null) series.createPriceLine({ price, color, lineWidth: w || 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title }); };
    mkLine(_anchors.entry, '#3b82f6', 'Entry', 2);
    mkLine(_anchors.sl,    '#ef4444', 'SL');
    mkLine(_anchors.tp,    '#22c55e', 'TP');
    mkLine(num(t.exitPrice), '#f59e0b', 'Exit');

    chart.timeScale().fitContent();

    // honest-pair notice (only when charting the USDT twin of a USDC/other fill)
    if (pairNote) {
      const note = document.createElement('div');
      note.className = 'tv-pair-note';
      note.textContent = pairNote;
      target.appendChild(note);
    }

    // ── trade-zone overlay (TradeZella-style green/red boxes) ──
    const canvas = document.createElement('canvas');
    canvas.className = 'tv-zone-canvas';
    target.appendChild(canvas);
    const ro = new ResizeObserver(() => {
      canvas.width = target.clientWidth;
      canvas.height = target.clientHeight;
    });
    ro.observe(target);
    canvas.width = target.clientWidth;
    canvas.height = target.clientHeight;

    _lw = { chart, series, vol, canvas, ro };
    _zoneOn = true;
    (function paint() {
      if (!_zoneOn || !_lw) return;
      drawZones();
      requestAnimationFrame(paint);
    })();
  }

  function setSeriesData(series, vol, bars) {
    series.setData(bars.map(b => ({ time: b.t / 1000, open: b.o, high: b.h, low: b.l, close: b.c })));
    vol.setData(bars.map(b => ({ time: b.t / 1000, value: b.v, color: b.c >= b.o ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)' })));
  }

  // Markers only up to `uptoT` (ms) so replay slices stay valid.
  // entryMk/exitMk are null when no bar supports the level — then no marker
  // is drawn at all (the dashed price lines still carry the level).
  function applyMarkers(series, t, uptoT) {
    if (!_anchors) return;
    const { entryMk, exitMk } = _anchors;
    const long = t.direction === 'Long';
    const markers = [];
    if (entryMk !== null && _bars[entryMk] && _bars[entryMk].t <= uptoT) {
      markers.push({
        time: _bars[entryMk].t / 1000,
        position: long ? 'belowBar' : 'aboveBar',
        color: long ? '#22c55e' : '#ef4444',
        shape: long ? 'arrowUp' : 'arrowDown',
        text: 'Entry',
      });
    }
    if (exitMk !== null && _bars[exitMk] && _bars[exitMk].t <= uptoT) {
      markers.push({
        time: _bars[exitMk].t / 1000,
        position: long ? 'aboveBar' : 'belowBar',
        color: '#f59e0b',
        shape: 'circle',
        text: 'Exit',
      });
    }
    series.setMarkers(markers);
  }

  function drawZones() {
    if (!_lw || !_anchors || !_bars.length) return;
    const { chart, series, canvas } = _lw;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const { entryMk, exitMk, entry, sl, tp } = _anchors;
    // zones only when BOTH ends are pinned to real bars — a guessed span
    // painted as a solid box misreads as a confirmed hold period
    if (entry === null || entryMk === null || exitMk === null) return;

    const ts = chart.timeScale();
    const coordX = ms => {
      const x = ts.timeToCoordinate(ms / 1000);
      if (x !== null) return x;
      // off-screen — clamp to edge
      const vr = ts.getVisibleRange();
      if (!vr) return null;
      return (ms / 1000 < vr.from) ? 0 : canvas.width;
    };
    // In replay, cap the zone at the last visible (replayed) bar
    const lastIdx = _replay ? Math.min(_replay.idx, exitMk) : exitMk;
    const x1 = coordX(_bars[entryMk].t);
    const x2 = coordX(_bars[lastIdx].t);
    if (x1 === null || x2 === null || x2 <= x1) return;

    const yEntry = series.priceToCoordinate(entry);
    if (yEntry === null) return;

    const zone = (price, fill, stroke) => {
      const y = series.priceToCoordinate(price);
      if (y === null) return;
      const top = Math.min(yEntry, y), h = Math.abs(y - yEntry);
      if (h < 1) return;
      ctx.fillStyle = fill;
      ctx.fillRect(x1, top, x2 - x1, h);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(x1 + 0.5, top + 0.5, x2 - x1 - 1, h - 1);
    };
    if (tp !== null) zone(tp, 'rgba(34,197,94,0.10)', 'rgba(34,197,94,0.25)');
    if (sl !== null) zone(sl, 'rgba(239,68,68,0.10)', 'rgba(239,68,68,0.25)');
  }

  /* ── bar replay (roadmap #4) ─────────────────────────── */
  function replaySlice(idx) {
    if (!_lw || !_bars.length) return;
    const t = DB.getTradeById(_curId);
    const slice = _bars.slice(0, idx + 1);
    setSeriesData(_lw.series, _lw.vol, slice);
    if (t) applyMarkers(_lw.series, t, _bars[idx].t);
  }

  function replayReset() {
    if (!_lw || !_anchors) return;
    if (_replay) { clearInterval(_replay.timer); }
    _replay = { idx: _anchors.entryIdx, timer: null };
    replaySlice(_replay.idx);
    setPlayBtn('▶');
  }

  function replayStep() {
    if (!_lw || !_anchors) return;
    if (!_replay) { replayReset(); return; }
    if (_replay.timer) { clearInterval(_replay.timer); _replay.timer = null; setPlayBtn('▶'); }
    advanceReplay();
  }

  function replayToggle() {
    if (!_lw || !_anchors) return;
    if (!_replay) { replayReset(); }
    if (_replay.timer) {
      clearInterval(_replay.timer);
      _replay.timer = null;
      setPlayBtn('▶');
    } else {
      _replay.timer = setInterval(advanceReplay, 400);
      setPlayBtn('⏸');
    }
  }

  function advanceReplay() {
    if (!_replay || !_lw) return;
    if (_replay.idx >= _bars.length - 1) {
      if (_replay.timer) { clearInterval(_replay.timer); _replay.timer = null; setPlayBtn('▶'); }
      return;
    }
    _replay.idx++;
    const b = _bars[_replay.idx];
    _lw.series.update({ time: b.t / 1000, open: b.o, high: b.h, low: b.l, close: b.c });
    _lw.vol.update({ time: b.t / 1000, value: b.v, color: b.c >= b.o ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)' });
    const t = DB.getTradeById(_curId);
    if (t) applyMarkers(_lw.series, t, b.t);
  }

  function setPlayBtn(label) {
    const btn = document.getElementById('tvReplayPlay');
    if (btn) btn.textContent = label;
  }

  /* ── LIVE TV MODE — official embed widget ────────────── */
  function mountWidget(target, t) {
    if (!target) return;
    target.innerHTML = '';
    const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const wrap = document.createElement('div');
    wrap.className = 'tradingview-widget-container';
    wrap.style.cssText = 'height:100%;width:100%';
    const inner = document.createElement('div');
    inner.className = 'tradingview-widget-container__widget';
    inner.style.cssText = 'height:100%;width:100%';
    wrap.appendChild(inner);

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.text = JSON.stringify({
      autosize: true,
      symbol: tvSymbol(t.symbol),
      interval: '15',
      timezone: 'Etc/UTC',
      theme: theme,
      style: '1',
      locale: 'en',
      withdateranges: true,
      hide_side_toolbar: false,
      allow_symbol_change: true,
      save_image: true,
      details: false,
      calendar: false,
      support_host: 'https://www.tradingview.com'
    });
    wrap.appendChild(script);
    target.appendChild(wrap);
  }

  return {
    open, close,
    _nav: nav, _edit: edit,
    _setMode: setMode, _setTF: setTF,
    _replayToggle: replayToggle, _replayStep: replayStep, _replayReset: replayReset,
    _shot: showShot,
  };
})();
