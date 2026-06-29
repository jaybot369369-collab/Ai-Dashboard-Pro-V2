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
        Scan last N=30 bars for the most recent UNFILLED gap.
        Ported from the LOCKED identifiers/fvg_setup.py (Jay-validated):
        • min gap = 0.05% of price (min_gap_pct=0.0005) — sub-threshold
          gaps are noise, skip them
        • quadrant grading: when price has retraced INTO the gap, a
          shallow retrace (Q1/Q2 — the half nearest b3) is A-grade
          (strength ×1.25); a deep retrace (Q3/Q4 — nearest b1) is
          B-grade (×0.75). Full close-through = inversion (handled as
          "filled" here). */
  const FVG_MIN_GAP_PCT = 0.0005;
  function detectFVG(klines, lookback = 30) {
    if (klines.length < 6) return _miss('not enough bars');
    const last = klines.length - 1;
    const start = Math.max(2, klines.length - lookback);
    const curC = klines[last].c;
    for (let i = last; i >= start; i--) {
      const a = klines[i - 2], c = klines[i];
      // Bullish FVG: a.high < c.low → gap between
      if (a.h < c.l) {
        const gapTop = c.l, gapBot = a.h;
        const size = (gapTop - gapBot) / klines[i].c;
        if (size < FVG_MIN_GAP_PCT) continue;
        // unfilled if no subsequent bar closed below gapBot wickwise
        let filled = false;
        for (let j = i + 1; j <= last; j++) {
          if (klines[j].l <= gapBot) { filled = true; break; }
        }
        if (!filled) {
          const age = last - i;
          const vm = volMult(klines, i);
          let strength = Math.min(1, size * 200) * (1 - age / lookback) * vm;
          let grade = '';
          if (curC >= gapBot && curC <= gapTop) {
            // retraced into the gap — Q1/Q2 = upper half (nearest b3)
            const pos = (curC - gapBot) / (gapTop - gapBot);
            const isA = pos >= 0.5;
            strength = Math.min(1, strength * (isA ? 1.25 : 0.75));
            grade = isA ? ' · in-gap Q1/Q2 (A)' : ' · in-gap Q3/Q4 (B)';
          }
          return {
            fired: true, dir: 'bull', strength,
            evidence: `Bull FVG ${age}b ago, gap ${(size*100).toFixed(2)}%${grade} · vol ${vm.toFixed(2)}×`
          };
        }
      }
      // Bearish FVG
      if (a.l > c.h) {
        const gapTop = a.l, gapBot = c.h;
        const size = (gapTop - gapBot) / klines[i].c;
        if (size < FVG_MIN_GAP_PCT) continue;
        let filled = false;
        for (let j = i + 1; j <= last; j++) {
          if (klines[j].h >= gapTop) { filled = true; break; }
        }
        if (!filled) {
          const age = last - i;
          const vm = volMult(klines, i);
          let strength = Math.min(1, size * 200) * (1 - age / lookback) * vm;
          let grade = '';
          if (curC >= gapBot && curC <= gapTop) {
            // retraced into the gap — Q1/Q2 = LOWER half for a bear FVG
            const pos = (curC - gapBot) / (gapTop - gapBot);
            const isA = pos <= 0.5;
            strength = Math.min(1, strength * (isA ? 1.25 : 0.75));
            grade = isA ? ' · in-gap Q1/Q2 (A)' : ' · in-gap Q3/Q4 (B)';
          }
          return {
            fired: true, dir: 'bear', strength,
            evidence: `Bear FVG ${age}b ago, gap ${(size*100).toFixed(2)}%${grade} · vol ${vm.toFixed(2)}×`
          };
        }
      }
    }
    return _miss('no unfilled FVG ≥0.05% in window');
  }

  /* ── Order Block: last opposing candle before a displacement leg.
        Bull OB = down candle before a strong up move.
        Ported from the LOCKED identifiers/order_block.py (Jay-validated,
        67.4% WR / PF 2.14 backtest):
        • displacement must be ≥ 1×ATR AND ≥ 2× the OB candle body
          (Python: min_disp_mult=2.0 — body-relative, not ATR-only)
        • premium/discount filter: a bull OB only counts if its body sits
          in the DISCOUNT half of the 30-bar dealing range around it; a
          bear OB only in the PREMIUM half. "Premium OBs are profit-taking
          levels, not entries" (2024 dealing-range mentorship). */
  function detectOB(klines, lookback = 40, rangeWindow = 30) {
    const a = atr(klines, 14);
    if (!a) return _miss('ATR warmup');
    const last = klines.length - 1;
    const start = Math.max(2, klines.length - lookback);
    for (let i = last - 1; i >= start; i--) {
      const k = klines[i];
      const isDown = k.c < k.o;
      const isUp = k.c > k.o;
      const bodyH = Math.abs(k.c - k.o);
      if (bodyH <= 0) continue;
      // Look at next 2 bars displacement
      const dispEnd = Math.min(last, i + 2);
      const dispMove = klines[dispEnd].c - k.c;
      const dispAbs = Math.abs(dispMove);
      if (dispAbs < a * 1.0) continue;            // energetic vs noise (ATR)
      if (dispAbs < bodyH * 2.0) continue;        // ≥2× OB body (locked param)
      // Dealing range around the OB candle (30 bars ending at i)
      const rngStart = Math.max(0, i - rangeWindow + 1);
      let rngHi = -Infinity, rngLo = Infinity;
      for (let j = rngStart; j <= i; j++) {
        if (klines[j].h > rngHi) rngHi = klines[j].h;
        if (klines[j].l < rngLo) rngLo = klines[j].l;
      }
      const rngEq = (rngHi + rngLo) / 2;
      const bodyHi = Math.max(k.o, k.c);
      const bodyLo = Math.min(k.o, k.c);
      if (isDown && dispMove > 0) {
        // Bull OB: entry edge (body high) must sit in the discount half
        if (bodyHi > rngEq) continue;             // premium bull OB — skip
        // Unmitigated if price hasn't traded back below k.l
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
            evidence: `Bull OB ${age}b ago @ ${k.l.toFixed(4)}–${k.h.toFixed(4)}, ` +
              `${(dispAbs/a).toFixed(1)}×ATR ${(dispAbs/bodyH).toFixed(1)}×body, ` +
              `discount half · vol ${vm.toFixed(2)}×`
          };
        }
      }
      if (isUp && dispMove < 0) {
        // Bear OB: entry edge (body low) must sit in the premium half
        if (bodyLo < rngEq) continue;             // discount bear OB — skip
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
            evidence: `Bear OB ${age}b ago @ ${k.l.toFixed(4)}–${k.h.toFixed(4)}, ` +
              `${(dispAbs/a).toFixed(1)}×ATR ${(dispAbs/bodyH).toFixed(1)}×body, ` +
              `premium half · vol ${vm.toFixed(2)}×`
          };
        }
      }
    }
    return _miss('no unmitigated OB in valid range half');
  }

  /* ── Sweep: wick beyond last swing high/low + close back inside
        Looks at last 3 bars vs prior 20-bar swing extreme.
        Liquidity-pool upgrade from the LOCKED identifiers/liquidity.py:
        equal highs/lows (≥2 touches within 0.1%) form a BSL/SSL pool —
        sweeping a POOL is a stronger signal than a single extreme
        (×1.25 strength bonus, capped at 1). */
  const POOL_TOL_PCT = 0.001;   // 0.1% equal-extreme cluster tolerance
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
        const touches = window.filter(b => Math.abs(b.h - swingHigh) / swingHigh <= POOL_TOL_PCT).length;
        const poolMult = touches >= 2 ? 1.25 : 1.0;
        const strength = Math.min(1, Math.min(1, wick * 200) * vm * poolMult);
        const poolTag = touches >= 2 ? ` BSL pool (${touches} touches)` : '';
        return {
          fired: true, dir: 'bear', strength,
          evidence: `Swept ${swingLen}b high${poolTag} @ ${swingHigh.toFixed(4)} ${off}b ago, closed back below · vol ${vm.toFixed(2)}×`
        };
      }
      if (k.l < swingLow && k.c > swingLow) {
        const wick = (Math.min(k.o, k.c) - k.l) / k.c;
        const vm = volMult(klines, i);
        const touches = window.filter(b => Math.abs(b.l - swingLow) / swingLow <= POOL_TOL_PCT).length;
        const poolMult = touches >= 2 ? 1.25 : 1.0;
        const strength = Math.min(1, Math.min(1, wick * 200) * vm * poolMult);
        const poolTag = touches >= 2 ? ` SSL pool (${touches} touches)` : '';
        return {
          fired: true, dir: 'bull', strength,
          evidence: `Swept ${swingLen}b low${poolTag} @ ${swingLow.toFixed(4)} ${off}b ago, closed back above · vol ${vm.toFixed(2)}×`
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

  /* ── NY-local wall clock (DST-aware) ──────────────────────
     ICT defines killzones in New York time, not UTC — fixed-UTC
     windows drift an hour across EST/EDT. Uses the Intl timezone
     database; falls back to the US DST rule (2nd Sun Mar → 1st Sun
     Nov = UTC-4, else UTC-5) if Intl is unavailable. */
  function nyHour(now = new Date()) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', hour12: false,
        hour: 'numeric', minute: 'numeric',
      }).formatToParts(now);
      const h = parseInt(parts.find(p => p.type === 'hour').value, 10) % 24;
      const m = parseInt(parts.find(p => p.type === 'minute').value, 10);
      return h + m / 60;
    } catch (e) {
      const y = now.getUTCFullYear();
      // 2nd Sunday of March, 1st Sunday of November (UTC approximations)
      const mar = new Date(Date.UTC(y, 2, 1));
      const dstStart = Date.UTC(y, 2, 14 - ((mar.getUTCDay() + 6) % 7), 7);
      const nov = new Date(Date.UTC(y, 10, 1));
      const dstEnd = Date.UTC(y, 10, 7 - ((nov.getUTCDay() + 6) % 7), 6);
      const offset = (now.getTime() >= dstStart && now.getTime() < dstEnd) ? -4 : -5;
      return (((now.getUTCHours() + now.getUTCMinutes() / 60) + offset) + 24) % 24;
    }
  }

  /* ── Killzones — NY-local hours, ported from the LOCKED Python
     identifiers (single source of truth for window times):
       London 02–05, NY AM 07–10   → identifiers/killzones.py
       NY PM 14–15 (SB window)     → identifiers/silver_bullet.py
       Asia 20–02 (accumulation)   → identifiers/power_of_3.py     */
  const KILLZONES = [
    { name: 'Asia',    startNY: 20, endNY:  2 },
    { name: 'London',  startNY:  2, endNY:  5 },
    { name: 'NY AM',   startNY:  7, endNY: 10 },
    { name: 'NY PM',   startNY: 14, endNY: 15 },
  ];

  function activeKillzone(now = new Date()) {
    const h = nyHour(now);
    for (const kz of KILLZONES) {
      if (kz.startNY <= kz.endNY) {
        if (h >= kz.startNY && h < kz.endNY) return kz.name;
      } else {
        if (h >= kz.startNY || h < kz.endNY) return kz.name;
      }
    }
    return null;
  }

  function isKillzoneActive() { return activeKillzone() !== null; }

  /* ── AMD / Power of 3 — live intraday port of the LOCKED
        identifiers/power_of_3.py classify_amd (Jay-approved; the
        AMD-alignment filter is what made SMR pass Phase 4d):
          Accumulation  = Asia 20:00 prev-day → 02:00 NY
          Manipulation  = 02:00 → 10:00 NY (sweeps the accum range)
          Distribution  = 10:00 → 16:00 NY (opposite direction)
        bull_amd: manipulation swept the accumulation LOW and price
        reclaimed it → expect bullish distribution. bear_amd mirrored.
        two_sided / no_sweep / trending → no direction (miss). */
  function nyParts(date) {
    try {
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York', hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: 'numeric', minute: 'numeric',
      });
      const p = {};
      for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
      return {
        h: (parseInt(p.hour, 10) % 24) + parseInt(p.minute, 10) / 60,
        dayKey: `${p.year}-${p.month}-${p.day}`,
      };
    } catch (e) {
      const h = nyHour(date);
      // fallback: derive the NY date by shifting UTC by the DST-rule offset
      const y = date.getUTCFullYear();
      const mar = new Date(Date.UTC(y, 2, 1));
      const dstStart = Date.UTC(y, 2, 14 - ((mar.getUTCDay() + 6) % 7), 7);
      const nov = new Date(Date.UTC(y, 10, 1));
      const dstEnd = Date.UTC(y, 10, 7 - ((nov.getUTCDay() + 6) % 7), 6);
      const off = (date.getTime() >= dstStart && date.getTime() < dstEnd) ? -4 : -5;
      const d = new Date(date.getTime() + off * 3600_000);
      return { h, dayKey: d.toISOString().slice(0, 10) };
    }
  }

  function detectAMD(klines, now = null) {
    if (!klines || klines.length < 30) return _miss('not enough bars for AMD');
    const last = klines[klines.length - 1];
    if (!Number.isFinite(last.t)) return _miss('klines carry no timestamps');
    const lastParts = nyParts(new Date(last.t));
    const today = lastParts.dayKey;
    const prevDay = new Date(Date.parse(today + 'T00:00:00Z') - 86400_000)
      .toISOString().slice(0, 10);
    if (lastParts.h < 2) return _miss('AMD: accumulation still forming (pre-02:00 NY)');

    let accHi = -Infinity, accLo = Infinity, nAcc = 0;
    let sweptHigh = false, sweptLow = false, nManip = 0;
    for (const k of klines) {
      const p = nyParts(new Date(k.t));
      const inAcc = (p.dayKey === prevDay && p.h >= 20) || (p.dayKey === today && p.h < 2);
      if (inAcc) {
        if (k.h > accHi) accHi = k.h;
        if (k.l < accLo) accLo = k.l;
        nAcc++;
      }
    }
    if (!nAcc || !Number.isFinite(accHi)) return _miss('AMD: no Asia accumulation bars in window');
    for (const k of klines) {
      const p = nyParts(new Date(k.t));
      if (p.dayKey === today && p.h >= 2 && p.h < 10) {
        if (k.h > accHi) sweptHigh = true;
        if (k.l < accLo) sweptLow = true;
        nManip++;
      }
    }
    if (!nManip) return _miss('AMD: manipulation phase not started');
    const accMid = (accHi + accLo) / 2;
    const c = last.c;
    if (sweptHigh && sweptLow) return _miss('AMD: two-sided (both accum edges swept)');
    if (!sweptHigh && !sweptLow) {
      return lastParts.h >= 10
        ? _miss('AMD: no_sweep (accum range held through manipulation)')
        : _miss('AMD: manipulation pending — no sweep yet');
    }
    if (sweptLow) {
      if (c <= accLo) return _miss('AMD: swept low, no reclaim — trending, not bull_amd');
      const strength = Math.min(1, 0.6 + (c > accMid ? 0.4 : 0));
      return {
        fired: true, dir: 'bull', strength,
        evidence: `bull_amd: manip swept Asia low ${accLo.toFixed(4)}, reclaimed ` +
          `(now ${c > accMid ? 'above' : 'below'} accum mid)`
      };
    }
    if (c >= accHi) return _miss('AMD: swept high, no rejection — trending, not bear_amd');
    const strength = Math.min(1, 0.6 + (c < accMid ? 0.4 : 0));
    return {
      fired: true, dir: 'bear', strength,
      evidence: `bear_amd: manip swept Asia high ${accHi.toFixed(4)}, rejected ` +
        `(now ${c < accMid ? 'below' : 'above'} accum mid)`
    };
  }

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

  /* ── RSI (Wilder smoothing) ───────────────────────────── */
  function rsi(closes, n = 14) {
    if (!closes || closes.length < n + 1) return null;
    let gains = 0, losses = 0;
    for (let i = 1; i <= n; i++) {
      const d = closes[i] - closes[i - 1];
      if (d > 0) gains += d; else losses -= d;
    }
    let ag = gains / n, al = losses / n;
    for (let i = n + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      ag = (ag * (n - 1) + Math.max(0, d)) / n;
      al = (al * (n - 1) + Math.max(0, -d)) / n;
    }
    return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }

  /* ── helper ───────────────────────────────────────────── */
  function _miss(reason) { return { fired: false, dir: null, strength: 0, evidence: reason }; }

  return {
    sma, ema, emaSeries, atr, adx, volMult, rsi,
    detectBias, detectADXGate,
    detectFVG, detectOB, detectSweep, detectCISD, detectBOS, detectAMD,
    activeKillzone, isKillzoneActive, nearLevel, nyHour,
    KILLZONES,
  };
})();
