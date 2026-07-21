/* ═══════════════════════════════════════════════════════════
   REVERSAL RADAR — bottom-zone confluence card (Dashboard tab).
   Took over the visible Regime card slot 2026-07-13; the regime engine
   still runs headless in regime_card.js and keeps writing jb_regime for
   the trade-save charter gate.

   Spec + backtest: Q2_2026/ICT_Methodology/bots/REVERSAL_RADAR_SPEC.md
   Validated on fixed data (BTC 1d, 2018-02 → 2026-02, Kaggle archive):
     · 3+ of 4 factors aligned ⇒ a 20% swing low was within ±5 days 65%
       of the time (68 bars / 23 episodes) vs 14% on a random day.
     · TOPS DID NOT VALIDATE — this card only ever argues for bottoms.
     · Divergence alone is a falling knife (fwd14 −3.3%) — single factors
       are never presented as a signal, only the confluence count.

   Factors (computed in-browser on COMPLETED daily bars only):
     time      swing clock — current decline age vs the median length of
               all completed 20% declines since 2018 (baked list + any new
               ones detected live). Literal wording only — no "ripe".
     sentiment Fear & Greed ≤ 20 (alternative.me, fetched live)
     volume    z ≥ 2 vs prior 20-day volume, within last 3 bars
     price     regular bullish RSI(14) divergence (fractal pivots confirmed
               2 bars late, drives counted) OR bullish engulf on ≥1.5×
               volume, within last 3 bars
════════════════════════════════════════════════════════════ */

