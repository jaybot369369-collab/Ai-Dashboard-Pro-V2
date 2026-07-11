/* ═══════════════════════════════════════════════════════════
   REGIME & RISK RULES card — owned by RegimeCard, rendered on the
   Dashboard tab (same guarded-injection pattern as ThesisScorecard).

   Purpose (Jay, 2026-07-11): a regime state that gates manual size, plus
   threshold alerts that expand to show WHAT TO DO — funding spike → cut
   size; OI flush → no new leverage. Mirrors how the bot farm already uses
   the Liquidity Watcher (micro-veto at score < 40), but for the human.

   Data sources (all fetched in-browser, nothing recalled from memory):
     · Liquidity Watcher /api/scores  — funding/OI/liq z-scores per symbol
       (localhost:8766 locally, /lw/ path on Railway; github.io = offline)
     · Binance spot 1d klines         — BTC trend vs SMA20/SMA50
     · CoinGecko global               — USDT dominance, direction from
       samples stored in localStorage (jb_usdtd_hist)

   Regime state is written to localStorage jb_regime — app.js reads it in
   the trade-save charter gate (risk-off ⇒ A-grade only, 1R = $25).
   All scoring is shown as a visible breakdown — no black box.
════════════════════════════════════════════════════════════ */

const RegimeCard = (() => {

  const REFRESH_MS   = 5 * 60 * 1000;
  const SYMS         = ['BTC', 'ETH', 'XRP', 'SOL', 'SUI'];
  const FUND_Z_SPIKE = 2.0;    // |z| on funding_extremity → funding spike alert
  const OI_Z_FLUSH   = -2.0;   // z on oi_roc_1h → flush alert
  const OI_Z_SURGE   = 2.5;    // z on oi_roc_1h → crowded build-up alert
  const LW_STRESS    = 40;     // same threshold as the bot farm micro-veto

  let _timer = null;

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ── data fetchers ─────────────────────────────────────── */
  function lwBase() {
    const h = location.hostname;
    if (h.endsWith('railway.app')) return '/lw';
    return 'http://localhost:8766';
  }

  async function fetchLW() {
    const r = await fetch(lwBase() + '/api/scores', { signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error('LW HTTP ' + r.status);
    return r.json();
  }

  async function fetchBtcTrend() {
    const r = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=55',
                          { signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error('Binance HTTP ' + r.status);
    const kl = await r.json();
    const closes = kl.map(k => parseFloat(k[4]));
    const price = closes[closes.length - 1];
    const sma = n => closes.slice(-n).reduce((a, b) => a + b, 0) / n;
    return { price, sma20: sma(20), sma50: sma(50) };
  }

  /* USDT dominance direction needs history — sample into localStorage,
     direction = latest vs the newest sample ≥20h older. Unknown until then. */
  async function fetchUsdtD() {
    let cur = null;
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/global', { signal: AbortSignal.timeout(12000) });
      if (r.ok) cur = (await r.json())?.data?.market_cap_percentage?.usdt ?? null;
    } catch { /* CG rate limits happen — direction just stays unknown */ }
    if (cur === null) return { value: null, dir: 'unknown' };

    let hist = [];
    try { hist = JSON.parse(localStorage.getItem('jb_usdtd_hist') || '[]'); } catch {}
    const now = Date.now();
    if (!hist.length || now - hist[hist.length - 1].ts > 6 * 36e5) {
      hist.push({ ts: now, v: cur });
      hist = hist.slice(-40);
      try { localStorage.setItem('jb_usdtd_hist', JSON.stringify(hist)); } catch {}
    }
    const ref = [...hist].reverse().find(s => now - s.ts >= 20 * 36e5);
    if (!ref) return { value: cur, dir: 'unknown' };
    const d = cur - ref.v;
    return { value: cur, dir: d > 0.05 ? 'rising' : d < -0.05 ? 'falling' : 'flat' };
  }

  /* ── regime scoring (transparent) ──────────────────────── */
  function scoreRegime(btc, lw, usdtd) {
    const parts = [];   // { pts, text }
    if (btc) {
      if (btc.price > btc.sma20 && btc.price > btc.sma50) parts.push({ pts: +1, text: 'BTC above 20d & 50d SMA (uptrend)' });
      else if (btc.price < btc.sma20 && btc.price < btc.sma50) parts.push({ pts: -1, text: 'BTC below 20d & 50d SMA (downtrend)' });
      else parts.push({ pts: 0, text: 'BTC between SMAs (mixed trend)' });
    } else parts.push({ pts: 0, text: 'BTC trend unavailable' });

    const b = lw?.scores?.BTC;
    if (b && typeof b.score === 'number') {
      if (b.score < LW_STRESS)   parts.push({ pts: -2, text: `LW score ${b.score.toFixed(0)} < ${LW_STRESS} — leverage stressed (bot vetoes here too)` });
      else if (b.score >= 60)    parts.push({ pts: +1, text: `LW score ${b.score.toFixed(0)} — leverage calm` });
      else                       parts.push({ pts: 0,  text: `LW score ${b.score.toFixed(0)} — middling` });
      const fi = b.components?.funding_extremity?.implication;
      if (fi && fi.tag === 'longs crowded') parts.push({ pts: -1, text: 'BTC funding: longs crowded — flush risk' });
    } else parts.push({ pts: 0, text: 'Liquidity Watcher offline — regime from trend only' });

    if (usdtd.dir === 'rising')  parts.push({ pts: -1, text: `USDT.D rising (${usdtd.value?.toFixed(2)}%) — money hiding in stables` });
    else if (usdtd.dir === 'falling') parts.push({ pts: +1, text: `USDT.D falling (${usdtd.value?.toFixed(2)}%) — risk appetite` });
    else parts.push({ pts: 0, text: usdtd.dir === 'flat' ? 'USDT.D flat' : 'USDT.D direction unknown (collecting samples)' });

    const total = parts.reduce((s, p) => s + p.pts, 0);
    const state = total >= 2 ? 'risk-on' : total <= -1 ? 'risk-off' : 'neutral';
    return { state, total, parts };
  }

  const PRESCRIPTION = {
    'risk-on':  { oneR: 50, text: 'Standard size: 1R = $50 · A/B setups only · with-trend entries preferred.' },
    'neutral':  { oneR: 50, text: 'Standard size: 1R = $50 · A/B only · full confluence required, no chasing mid-range.' },
    'risk-off': { oneR: 25, text: 'HALF SIZE: 1R = $25 · A-grade only · no counter-trend longs · paper-short reps take priority.' },
  };

  /* ── threshold alerts ──────────────────────────────────── */
  function buildAlerts(lw) {
    const out = [];
    if (!lw?.scores) return out;
    for (const sym of SYMS) {
      const s = lw.scores[sym];
      if (!s || !s.components) continue;
      const f = s.components.funding_extremity, oi = s.components.oi_roc_1h;

      if (f && Math.abs(f.z) >= FUND_Z_SPIKE) {
        const tag = f.implication?.tag || 'funding stretched';
        out.push({
          icon: '⚡', title: `FUNDING SPIKE — ${sym}`, sub: `${tag} (z=${f.z.toFixed(1)})`,
          action: `Cut new-entry size to HALF in the crowded direction on ${sym}. Do not add leverage the same way as the crowd — stretched funding mean-reverts via stop-runs. ${esc(f.implication?.hint || '')}`,
        });
      }
      if (oi && oi.z <= OI_Z_FLUSH) {
        out.push({
          icon: '🩸', title: `OI FLUSH — ${sym}`, sub: `open interest dropping fast (z=${oi.z.toFixed(1)})`,
          action: `No NEW leveraged entries on ${sym} for ~24h. A flush means forced closes — structure is broken until it reforms. A-grade spot-size only; wait for a fresh 4h structure before sizing normally.`,
        });
      }
      if (oi && oi.z >= OI_Z_SURGE) {
        out.push({
          icon: '🎈', title: `OI SURGE — ${sym}`, sub: `leverage building fast (z=${oi.z.toFixed(1)})`,
          action: `Crowded build-up on ${sym}. Don't join late with leverage — late OI is the fuel for the squeeze against you. If already positioned: verify the stop is live, consider partials into strength.`,
        });
      }
      if (typeof s.score === 'number' && s.score < LW_STRESS) {
        out.push({
          icon: '🚨', title: `LEVERAGE STRESS — ${sym}`, sub: `LW score ${s.score.toFixed(0)} < ${LW_STRESS}`,
          action: `Same condition the bot farm vetoes on. Manual entries on ${sym} against the 4h bias are a skip. With-bias entries: half size, stop live before entry.`,
        });
      }
    }
    return out;
  }

  /* ── render ────────────────────────────────────────────── */
  const STATE_STYLE = {
    'risk-on':  { fg: '#16a34a', label: 'RISK-ON' },
    'neutral':  { fg: '#d97706', label: 'NEUTRAL' },
    'risk-off': { fg: '#dc2626', label: 'RISK-OFF' },
  };

  function _cardHTML() {
    // placeholder; filled async by _refresh()
    setTimeout(_refresh, 0);
    if (!_timer) _timer = setInterval(() => {
      if (document.getElementById('regimeCardBody')) _refresh();
    }, REFRESH_MS);
    return `
      <div class="card" id="regimeCard">
        <div class="card-head">
          <div>
            <div class="card-title">🌡️ Regime &amp; risk rules</div>
            <div class="card-sub">Gates manual size — same data the bot farm's veto uses</div>
          </div>
        </div>
        <div id="regimeCardBody" style="padding:4px 18px 16px">
          <div style="color:var(--text-2);font-size:13px;padding:12px 0">Reading market state…</div>
        </div>
      </div>`;
  }

  async function _refresh() {
    const el = document.getElementById('regimeCardBody');
    if (!el) return;

    const [lw, btc, usdtd] = await Promise.all([
      fetchLW().catch(() => null),
      fetchBtcTrend().catch(() => null),
      fetchUsdtD().catch(() => ({ value: null, dir: 'unknown' })),
    ]);

    const reg = scoreRegime(btc, lw, usdtd);
    const rx  = PRESCRIPTION[reg.state];
    const st  = STATE_STYLE[reg.state];
    const alerts = buildAlerts(lw);

    // persist for the app.js charter gate
    try {
      localStorage.setItem('jb_regime', JSON.stringify({
        state: reg.state, oneR: rx.oneR, ts: new Date().toISOString(),
        why: reg.parts.map(p => `${p.pts >= 0 ? '+' : ''}${p.pts} ${p.text}`),
      }));
    } catch {}

    const breakdown = reg.parts.map(p => `
      <div style="display:flex;gap:8px;font-size:12px;color:var(--text-2);padding:2px 0">
        <span style="flex:0 0 24px;font-weight:700;color:${p.pts > 0 ? '#16a34a' : p.pts < 0 ? '#dc2626' : 'var(--text-2)'}">${p.pts >= 0 ? '+' + p.pts : p.pts}</span>
        <span>${esc(p.text)}</span>
      </div>`).join('');

    // No LW data = no threshold visibility — say so, never show a green all-clear (RULE #2)
    const alertsHtml = !lw ? `<div style="font-size:12.5px;color:var(--text-2);margin-top:8px">⚪ Liquidity Watcher offline — funding/OI thresholds can't be checked from here. Start it locally (port 8766) or open the Railway dashboard.</div>`
      : alerts.length ? alerts.map(a => `
      <details style="border:1px solid var(--border);border-radius:8px;margin-top:8px;background:var(--surface-2,rgba(127,127,127,.05))">
        <summary style="cursor:pointer;padding:9px 12px;font-size:13px;font-weight:600;list-style-position:inside">
          ${a.icon} ${esc(a.title)} <span style="font-weight:400;color:var(--text-2)">· ${esc(a.sub)} — expand for action</span>
        </summary>
        <div style="padding:2px 14px 12px;font-size:12.5px;line-height:1.55;color:var(--text)">
          <strong>Action:</strong> ${a.action}
        </div>
      </details>`).join('')
      : `<div style="font-size:12.5px;color:#16a34a;margin-top:8px">✓ No thresholds tripped — funding, OI and leverage stress all inside normal bands.</div>`;

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px">
        <span style="font-size:15px;font-weight:800;color:${st.fg};background:${st.fg}1a;padding:5px 14px;border-radius:99px">${st.label}</span>
        <span style="font-size:13px;font-weight:600">${esc(rx.text)}</span>
      </div>
      <details>
        <summary style="cursor:pointer;font-size:12px;color:var(--text-2)">Why (score ${reg.total >= 0 ? '+' : ''}${reg.total}) — show the inputs</summary>
        <div style="padding:6px 0 2px">${breakdown}</div>
      </details>
      <div style="border-top:1px solid var(--border);margin-top:10px;padding-top:8px">
        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-2)">Threshold alerts</div>
        ${alertsHtml}
      </div>
      <div style="font-size:10.5px;color:var(--text-2);margin-top:10px">Updated ${new Date().toLocaleTimeString()} · refreshes every 5 min · risk-off is enforced at trade save (A-grade only, 1R=$25)</div>
    `;
  }

  return { _cardHTML, _refresh };
})();
