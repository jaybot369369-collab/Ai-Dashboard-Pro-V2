/* ═══════════════════════════════════════════════════════════
   ICT_DETECTORS — pure-function ICT pattern detectors
   Each detector takes a kline window (array of {t,o,h,l,c,v})
   and returns { fired, dir, strength, evidence }.
   Indicator helpers: ema, sma, atr, adx.
════════════════════════════════════════════════════════════ */
window.ICTDetect = (() => {

  /* ── Indicator primitives ─────────────────────────────── */
  function sma(arr, n) {
    if (arr.length < n) return null;
    let s = 0;
    for (let i = arr.length - n; i < arr.length; i++) s += arr[i];
    return s / n;
  }

  function ema(arr, n) {
    if (arr.length < n) return null;
    const k = 2 / (n + 1);
    let e = arr.slice(0, n).reduce((a, b) => a + b, 0) / n;
    for (let i = n; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
    return e;
  }

  function emaSeries(arr, n) {
    if (arr.length < n) return [];
    const k = 2 / (n + 1);
    const out = new Array(n - 1).fill(null);
    let e = arr.slice(0, n).reduce((a, b) => a + b, 0) / n;
    out.push(e);
    for (let i = n; i < arr.length; i++) {
      e = arr[i] * k + e * (1 - k);
      out.push(e);
    }
    return out;
  }

  function atr(klines, n = 14) {
    if (klines.length < n + 1) return null;
    const trs = [];
    for (let i = 1; i < klines.length; i++) {
      const h = klines[i].h, l = klines[i].l, pc = klines[i - 1].c;
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    return sma(trs.slice(-n), n);
  }

  /* Wilder ADX — returns { adx, plusDI, minusDI } for the last bar */
  function adx(klines, n = 14) {
    if (klines.length < n * 2 + 1) return null;
    const plusDM = [], minusDM = [], trs = [];
    for (let i = 1; i < klines.length; i++) {
      const up = klines[i].h - klines[i - 1].h;
      const dn = klines[i - 1].l - klines[i].l;
      plusDM.push(up > dn && up > 0 ? up : 0);
      minusDM.push(dn > up && dn > 0 ? dn : 0);
      const tr = Math.max(
        klines[i].h - klines[i].l,
        Math.abs(klines[i].h - klines[i - 1].c),
        Math.abs(klines[i].l - klines[i - 1].c)
      );
      trs.push(tr);
    }
    // Wilder smoothing
    function wilder(arr) {
      let s = arr.slice(0, n).reduce((a, b) => a + b, 0);
      const out = [s];
      for (let i = n; i < arr.length; i++) {
        s = s - s / n + arr[i];
        out.push(s);
      }
      return out;
    }
    const smTR = wilder(trs);
    const smP  = wilder(plusDM);
    const smM  = wilder(minusDM);
    const dx = [];
    for (let i = 0; i < smTR.length; i++) {
      const pdi = (smP[i] / smTR[i]) * 100;
      const mdi = (smM[i] / smTR[i]) * 100;
      const sum = pdi + mdi;
      dx.push(sum ? (Math.abs(pdi - mdi) / sum) * 100 : 0);
    }
    if (dx.length < n) return null;
    // ADX = Wilder smoothing of DX
    let adxV = dx.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const adxSeries = [adxV];
    for (let i = n; i < dx.length; i++) {
      adxV = (adxV * (n - 1) + dx[i]) / n;
      adxSeries.push(adxV);
    }
    const last = adxSeries[adxSeries.length - 1];
    const prev3 = adxSeries.slice(-4, -1);
    const rising = prev3.length === 3 && last > prev3[2] && prev3[2] > prev3[0];
    const lastP = (smP[smP.length - 1] / smTR[smTR.length - 1]) * 100;
    const lastM = (smM[smM.length - 1] / smTR[smTR.length - 1]) * 100;
    return { adx: last, plusDI: lastP, minusDI: lastM, rising };
  }

  /* ── volume z-score on a single bar (vs N-bar avg) ────── */
  function volMult(klines, barIdx, n = 20) {
    if (!klines || klines.length < n + 1) return 1;
    const idx = barIdx == null ? klines.length - 1 : barIdx;
    let s = 0;
    const start = Math.max(0, idx - n);
    for (let i = start; i < idx; i++) s += (klines[i].v || 0);
    const avg = s / Math.max(1, idx - start);
    if (!avg) return 1;
    const rel = (klines[idx].v || 0) / avg;
    // Clamp to [0.5, 1.5] so a low-volume sweep doesn't get zeroed
    return Math.max(0.5, Math.min(1.5, rel));
  }

  /* ── 4h bias via EMA50/EMA200 + slope ─────────────────── */
  function detectBias(klines) {
    const closes = klines.map(k => k.c);
    const e50  = emaSeries(closes, 50);
    const e200 = emaSeries(closes, 200);
    if (!e50.length || !e200.length) return _miss('not enough bars for EMA200');
    const last50  = e50[e50.length - 1];
    const last200 = e200[e200.length - 1];
    if (last50 == null || last200 == null) return _miss('EMA warmup');
    const lookback = 10;
    const prev50 = e50[e50.length - 1 - lookback];
    if (prev50 == null) return _miss('slope warmup');
    const slope = (last50 - prev50) / prev50;
    const aboveBy = (last50 - last200) / last200;
    const dir = last50 > last200 && slope > 0 ? 'bull'
              : last50 < last200 && slope < 0 ? 'bear'
              : null;
    if (!dir) return _miss(`EMA mixed (50/200 ratio ${(aboveBy*100).toFixed(2)}%)`);
    const strength = Math.min(1, Math.abs(slope) * 80 + Math.abs(aboveBy) * 20);
    return {
      fired: true, dir, strength,
      evidence: `EMA50 ${dir === 'bull' ? '>' : '<'} EMA200 (Δ ${(aboveBy*100).toFixed(2)}%), 10-bar slope ${(slope*100).toFixed(2)}%`
    };
  }

  /* ── ADX gate (mirrors OBxADX bot gate_C: ADX>15 & rising 3 bars) */
  function detectADXGate(klines) {
    const a = adx(klines, 14);
    if (!a) return _miss('ADX warmup');
    if (a.adx <= 15) return _miss(`ADX ${a.adx.toFixed(1)} ≤ 15`);
    if (!a.rising)   return _miss(`ADX ${a.adx.toFixed(1)} not rising`);
    const dir = a.plusDI > a.minusDI ? 'bull' : 'bear';
    const strength = Math.min(1, (a.adx - 15) / 30);
    return {
      fired: true, dir, strength,
      evidence: `ADX ${a.adx.toFixed(1)} rising, +DI ${a.plusDI.toFixed(1)} / -DI ${a.minusDI.toFixed(1)}`
    };
  }

  /* ── FVG: 3-candle gap (c[-3].high < c[-1].low for bull, opposite for bear)
        Scan last N=30 bars for the most recent UNFILLED gap. */
  function detectFVG(klines, lookback = 30) {
    if (klines.length < 6) return _miss('not enough bars');
    const last = klines.length - 1;
    const start = Math.max(2, klines.length - lookback);
    for (let i = last; i >= start; i--) {
      const a = klines[i - 2], c = klines[i];
      // Bullish FVG: a.high < c.low → gap between
      if (a.h < c.l) {
        const gapTop = c.l, gapBot = a.h;
        // unfilled if no subsequent bar closed below gapBot wickwise
        let filled = false;
        for (let j = i + 1; j <= last; j++) {
          if (klines[j].l <= gapBot) { filled = true; break; }
        }
        if (!filled) {
          const size = (gapTop - gapBot) / klines[i].c;
          const age = last - i;
          const vm = volMult(klines, i);
          const strength = Math.min(1, size * 200) * (1 - age / lookback) * vm;
          return {
            fired: true, dir: 'bull', strength,
            evidence: `Bull FVG ${age}b ago, gap ${(size*100).toFixed(2)}% · vol ${vm.toFixed(2)}×`
          };
        }
      }
      // Bearish FVG
      if (a.l > c.h) {
        const gapTop = a.l, gapBot = c.h;
        let filled = false;
        for (let j = i + 1; j <= last; j++) {
          if (klines[j].h >= gapTop) { filled = true; break; }
        }
        if (!filled) {
          const size = (gapTop - gapBot) / klines[i].c;
          const age = last - i;
          const vm = volMult(klines, i);
          const strength = Math.min(1, size * 200) * (1 - age / lookback) * vm;
          return {
            fired: true, dir: 'bear', strength,
            evidence: `Bear FVG ${age}b ago, gap ${(size*100).toFixed(2)}% · vol ${vm.toFixed(2)}×`
          };
        }
      }
    }
    return _miss('no unfilled FVG in window');
  }

  /* ── Order Block: last opposing candle before >1×ATR displacement.
        Bull OB = down candle before a strong up move. */
  function detectOB(klines, lookback = 40) {
    const a = atr(klines, 14);
    if (!a) return _miss('ATR warmup');
    const last = klines.length - 1;
    const start = Math.max(2, klines.length - lookback);
    for (let i = last - 1; i >= start; i--) {
      const k = klines[i];
      const isDown = k.c < k.o;
      const isUp = k.c > k.o;
      // Look at next 2 bars displacement
      const dispEnd = Math.min(last, i + 2);
      const dispMove = klines[dispEnd].c - k.c;
      const dispAbs = Math.abs(dispMove);
      if (dispAbs < a * 1.0) continue;
      if (isDown && dispMove > 0) {
        // Bull OB at k. Unmitigated if price hasn't closed back below k.l
        let mitigated = false;
        for (let j = dispEnd + 1; j <= last; j++) {
          if (klines[j].l <= k.l) { mitigated = true; break; }
        }
        if (!mitigated) {
          const age = last - i;
          const proximity = 1 - Math.min(1, Math.abs(klines[last].c - k.h) / (a * 5));
          const vm = volMult(klines, i);
          const strength = Math.max(0.2, proximity * (1 - age / lookback)) * vm;
          return {
            fired: true, dir: 'bull', strength,
            evidence: `Bull OB ${age}b ago @ ${k.l.toFixed(4)}–${k.h.toFixed(4)}, ${(dispAbs/a).toFixed(1)}×ATR · vol ${vm.toFixed(2)}×`
          };
        }
      }
      if (isUp && dispMove < 0) {
        let mitigated = false;
        for (let j = dispEnd + 1; j <= last; j++) {
          if (klines[j].h >= k.h) { mitigated = true; break; }
        }
        if (!mitigated) {
          const age = last - i;
          const proximity = 1 - Math.min(1, Math.abs(klines[last].c - k.l) / (a * 5));
          const vm = volMult(klines, i);
          const strength = Math.max(0.2, proximity * (1 - age / lookback)) * vm;
          return {
            fired: true, dir: 'bear', strength,
            evidence: `Bear OB ${age}b ago @ ${k.l.toFixed(4)}–${k.h.toFixed(4)}, ${(dispAbs/a).toFixed(1)}×ATR · vol ${vm.toFixed(2)}×`
          };
        }
      }
    }
    return _miss('no unmitigated OB');
  }

  /* ── Sweep: wick beyond last swing high/low + close back inside
        Looks at last 3 bars vs prior 20-bar swing extreme. */
  function detectSweep(klines, swingLen = 20) {
    if (klines.length < swingLen + 4) return _miss('not enough bars');
    const last = klines.length - 1;
    for (let off = 0; off < 3; off++) {
      const i = last - off;
      const window = klines.slice(i - swingLen, i);
      const swingHigh = Math.max(...window.map(k => k.h));
      const swingLow  = Math.min(...window.map(k => k.l));
      const k = klines[i];
      if (k.h > swingHigh && k.c < swingHigh) {
        const wick = (k.h - Math.max(k.o, k.c)) / k.c;
        const vm = volMult(klines, i);
        const strength = Math.min(1, wick * 200) * vm;
        return {
          fired: true, dir: 'bear', strength,
          evidence: `Swept ${swingLen}b high @ ${swingHigh.toFixed(4)} ${off}b ago, closed back below · vol ${vm.toFixed(2)}×`
        };
      }
      if (k.l < swingLow && k.c > swingLow) {
        const wick = (Math.min(k.o, k.c) - k.l) / k.c;
        const vm = volMult(klines, i);
        const strength = Math.min(1, wick * 200) * vm;
        return {
          fired: true, dir: 'bull', strength,
          evidence: `Swept ${swingLen}b low @ ${swingLow.toFixed(4)} ${off}b ago, closed back above · vol ${vm.toFixed(2)}×`
        };
      }
    }
    return _miss('no recent sweep');
  }

  /* ── CISD: close back through prior opposing candle close
        Simple proxy — last 3 bars flipped colour with displacement. */
  function detectCISD(klines) {
    if (klines.length < 6) return _miss('not enough bars');
    const last = klines.length - 1;
    const k = klines[last];
    const a = atr(klines, 14);
    if (!a) return _miss('ATR warmup');
    const body = Math.abs(k.c - k.o);
    if (body < a * 0.7) return _miss('current bar body too small');
    // Look back: did the last 3 prior closes trend opposite to current bar?
    const dirCur = k.c > k.o ? 'bull' : 'bear';
    const priors = klines.slice(last - 3, last);
    if (dirCur === 'bull') {
      const allDown = priors.every(p => p.c < p.o);
      if (allDown && k.c > priors[priors.length - 1].o) {
        return {
          fired: true, dir: 'bull', strength: Math.min(1, body / a / 2),
          evidence: `CISD bull: 3 bear bars → bull body ${(body/a).toFixed(1)}×ATR closed above prior open`
        };
      }
    } else {
      const allUp = priors.every(p => p.c > p.o);
      if (allUp && k.c < priors[priors.length - 1].o) {
        return {
          fired: true, dir: 'bear', strength: Math.min(1, body / a / 2),
          evidence: `CISD bear: 3 bull bars → bear body ${(body/a).toFixed(1)}×ATR closed below prior open`
        };
      }
    }
    return _miss('no CISD flip');
  }

  /* ── BOS (Break of Structure): break of prior swing within last 5 bars */
  function detectBOS(klines, swingLen = 15) {
    if (klines.length < swingLen + 6) return _miss('not enough bars');
    const last = klines.length - 1;
    const recent = klines.slice(last - 5, last + 1);
    const prior = klines.slice(last - 5 - swingLen, last - 5);
    const priorHigh = Math.max(...prior.map(k => k.h));
    const priorLow  = Math.min(...prior.map(k => k.l));
    const recentHigh = Math.max(...recent.map(k => k.c));
    const recentLow  = Math.min(...recent.map(k => k.c));
    if (recentHigh > priorHigh) {
      return {
        fired: true, dir: 'bull', strength: 0.6,
        evidence: `BOS up: close > ${swingLen}b high ${priorHigh.toFixed(4)}`
      };
    }
    if (recentLow < priorLow) {
      return {
        fired: true, dir: 'bear', strength: 0.6,
        evidence: `BOS down: close < ${swingLen}b low ${priorLow.toFixed(4)}`
      };
    }
    return _miss('no BOS in last 5 bars');
  }

  /* ── Killzone active (UTC wall-clock) ─────────────────── */
  const KILLZONES = [
    { name: 'Asia',    startUTC:  0, endUTC:  4 },
    { name: 'London',  startUTC:  7, endUTC:  9 },   // London Open = 07-09 UTC (08-10 BST handled approx)
    { name: 'NY AM',   startUTC: 13, endUTC: 15 },
    { name: 'NY PM',   startUTC: 18, endUTC: 20 },
  ];

  function activeKillzone(now = new Date()) {
    const h = now.getUTCHours();
    for (const kz of KILLZONES) {
      if (kz.startUTC <= kz.endUTC) {
        if (h >= kz.startUTC && h < kz.endUTC) return kz.name;
      } else {
        if (h >= kz.startUTC || h < kz.endUTC) return kz.name;
      }
    }
    return null;
  }

  function isKillzoneActive() { return activeKillzone() !== null; }

  /* ── near_level: price within tolPct of any level
        levels = [{ label, value }, ...]   */
  function nearLevel(price, levels, tolPct = 0.4) {
    if (!levels || !levels.length) return _miss('no levels');
    let best = null;
    for (const lv of levels) {
      if (!Number.isFinite(lv.value)) continue;
      const dPct = Math.abs(price - lv.value) / price * 100;
      if (dPct <= tolPct && (!best || dPct < best.dPct)) {
        best = { ...lv, dPct };
      }
    }
    if (!best) return _miss(`no level within ${tolPct}%`);
    const isResistance = /res|r\d|high|bsl/i.test(best.label) || best.value > price;
    const dir = isResistance ? 'bear' : 'bull';
    const strength = 1 - (best.dPct / tolPct);
    return {
      fired: true, dir, strength,
      evidence: `Near ${best.label} @ ${best.value} (${best.dPct.toFixed(2)}% away)`
    };
  }

  /* ── helper ───────────────────────────────────────────── */
  function _miss(reason) { return { fired: false, dir: null, strength: 0, evidence: reason }; }

  return {
    sma, ema, emaSeries, atr, adx, volMult,
    detectBias, detectADXGate,
    detectFVG, detectOB, detectSweep, detectCISD, detectBOS,
    activeKillzone, isKillzoneActive, nearLevel,
    KILLZONES,
  };
})();
