/* ═══════════════════════════════════════════════════════════
   TRADE SYNC — auto-import real Binance fills + OBxADX bot trades
   (TradeZella-parity roadmap #3)

   Two sources, one review-before-import modal:
   • Binance (spot + USD-M futures) — pulled by the local trade-sync
     shim (:8772, launchd-managed, read-only API key stored ONLY in
     ~/.local/share/trade-sync/.env). Raw fills are reconstructed into
     round-trip trades client-side by js/lib/trade_reconstruct.js and
     imported as source:'binance_api' (counts as the real ledger).
   • OBxADX bot ledger — fetched from the Railway fund API, imported
     as source:'obxadx' (paper trades: viewable via the Trade Log's
     Bot view, ALWAYS excluded from personal stats).

   Idempotent: every import carries an importKey; already-imported
   rows show as such and can't duplicate. Rows matching a manual
   trade (same base symbol + same date) default to unchecked with a
   DUP? flag — the user decides.
════════════════════════════════════════════════════════════ */
const TradeSync = (() => {

  const SHIM = 'http://127.0.0.1:8772';
  const FUND_API = 'https://q2-2026-fund-production.up.railway.app';
  const FIRST_BACKFILL_DAYS = 120;

  let _overlay = null;
  let _rows = { bin: [], bot: [] };   // {t, status, checked}

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  const fmt$ = n => (n < 0 ? '-$' : '+$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function baseOf(sym) {
    let s = String(sym || '').toUpperCase().replace(/\.P$/, '').replace(/[^A-Z0-9]/g, '');
    for (const q of ['USDT', 'USDC', 'PERP', 'USD']) {
      if (s.length > q.length && s.endsWith(q)) return s.slice(0, -q.length);
    }
    return s;
  }

  function existingKeys() {
    const set = new Set();
    DB.getTrades().forEach(t => { if (t.importKey) set.add(t.importKey); });
    return set;
  }
  function manualDayIndex() {
    const set = new Set();
    DB.getTrades().forEach(t => {
      if (!t.source || t.source === 'manual') set.add(`${baseOf(t.symbol)}:${t.date}`);
    });
    return set;
  }

  /* ── modal shell ─────────────────────────────────────── */
  function open() {
    close();
    _rows = { bin: [], bot: [] };
    _overlay = document.createElement('div');
    _overlay.className = 'modal-overlay';
    _overlay.addEventListener('click', e => { if (e.target === _overlay) close(); });
    _overlay.innerHTML = `
      <div class="modal" style="max-width:980px;width:min(96vw,980px)" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h2>⇄ Sync trades</h2>
          <button class="modal-close" onclick="TradeSync.close()">✕</button>
        </div>
        <div class="modal-body" style="max-height:74vh;overflow-y:auto">

          <div style="border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
              <div>
                <div style="font-weight:700">🟡 Binance — real fills (spot + futures)</div>
                <div class="text-xs text-sub" id="tsBinSub">Checking local sync helper…</div>
              </div>
              <button class="btn-primary btn-sm" id="tsBinPull" onclick="TradeSync._pullBinance()" disabled>⟳ Pull fills</button>
            </div>
            <div id="tsBinBody" style="margin-top:10px"></div>
          </div>

          <div style="border:1px solid var(--border);border-radius:10px;padding:14px 16px">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
              <div>
                <div style="font-weight:700">🤖 OBxADX bot ledger (paper trades)</div>
                <div class="text-xs text-sub">Imported as a separate source — browsable in the Trade Log's Bot view, never mixed into your personal stats.</div>
              </div>
              <button class="btn-ghost btn-sm" id="tsBotPull" onclick="TradeSync._pullBot()">⟳ Pull bot trades</button>
            </div>
            <div id="tsBotBody" style="margin-top:10px"></div>
          </div>

        </div>
      </div>`;
    document.body.appendChild(_overlay);
    _health();
  }

  function close() {
    if (_overlay) { _overlay.remove(); _overlay = null; }
  }

  async function _health() {
    const sub = document.getElementById('tsBinSub');
    const btn = document.getElementById('tsBinPull');
    if (!sub) return;
    try {
      const h = await fetch(`${SHIM}/health`, { signal: AbortSignal.timeout(4000) }).then(r => r.json());
      if (!h.keys_configured) {
        sub.innerHTML = `Helper is running, but no API key yet.`;
        document.getElementById('tsBinBody').innerHTML = `
          <div class="text-sm" style="line-height:1.7;border-left:3px solid var(--warn,#f59e0b);padding-left:12px">
            <b>One-time setup (2 min):</b><br>
            1. Binance → Profile → <b>API Management</b> → Create API (label it <code>dashboard-import</code>)<br>
            2. Permissions: <b>Enable Reading ONLY</b> — leave trading &amp; withdrawals off<br>
            3. Paste both values into <code>${esc(h.env_file)}</code>:<br>
            <code style="display:block;margin:6px 0;padding:8px;background:var(--surface-2,rgba(127,127,127,.08));border-radius:6px">BINANCE_API_KEY=…<br>BINANCE_API_SECRET=…</code>
            4. Restart the helper: <code>launchctl kickstart -k gui/$(id -u)/com.claudebot.trade-sync-shim</code><br>
            5. Reopen this modal — the Pull button lights up.
          </div>`;
        return;
      }
      sub.textContent = `Helper ready · ${h.cached_fills} fills cached · last sync ${h.last_sync ? h.last_sync.slice(0, 16).replace('T', ' ') + ' UTC' : 'never'}`;
      btn.disabled = false;
    } catch (e) {
      sub.innerHTML = `✗ Local sync helper unreachable at ${SHIM} — it auto-starts on login (launchd). Start now: <code>launchctl load ~/Library/LaunchAgents/com.claudebot.trade-sync-shim.plist</code>`;
    }
  }

  /* ── Binance ─────────────────────────────────────────── */
  async function _pullBinance() {
    const body = document.getElementById('tsBinBody');
    const btn = document.getElementById('tsBinPull');
    btn.disabled = true; btn.textContent = '⟳ Syncing…';
    body.innerHTML = `<div class="text-sm text-sub">Pulling fills from Binance (first backfill covers ${FIRST_BACKFILL_DAYS} days — can take ~a minute)…</div>`;
    try {
      const sync = await fetch(`${SHIM}/sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: FIRST_BACKFILL_DAYS }),
      }).then(r => r.json());
      if (!sync.ok) throw new Error(sync.error || 'sync failed');
      const { fills } = await fetch(`${SHIM}/fills`).then(r => r.json());
      const { trades, orphans } = TradeReconstruct.reconstruct(fills);
      const keys = existingKeys(), dups = manualDayIndex();
      _rows.bin = trades.map(t => {
        let status = 'new', checked = true;
        if (keys.has(t.importKey)) { status = 'imported'; checked = false; }
        else if (t.open) { status = 'open'; checked = false; }
        else if (dups.has(`${baseOf(t.symbol)}:${t.date}`)) { status = 'dup'; checked = false; }
        return { t, status, checked };
      });
      const note = `Synced: +${sync.added_spot} spot / +${sync.added_fut} futures fills`
        + (sync.errors && sync.errors.length ? ` · ${sync.errors.length} source errors (see helper log)` : '')
        + (orphans.length ? ` · ${orphans.length} sell-only fills skipped (pre-existing holdings, not round-trips)` : '');
      body.innerHTML = _tableHTML('bin', note);
    } catch (e) {
      body.innerHTML = `<div class="text-sm" style="color:var(--bad,#ef4444)">✗ ${esc(e.message)}</div>`;
    }
    btn.disabled = false; btn.textContent = '⟳ Pull fills';
  }

  /* ── OBxADX bot ledger ───────────────────────────────── */
  async function _pullBot() {
    const body = document.getElementById('tsBotBody');
    const btn = document.getElementById('tsBotPull');
    btn.disabled = true; btn.textContent = '⟳ Pulling…';
    body.innerHTML = `<div class="text-sm text-sub">Fetching bot ledger from the fund API…</div>`;
    try {
      const d = await fetch(`${FUND_API}/api/obxadx_trades?bot=15m&limit=500`, { signal: AbortSignal.timeout(12000) }).then(r => r.json());
      if (!d.ok) throw new Error('fund API error');
      const keys = existingKeys();
      const closed = d.recent_closed || [];
      _rows.bot = closed.map(x => {
        const t = _mapBotTrade(x);
        const status = keys.has(t.importKey) ? 'imported' : 'new';
        return { t, status, checked: status === 'new' };
      });
      body.innerHTML = _tableHTML('bot',
        `${closed.length} closed bot trades fetched (bot total: ${d.n_closed_total})`);
    } catch (e) {
      body.innerHTML = `<div class="text-sm" style="color:var(--bad,#ef4444)">✗ ${esc(e.message)}</div>`;
    }
    btn.disabled = false; btn.textContent = '⟳ Pull bot trades';
  }

  function _mapBotTrade(x) {
    const fillTs = Date.parse(x.fill_ts);
    const closeTs = x.close_ts ? Date.parse(x.close_ts) : null;
    const dir = x.direction === 'bull' ? 'Long' : 'Short';
    const r = (x.net_pnl !== undefined && x.dollar_risk) ? x.net_pnl / x.dollar_risk : null;
    const d0 = new Date(fillTs).toISOString();
    const d1 = closeTs ? new Date(closeTs).toISOString() : '';
    return {
      importKey: `obxadx:15m:${x.uid}`,
      source: 'obxadx',
      symbol: `${x.sym}USDT`,
      direction: dir,
      entry: String(x.entry ?? ''),
      sl: String(x.stop ?? ''),
      tp: String(x.tp2 ?? x.tp1 ?? ''),
      exitPrice: x.close_price != null ? String(x.close_price) : '',
      size: x.size_usd != null ? String(x.size_usd) : '',
      result: x.net_pnl != null ? String(+x.net_pnl.toFixed(2)) : '',
      rMultiple: r != null ? r.toFixed(2) : '',
      date: d0.slice(0, 10),
      time: d0.slice(11, 16),
      dateEnd: d1 && d1.slice(0, 10) !== d0.slice(0, 10) ? d1.slice(0, 10) : '',
      session: TradeReconstruct.sessionFor(fillTs),
      setupTypes: ['OBxADX 15m'],
      notes: `OBxADX bot trade — ${x.close_reason || ''}${x.bars_held != null ? ` · ${x.bars_held} bars held` : ''}`,
    };
  }

  /* ── review table (shared) ───────────────────────────── */
  const _BADGE = {
    new:      '<span class="badge badge-green">NEW</span>',
    imported: '<span class="badge badge-dim">imported ✓</span>',
    dup:      '<span class="badge" style="background:#f59e0b22;color:#b45309;border-color:#f59e0b55" title="A manual trade with the same symbol + date already exists — import only if it\'s genuinely a different trade">DUP?</span>',
    open:     '<span class="badge badge-dim" title="Position still open — sync again after it closes">OPEN</span>',
  };

  function _tableHTML(kind, note) {
    const rows = _rows[kind];
    if (!rows.length) return `<div class="text-sm text-sub">Nothing to show — no round-trips found.</div>`;
    const selCount = rows.filter(r => r.checked).length;
    return `
      <div class="text-xs text-sub" style="margin-bottom:8px">${esc(note)}</div>
      <div style="max-height:320px;overflow-y:auto;border:1px solid var(--border-sub);border-radius:8px">
      <table class="privacy-mask" style="width:100%;border-collapse:collapse;font-size:.78rem">
        <thead><tr style="position:sticky;top:0;background:var(--surface,var(--bg-card))">
          <th style="padding:6px 8px"></th><th style="text-align:left;padding:6px 4px">Date · time</th>
          <th style="text-align:left">Symbol</th><th style="text-align:left">Dir</th>
          <th style="text-align:right">Entry</th><th style="text-align:right">Exit</th>
          <th style="text-align:right">P&amp;L</th><th style="text-align:left;padding-left:10px">Status</th>
        </tr></thead>
        <tbody>
          ${rows.map((r, i) => {
            const pl = parseFloat(r.t.result);
            return `<tr style="border-top:1px solid var(--border-sub);${r.status === 'imported' ? 'opacity:.5' : ''}">
              <td style="padding:5px 8px"><input type="checkbox" ${r.checked ? 'checked' : ''} ${r.status === 'imported' ? 'disabled' : ''} onchange="TradeSync._tick('${kind}',${i},this.checked)"></td>
              <td style="padding:5px 4px;white-space:nowrap">${esc(r.t.date)}${r.t.time ? ' ' + esc(r.t.time) : ''}</td>
              <td><b>${esc(r.t.symbol)}</b></td>
              <td style="color:${r.t.direction === 'Long' ? 'var(--good,#22c55e)' : 'var(--bad,#ef4444)'}">${esc(r.t.direction)}</td>
              <td style="text-align:right;font-family:monospace">${esc(r.t.entry)}</td>
              <td style="text-align:right;font-family:monospace">${esc(r.t.exitPrice) || '—'}</td>
              <td style="text-align:right;font-weight:700;color:${!isNaN(pl) ? (pl >= 0 ? 'var(--good,#22c55e)' : 'var(--bad,#ef4444)') : 'var(--muted)'}">${!isNaN(pl) ? fmt$(pl) : '—'}</td>
              <td style="padding-left:10px">${_BADGE[r.status] || ''}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
        <span class="text-xs text-sub" id="tsCount_${kind}">${selCount} selected</span>
        <button class="btn-primary btn-sm" onclick="TradeSync._import('${kind}')">↓ Import selected</button>
      </div>`;
  }

  function _tick(kind, i, on) {
    _rows[kind][i].checked = on;
    const el = document.getElementById(`tsCount_${kind}`);
    if (el) el.textContent = `${_rows[kind].filter(r => r.checked).length} selected`;
  }

  function _import(kind) {
    const sel = _rows[kind].filter(r => r.checked && r.status !== 'imported');
    if (!sel.length) { if (window.App && App.toast) App.toast('Nothing selected', 'info'); return; }
    sel.forEach(r => {
      const { open, fillsCount, feeNote, ...data } = r.t;   // strip meta-only fields
      DB.addTrade(data);
      r.status = 'imported'; r.checked = false;
    });
    if (window.App && App.toast) App.toast(`Imported ${sel.length} trade${sel.length === 1 ? '' : 's'}`, 'success');
    // re-render the table with fresh statuses + refresh the Trade Log behind
    const bodyId = kind === 'bin' ? 'tsBinBody' : 'tsBotBody';
    const body = document.getElementById(bodyId);
    if (body) body.innerHTML = _tableHTML(kind, `${sel.length} imported just now`);
    if (window.TradeLogTab && TradeLogTab.render && document.getElementById('tlSearch')) {
      try { TradeLogTab.render(); } catch {}
    }
  }

  return { open, close, _pullBinance, _pullBot, _tick, _import };
})();
