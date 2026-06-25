/* ═══════════════════════════════════════════════════════════
   FCP SCORE ENGINE — Float · Catalyst · Price
   Pure scoring module. Dual export: window.FCPScore (browser)
   + module.exports (Node.js for Phase-2 Telegram/PDF report).

   Scoring hierarchy (from Penny_Stock_Coaching deck):
     Leg 1 — FLOAT (50%, gates the whole system)
              FDV/mcap overhang + circulating/total ratio.
              floatScore < 35 → composite capped at 40, tier forced F.
     Leg 2 — CATALYST (30%)
              catalysts.json events ≤30d by symbol (tiered)
              + turnover surge as promotion proxy.
     Leg 3 — PRICE ACTION (20%, confirmation last)
              First green day off a base > overextension > alignment.

   Honesty: FDV/mcap is a proxy for unlock overhang (Rule #2).
   Precise unlock dates are NOT available from free APIs; the
   flag UNLOCK DATA means a manual override was found.
════════════════════════════════════════════════════════════ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FCPScore = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

  // Stablecoins + wrapped/staked tokens to skip.
  const EXCLUDE = new Set([
    'USDT','USDC','DAI','FDUSD','TUSD','USDE','WBTC','WETH','WBETH',
    'STETH','WEETH','BUSD','PYUSD','USDS','SUSDE','USDD','GUSD','FRAX',
    'LUSD','CRVUSD','GHO','ALUSD','DOLA','EUSD','XAUT','PAXG','EETH',
    'RETH','CBETH','SFRXETH','SUSDS',
  ]);

  // ── Catalyst tier map (from the coaching deck's hierarchy) ────────────
  // Returns { boost, label } based on event fields.
  function _catalystImpact(ev) {
    const cat   = (ev.category || '').toLowerCase();
    const title = (ev.title    || '').toLowerCase();
    const imp   = (ev.impact   || '').toLowerCase();

    if (cat === 'token unlock')                    return { boost: -30, label: 'Unlock (dist.)' };
    if (cat.includes('etf')) {
      if (title.includes('listing') || title.includes('approval') || title.includes('launch'))
                                                   return { boost: 38, label: 'ETF listing A+' };
      return                                              { boost: 15, label: 'ETF flows B' };
    }
    if (title.includes('listing') || title.includes('binance') || title.includes('coinbase') || title.includes('cex'))
                                                   return { boost: 38, label: 'CEX listing A+' };
    if (cat === 'protocol' || cat === 'regulatory') {
      if (imp === 'high')                          return { boost: 28, label: 'Protocol A' };
      if (imp === 'medium')                        return { boost: 12, label: 'Protocol B' };
                                                   return { boost:  5, label: 'Protocol C' };
    }
    if (cat === 'macro')                           return { boost:  8, label: 'Macro B' };
                                                   return { boost:  5, label: 'Event C' };
  }

  // ── Main scorer ───────────────────────────────────────────────────────
  function score(coin, catalysts, unlockOverrides) {
    const sym   = (coin.symbol || '').toUpperCase();
    const circ  = coin.circulating_supply          || 0;
    const total = coin.total_supply                || circ;
    const maxS  = coin.max_supply;                    // null = uncapped (ETH, SOL, etc.)
    const fdv   = coin.fully_diluted_valuation;
    const mcap  = coin.market_cap                  || 0;
    const vol   = coin.total_volume                || 0;
    const c24   = coin.price_change_percentage_24h_in_currency;
    const c7    = coin.price_change_percentage_7d_in_currency;
    const c30   = coin.price_change_percentage_30d_in_currency;

    const denominator = maxS || total || circ || 1;
    const circRatio   = circ / denominator;
    const turnover    = mcap > 0 ? vol / mcap : 0;
    const fdvUnknown  = !fdv || fdv <= 0;
    const fdvMcap     = fdvUnknown ? 1.0 : fdv / (mcap || 1);

    // Manual unlock override
    const override = Array.isArray(unlockOverrides)
      ? unlockOverrides.find(o => (o.symbol || '').toUpperCase() === sym)
      : null;

    // ── LEG 1: FLOAT ─────────────────────────────────────────────────
    // fdvMcap 1.0→100, 1.5→80, 2.0→60, 3.0→20, 3.5+→0
    const floatOverhang = clamp(100 - (fdvMcap - 1) * 40);
    const floatScore    = clamp(0.6 * floatOverhang + 0.4 * (circRatio * 100));
    const floatGated    = floatScore < 35;

    // ── LEG 2: CATALYST ──────────────────────────────────────────────
    const today         = new Date();
    let   catalystScore = 50;
    const catalystHits  = [];

    if (Array.isArray(catalysts)) {
      for (const ev of catalysts) {
        if (!Array.isArray(ev.assets) || !ev.assets.includes(sym)) continue;
        const evDate   = new Date(ev.date);
        if (isNaN(evDate)) continue;
        const daysDiff = (evDate - today) / 86400000;
        if (daysDiff < -7 || daysDiff > 30) continue;  // window: already fired (−7d) to upcoming (+30d)
        const { boost, label } = _catalystImpact(ev);
        catalystScore += boost;
        catalystHits.push({ title: ev.title, label, boost, date: ev.date });
      }
    }

    // Manual unlock override → negative catalyst signal
    if (override && override.next_unlock_date) {
      const unlockDate     = new Date(override.next_unlock_date);
      const daysToUnlock   = (unlockDate - today) / 86400000;
      if (daysToUnlock >= 0 && daysToUnlock <= 30) {
        const pct     = override.pct_supply || 5;
        const penalty = pct > 10 ? -35 : pct > 5 ? -20 : -10;
        catalystScore += penalty;
        catalystHits.push({
          title: `Unlock: ${pct}% supply in ${Math.round(daysToUnlock)}d`,
          label: 'Unlock override', boost: penalty, date: override.next_unlock_date,
        });
      }
    }

    // Turnover surge as promotion-phase proxy
    if (turnover > 0.30) {
      catalystScore += 22;
      catalystHits.push({ title: 'Extreme volume surge', label: 'Turnover >30%', boost: 22, date: null });
    } else if (turnover > 0.15) {
      catalystScore += 12;
      catalystHits.push({ title: 'Volume surge', label: 'Turnover >15%', boost: 12, date: null });
    }
    catalystScore = clamp(catalystScore);

    // ── LEG 3: PRICE ACTION ──────────────────────────────────────────
    let priceScore  = 50;
    const pFlags    = [];

    // "First green day off a base" — the coaching deck sweet spot
    if (c24 != null && c7 != null && c24 > 0 && c7 < 0) {
      priceScore += 22;
      pFlags.push('first-green-day');
    } else if (c24 != null && c24 > 0) {
      priceScore += 8;
    }
    if (c24 != null && c7 != null && c30 != null && c24 > 0 && c7 > 0 && c30 > 0) {
      priceScore += 10;
      pFlags.push('full-alignment');
    }
    if (c7 != null && c7 < -30) priceScore -= 15;

    const overextended = (c7 != null && c7 > 40) ||
                         (c24 != null && c24 > 20 && turnover > 0.20);
    if (overextended) { priceScore -= 30; pFlags.push('overextended'); }
    priceScore = clamp(priceScore);

    // ── COMPOSITE ────────────────────────────────────────────────────
    let composite = clamp(0.5 * floatScore + 0.3 * catalystScore + 0.2 * priceScore);
    if (floatGated) composite = Math.min(composite, 40);

    // ── PHASE (SEC-02 promotion cycle) ───────────────────────────────
    let phase;
    if (overextended || (c24 != null && c24 > 12) || (c7 != null && c7 > 30 && turnover > 0.15)) {
      phase = 'Spike';
    } else if (c30 != null && c30 < -25 && (c7 == null || c7 < -10)) {
      phase = 'Collapse';
    } else if (c7 != null && c7 > 5 && turnover > 0.08) {
      phase = 'Promotion';
    } else {
      phase = 'Accumulation';
    }
    // Heavy overhang always overrides to Distribution, regardless of short-term price
    if (fdvMcap > 2.5 && phase !== 'Collapse') phase = 'Distribution';

    // ── TIER ────────────────────────────────────────────────────────
    const tier = floatGated          ? 'F'
               : composite >= 78     ? 'A+'
               : composite >= 63     ? 'A'
               : composite >= 50     ? 'B'
               : composite >= 35     ? 'C'
               :                       'F';

    // ── VERDICT ─────────────────────────────────────────────────────
    const verdict =
      (overextended && fdvMcap > 1.8) ? 'SHORT EXTENSION'
      : floatGated                    ? 'AVOID LONG'
      : (tier === 'A+' && (phase === 'Accumulation' || phase === 'Promotion'))
                                      ? 'ACCUMULATE'
      : (tier === 'A' || tier === 'B') ? 'WATCH'
      : (phase === 'Spike' || phase === 'Distribution')
                                      ? 'AVOID LONG'
      :                                  'NEUTRAL';

    return {
      composite: Math.round(composite),
      tier,
      phase,
      verdict,
      legs: {
        float: {
          score: Math.round(floatScore),
          fdvMcap: +fdvMcap.toFixed(2),
          circRatio: +circRatio.toFixed(3),
          floatOverhang: Math.round(floatOverhang),
        },
        catalyst: {
          score: Math.round(catalystScore),
          hits: catalystHits,
          turnover: +turnover.toFixed(3),
        },
        price: {
          score: Math.round(priceScore),
          flags: pFlags,
          c24, c7, c30,
        },
      },
      flags: [
        ...(floatGated   ? ['DISTRIBUTION MACHINE'] : []),
        ...(fdvUnknown   ? ['FDV UNKNOWN']           : []),
        ...(overextended ? ['OVEREXTENDED']           : []),
        ...(override     ? ['UNLOCK DATA']            : []),
      ],
    };
  }

  return { score, EXCLUDE };
}));
