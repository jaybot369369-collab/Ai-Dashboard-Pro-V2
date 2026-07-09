/* ═══════════════════════════════════════════════════════════
   TRADE RECONSTRUCT — raw exchange fills → round-trip trades
   Input: normalized fills from the local trade-sync shim
     { market:'spot'|'fut', symbol, ts, side:'BUY'|'SELL',
       price, qty, quoteQty, fee, feeAsset,
       realizedPnl? (fut only), orderId, id }
   Output: { trades:[...], orphans:[...] }
     Each trade maps 1:1 onto the dashboard trade-object schema
     (date/time/entry/exitPrice/result/size/session/...), plus
     importKey for idempotent re-imports.

   Rules:
   - spot: long-only running position per symbol. A round-trip is
     position 0 → accumulating BUYs → SELLs back to ≤ dust.
     SELLs with no tracked position are "orphans" (pre-existing
     holdings sold) — surfaced, never silently imported.
   - fut: signed position, long and short both; a fill that flips
     the sign is split into (close old trip, open new trip).
     P&L uses the exchange's own realizedPnl (exact, fee-exclusive)
     minus USDT-denominated fees.
   - Dual export (window.TradeReconstruct + CommonJS) so the same
     math is unit-testable in Node — mirrors the ICT engine pattern.
════════════════════════════════════════════════════════════ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TradeReconstruct = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  const QUOTES = ['USDT', 'USDC', 'BUSD', 'USD'];
  const DUST_FRAC = 0.005;   // ≤0.5% of peak position ≈ closed (base-asset fees leave dust)

  function quoteOf(symbol) {
    for (const q of QUOTES) if (symbol.endsWith(q)) return q;
    return '';
  }

  function sessionFor(tsMs) {
    const h = new Date(tsMs).getUTCHours();
    if (h >= 7 && h < 12) return 'London';
    if (h >= 12 && h < 21) return 'NY';
    return 'Asian';
  }

  function fmtPx(v) {
    if (!isFinite(v) || v === 0) return '';
    // enough precision to round-trip sub-cent prices, no float noise
    return String(+v.toPrecision(8));
  }

  const dateStr = ts => new Date(ts).toISOString().slice(0, 10);
  const timeStr = ts => new Date(ts).toISOString().slice(11, 16);

  /* fee in quote terms (approx for base-asset fees; BNB fees can't be
     converted without a price feed — counted separately as feeUnknown) */
  function feeQuote(f, quote) {
    if (f.feeAsset === quote) return f.fee;
    if (f.symbol.startsWith(f.feeAsset)) return f.fee * f.price; // base-asset fee
    return null; // BNB or other — unknown
  }

  function buildTrade(market, symbol, legs, closed) {
    const entries = legs.filter(l => l.kind === 'entry');
    const exits   = legs.filter(l => l.kind === 'exit');
    const eQty = entries.reduce((s, l) => s + l.qty, 0);
    const xQty = exits.reduce((s, l) => s + l.qty, 0);
    const eAvg = eQty ? entries.reduce((s, l) => s + l.price * l.qty, 0) / eQty : 0;
    const xAvg = xQty ? exits.reduce((s, l) => s + l.price * l.qty, 0) / xQty : 0;
    const quote = quoteOf(symbol);
    const dir = legs[0].dir;

    let fees = 0, feeUnknown = false;
    let pnl = null;
    if (market === 'fut') {
      pnl = legs.reduce((s, l) => s + (l.realizedPnl || 0), 0);
      for (const l of legs) {
        const fq = feeQuote(l.fill, quote);
        if (fq === null) feeUnknown = true; else fees += fq;
      }
      pnl -= fees;
    } else if (closed && eQty > 0) {
      const matched = Math.min(eQty, xQty);
      pnl = (xAvg - eAvg) * matched;
      for (const l of legs) {
        const fq = feeQuote(l.fill, quote);
        if (fq === null) feeUnknown = true; else fees += fq;
      }
      pnl -= fees;
    }

    const t0 = legs[0].ts, t1 = legs[legs.length - 1].ts;
    const firstId = legs[0].fill.id, lastId = legs[legs.length - 1].fill.id;
    const dispSymbol = market === 'fut' ? symbol + '.P' : symbol;

    return {
      importKey: `${market}:${symbol}:${firstId}:${lastId}`,
      source: 'binance_api',
      symbol: dispSymbol,
      direction: dir,
      entry: fmtPx(eAvg),
      exitPrice: closed ? fmtPx(xAvg) : '',
      sl: '', tp: '',
      size: (eAvg * eQty).toFixed(2),
      result: closed && pnl !== null ? String(+pnl.toFixed(2)) : '',
      rMultiple: '',
      date: dateStr(t0),
      time: timeStr(t0),
      dateEnd: closed && dateStr(t1) !== dateStr(t0) ? dateStr(t1) : '',
      session: sessionFor(t0),
      open: !closed,
      fillsCount: legs.length,
      feeNote: feeUnknown ? 'some fees paid in BNB — not included in P&L' : '',
      notes: `Imported from Binance ${market === 'fut' ? 'futures' : 'spot'} — ${legs.length} fills`
        + (feeUnknown ? ' (BNB fees excluded from P&L)' : ` (fees $${fees.toFixed(2)} included)`),
    };
  }

  function reconstructSpot(symbol, fills) {
    const trades = [], orphans = [];
    let legs = [], pos = 0, peak = 0;
    for (const f of fills) {
      if (f.side === 'BUY') {
        legs.push({ kind: 'entry', dir: 'Long', qty: f.qty, price: f.price, ts: f.ts, fill: f });
        pos += f.qty; peak = Math.max(peak, pos);
      } else {
        if (pos <= 0) { orphans.push(f); continue; }
        const q = Math.min(f.qty, pos);
        legs.push({ kind: 'exit', dir: 'Long', qty: q, price: f.price, ts: f.ts, fill: f });
        pos -= q;
        if (f.qty > q + 1e-12) orphans.push({ ...f, qty: +(f.qty - q).toFixed(12), partial: true });
        if (pos <= peak * DUST_FRAC) {
          trades.push(buildTrade('spot', symbol, legs, true));
          legs = []; pos = 0; peak = 0;
        }
      }
    }
    if (legs.length) trades.push(buildTrade('spot', symbol, legs, false));
    return { trades, orphans };
  }

  function reconstructFut(symbol, fills) {
    const trades = [];
    let legs = [], pos = 0;
    const dirOf = p => (p > 0 ? 'Long' : 'Short');
    for (const f of fills) {
      let qty = f.qty * (f.side === 'BUY' ? 1 : -1);
      while (Math.abs(qty) > 1e-12) {
        if (pos === 0) {
          // opening a fresh trip
          const use = qty;
          legs.push({ kind: 'entry', dir: dirOf(use), qty: Math.abs(use), price: f.price, ts: f.ts, fill: f, realizedPnl: f.realizedPnl });
          pos += use; qty = 0;
        } else if (Math.sign(qty) === Math.sign(pos)) {
          // adding to the trip
          legs.push({ kind: 'entry', dir: dirOf(pos), qty: Math.abs(qty), price: f.price, ts: f.ts, fill: f, realizedPnl: f.realizedPnl });
          pos += qty; qty = 0;
        } else {
          // reducing / closing (maybe flipping)
          const closeQty = Math.min(Math.abs(qty), Math.abs(pos));
          legs.push({ kind: 'exit', dir: dirOf(pos), qty: closeQty, price: f.price, ts: f.ts, fill: f, realizedPnl: f.realizedPnl });
          pos += Math.sign(qty) * closeQty;
          qty -= Math.sign(qty) * closeQty;
          if (Math.abs(pos) < 1e-12) {
            trades.push(buildTrade('fut', symbol, legs, true));
            legs = []; pos = 0;
          }
        }
      }
    }
    if (legs.length) trades.push(buildTrade('fut', symbol, legs, false));
    return { trades, orphans: [] };
  }

  function reconstruct(fills) {
    const groups = {};
    for (const f of fills || []) {
      const k = `${f.market}:${f.symbol}`;
      (groups[k] = groups[k] || []).push(f);
    }
    const trades = [], orphans = [];
    for (const k of Object.keys(groups).sort()) {
      const rows = groups[k].sort((a, b) => a.ts - b.ts || String(a.id).localeCompare(String(b.id)));
      const [market, symbol] = k.split(':');
      const r = market === 'fut' ? reconstructFut(symbol, rows) : reconstructSpot(symbol, rows);
      trades.push(...r.trades);
      orphans.push(...r.orphans);
    }
    trades.sort((a, b) => (a.date + (a.time || '')) < (b.date + (b.time || '')) ? 1 : -1);
    return { trades, orphans };
  }

  return { reconstruct, sessionFor, quoteOf };
}));