const ReversalRadar = (() => {

  const REFRESH_MS = 5 * 60 * 1000;
  const ZZ = 0.20, RSI_N = 14, SEP_MIN = 5, SEP_MAX = 60, VOL_WIN = 20, PERSIST = 3;

  /* Completed 20% decline lengths (days, high→low), BTC 2018-02 → 2026-02-25,
     from reversal_labels.json (Phase 1, fixed archive). The live zigzag appends
     any decline whose low CONFIRMED after the baked end, so the median keeps
     updating itself as new swings complete.
     Trailing 46 + 23: Oct-2025→Nov-2025 and Jan-2026→Feb-2026 declines. The
     archive's Jan-14 high missed the 20% rebound by ~1% so Phase 1 never
     confirmed them, but Binance data (which this card runs on) did — baked
     here per-Binance so the live filter can't double-count or drop them. */
  const BAKED_DECLINES = [5, 5, 13, 11, 50, 20, 41, 16, 36, 6, 7, 78, 30, 29, 1,
    19, 3, 8, 7, 11, 11, 3, 13, 7, 21, 14, 24, 28, 14, 45, 18, 23, 69, 22, 62,
    60, 12, 48, 28, 7, 39, 36, 46, 23];
  const BAKED_END_MS = Date.parse('2026-02-25T00:00:00Z');

  let _timer = null;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const iso = ts => new Date(ts).toISOString().slice(0, 10);
  const median = a => {
    const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  /* ── data ──────────────────────────────────────────────── */
  async function fetchDaily() {
    const r = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1000',
                          { signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error('Binance HTTP ' + r.status);
    const kl = await r.json();
    kl.pop();   // drop the in-progress bar — completed bars only
    return kl.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
  }

  async function fetchFng() {
    const r = await fetch('https://api.alternative.me/fng/?limit=1',
                          { signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error('FNG HTTP ' + r.status);
    const d = (await r.json())?.data?.[0];
    return d ? { value: +d.value, label: d.value_classification } : null;
  }

  /* ── detectors (ports of reversal_factor_backtest.py) ───── */
  function zigzagLive(bars, thr) {
    let trend = null, extI = 0, extP = null, lastHi = null, lastLo = null;
    let hiI = 0, hiP = bars[0].h, loI = 0, loP = bars[0].l;
    const declines = [];
    for (let i = 0; i < bars.length; i++) {
      const h = bars[i].h, l = bars[i].l;
      if (trend === null) {
        if (h > hiP) { hiI = i; hiP = h; }
        if (l < loP) { loI = i; loP = l; }
        if (l <= hiP * (1 - thr) && hiI < i) { lastHi = { t: bars[hiI].t, p: hiP }; trend = 'down'; extI = i; extP = l; }
        else if (h >= loP * (1 + thr) && loI < i) { lastLo = { t: bars[loI].t, p: loP }; trend = 'up'; extI = i; extP = h; }
      } else if (trend === 'up') {
        if (h > extP) { extI = i; extP = h; }
        else if (l <= extP * (1 - thr)) { lastHi = { t: bars[extI].t, p: extP }; trend = 'down'; extI = i; extP = l; }
      } else {
        if (l < extP) { extI = i; extP = l; }
        else if (h >= extP * (1 + thr)) {
          // confT = when the low CONFIRMED (20% rebound completed) — the baked
          // list holds lows confirmed ≤ archive end, so filter on confT
          if (lastHi) declines.push({ confT: bars[i].t, days: Math.round((bars[extI].t - lastHi.t) / 864e5) });
          lastLo = { t: bars[extI].t, p: extP }; trend = 'up'; extI = i; extP = h;
        }
      }
    }
    return { trend, lastHigh: lastHi, declines };
  }

  function rsiWilder(cl, n) {
    const out = new Array(cl.length).fill(null);
    if (cl.length <= n) return out;
    let g = 0, ls = 0;
    for (let i = 1; i <= n; i++) { const ch = cl[i] - cl[i - 1]; g += Math.max(ch, 0); ls += Math.max(-ch, 0); }
    let ag = g / n, al = ls / n;
    out[n] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (let i = n + 1; i < cl.length; i++) {
      const ch = cl[i] - cl[i - 1];
      ag = (ag * (n - 1) + Math.max(ch, 0)) / n;
      al = (al * (n - 1) + Math.max(-ch, 0)) / n;
      out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
    return out;
  }

  function fractalLows(lows) {
    const p = [];
    for (let i = 2; i < lows.length - 2; i++) {
      const v = lows[i];
      if (v < lows[i - 2] && v < lows[i - 1] && v < lows[i + 1] && v < lows[i + 2]) p.push(i);
    }
    return p;
  }

  function bullDivEvents(piv, lows, rsi, nBars) {
    const ok = j => {
      const a = piv[j - 1], b = piv[j], sep = b - a;
      if (sep < SEP_MIN || sep > SEP_MAX) return false;
      if (rsi[a] == null || rsi[b] == null) return false;
      return lows[b] < lows[a] && rsi[b] > rsi[a];
    };
    const evs = [];
    for (let j = 1; j < piv.length; j++) {
      if (!ok(j)) continue;
      let drives = 2, m = j - 1;
      while (m >= 1 && ok(m)) { drives++; m--; }
      const c = piv[j] + 2;   // pivot confirms 2 bars later — no anticipation
      if (c < nBars) evs.push({ i: c, drives, pivT: null });
    }
    return evs;
  }

  function volLast3(bars) {
    const res = [];
    for (let i = bars.length - PERSIST; i < bars.length; i++) {
      if (i < VOL_WIN) continue;
      const win = bars.slice(i - VOL_WIN, i).map(b => b.v);
      const m = win.reduce((a, b) => a + b, 0) / VOL_WIN;
      const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) * (b - m), 0) / VOL_WIN);
      res.push({ i, t: bars[i].t, z: sd > 0 ? (bars[i].v - m) / sd : 0, mult: m > 0 ? bars[i].v / m : 0 });
    }
    return res;
  }

  function engulfLast3(bars, vols) {
    const byI = Object.fromEntries(vols.map(v => [v.i, v]));
    const out = [];
    for (let i = bars.length - PERSIST; i < bars.length; i++) {
      if (i < 1) continue;
      const b = bars[i], p = bars[i - 1], vm = byI[i]?.mult ?? 0;
      if (vm >= 1.5 && b.c > b.o && p.c < p.o && b.o <= p.c && b.c >= p.o) out.push({ i, t: b.t });
    }
    return out;
  }

  /* ── live episode counter (charter §3 gating: n<20 = collecting) ── */
  function logEpisode(dateStr, k) {
    let eps = [];
    try { eps = JSON.parse(localStorage.getItem('jb_revradar_eps') || '[]'); } catch {}
    const last = eps[eps.length - 1];
    if (!last || Date.parse(dateStr) - Date.parse(last.d) > 5 * 864e5) {
      eps.push({ d: dateStr, k });
      try { localStorage.setItem('jb_revradar_eps', JSON.stringify(eps)); } catch {}
    }
    return eps.length;
  }
  function episodeCount() {
    try { return JSON.parse(localStorage.getItem('jb_revradar_eps') || '[]').length; } catch { return 0; }
  }

  /* ── render ────────────────────────────────────────────── */
  function _cardHTML() {
    setTimeout(_refresh, 0);
    if (!_timer) _timer = setInterval(() => {
      if (document.getElementById('revRadarBody')) _refresh();
    }, REFRESH_MS);
    return `
      <div class="card" id="revRadarCard">
        <div class="card-head">
          <div>
            <div class="card-title"><span class="card-emoji">📡</span>Reversal Radar — BTC bottoms</div>
            <div class="card-sub">4-factor bottom-ZONE finder · backtested 2018–2026 · finds the zone, not the entry</div>
          </div>
        </div>
        <div id="revRadarBody" style="padding:4px 18px 16px">
          <div style="color:var(--text-2);font-size:13px;padding:12px 0">Reading market state…</div>
        </div>
      </div>`;
  }

  function tile(name, on, main, sub) {
    const mark = on
      ? '<span style="color:#16a34a;font-weight:700">✓</span>'
      : '<span style="color:var(--text-2)">—</span>';
    return `
      <div style="border:1px solid var(--border);border-radius:8px;padding:9px 11px;background:var(--surface-2,rgba(127,127,127,.05))">
        <div style="display:flex;justify-content:space-between;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-2)">
          <span>${esc(name)}</span>${mark}
        </div>
        <div style="font-size:13px;font-weight:600;margin-top:3px">${main}</div>
        <div style="font-size:11.5px;color:var(--text-2);margin-top:2px">${sub}</div>
      </div>`;
  }

  async function _refresh() {
    const el = document.getElementById('revRadarBody');
    if (!el) return;

    let bars = null, fng = null, fngErr = false;
    try { bars = await fetchDaily(); } catch (e) { console.warn('[revradar] klines failed:', e); }
    try { fng = await fetchFng(); } catch (e) { fngErr = true; console.warn('[revradar] fng failed:', e); }

    if (!bars || bars.length < 100) {
      el.innerHTML = `<div style="font-size:12.5px;color:var(--text-2);padding:12px 0">⚪ Binance daily klines unreachable from this browser — the radar can't compute. Nothing is assumed; retry in 5 min.</div>`;
      return;
    }

    const n = bars.length;
    const last = bars[n - 1];
    const closes = bars.map(b => b.c), lows = bars.map(b => b.l);

    /* time — swing clock */
    const zig = zigzagLive(bars, ZZ);
    const newDecl = zig.declines.filter(d => d.confT > BAKED_END_MS).map(d => d.days);
    const allDecl = BAKED_DECLINES.concat(newDecl);
    const med = median(allDecl);
    const inDecline = zig.trend === 'down' && zig.lastHigh;
    const age = inDecline ? Math.round((last.t - zig.lastHigh.t) / 864e5) : null;
    const clockOn = !!(inDecline && age >= med);

    /* sentiment */
    const fngOn = !!(fng && fng.value <= 20);

    /* volume */
    const vols = volLast3(bars);
    const spike = vols.filter(v => v.z >= 2);
    const volOn = spike.length > 0;
    const lastVol = vols[vols.length - 1];

    /* price */
    const rsi = rsiWilder(closes, RSI_N);
    const divs = bullDivEvents(fractalLows(lows), lows, rsi, n);
    const recentDivs = divs.filter(d => d.i >= n - PERSIST);
    const engs = engulfLast3(bars, vols);
    const priceOn = recentDivs.length > 0 || engs.length > 0;
    const drives = recentDivs.length ? Math.max(...recentDivs.map(d => d.drives)) : 0;

    const k = [clockOn, fngOn, volOn, priceOn].filter(Boolean).length;
    let epCount = episodeCount();
    if (k >= 3) epCount = logEpisode(iso(last.t), k);

    /* status + meter */
    const status = k >= 3
      ? { fg: '#16a34a', label: `${k} OF 4 — BOTTOM-ZONE CONDITIONS` }
      : k === 2
        ? { fg: '#d97706', label: '2 OF 4 — BUILDING, NOT ENOUGH' }
        : { fg: 'var(--text-2)', label: `${k} OF 4 — NO BOTTOM CASE` };
    const meter = [0, 1, 2, 3].map(i =>
      `<div style="flex:1;height:7px;border-radius:4px;background:${i < k ? '#16a34a' : 'var(--border)'}"></div>`).join('');

    /* literal paragraph */
    const px = '$' + last.c.toLocaleString(undefined, { maximumFractionDigits: 0 });
    const bits = [];
    if (clockOn) bits.push(`the decline is ${age} days old vs a typical completed decline of ${Math.round(med)} days`);
    else if (inDecline) bits.push(`the decline is ${age} days old — under the typical ${Math.round(med)} days, so the clock hasn't fired`);
    if (fng) bits.push(`Fear &amp; Greed is ${fng.value} (${esc(fng.label)})${fngOn ? '' : ' — needs ≤20 to fire'}`);
    if (lastVol) bits.push(`yesterday's volume ran ${Math.round(lastVol.mult * 100)}% of its 20-day average${volOn ? ` with a z=${spike[spike.length - 1].z.toFixed(1)} spike` : ''}`);
    if (recentDivs.length) bits.push(`a bullish RSI divergence confirmed with ${drives} drives`);
    if (engs.length) bits.push(`a bullish engulfing candle printed on ≥1.5× volume`);
    let para;
    if (k >= 3) {
      para = `<strong>${k} of 4 factors aligned</strong> at ${px} (last daily close). In the 2018–2026 backtest this situation was within 5 days of a major low 65% of the time, against 14% on a random day. This finds the ZONE — it is not an entry signal. Entries still go through your normal process.`;
    } else if (k === 2) {
      para = `2 of 4 aligned at ${px}. Not enough — in the backtest, 2 factors carried no edge two weeks out. `;
    } else {
      para = `No bottom case at ${px}. `;
    }
    if (bits.length) para += ` Right now: ${bits.join('; ')}.`;

    /* tiles */
    const tiles =
      tile('Time — swing clock', clockOn,
        inDecline ? `Decline: ${age} days old` : 'No ≥20% decline running',
        inDecline ? `typical completed decline: ${Math.round(med)} days (n=${allDecl.length} since 2018)`
                  : 'clock starts when BTC is 20% below a swing high') +
      tile('Sentiment — F&G', fngOn,
        fng ? `${fng.value} — ${esc(fng.label)}` : (fngErr ? 'Unavailable' : '…'),
        fng ? (fngOn ? 'extreme fear — fires at ≤20' : 'fires at ≤20') : 'alternative.me unreachable — counted as off') +
      tile('Volume', volOn,
        lastVol ? `${Math.round(lastVol.mult * 100)}% of 20-day avg` : '…',
        volOn ? `spike z=${spike[spike.length - 1].z.toFixed(1)} on ${iso(spike[spike.length - 1].t)}` : 'fires on a z≥2 spike in the last 3 days') +
      tile('Price — RSI div / engulf', priceOn,
        recentDivs.length ? `Bullish divergence · ${drives} drives`
          : engs.length ? 'Bullish engulf on volume' : 'No trigger',
        priceOn ? `confirmed in the last 3 daily bars` : 'watching for a confirmed divergence or an engulf on ≥1.5× volume');

    /* transparent breakdown */
    const zParts = vols.map(v => `${iso(v.t)}: z=${v.z.toFixed(1)}, ${Math.round(v.mult * 100)}% of avg`).join(' · ');
    const breakdown = `
      <div style="font-size:12px;color:var(--text-2);line-height:1.6;padding:6px 0 2px">
        <div>· Swing clock: ${inDecline ? `down-leg since ${iso(zig.lastHigh.t)} (high $${zig.lastHigh.p.toLocaleString(undefined, { maximumFractionDigits: 0 })}), age ${age}d, median completed decline ${med}d over ${allDecl.length} declines (${BAKED_DECLINES.length} baked + ${newDecl.length} live)` : `up-leg by the 20% swing measure — no decline to time`}</div>
        <div>· F&amp;G: ${fng ? `${fng.value} (${esc(fng.label)})` : 'fetch failed — factor forced off, never assumed'}</div>
        <div>· Volume (last 3 completed bars): ${zParts || 'n/a'}</div>
        <div>· Price: ${divs.length} bullish divergences in the loaded window, ${recentDivs.length} confirmed in the last 3 bars${engs.length ? `; engulf on ${engs.map(e => iso(e.t)).join(', ')}` : ''}</div>
        <div>· Bars: ${n} completed daily candles to ${iso(last.t)} (in-progress candle excluded)</div>
      </div>`;

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px">
        <span style="font-size:13.5px;font-weight:800;color:${status.fg};background:${k >= 3 ? '#16a34a1a' : 'transparent'};padding:5px 12px;border-radius:99px;border:1px solid ${k >= 3 ? '#16a34a55' : 'var(--border)'}">${status.label}</span>
      </div>
      <div style="display:flex;gap:5px;margin-bottom:12px">${meter}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:12px">${tiles}</div>
      <div style="font-size:13px;line-height:1.6;margin-bottom:8px">${para}</div>
      <details>
        <summary style="cursor:pointer;font-size:12px;color:var(--text-2)">Show the inputs — every number, no black box</summary>
        ${breakdown}
      </details>
      <div style="border-top:1px solid var(--border);margin-top:10px;padding-top:8px;font-size:10.5px;color:var(--text-2)">
        Backtest 2018→2026 (fixed data): 3+ factors ⇒ 65% within 5d of a ≥20% low (23 episodes) · baseline 14% · k=2 showed NO edge ·
        tops did not validate — this card only looks for bottoms · live sample ${epCount}/20 episodes — collecting, no live verdict until 20 ·
        updated ${new Date().toLocaleTimeString()} · refreshes every 5 min
      </div>`;
  }

  return { _cardHTML, _refresh };
})();
