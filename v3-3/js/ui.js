/* ═══════════════════════════════════════════════════════════
   UI — small shared bits every page uses.
   Formatting, escaping, charts, toasts. No page logic in here.
════════════════════════════════════════════════════════════ */
const UI = (() => {
  'use strict';

  const $  = id => document.getElementById(id);
  const $$ = sel => [...document.querySelectorAll(sel)];

  /** True only if `id` is still the page on screen.
      Pages that fetch anything must check this before they paint, or a slow
      reply lands on top of whatever Jay opened next. That is how the Context
      page ended up under the Trade Log heading, and Radar over Context. */
  const stillOn = id =>
    typeof App !== 'undefined' && App.currentPage ? App.currentPage() === id : true;

  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const money = n => (n < 0 ? '−$' : '$') +
    Math.abs(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const signed = n => ((Number(n) || 0) >= 0 ? '+$' : '−$') +
    Math.abs(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const pct = n => (Number(n) || 0).toFixed(1) + '%';

  const price = n => {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return '$' + v.toLocaleString('en-US', { maximumFractionDigits: v < 1 ? 5 : v < 100 ? 4 : 2 });
  };

  function dateLong(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T12:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString('en-GB',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  function dateShort(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T12:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
  }
  function ago(iso) {
    if (!iso) return 'never';
    const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' minutes ago';
    const h = Math.floor(mins / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    const d = Math.floor(h / 24);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }

  /* ── Toast ────────────────────────────────────────── */
  let toastT = null;
  function toast(msg, kind) {
    let el = $('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.className = 'toast show ' + (kind || '');
    el.textContent = msg;
    clearTimeout(toastT);
    toastT = setTimeout(() => { el.className = 'toast'; }, 2600);
  }

  function confirmBox(msg) { return window.confirm(msg); }

  /* ── Canvas charts (no libraries) ─────────────────── */
  function cssVar(name, fb) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fb;
  }

  function prep(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    const w = r.width || canvas.parentElement.clientWidth || 600;
    const h = r.height || 220;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  /** Balance over time. */
  function lineChart(canvas, points, opts) {
    if (!canvas || !points || points.length < 2) {
      if (canvas) { const { ctx, w, h } = prep(canvas);
        ctx.fillStyle = cssVar('--text-3', '#888'); ctx.font = '13px system-ui';
        ctx.textAlign = 'center'; ctx.fillText('Not enough finished trades to draw a line yet', w / 2, h / 2); }
      return;
    }
    const o = opts || {};
    const { ctx, w, h } = prep(canvas);
    const padL = 58, padR = 12, padT = 12, padB = 26;
    const vals = points.map(p => p.y);
    let min = Math.min(...vals), max = Math.max(...vals);
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    min -= span * 0.08; max += span * 0.08;
    const X = i => padL + (i / (points.length - 1)) * (w - padL - padR);
    const Y = v => padT + (1 - (v - min) / (max - min)) * (h - padT - padB);

    const line = o.color || cssVar('--accent', '#2563eb');
    const grid = cssVar('--line', '#ddd');
    const dim  = cssVar('--text-3', '#888');

    // grid + labels
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    ctx.fillStyle = dim; ctx.font = '11px ui-monospace,monospace'; ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const v = min + (max - min) * (i / 4);
      const y = Math.round(Y(v)) + .5;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillText('$' + Math.round(v).toLocaleString(), padL - 8, y + 4);
    }

    // fill
    const g = ctx.createLinearGradient(0, padT, 0, h - padB);
    g.addColorStop(0, line + '44'); g.addColorStop(1, line + '00');
    ctx.beginPath(); ctx.moveTo(X(0), Y(points[0].y));
    points.forEach((p, i) => ctx.lineTo(X(i), Y(p.y)));
    ctx.lineTo(X(points.length - 1), h - padB); ctx.lineTo(X(0), h - padB); ctx.closePath();
    ctx.fillStyle = g; ctx.fill();

    // line
    ctx.beginPath(); ctx.moveTo(X(0), Y(points[0].y));
    points.forEach((p, i) => ctx.lineTo(X(i), Y(p.y)));
    ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();

    // start / end labels
    ctx.fillStyle = dim; ctx.font = '11px system-ui';
    ctx.textAlign = 'left';  ctx.fillText(points[0].label || '', padL, h - 8);
    ctx.textAlign = 'right'; ctx.fillText(points[points.length - 1].label || '', w - padR, h - 8);
  }

  /** Money by category. */
  function barChart(canvas, items) {
    if (!canvas) return;
    const { ctx, w, h } = prep(canvas);
    if (!items.length) return;
    const padL = 4, padB = 40, padT = 8;
    const max = Math.max(...items.map(i => Math.abs(i.value)), 1);
    const bw = (w - padL) / items.length;
    const zero = padT + (h - padT - padB) / 2;
    const good = cssVar('--good', '#0a0'), bad = cssVar('--bad', '#c00'), dim = cssVar('--text-3', '#888');

    ctx.strokeStyle = cssVar('--line', '#ddd');
    ctx.beginPath(); ctx.moveTo(0, zero + .5); ctx.lineTo(w, zero + .5); ctx.stroke();

    items.forEach((it, i) => {
      const bh = (Math.abs(it.value) / max) * ((h - padT - padB) / 2);
      const x = padL + i * bw + bw * 0.18;
      const bwid = bw * 0.64;
      ctx.fillStyle = it.value >= 0 ? good : bad;
      if (it.value >= 0) ctx.fillRect(x, zero - bh, bwid, bh);
      else ctx.fillRect(x, zero, bwid, bh);

      ctx.save();
      ctx.translate(x + bwid / 2, h - padB + 12);
      ctx.rotate(-Math.PI / 5);
      ctx.fillStyle = dim; ctx.font = '10px system-ui'; ctx.textAlign = 'right';
      ctx.fillText(String(it.label).slice(0, 22), 0, 0);
      ctx.restore();
    });
  }

  /** Spider / radar chart for the RSI page. */
  function spiderChart(canvas, axes, series) {
    if (!canvas) return;
    const { ctx, w, h } = prep(canvas);
    const cx = w / 2, cy = h / 2 + 6, R = Math.min(w, h) / 2 - 42;
    const n = axes.length;
    if (!n) return;
    const grid = cssVar('--line', '#ddd'), dim = cssVar('--text-3', '#888');

    // rings at 0/30/50/70/100
    [0, 30, 50, 70, 100].forEach(level => {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n - Math.PI / 2;
        const r = (level / 100) * R;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = (level === 30 || level === 70) ? cssVar('--warn', '#a80') + '77' : grid;
      ctx.lineWidth = (level === 30 || level === 70) ? 1.4 : 1;
      ctx.stroke();
    });

    // spokes + labels
    ctx.fillStyle = dim; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n - Math.PI / 2;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.stroke();
      const lx = cx + Math.cos(a) * (R + 20), ly = cy + Math.sin(a) * (R + 20);
      ctx.fillText(axes[i], lx, ly + 4);
    }

    series.forEach(s => {
      ctx.beginPath();
      s.values.forEach((v, i) => {
        const a = (Math.PI * 2 * i) / n - Math.PI / 2;
        const r = (Math.max(0, Math.min(100, v)) / 100) * R;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = s.color + '2e'; ctx.fill();
      ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.stroke();
      s.values.forEach((v, i) => {
        const a = (Math.PI * 2 * i) / n - Math.PI / 2;
        const r = (Math.max(0, Math.min(100, v)) / 100) * R;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3, 0, Math.PI * 2);
        ctx.fillStyle = s.color; ctx.fill();
      });
    });
  }

  /* ── Live prices, with the same fallback the bots use ── */
  async function livePrices(symbols) {
    const out = {};
    await Promise.all(symbols.map(async sym => {
      const pair = sym.replace('/', '').toUpperCase();
      try {
        const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`);
        if (r.ok) {
          const j = await r.json();
          out[sym] = { price: +j.lastPrice, change: +j.priceChangePercent, from: 'Binance' };
          return;
        }
      } catch {}
      try {
        const r = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${pair}`);
        if (r.ok) {
          const j = await r.json();
          const row = j.result?.list?.[0];
          if (row) { out[sym] = { price: +row.lastPrice, change: +row.price24hPcnt * 100, from: 'Bybit' }; return; }
        }
      } catch {}
      out[sym] = null;
    }));
    return out;
  }

  async function klines(symbol, interval, limit) {
    const pair = symbol.replace('/', '').toUpperCase();
    const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit || 200}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Could not get price history for ' + symbol);
    return (await r.json()).map(k => ({
      time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
    }));
  }

  /** Standard 14-period RSI. */
  function rsi(closes, period) {
    const p = period || 14;
    if (closes.length < p + 1) return null;
    let gain = 0, loss = 0;
    for (let i = 1; i <= p; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    let ag = gain / p, al = loss / p;
    for (let i = p + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      ag = (ag * (p - 1) + (d > 0 ? d : 0)) / p;
      al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
    }
    if (al === 0) return 100;
    return 100 - 100 / (1 + ag / al);
  }

  return {
    $, $$, stillOn, esc, money, signed, pct, price,
    dateLong, dateShort, ago, toast, confirmBox, cssVar,
    lineChart, barChart, spiderChart, livePrices, klines, rsi,
  };
})();
