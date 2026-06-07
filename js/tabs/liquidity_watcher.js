/* ═══════════════════════════════════════════════════════════
   LIQUIDITY WATCHER TAB  v4 — enhanced KPI + full data table
   Fetches live scores from localhost:8766/api/scores and
   renders a native card + table UI (no iframe).
   Full standalone dashboard still reachable via ↗ Pop out.
════════════════════════════════════════════════════════════ */
const LiquidityWatcherTab = (() => {

  const _lwIsLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  // On Railway / any non-localhost host: ALWAYS use same-origin /lw and
  // ignore any stale lw_remote_url override that would break this.
  const API = _lwIsLocal
    ? (localStorage.getItem('lw_remote_url') || 'http://127.0.0.1:8766')
    : (window.location.origin + '/lw');
  const TFS = ['15m', '4h', 'D', 'W'];
  let _activeTf = 'D';
  let _refreshTimer = null;
  let _lastScores = null;
  let _liqAsset    = null;   // selected ticker for the Top Liquidation Levels panel
  let _liqWindow   = localStorage.getItem('lw_liq_window_v2') || '30d';
  let _liqKlines   = null;
  let _liqKlinesKey = null;
  let _liqData     = null;
  let _liqInFlight = false;

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function _isActiveTab() {
    return document.querySelector('.nav-item.active')?.dataset.tab === 'liquidity';
  }

  async function _fetchHealth() {
    try {
      const r = await fetch(`${API}/api/health`, {
        mode: 'cors', cache: 'no-store',
        signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined,
      });
      return r.ok ? r.json() : null;
    } catch { return null; }
  }

  async function _fetchScores(tf) {
    try {
      const r = await fetch(`${API}/api/scores?tf=${tf}`, {
        mode: 'cors', cache: 'no-store',
        signal: AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined,
      });
      return r.ok ? r.json() : null;
    } catch { return null; }
  }

  /* ── Priority derived from score (lower = more stretched = higher priority) */
  function _priority(score) {
    if (score === null || score === undefined) return { label: '—', cls: 'lw-badge-dim' };
    if (score < 40) return { label: 'HIGH', cls: 'lw-badge-high' };
    if (score < 65) return { label: 'MED',  cls: 'lw-badge-med'  };
    return            { label: 'LOW',  cls: 'lw-badge-low'  };
  }

  function _biasChip(bias) {
    const map = {
      bull:    { label: 'Bullish',  cls: 'lw-chip-bull'    },
      bear:    { label: 'Bearish',  cls: 'lw-chip-bear'    },
      neutral: { label: 'Neutral',  cls: 'lw-chip-neutral' },
      choppy:  { label: 'Choppy',   cls: 'lw-chip-choppy'  },
    };
    const b = map[bias] || { label: bias || '—', cls: 'lw-chip-neutral' };
    return `<span class="lw-chip ${b.cls}">${b.label}</span>`;
  }

  function _statusBadge(warming, score) {
    if (warming) return `<span class="lw-badge lw-badge-dim">Warming</span>`;
    if (score === null || score === undefined) return `<span class="lw-badge lw-badge-dim">No data</span>`;
    return `<span class="lw-badge lw-badge-live">Live</span>`;
  }

  /* Top signal from components */
  function _topSignal(components) {
    if (!components) return '—';
    const entries = Object.values(components)
      .filter(c => c.implication && c.implication.tag)
      .sort((a, b) => Math.abs(b.z || 0) - Math.abs(a.z || 0));
    if (!entries.length) return '—';
    const imp = entries[0].implication;
    return esc(imp.tag);
  }

  /* Score bar HTML */
  function _scoreBar(score) {
    if (score === null || score === undefined) return `<span style="color:var(--muted)">—</span>`;
    const pct = Math.round(score);
    const color = score < 40 ? 'var(--red,#ef4444)' : score < 65 ? '#f59e0b' : '#22c55e';
    return `<div style="display:flex;align-items:center;gap:8px">
      <div style="flex:1;height:4px;background:var(--border);border-radius:4px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:4px;transition:width .4s"></div>
      </div>
      <span style="font-size:12px;font-weight:700;color:${color};width:28px;text-align:right">${pct}</span>
    </div>`;
  }

  /* ── Formatting helpers ── */

  function _fmtM(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n/1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n/1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n/1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  }

  /* ── Liq zones chart helpers ── */
  const _LIQ_WIN_CFG = {
    '7d':  { interval: '240', limit: 42,  okxBar: '4H'  },
    '14d': { interval: '240', limit: 84,  okxBar: '4H'  },
    '30d': { interval: 'D',   limit: 30,  okxBar: '1D'  },
  };

  async function _fetchKlinesLiq(asset, win) {
    const key = asset + '-' + win;
    if (_liqKlinesKey === key && _liqKlines) return _liqKlines;
    const cfg = _LIQ_WIN_CFG[win] || _LIQ_WIN_CFG['30d'];
    const sym = asset + 'USDT';
    try {
      const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}&interval=${cfg.interval}&limit=${cfg.limit}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const j = await r.json();
      if (j.result && j.result.list && j.result.list.length) {
        _liqKlines = j.result.list.reverse().map(c => ({ o:+c[1], h:+c[2], l:+c[3], c:+c[4] }));
        _liqKlinesKey = key;
        return _liqKlines;
      }
    } catch(e) {}
    try {
      const url = `https://www.okx.com/api/v5/market/candles?instId=${sym}-SWAP&bar=${cfg.okxBar}&limit=${cfg.limit}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const j = await r.json();
      if (j.data && j.data.length) {
        _liqKlines = j.data.reverse().map(c => ({ o:+c[1], h:+c[2], l:+c[3], c:+c[4] }));
        _liqKlinesKey = key;
        return _liqKlines;
      }
    } catch(e) {}
    return null;
  }

  function _heatRgba(t, alpha) {
    if (t < 0.12) return `rgba(70,10,120,${((0.35 + t * 3) * alpha).toFixed(2)})`;
    if (t < 0.28) return `rgba(0,90,180,${((0.50 + t * 1.5) * alpha).toFixed(2)})`;
    if (t < 0.48) return `rgba(0,190,200,${((0.60 + t) * alpha).toFixed(2)})`;
    if (t < 0.68) return `rgba(0,230,100,${((0.68 + t * 0.5) * alpha).toFixed(2)})`;
    if (t < 0.85) return `rgba(160,255,0,${((0.75 + t * 0.3) * alpha).toFixed(2)})`;
    return `rgba(255,245,0,${((0.85 + t * 0.15) * alpha).toFixed(2)})`;
  }

  function _fmtFunding(v) {
    if (v == null) return { txt: '—', color: 'var(--text-dim)', dir: '' };
    const pct = (v * 100).toFixed(4);
    const sign = v >= 0 ? '+' : '';
    const color = Math.abs(v) > 0.0003 ? (v > 0 ? '#ef4444' : '#22c55e') : 'var(--text-sub)';
    const dir = v > 0.00005 ? 'longs pay' : v < -0.00005 ? 'shorts pay' : 'neutral';
    return { txt: sign + pct + '%', color, dir };
  }

  function _fmtBasis(v) {
    if (v == null) return '<span style="color:var(--text-dim)">—</span>';
    const pct = (v * 100).toFixed(4);
    const sign = v >= 0 ? '+' : '';
    const color = Math.abs(v) < 0.0002 ? 'var(--text-dim)' : v > 0 ? '#22c55e' : '#ef4444';
    return `<span style="color:${color}">${sign}${pct}%</span>`;
  }

  function _fmtOIChange(v) {
    if (v == null) return '<span style="color:var(--text-dim)">—</span>';
    const pct = (v * 100).toFixed(2);
    const sign = v >= 0 ? '+' : '';
    const color = v > 0.001 ? '#22c55e' : v < -0.001 ? '#ef4444' : 'var(--text-dim)';
    return `<span style="color:${color}">${sign}${pct}%/h</span>`;
  }

  function _fmtDepth(v) {
    if (v == null) return '<span style="color:var(--text-dim)">—</span>';
    const abs = Math.abs(v);
    const formatted = abs >= 1e6 ? '$' + (abs/1e6).toFixed(1)+'M' : abs >= 1e3 ? '$'+(abs/1e3).toFixed(0)+'K' : '$'+Math.round(abs);
    if (v > 500000) return `<span style="color:#22c55e">Bid +${formatted}</span>`;
    if (v < -500000) return `<span style="color:#ef4444">Ask +${formatted}</span>`;
    return `<span style="color:var(--text-dim)">Balanced</span>`;
  }

  function _fmtLiq(v) {
    if (v == null) return '—';
    if (v >= 1e6) return '$' + (v/1e6).toFixed(1)+'M/hr';
    if (v >= 1e3) return '$' + (v/1e3).toFixed(0)+'K/hr';
    return '$' + Math.round(v)+'/hr';
  }

  /* ── KPI summary strip — 4 cards ── */
  function _kpiStrip(scores, sorted) {
    /* Most Stretched */
    const stretchedAsset = sorted[0];
    const stretchedScore = stretchedAsset ? scores[stretchedAsset].score : null;

    /* Highest OI */
    let oiAsset = null, oiMax = -Infinity;
    for (const a of sorted) {
      const oi = scores[a].meta && scores[a].meta.oi_usd;
      if (oi != null && oi > oiMax) { oiMax = oi; oiAsset = a; }
    }

    /* Extreme Funding */
    let fundAsset = null, fundMax = -Infinity, fundVal = null;
    for (const a of sorted) {
      const c = scores[a].components;
      const v = c && c.funding_extremity && c.funding_extremity.value;
      if (v != null && Math.abs(v) > fundMax) { fundMax = Math.abs(v); fundAsset = a; fundVal = v; }
    }

    /* Active Liquidations */
    let liqAsset = null, liqMax = -Infinity, liqVal = null;
    for (const a of sorted) {
      const c = scores[a].components;
      const v = c && c.liq_usd_per_hour && c.liq_usd_per_hour.value;
      if (v != null && v > liqMax) { liqMax = v; liqAsset = a; liqVal = v; }
    }

    const fundFmt = fundVal != null ? _fmtFunding(fundVal) : null;

    return `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
      <div class="card" style="padding:14px 16px">
        <div style="font-size:11px;color:var(--text-sub);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Most Stretched</div>
        <div style="font-size:22px;font-weight:700;color:${stretchedScore != null && stretchedScore < 40 ? '#ef4444' : stretchedScore != null && stretchedScore < 65 ? '#f59e0b' : '#22c55e'}">${stretchedScore != null ? Math.round(stretchedScore) : '—'}</div>
        <div style="font-size:12px;color:var(--text-sub);margin-top:2px">${stretchedAsset ? esc(stretchedAsset) + '/USDT' : '—'}</div>
      </div>
      <div class="card" style="padding:14px 16px">
        <div style="font-size:11px;color:var(--text-sub);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Highest OI</div>
        <div style="font-size:22px;font-weight:700;color:var(--text)">${oiAsset ? _fmtM(oiMax) : '—'}</div>
        <div style="font-size:12px;color:var(--text-sub);margin-top:2px">${oiAsset ? esc(oiAsset) + '/USDT' : '—'}</div>
      </div>
      <div class="card" style="padding:14px 16px">
        <div style="font-size:11px;color:var(--text-sub);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Extreme Funding</div>
        <div style="font-size:22px;font-weight:700;color:${fundFmt ? fundFmt.color : 'var(--text)'}">${fundFmt ? esc(fundFmt.txt) : '—'}</div>
        <div style="font-size:12px;color:var(--text-sub);margin-top:2px">${fundAsset ? esc(fundAsset) + ' · ' + esc(fundFmt ? fundFmt.dir : '') : '—'}</div>
      </div>
      <div class="card" style="padding:14px 16px">
        <div style="font-size:11px;color:var(--text-sub);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Active Liquidations</div>
        <div style="font-size:22px;font-weight:700;color:${liqVal != null && liqVal > 100000 ? '#ef4444' : 'var(--text)'}">${liqVal != null ? _fmtLiq(liqVal) : '—'}</div>
        <div style="font-size:12px;color:var(--text-sub);margin-top:2px">${liqAsset ? esc(liqAsset) + '/USDT' : '—'}</div>
      </div>
    </div>`;
  }

  /* ── Enhanced featured asset card (top 3 most stretched) ── */
  function _assetCard(asset, data) {
    const score = data.score;
    const bias  = data.bias || 'neutral';
    const warm  = data.warming;
    const prio  = _priority(score);
    const pct   = score !== null ? Math.round(score) : null;
    const dotCls = warm ? '' : 'live';
    const c     = data.components || {};
    const meta  = data.meta || {};

    const oiVal    = meta.oi_usd;
    const oiRoc    = c.oi_roc_1h && c.oi_roc_1h.value;
    const fundVal  = c.funding_extremity && c.funding_extremity.value;
    const liqVal   = c.liq_usd_per_hour && c.liq_usd_per_hour.value;
    const basisVal = c.basis && c.basis.value;
    const fundFmt  = _fmtFunding(fundVal);

    /* Top implication hint */
    const implEntries = Object.entries(c)
      .filter(([, cv]) => cv && cv.implication && cv.implication.hint)
      .sort(([, a], [, b]) => Math.abs(b.z || 0) - Math.abs(a.z || 0));
    const topImpl = implEntries.length ? implEntries[0][1].implication : null;

    const hintColor = topImpl
      ? (topImpl.kind === 'bear' ? '#ef4444' : topImpl.kind === 'bull' ? '#22c55e' : topImpl.kind === 'organic' ? '#22c55e' : '#f59e0b')
      : '';

    return `<div class="card lw-asset-card">
      <div class="lw-ac-head">
        <div class="lw-ac-sym">
          <div class="lw-ac-avatar">${esc(asset.slice(0,1))}</div>
          <div>
            <div class="lw-ac-name">${esc(asset)}/USDT</div>
            <div class="lw-ac-sub">${warm ? 'warming up' : pct !== null ? pct + ' / 100 calm score' : 'no data yet'}</div>
          </div>
        </div>
        <span class="lw-dot ${dotCls}" style="flex-shrink:0"></span>
      </div>
      <div style="margin:10px 0 8px">${_scoreBar(score)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        ${_biasChip(bias)}
        <span class="lw-badge ${prio.cls}" style="margin-left:auto">${prio.label}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;padding:10px;background:var(--bg,#f8f8f8);border-radius:8px;margin-bottom:${topImpl ? '10px' : '0'}">
        <div>
          <div style="font-size:10px;color:var(--text-sub);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">OI</div>
          <div style="font-size:13px;font-weight:600;color:var(--text)">${_fmtM(oiVal)}</div>
          <div style="font-size:11px;margin-top:1px">${_fmtOIChange(oiRoc)}</div>
        </div>
        <div>
          <div style="font-size:10px;color:var(--text-sub);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">Funding/8h</div>
          <div style="font-size:13px;font-weight:600;color:${fundFmt.color}">${esc(fundFmt.txt)}</div>
          <div style="font-size:11px;color:var(--text-sub);margin-top:1px">${esc(fundFmt.dir)}</div>
        </div>
        <div>
          <div style="font-size:10px;color:var(--text-sub);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">Liq/hr</div>
          <div style="font-size:13px;font-weight:600;color:var(--text)">${esc(_fmtLiq(liqVal))}</div>
          <div style="font-size:11px;margin-top:1px">${_fmtBasis(basisVal)}</div>
        </div>
      </div>
      ${topImpl ? `<div style="padding:8px 10px;border-radius:6px;border-left:3px solid ${hintColor};background:${hintColor}18;font-size:12px;color:var(--text)">
        <span style="font-weight:600;color:${hintColor}">${esc(topImpl.tag)}</span> — ${esc(topImpl.hint)}
      </div>` : ''}
    </div>`;
  }

  /* ── Full data table row ── */
  function _tableRow(asset, data) {
    const score   = data.score;
    const bias    = data.bias || 'neutral';
    const warm    = data.warming;
    const prio    = _priority(score);
    const c       = data.components || {};
    const meta    = data.meta || {};

    const oiVal    = meta.oi_usd;
    const oiRoc    = c.oi_roc_1h && c.oi_roc_1h.value;
    const fundVal  = c.funding_extremity && c.funding_extremity.value;
    const liqVal   = c.liq_usd_per_hour && c.liq_usd_per_hour.value;
    const basisVal = c.basis && c.basis.value;
    const depthVal = c.depth_delta && c.depth_delta.value;
    const fundFmt  = _fmtFunding(fundVal);

    /* Collect any implication hints for inline display */
    const hints = Object.entries(c)
      .filter(([, cv]) => cv && cv.implication && cv.implication.hint)
      .sort(([, a], [, b]) => Math.abs(b.z || 0) - Math.abs(a.z || 0));
    const topHint = hints.length ? hints[0][1].implication : null;
    const hintColor = topHint
      ? (topHint.kind === 'bear' ? '#ef4444' : topHint.kind === 'bull' ? '#22c55e' : topHint.kind === 'organic' ? '#22c55e' : '#f59e0b')
      : '';

    return `<tr class="lw-row">
      <td class="lw-td-asset">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="lw-ac-avatar lw-ac-avatar-sm">${esc(asset.slice(0,1))}</div>
          <div>
            <div style="font-weight:600;font-size:13px">${esc(asset)}/USDT</div>
            ${topHint ? `<div style="font-size:11px;color:${hintColor};margin-top:2px">${esc(topHint.tag)} — ${esc(topHint.hint)}</div>` : ''}
          </div>
          <button class="lw-remove-asset" data-asset="${esc(asset)}" title="Remove ${esc(asset)} from the watchlist">✕</button>
        </div>
      </td>
      <td class="lw-td-score">${_scoreBar(score)}</td>
      <td>${_biasChip(bias)}</td>
      <td style="font-size:12px;font-weight:600;color:var(--text)">${_fmtM(oiVal)}</td>
      <td style="font-size:12px">${_fmtOIChange(oiRoc)}</td>
      <td style="font-size:12px"><span style="font-weight:600;color:${fundFmt.color}">${esc(fundFmt.txt)}</span><br><span style="font-size:11px;color:var(--text-sub)">${esc(fundFmt.dir)}</span></td>
      <td style="font-size:12px">${esc(_fmtLiq(liqVal))}</td>
      <td style="font-size:12px">${_fmtBasis(basisVal)}</td>
      <td style="font-size:12px">${_fmtDepth(depthVal)}</td>
      <td><span class="lw-badge ${prio.cls}">${prio.label}</span></td>
    </tr>`;
  }

  /* ── Alert strip — only when |z| >= 2 on any component ── */
  function _alertStrip(scores, sorted) {
    const chips = [];
    for (const asset of sorted) {
      const c = (scores[asset] && scores[asset].components) || {};
      for (const [, cv] of Object.entries(c)) {
        if (cv && cv.implication && cv.implication.tag && Math.abs(cv.z || 0) >= 2) {
          const kind = cv.implication.kind || '';
          const icon = kind === 'bear' ? '⚡' : kind === 'bull' ? '🔼' : '⚠';
          const color = kind === 'bear' ? '#ef4444' : kind === 'bull' ? '#22c55e' : '#f59e0b';
          chips.push(`<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;border:1px solid ${color}40;background:${color}12;font-size:12px;font-weight:600;color:${color}">${icon} ${esc(asset)}: ${esc(cv.implication.tag)}</span>`);
          break; /* one chip per asset */
        }
      }
    }
    if (!chips.length) return '';
    return `<div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-sub);margin-bottom:8px">Active Signals</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${chips.join('')}</div>
    </div>`;
  }

  /* ── How to Use guide ── */
  function _guideHTML() {

    function row(bull, bear) {
      return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0">
        <div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:8px;padding:10px 12px">
          <div style="font-size:.78rem;font-weight:700;color:#22c55e;margin-bottom:5px">🟢 BULLISH SIGNS</div>
          <div style="font-size:.86rem;color:var(--text);line-height:1.65">${bull}</div>
        </div>
        <div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:8px;padding:10px 12px">
          <div style="font-size:.78rem;font-weight:700;color:#ef4444;margin-bottom:5px">🔴 BEARISH SIGNS</div>
          <div style="font-size:.86rem;color:var(--text);line-height:1.65">${bear}</div>
        </div>
      </div>`;
    }

    function tip(text) {
      return `<div style="background:rgba(99,102,241,.1);border-left:3px solid var(--accent,#6366f1);border-radius:0 6px 6px 0;padding:8px 12px;margin-top:8px;font-size:.86rem;color:var(--text-sub);line-height:1.6">
        <strong style="color:var(--accent,#6366f1)">💡 Trading tip:</strong> ${text}
      </div>`;
    }

    function warn(text) {
      return `<div style="background:rgba(251,191,36,.1);border-left:3px solid #f59e0b;border-radius:0 6px 6px 0;padding:8px 12px;margin-top:8px;font-size:.86rem;color:var(--text-sub);line-height:1.6">
        <strong style="color:#f59e0b">⚠️ Watch out:</strong> ${text}
      </div>`;
    }

    const sections = [

      {
        emoji: '🎯',
        title: 'Calm Score — The Big Picture Number',
        intro: `Think of this like a <strong>temperature gauge for the whole market</strong>. When it's cold (low score), the market is stressed and overheated with positions. When it's warm (high score), everyone is calm and the market is clean.<br><br>
The score is built from <em>all</em> the other metrics combined — OI, funding, liquidations, book depth, and more. It's your one-number summary.`,
        content: `
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:10px 0">
  <div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:8px;padding:10px;text-align:center">
    <div style="font-size:1.3rem;font-weight:800;color:#ef4444">0–40</div>
    <div style="font-size:.78rem;font-weight:700;color:#ef4444;margin:3px 0">HIGH RISK</div>
    <div style="font-size:.83rem;color:var(--text-sub)">Market is stretched and crowded. Leverage is extreme. A big flush is likely coming soon — in either direction.</div>
  </div>
  <div style="background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);border-radius:8px;padding:10px;text-align:center">
    <div style="font-size:1.3rem;font-weight:800;color:#f59e0b">40–65</div>
    <div style="font-size:.78rem;font-weight:700;color:#f59e0b;margin:3px 0">MODERATE</div>
    <div style="font-size:.83rem;color:var(--text-sub)">Normal market conditions. Positioning exists but isn't extreme. Trade normally, stay alert.</div>
  </div>
  <div style="background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);border-radius:8px;padding:10px;text-align:center">
    <div style="font-size:1.3rem;font-weight:800;color:#22c55e">65–100</div>
    <div style="font-size:.78rem;font-weight:700;color:#22c55e;margin:3px 0">CALM</div>
    <div style="font-size:.83rem;color:var(--text-sub)">Clean, orderly market. Low stress. Best conditions for full-size entries with clear stops.</div>
  </div>
</div>
${tip('A score below 40 at a killzone + Order Block is like a loaded spring. The flush hasn\'t happened yet — that\'s your setup. A score above 65 means less chaos and cleaner price action.')}
${warn('A very low calm score does NOT tell you WHICH direction the flush will go. You still need your HTF bias and price structure to decide direction.')}`,
      },

      {
        emoji: '📦',
        title: 'Open Interest (OI) — How Much Money Is Betting Right Now',
        intro: `Imagine a poker game. Open Interest is the <strong>total amount of chips on the table</strong>. Every open trade is a chip. When OI is high, lots of people have big bets open. When it drops, people are cashing out and leaving the table.<br><br>
Higher OI = more fuel for a big move (or a big crash). It doesn't tell you the direction by itself — for that you need to combine it with price movement.`,
        content: row(
          `Price <strong>goes up</strong> AND OI <strong>goes up</strong> at the same time.<br><br>
This means new buyers are opening fresh long positions as price rises. Real demand. The move has real money behind it, not just short covering.`,
          `Price <strong>goes down</strong> AND OI <strong>goes up</strong> at the same time.<br><br>
This means new sellers are opening fresh short positions as price falls. Real selling pressure. Trend continuation is more likely — don't try to catch the bottom yet.`
        ) + `
<div style="background:rgba(255,255,255,.04);border-radius:8px;padding:10px 12px;margin:8px 0;font-size:.86rem;color:var(--text-sub);line-height:1.65">
  <strong style="color:var(--text)">When OI drops while price moves:</strong><br>
  This is called <em>position unwinding</em>. People are closing their bets, not opening new ones. The move is weaker and more likely to reverse soon. Be careful chasing it.
</div>
${tip('A huge OI sitting above equal highs (buy stops) is like a pile of fuel above the market. Smart money will push price up to grab those stops, causing a spike — then reverse hard. That\'s your short setup after the sweep.')}`,
      },

      {
        emoji: '📈',
        title: 'OI Δ/hr — Is Positioning Growing or Shrinking Right Now?',
        intro: `This is just the <strong>speed of change</strong> in Open Interest over the last hour. It tells you what is happening <em>right now</em> — is the market getting more crowded or are people leaving?`,
        content: row(
          `<strong>Positive and growing</strong> while price is rising.<br><br>
New longs are piling in aggressively. Fresh demand. Momentum is building. This is a trend continuation signal.`,
          `<strong>Sharply negative</strong> while price is falling.<br><br>
Everyone is running for the exits at the same time. Mass liquidation or panic close. This can cause a rapid price drop but often leads to a reversal once the dust settles.`
        ) + warn('A sudden big negative OI change during a price move = forced liquidations happening. That spike or wick you see on the chart is people getting blown out. Don\'t enter in the middle of it — wait for it to settle.'),
      },

      {
        emoji: '💸',
        title: 'Funding Rate — Who Is Paying Whom Every 8 Hours',
        intro: `Crypto perpetual contracts never expire, so they use a <strong>funding rate</strong> to keep the perp price close to spot price. Every 8 hours, one side pays the other.<br><br>
Think of it like rent. If everyone wants to be long (bullish), they have to pay rent to the shorts for the privilege. The more crowded one side gets, the higher the rent. When rent gets too expensive, people start leaving — and that\'s when price reverses.`,
        content: row(
          `Funding is <strong>negative</strong> (shorts paying longs).<br><br>
The crowd is too bearish. Shorts are so packed in that they\'re paying rent to stay in the trade. Any bit of good news or a price uptick will force them to close — causing a short squeeze upward.<br><br>
<em>Example: -0.05%/8h = shorts paying $50 per $100,000 held, every 8 hours. That adds up fast.</em>`,
          `Funding is <strong>positive</strong> (longs paying shorts).<br><br>
The crowd is too bullish. Everyone is long and comfortable. They\'re paying to stay in. When price dips even slightly, these overleveraged longs panic-close — causing a cascade down.<br><br>
<em>Example: +0.05%/8h = longs paying $50 per $100,000 held, every 8 hours.</em>`
        ) + `
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0">
  <div style="background:rgba(34,197,94,.08);border-radius:6px;padding:8px;text-align:center">
    <div style="font-size:.78rem;color:#22c55e;font-weight:700">−0.10% or lower</div>
    <div style="font-size:.83rem;color:var(--text-sub);margin-top:3px">Extreme short squeeze setup. Shorts are bleeding.</div>
  </div>
  <div style="background:rgba(255,255,255,.04);border-radius:6px;padding:8px;text-align:center">
    <div style="font-size:.78rem;color:var(--text-dim);font-weight:700">−0.01% to +0.01%</div>
    <div style="font-size:.83rem;color:var(--text-sub);margin-top:3px">Neutral. Neither side is crowded. Market can go either way.</div>
  </div>
  <div style="background:rgba(239,68,68,.08);border-radius:6px;padding:8px;text-align:center">
    <div style="font-size:.78rem;color:#ef4444;font-weight:700">+0.10% or higher</div>
    <div style="font-size:.83rem;color:var(--text-sub);margin-top:3px">Extreme long flush setup. Longs are bleeding.</div>
  </div>
</div>
${tip('High positive funding + equal highs on the chart = a BSL (Buy Stop Liquidity) sweep is very likely. ICT calls this "running the buy stops." Smart money pushes price up to trigger those stops, grabs the exit liquidity, then dumps. High negative funding + equal lows = the same thing in reverse.')}`,
      },

      {
        emoji: '💥',
        title: 'Liquidations / hr — Positions Being Forcibly Closed',
        intro: `When a trader uses leverage and price moves against them enough, their exchange <strong>force-closes their position</strong> — this is a liquidation. It happens instantly and the trader has no say.<br><br>
The liquidations per hour metric shows how violent current market conditions are. Think of it like measuring how many cars are crashing on the highway right now.`,
        content: row(
          `A <strong>sudden spike in short liquidations</strong> (shorts being blown out).<br><br>
Price just swept below equal lows or a key support, forcing short-sellers out. Once they\'re all gone, there\'s nobody left to sell — price bounces hard. This is often the exact bottom of a stop hunt.`,
          `A <strong>sudden spike in long liquidations</strong> (longs being blown out).<br><br>
Price just swept above equal highs or a key resistance, forcing buyers out. Once the longs are gone, buying pressure evaporates — price dumps back. This is often the exact top of a stop hunt.`
        ) + warn('If liquidations are already very high and ongoing, do NOT enter a trade. You\'re in the middle of a storm. Wait for the spike to end and price to stabilise at a key level (OB or FVG). THEN enter.') +
        tip('A liquidation spike that lands right on an Order Block or Fair Value Gap and then stops = high-conviction entry. The weak hands just got washed out. Smart money steps in here.'),
      },

      {
        emoji: '⚖️',
        title: 'Basis (Perp Price vs Spot Price)',
        intro: `The perpetual contract should trade very close to the actual spot price. The <strong>basis</strong> is the gap between them.<br><br>
It\'s like the gap between the sticker price of a car and what people are actually paying at auction. When everyone is excited (bullish), the perp trades above spot. When everyone is scared (bearish), it trades below.`,
        content: row(
          `Basis is <strong>positive and growing</strong> (perp above spot).<br><br>
Traders are willing to pay a premium on the futures market to hold long positions. This is a bullish sentiment signal — demand is outpacing spot supply.<br><br>
The bigger the positive basis, the more excited the market is.`,
          `Basis is <strong>negative or flipping negative</strong> (perp below spot).<br><br>
Traders are selling the perp below what you could buy on spot — they\'re desperate to be short or to exit longs. Strong bearish sentiment.<br><br>
A basis flip from positive to negative during a price breakdown = real capitulation.`
        ) + tip('Negative basis at a discount Order Block (price in a discount, OB below current price) = extra confirmation for a long. The futures market is oversold relative to spot. Smart money often steps in here.'),
      },

      {
        emoji: '📚',
        title: 'Book Depth / Skew — What the Order Book Looks Like',
        intro: `The order book shows all the limit buy and sell orders sitting within 2% of the current price. The <strong>book skew</strong> is the difference between buy orders and sell orders in that window.<br><br>
Think of it like a tug of war. If there are way more buyers lined up than sellers, price has a wall of support underneath it. If there are way more sellers than buyers, price has a ceiling above it.`,
        content: row(
          `<strong>Bid+ (green)</strong> — More buy orders than sell orders in the book.<br><br>
Price has a thick floor of buy support beneath it. It\'s harder for price to fall because every dip gets absorbed quickly. This is a bullish order flow signal.<br><br>
Extreme bid dominance (z-score near 3.0) = buyers are exceptionally aggressive.`,
          `<strong>Ask+ (red)</strong> — More sell orders than buy orders in the book.<br><br>
Price has a ceiling of sell orders above it. Every attempt to rally gets sold into immediately. This is a bearish order flow signal.<br><br>
Extreme ask dominance = sellers are stacking up, rally will struggle.`
        ) + warn('An extreme book skew in either direction (z-score at the cap of 3.0) is abnormal and often precedes a reversal. When the book is too bid-heavy, smart money may be preparing to unload into those buyers. Don\'t blindly follow the book.'),
      },

      {
        emoji: '🧭',
        title: 'Bias — The Dashboard\'s Overall Direction Call',
        intro: `The bias is the <strong>system\'s best guess</strong> at which direction the market is leaning, based on combining all metrics together. Think of it as asking the dashboard: "If you had to bet right now, which way would you go?"`,
        content: `
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0">
  <div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:8px;padding:10px 12px">
    <div style="font-size:.86rem;font-weight:700;color:#22c55e;margin-bottom:4px">🟢 BULL</div>
    <div style="font-size:.86rem;color:var(--text);line-height:1.6">Most metrics agree the market wants to go up. OI expanding on the long side, funding not extreme, positive basis, bid-heavy book. Safe to look for long setups.</div>
  </div>
  <div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:8px;padding:10px 12px">
    <div style="font-size:.86rem;font-weight:700;color:#ef4444;margin-bottom:4px">🔴 BEAR</div>
    <div style="font-size:.86rem;color:var(--text);line-height:1.6">Most metrics agree the market wants to go down. Shorts piling in, negative funding, negative basis, ask-heavy book. Safe to look for short setups.</div>
  </div>
  <div style="background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.25);border-radius:8px;padding:10px 12px">
    <div style="font-size:.86rem;font-weight:700;color:#f59e0b;margin-bottom:4px">🟡 CHOPPY</div>
    <div style="font-size:.86rem;color:var(--text);line-height:1.6">Metrics are contradicting each other. Funding says one thing, OI says another. The market itself is confused. <strong>Avoid directional trades.</strong> Wait for alignment.</div>
  </div>
  <div style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:10px 12px">
    <div style="font-size:.86rem;font-weight:700;color:var(--text-sub);margin-bottom:4px">⚪ NEUTRAL</div>
    <div style="font-size:.86rem;color:var(--text);line-height:1.6">No strong signals in any direction. Everything is middling. This is a "watch and wait" state — don\'t force a trade.</div>
  </div>
</div>
${tip('Always make sure the Bias here matches your higher timeframe bias from the ICT Dojo before taking a trade. If Dojo says Bullish but this says Bear — that\'s a conflict. Lower your size or skip the trade entirely.')}`,
      },

      {
        emoji: '🏦',
        title: 'Funding Divergence — When Exchanges Disagree',
        intro: `This dashboard pulls funding rates from three different exchanges: <strong>Bybit, OKX, and Deribit</strong>. They should all be similar. When they\'re very different from each other, that\'s called <strong>funding divergence</strong>.<br><br>
Imagine three weather stations reading the same sky but giving very different forecasts. Something unusual is going on.`,
        content: row(
          `Funding rates are <strong>similar across all exchanges</strong> (low divergence).<br><br>
Everyone agrees. Traders on Bybit, OKX, and Deribit are all positioned the same way. This consensus usually leads to cleaner, more predictable price moves. Trends are more reliable in this state.`,
          `Funding rates are <strong>very different across exchanges</strong> (high divergence).<br><br>
Traders on different exchanges are positioned completely differently. This means uncertainty and disagreement in the market. Expect choppy, back-and-forth price action with lots of fakeouts until the divergence resolves.`
        ) + warn('When funding divergence is high (the "venues split" signal), avoid swing trades. Scalps only if anything, and keep stops tight. The market is irrational right now — it can move either way on very little volume.'),
      },

      {
        emoji: '🔗',
        title: 'Putting It All Together — The Full Checklist',
        intro: `Here\'s how to use this entire dashboard as a quick checklist before taking any ICT trade:`,
        content: `
<div style="display:flex;flex-direction:column;gap:8px;margin:10px 0">
  <div style="background:rgba(255,255,255,.04);border-radius:8px;padding:12px 14px;font-size:.86rem;color:var(--text);line-height:1.7">
    <strong style="color:var(--accent,#6366f1)">Step 1 — Check the Calm Score</strong><br>
    Is it above 50? Good, proceed. Below 30? The market is very stretched — only take the highest-quality setups and reduce your size by half. Below 20? Sit on your hands.
  </div>
  <div style="background:rgba(255,255,255,.04);border-radius:8px;padding:12px 14px;font-size:.86rem;color:var(--text);line-height:1.7">
    <strong style="color:var(--accent,#6366f1)">Step 2 — Check the Bias</strong><br>
    Does it say Bull or Bear? Make sure it matches your HTF direction from the ICT Dojo. If they conflict, skip the trade or halve your size. If they align — that\'s a green light.
  </div>
  <div style="background:rgba(255,255,255,.04);border-radius:8px;padding:12px 14px;font-size:.86rem;color:var(--text);line-height:1.7">
    <strong style="color:var(--accent,#6366f1)">Step 3 — Check Funding</strong><br>
    Is funding extreme in the same direction as your trade? If you want to go long but funding is very positive (longs already crowded), be cautious — you\'re buying with the crowd. If you want to go short and funding is very positive — that\'s extra confirmation, the longs are about to get flushed.
  </div>
  <div style="background:rgba(255,255,255,.04);border-radius:8px;padding:12px 14px;font-size:.86rem;color:var(--text);line-height:1.7">
    <strong style="color:var(--accent,#6366f1)">Step 4 — Check OI</strong><br>
    Is OI growing in your direction? Good — new money supports the move. Is OI falling? The move might be weak or almost done. Is OI growing but the price isn\'t moving? A big move is building and about to pop.
  </div>
  <div style="background:rgba(255,255,255,.04);border-radius:8px;padding:12px 14px;font-size:.86rem;color:var(--text);line-height:1.7">
    <strong style="color:var(--accent,#6366f1)">Step 5 — Check Liquidations</strong><br>
    Any big liq spike happening right now? Wait for it to finish before entering. A fresh liq spike into your OB or FVG = the weak hands just got washed, enter after price stabilises.
  </div>
  <div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:8px;padding:12px 14px;font-size:.86rem;color:var(--text);line-height:1.7">
    <strong style="color:#22c55e">✅ Ideal trade setup:</strong><br>
    Calm score 50+, Bias matches HTF, Funding against the crowd in your favour, OI growing in your direction, no active liq spike, positive basis for longs / negative for shorts. This is a 5-star setup. Size up.
  </div>
  <div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:12px 14px;font-size:.86rem;color:var(--text);line-height:1.7">
    <strong style="color:#ef4444">❌ Skip the trade if:</strong><br>
    Calm score below 25, Bias says Choppy, Funding is extreme AND in your direction (you\'re the crowd), active liq spike ongoing, funding divergence alert showing. Wait for a better day.
  </div>
</div>`,
      },

    ];

    const sectionsHTML = sections.map(s => `
      <div style="padding:14px 16px;border-radius:10px;background:var(--surface2,rgba(255,255,255,.03));border:1px solid var(--border);margin-bottom:12px">
        <div style="font-size:1rem;font-weight:700;color:var(--text);margin-bottom:8px">${s.emoji} ${esc(s.title)}</div>
        <div style="font-size:.9rem;color:var(--text-sub);line-height:1.7;margin-bottom:8px">${s.intro}</div>
        <div>${s.content}</div>
      </div>`).join('');

    return `<div class="card" style="margin-top:24px;padding:0;overflow:hidden">
      <div style="padding:16px 20px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;border-bottom:1px solid var(--border)" onclick="const b=document.getElementById('lwGuideBody'),t=document.getElementById('lwGuideToggle'),open=b.style.display!=='none';b.style.display=open?'none':'block';t.textContent=open?'▼ Show full guide':'▲ Hide guide'">
        <div>
          <span style="font-weight:700;font-size:.98rem;color:var(--text)">📖 How to Read This Dashboard</span>
          <span style="font-size:.83rem;color:var(--text-dim);margin-left:10px">Plain-English guide to every metric — what's bullish, what's bearish, and how to use it with ICT</span>
        </div>
        <button id="lwGuideToggle" class="btn-ghost btn-sm" style="pointer-events:none;white-space:nowrap;margin-left:12px">▼ Show full guide</button>
      </div>
      <div id="lwGuideBody" style="display:none;padding:16px 20px">
        ${sectionsHTML}
      </div>
    </div>`;
  }

  function _liveHTML(health, scoresData) {
    const scores = (scoresData && scoresData.scores) || {};
    const allAssets = Object.keys(scores);

    /* Sort by score ascending (most stretched first), nulls last */
    const sorted = [...allAssets].sort((a, b) => {
      const sa = scores[a].score, sb = scores[b].score;
      if (sa === null && sb === null) return 0;
      if (sa === null) return 1;
      if (sb === null) return -1;
      return sa - sb;
    });

    const featured = sorted.slice(0, 3);
    const tfBtns = TFS.map(tf =>
      `<button class="lw-tf-btn${tf === _activeTf ? ' on' : ''}" data-tf="${tf}">${tf}</button>`
    ).join('');

    const cardCount = allAssets.length;
    const liveCount = allAssets.filter(a => !scores[a].warming && scores[a].score !== null).length;
    const warmingCount = cardCount - liveCount;
    /* The LW score model needs a rolling z-score baseline per component.
       After a Railway redeploy the server has no history yet — funding,
       OI, liquidations, etc. show as "warming" until ~50 samples have
       been polled per metric (≈20-30 minutes). Surface that explicitly
       so the dashboard doesn't look broken during warmup. */
    const warmingNote = warmingCount > 0
      ? `<div style="font-size:11px;color:var(--muted-2);margin-top:4px">
           ⏳ ${warmingCount} asset${warmingCount !== 1 ? 's' : ''} warming up — scores need ~50 polls of history per metric (≈20–30 min after a redeploy). Funding/basis data is already flowing; calm-score appears once the baselines fill.
         </div>`
      : '';

    return `
      <div class="page-head">
        <div>
          <h1>Liquidity Watcher</h1>
          <p class="subtitle">${cardCount} assets · ${liveCount} live</p>
        </div>
        <div class="page-head-right" style="display:flex;gap:8px;align-items:center">
          <div class="lw-tf-row">${tfBtns}</div>
          <a class="btn-ghost" href="${API}/" target="_blank" rel="noopener">↗ Pop out</a>
        </div>
      </div>

      <div style="margin-bottom:18px">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="lw-dot live"></span>
          <span style="font-size:12px;color:var(--muted)">connected · ${esc(String(health.universe_size))} assets · ${esc(String(health.metrics_tracked))} metrics tracked · tf: ${esc(_activeTf)}</span>
          <span style="margin-left:auto;font-size:11px;color:var(--muted-2)" id="lwLastRefresh"></span>
          <button class="btn-ghost" id="lwRefreshBtn" style="font-size:12px;padding:4px 10px">↺ Refresh</button>
        </div>
        ${warmingNote}
      </div>

      ${_liqZonesShell()}

      ${_oiBarsShell(scores)}

      ${_kpiStrip(scores, sorted)}

      ${_alertStrip(scores, sorted)}

      ${featured.length ? `
      <div class="lw-cards-row">
        ${featured.map(a => _assetCard(a, scores[a])).join('')}
      </div>` : ''}

      <div class="card" style="padding:0;overflow:hidden;margin-bottom:6px">
        <table class="lw-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th style="min-width:140px">Calm Score</th>
              <th>Bias</th>
              <th>OI</th>
              <th>OI Δ/hr</th>
              <th>Funding/8h</th>
              <th>Liq/hr</th>
              <th>Basis</th>
              <th>Book Skew</th>
              <th>Priority</th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map(a => _tableRow(a, scores[a])).join('')}
            ${sorted.length === 0 ? '<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--muted)">No data yet — scores warm up within a minute</td></tr>' : ''}
          </tbody>
        </table>
      </div>

      <form id="lwAddForm" style="display:flex;align-items:center;gap:8px;margin:10px 0 4px">
        <input id="lwAddInput" type="text" autocomplete="off" spellcheck="false"
          placeholder="add a ticker (e.g. AVAX, LINK)…"
          style="flex:0 1 260px;padding:7px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card,#fff);color:var(--text);font-size:13px" />
        <button type="submit" id="lwAddBtn" class="btn-ghost" style="font-size:13px;padding:7px 14px">+ Add</button>
        <span id="lwAddStatus" style="font-size:12px"></span>
      </form>
      <p style="font-size:11px;color:var(--muted-2);margin-top:2px;text-align:right">
        Calm score 0–100: low = stretched / high-risk · HIGH priority = act with caution · data from Bybit, OKX, Deribit
      </p>

      ${_guideHTML()}`;
  }

  /* ══════════════════════════════════════════════════════════
     TOP LIQUIDATION LEVELS panel — native render of the LW
     /api/asset/{asset}/liquidations endpoint. Same data + look as
     the standalone /lw page, styled with V2 theme tokens. Uses the
     shared `API` base, so it resolves to localhost:8766 locally and
     same-origin /lw on Railway with no extra wiring.
  ════════════════════════════════════════════════════════════ */
  function _fmtPx(p) {
    if (p == null || isNaN(p)) return '—';
    const a = Math.abs(p);
    const dec = a >= 1000 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
    return '$' + Number(p).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  /* Compact cross-asset Open Interest bar strip (under the liq panel).
     Built inline from the scores payload's per-asset meta.oi_usd — no extra
     fetch, re-renders with every render + 30s refresh. */
  function _oiBarsShell(scores) {
    const rows = Object.keys(scores || {})
      .map(a => [a, (scores[a] && scores[a].meta && scores[a].meta.oi_usd) || 0])
      .filter(r => r[1] > 0)
      .sort((x, y) => y[1] - x[1]);
    const head = `
      <div style="display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px">
        <div>
          <h2 style="font-size:14px;font-weight:700;margin:0;color:var(--text)">Open Interest <span style="font-weight:400;font-size:12px;color:var(--muted)">(live, by asset)</span></h2>
          <p style="font-size:11px;color:var(--muted);margin:3px 0 0;max-width:560px;line-height:1.5">Live perp open interest in USD across the universe — longest bar = most leveraged capital parked.</p>
        </div>
        <span style="font-size:11px;color:var(--muted);white-space:nowrap">TF ${esc(_activeTf)}</span>
      </div>`;
    let body;
    if (!rows.length) {
      body = `<div style="font-size:12px;color:var(--muted);padding:8px 0">Waiting for live open-interest data…</div>`;
    } else {
      const max = rows[0][1] || 1;
      body = `<div style="display:flex;flex-direction:column;gap:6px">` + rows.map(([a, oi]) => {
        const w = Math.max(1.5, (oi / max) * 100);
        return `<div style="display:grid;grid-template-columns:52px 1fr 74px;align-items:center;gap:10px">
          <span style="font-size:12px;font-weight:700;color:var(--text)">${esc(a)}</span>
          <div style="height:12px;background:var(--bg,#f0f0f0);border-radius:3px;overflow:hidden">
            <div style="height:100%;border-radius:3px;min-width:2px;width:${w.toFixed(1)}%;background:linear-gradient(90deg,#22c55e,#eab308)"></div>
          </div>
          <span style="font-size:12px;font-weight:600;color:var(--text);text-align:right;font-variant-numeric:tabular-nums">${_fmtM(oi)}</span>
        </div>`;
      }).join('') + `</div>`;
    }
    return `<section class="card" style="padding:14px 18px;margin-bottom:18px">${head}${body}</section>`;
  }

  function _liqZonesShell() {
    const winBtnStyle = (w) => {
      const active = w === _liqWindow;
      return `data-lww="${w}" style="background:${active ? 'var(--accent,#7c3aed)' : 'transparent'};color:${active ? '#fff' : 'var(--text-sub)'};border:1px solid ${active ? 'var(--accent,#7c3aed)' : 'var(--border)'};border-radius:6px;padding:4px 10px;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s"`;
    };
    return `
      <section id="lwLiqZones" class="card" style="padding:16px 18px;margin-bottom:18px">
        <div style="display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px">
          <div>
            <h2 style="font-size:15px;font-weight:700;margin:0;color:var(--text)">Top Liquidation Levels</h2>
            <p style="font-size:12px;color:var(--muted);margin:4px 0 0;line-height:1.5">Biggest squeeze clusters above and flush clusters below price, with candle overlay.</p>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <div style="display:flex;gap:4px">
              <button ${winBtnStyle('7d')}>7D</button>
              <button ${winBtnStyle('14d')}>14D</button>
              <button ${winBtnStyle('30d')}>1M</button>
            </div>
            <select id="lwLiqTicker" style="background:var(--bg-card,#1a1a2e);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:5px 10px;font-size:13px;font-weight:600;cursor:pointer"></select>
            <span id="lwLiqSource" style="font-size:11px;font-weight:600;padding:3px 8px;border-radius:10px;white-space:nowrap"></span>
          </div>
        </div>
        <div id="lwLiqAnchor" style="display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px;margin-bottom:10px;font-size:13px;color:var(--muted)"></div>
        <div id="lwLiqChart" style="width:100%;min-height:520px;background:#080612;border-radius:8px;overflow:hidden;margin:0 0 10px"></div>
        <div style="display:flex;gap:24px;font-size:13px;padding:2px 0">
          <span><span style="color:#22c55e;font-size:11px">▲ squeeze heat</span> <b id="lwLiqTotAbove" style="color:var(--text)">—</b></span>
          <span><span style="color:#ef4444;font-size:11px">▼ flush heat</span> <b id="lwLiqTotBelow" style="color:var(--text)">—</b></span>
        </div>
        <p id="lwLiqNote" style="font-size:11px;color:var(--muted);margin:8px 0 0;line-height:1.5;font-style:italic"></p>
      </section>`;
  }

  function _paintLiqSVG() {
    const data = _liqData;
    const klines = _liqKlines;

    // Update source badge + anchor
    const src    = document.getElementById('lwLiqSource');
    const anchor = document.getElementById('lwLiqAnchor');
    const totA   = document.getElementById('lwLiqTotAbove');
    const totB   = document.getElementById('lwLiqTotBelow');
    const note   = document.getElementById('lwLiqNote');
    const chartEl = document.getElementById('lwLiqChart');
    if (!data) return;

    const _src = data.source || 'estimated';
    const live = _src === 'coinglass';
    if (src) {
      src.textContent = live ? 'live' : 'estimated';
      src.style.background = live ? 'rgba(34,197,94,.16)' : 'rgba(234,179,8,.16)';
      src.style.color      = live ? '#22c55e' : '#b8860b';
      src.style.border     = '1px solid ' + (live ? 'rgba(34,197,94,.4)' : 'rgba(234,179,8,.45)');
    }
    if (anchor) anchor.innerHTML =
      `<span style="font-weight:700;color:var(--text)">${esc(data.asset || _liqAsset || '')}</span>` +
      ` <span>live price</span> <span style="font-weight:700;color:var(--text)">${_fmtPx(data.current_price)}</span>` +
      ` <span style="color:var(--muted)">· TF ${esc(data.tf || _activeTf)} · ${_liqWindow}</span>`;
    if (totA) totA.textContent = _fmtM(data.total_above || 0);
    if (totB) totB.textContent = _fmtM(data.total_below || 0);
    if (note) note.textContent = data.note || '';

    if (!chartEl) return;
    const above = data.above || [], below = data.below || [];
    const all   = [...above, ...below];
    if (!all.length || !data.current_price) {
      chartEl.innerHTML = `<div style="padding:60px 0;text-align:center;color:var(--muted);font-size:13px">Warming up — not enough history for ${esc(data.asset || '')}. Zones appear within ~1 min.</div>`;
      return;
    }

    const current = data.current_price;
    const maxUsd  = Math.max(...all.map(r => r.liq_usd));
    const W  = chartEl.clientWidth || 860;
    const H  = 520;
    const PL = 92, PR = 96, PT = 22, PB = 22;
    const cW = W - PL - PR, cH = H - PT - PB;
    const BH = 5, GLOW = 10;

    let pyBand, pyPrice, cy;
    if (klines && klines.length) {
      const rawMin = Math.min(...all.map(r => r.price), ...klines.map(k => k.l), current);
      const rawMax = Math.max(...all.map(r => r.price), ...klines.map(k => k.h), current);
      const pad    = (rawMax - rawMin) * 0.04;
      const minP   = rawMin - pad, maxP = rawMax + pad, pRange = maxP - minP;
      pyPrice = p => PT + (1 - (p - minP) / pRange) * cH;
      pyBand  = r => pyPrice(r.price);
      cy      = pyPrice(current);
    } else {
      const midY    = H / 2;
      const maxAbove = above.length ? Math.max(...above.map(r => r.price)) : current * 1.15;
      const pyAbove  = p => midY - ((p - current) / (maxAbove - current)) * (midY - PT - 10);
      const minBelow = below.length ? Math.min(...below.map(r => r.price)) : current * 0.85;
      const pyBelow  = p => midY + ((current - p) / (current - minBelow)) * (H - PB - midY - 10);
      const aboveSet = new Set(above);
      pyBand  = r => aboveSet.has(r) ? pyAbove(r.price) : pyBelow(r.price);
      pyPrice = p => p >= current ? pyAbove(p) : pyBelow(p);
      cy      = midY;
    }

    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="display:block">`;
    s += `<rect width="${W}" height="${H}" fill="#080612" rx="8"/>`;
    s += `<rect x="${PL}" y="${PT}" width="${cW}" height="${cH}" fill="#0c0a1a"/>`;
    s += `<rect x="${PL}" y="${PT}" width="${cW}" height="${Math.max(0, cy - PT)}" fill="rgba(34,197,94,0.04)"/>`;
    s += `<rect x="${PL}" y="${cy}" width="${cW}" height="${Math.max(0, PT + cH - cy)}" fill="rgba(239,68,68,0.04)"/>`;
    for (let i = 1; i < 5; i++) {
      const gy = PT + (cH / 5) * i;
      s += `<line x1="${PL}" y1="${gy.toFixed(1)}" x2="${PL + cW}" y2="${gy.toFixed(1)}" stroke="#16161e" stroke-width="1"/>`;
    }

    for (const r of all) {
      const y = pyBand(r);
      const t = r.liq_usd / maxUsd;
      if (t > 0.12) s += `<rect x="${PL}" y="${(y-GLOW/2).toFixed(1)}" width="${cW}" height="${GLOW}" fill="${_heatRgba(t,0.18)}" rx="3"/>`;
      if (t > 0.30) s += `<rect x="${PL}" y="${(y-BH*1.5).toFixed(1)}" width="${cW}" height="${(BH*3).toFixed(1)}" fill="${_heatRgba(t,0.30)}" rx="1"/>`;
      const bh = BH + t * 3;
      s += `<rect x="${PL}" y="${(y-bh/2).toFixed(1)}" width="${cW}" height="${bh.toFixed(1)}" fill="${_heatRgba(t,1)}" rx="1"/>`;
      if (t > 0.50) s += `<rect x="${PL}" y="${(y-0.5).toFixed(1)}" width="${cW}" height="1.5" fill="rgba(255,250,100,0.75)" rx="1"/>`;
    }

    if (klines && klines.length) {
      const n = klines.length, candleW = cW / n, bodyHW = Math.max(candleW * 0.38, 1.5);
      for (let i = 0; i < n; i++) {
        const k = klines[i], xc = PL + (i + 0.5) * candleW;
        const yH = pyPrice(k.h), yL = pyPrice(k.l), yO = pyPrice(k.o), yC = pyPrice(k.c);
        const bull = k.c >= k.o, col = bull ? 'rgba(52,211,153,0.85)' : 'rgba(248,113,113,0.85)';
        s += `<line x1="${xc.toFixed(1)}" y1="${yH.toFixed(1)}" x2="${xc.toFixed(1)}" y2="${yL.toFixed(1)}" stroke="${col}" stroke-width="1" opacity="0.55"/>`;
        s += `<rect x="${(xc-bodyHW).toFixed(1)}" y="${Math.min(yO,yC).toFixed(1)}" width="${(bodyHW*2).toFixed(1)}" height="${Math.max(Math.abs(yC-yO),1.5).toFixed(1)}" fill="${col}" rx="1"/>`;
      }
    }

    s += `<line x1="${PL-8}" y1="${cy.toFixed(1)}" x2="${PL+cW}" y2="${cy.toFixed(1)}" stroke="rgba(255,255,255,0.85)" stroke-width="1.5" stroke-dasharray="6,4"/>`;
    s += `<circle cx="${PL-2}" cy="${cy.toFixed(1)}" r="3.5" fill="#fff" opacity="0.9"/>`;
    s += `<text x="${PL+cW-8}" y="${PT+17}" fill="rgba(52,211,153,0.85)" font-size="12" font-weight="bold" text-anchor="end" font-family="system-ui,sans-serif" letter-spacing="1.4">SQUEEZE ZONES ▲</text>`;
    s += `<text x="${PL+cW-8}" y="${PT+cH-8}" fill="rgba(248,113,113,0.85)" font-size="12" font-weight="bold" text-anchor="end" font-family="system-ui,sans-serif" letter-spacing="1.4">▼ FLUSH ZONES</text>`;

    const usedY = new Set();
    function yFree(y) { for (const uy of usedY) if (Math.abs(uy-y) < 20) return false; return true; }
    const sorted = [...all].sort((a,b) => b.liq_usd - a.liq_usd);
    for (const r of sorted) {
      const y = pyBand(r);
      if (Math.abs(y - cy) < 14) continue;
      if (!yFree(y)) continue;
      usedY.add(y);
      const pctStr = (r.pct_from >= 0 ? '+' : '') + r.pct_from.toFixed(1) + '%';
      const lblColor = r.price > current ? 'rgba(110,230,150,0.95)' : 'rgba(248,120,100,0.95)';
      s += `<text x="${PL-6}" y="${(y+4).toFixed(1)}" fill="rgba(190,200,220,0.9)" font-size="11" text-anchor="end" font-family="monospace">${_fmtPx(r.price)}</text>`;
      s += `<text x="${PL+cW+6}" y="${(y+1).toFixed(1)}" fill="${lblColor}" font-size="12" font-weight="600" font-family="monospace">${pctStr}</text>`;
      s += `<text x="${PL+cW+6}" y="${(y+14).toFixed(1)}" fill="rgba(140,155,175,0.8)" font-size="10" font-family="monospace">${_fmtM(r.liq_usd)}</text>`;
    }
    s += `<text x="${PL+cW+6}" y="${(cy+5).toFixed(1)}" fill="#ffffff" font-size="13" font-weight="bold" font-family="monospace">${_fmtPx(current)}</text>`;
    s += `</svg>`;
    chartEl.innerHTML = s;
  }

  async function _loadLiq(asset, tf) {
    if (!asset || _liqInFlight) return;
    _liqInFlight = true;
    try {
      const zFetch  = fetch(`${API}/api/asset/${asset}/liquidations?tf=${tf}&window=${_liqWindow}`, {
        mode: 'cors', cache: 'no-store',
        signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
      });
      const klPromise = _fetchKlinesLiq(asset, _liqWindow);
      _liqData = await (await zFetch).json();
      await klPromise;
      _paintLiqSVG();
    } catch (e) {
      const note = document.getElementById('lwLiqNote');
      if (note) note.textContent = 'Could not load liquidation zones (' + e.message + ').';
    } finally {
      _liqInFlight = false;
    }
  }

  function _wireLiqZones(content, assets) {
    const sel = content.querySelector('#lwLiqTicker');
    if (!sel) return;
    const list = (assets || []).slice().sort();
    if (!list.length) return;
    if (!_liqAsset || !list.includes(_liqAsset)) {
      const saved = localStorage.getItem('lw_liq_ticker');
      _liqAsset = (saved && list.includes(saved)) ? saved : list[0];
    }
    sel.innerHTML = list.map(a => `<option value="${esc(a)}"${a === _liqAsset ? ' selected' : ''}>${esc(a)}</option>`).join('');
    sel.addEventListener('change', () => {
      _liqAsset = sel.value;
      localStorage.setItem('lw_liq_ticker', _liqAsset);
      _liqKlines = null; _liqKlinesKey = null;
      _loadLiq(_liqAsset, _activeTf);
    });

    // Wire window toggle buttons
    content.querySelectorAll('[data-lww]').forEach(btn => {
      btn.addEventListener('click', () => {
        _liqWindow = btn.dataset.lww;
        localStorage.setItem('lw_liq_window_v2', _liqWindow);
        _liqKlines = null; _liqKlinesKey = null;
        // Update button styles without full re-render
        content.querySelectorAll('[data-lww]').forEach(b => {
          const active = b.dataset.lww === _liqWindow;
          b.style.background = active ? 'var(--accent,#7c3aed)' : 'transparent';
          b.style.color      = active ? '#fff' : 'var(--text-sub)';
          b.style.borderColor = active ? 'var(--accent,#7c3aed)' : 'var(--border)';
        });
        _loadLiq(_liqAsset, _activeTf);
      });
    });

    _loadLiq(_liqAsset, _activeTf);
  }

  function _offlineHTML() {
    return `
      <div class="page-head"><h1>Liquidity Watcher</h1><p class="subtitle">Live leverage &amp; positioning data</p></div>
      <div class="lw-offline">
        <div class="lw-offline-icon">🌊</div>
        <h2 class="lw-offline-title">Liquidity Watcher offline</h2>
        <p class="lw-offline-sub">Trying <code>${API.replace('http://','').replace('https://','')}</code> — retrying automatically…</p>
        <p class="lw-offline-sub" style="font-size:11px;margin-top:6px;">
          Start: <code>cd "_CLAUDE PROJECTS/Crypto Liquidity Watcher" &amp;&amp; python3 server.py</code>
        </p>
        <div class="lw-offline-actions" style="margin-top:20px;">
          <button class="btn-primary" id="lwRetry">Retry now</button>
        </div>
      </div>`;
  }

  function _updateTimestamp() {
    const el = document.getElementById('lwLastRefresh');
    if (el) el.textContent = 'updated ' + new Date().toLocaleTimeString();
  }

  /* ── Add / remove ticker controls (hit LW universe endpoints) ── */
  function _wireUniverseControls(content) {
    /* Per-row remove */
    content.querySelectorAll('.lw-remove-asset').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const asset = btn.dataset.asset;
        if (!asset) return;
        if (!confirm(`Remove ${asset} from the watchlist?\n\nIt'll be hidden until you re-add it via the box below.`)) return;
        btn.disabled = true;
        try {
          const r = await fetch(`${API}/api/universe/remove`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            mode: 'cors', body: JSON.stringify({ asset }),
          });
          const d = await r.json();
          if (!d.ok) { alert(`Couldn't remove ${asset}: ${d.error || 'unknown error'}`); btn.disabled = false; return; }
          if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
          render();
        } catch (err) {
          alert(`Network error: ${err.message}`); btn.disabled = false;
        }
      });
    });

    /* Add ticker form */
    const form = content.querySelector('#lwAddForm');
    const input = content.querySelector('#lwAddInput');
    const addBtn = content.querySelector('#lwAddBtn');
    const status = content.querySelector('#lwAddStatus');
    function setStatus(msg, color) { if (status) { status.textContent = msg || ''; status.style.color = color || 'var(--muted)'; } }
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const asset = (input.value || '').trim().toUpperCase();
        if (!asset) return;
        if (!/^[A-Z0-9]{1,12}$/.test(asset.replace('_', ''))) { setStatus('invalid symbol', '#ef4444'); return; }
        addBtn.disabled = true;
        setStatus('checking Bybit listing…', 'var(--muted)');
        try {
          const r = await fetch(`${API}/api/universe/add`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            mode: 'cors', body: JSON.stringify({ asset }),
          });
          const d = await r.json();
          if (!d.ok) { setStatus(d.error || 'failed', '#ef4444'); addBtn.disabled = false; return; }
          setStatus(`✓ added ${asset}`, '#22c55e');
          input.value = '';
          if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
          setTimeout(render, 600);
        } catch (err) {
          setStatus('network error', '#ef4444'); addBtn.disabled = false;
        }
      });
    }
  }

  let _retryTimer = null;

  async function render() {
    const content = document.getElementById('content');
    if (!content) return;
    if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }

    content.innerHTML = `<div style="padding:40px;color:var(--muted);font-size:13px">Checking Liquidity Watcher…</div>`;

    const health = await _fetchHealth();
    if (!health) {
      content.innerHTML = _offlineHTML();
      _retryTimer = setTimeout(() => { if (_isActiveTab()) render(); else _retryTimer = null; }, 3000);
      document.getElementById('lwRetry')?.addEventListener('click', () => { clearTimeout(_retryTimer); render(); });
      return;
    }

    const scoresData = await _fetchScores(_activeTf);
    _lastScores = scoresData;
    content.innerHTML = _liveHTML(health, scoresData);
    _updateTimestamp();
    _wireUniverseControls(content);
    _wireLiqZones(content, Object.keys((scoresData && scoresData.scores) || {}));

    /* TF buttons */
    content.querySelectorAll('.lw-tf-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeTf = btn.dataset.tf;
        if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
        render();
      });
    });

    /* Manual refresh */
    document.getElementById('lwRefreshBtn')?.addEventListener('click', () => {
      if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
      render();
    });

    /* Auto-refresh every 30s while tab is active */
    _refreshTimer = setInterval(async () => {
      if (!_isActiveTab()) { clearInterval(_refreshTimer); _refreshTimer = null; return; }
      const fresh = await _fetchScores(_activeTf);
      if (fresh) {
        _lastScores = fresh;
        const tbody = content.querySelector('.lw-table tbody');
        const cards = content.querySelector('.lw-cards-row');
        if (tbody || cards) {
          /* soft re-render just the data sections */
          const h = await _fetchHealth();
          content.innerHTML = _liveHTML(h || health, fresh);
          _updateTimestamp();
          _wireUniverseControls(content);
          _wireLiqZones(content, Object.keys((fresh && fresh.scores) || {}));
          content.querySelectorAll('.lw-tf-btn').forEach(b => {
            b.addEventListener('click', () => { _activeTf = b.dataset.tf; clearInterval(_refreshTimer); _refreshTimer = null; render(); });
          });
          document.getElementById('lwRefreshBtn')?.addEventListener('click', () => { clearInterval(_refreshTimer); _refreshTimer = null; render(); });
        }
      }
    }, 30000);
  }

  return { render };
})();
