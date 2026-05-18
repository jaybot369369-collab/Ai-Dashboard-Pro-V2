/* ═══════════════════════════════════════════════════════════
   LIQUIDITY WATCHER TAB  v3 — Claude.ai design
   Fetches live scores from localhost:8766/api/scores and
   renders a native card + table UI (no iframe).
   Full standalone dashboard still reachable via ↗ Pop out.
════════════════════════════════════════════════════════════ */
const LiquidityWatcherTab = (() => {

  const API = 'http://127.0.0.1:8766';
  const TFS = ['15m', '4h', 'D', 'W'];
  let _activeTf = 'D';
  let _refreshTimer = null;
  let _lastScores = null;

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

  /* ── Featured asset card (top 3 by score ascending = most stretched first) */
  function _assetCard(asset, data) {
    const score = data.score;
    const bias  = data.bias || 'neutral';
    const warm  = data.warming;
    const prio  = _priority(score);
    const sig   = _topSignal(data.components);
    const pct   = score !== null ? Math.round(score) : null;
    const dotCls = warm ? '' : 'live';

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
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        ${_biasChip(bias)}
        ${sig !== '—' ? `<span class="lw-chip lw-chip-sig">${esc(sig)}</span>` : ''}
        <span class="lw-badge ${prio.cls}" style="margin-left:auto">${prio.label}</span>
      </div>
    </div>`;
  }

  /* ── Full table row */
  function _tableRow(asset, data) {
    const score = data.score;
    const bias  = data.bias || 'neutral';
    const warm  = data.warming;
    const prio  = _priority(score);
    const sig   = _topSignal(data.components);

    return `<tr class="lw-row">
      <td class="lw-td-asset">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="lw-ac-avatar lw-ac-avatar-sm">${esc(asset.slice(0,1))}</div>
          <span style="font-weight:600">${esc(asset)}/USDT</span>
        </div>
      </td>
      <td class="lw-td-score">${_scoreBar(score)}</td>
      <td>${_biasChip(bias)}</td>
      <td style="font-size:12px;color:var(--text-sub);max-width:160px">${esc(sig)}</td>
      <td><span class="lw-badge ${prio.cls}">${prio.label}</span></td>
      <td>${_statusBadge(warm, score)}</td>
    </tr>`;
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

      <div style="display:flex;align-items:center;gap:8px;margin-bottom:18px">
        <span class="lw-dot live"></span>
        <span style="font-size:12px;color:var(--muted)">connected · ${esc(String(health.universe_size))} assets · ${esc(String(health.metrics_tracked))} metrics tracked · tf: ${esc(_activeTf)}</span>
        <span style="margin-left:auto;font-size:11px;color:var(--muted-2)" id="lwLastRefresh"></span>
        <button class="btn-ghost" id="lwRefreshBtn" style="font-size:12px;padding:4px 10px">↺ Refresh</button>
      </div>

      ${featured.length ? `
      <div class="lw-cards-row">
        ${featured.map(a => _assetCard(a, scores[a])).join('')}
      </div>` : ''}

      <div class="card" style="padding:0;overflow:hidden">
        <table class="lw-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th style="min-width:140px">Calm score</th>
              <th>Bias</th>
              <th>Top signal</th>
              <th>Priority</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map(a => _tableRow(a, scores[a])).join('')}
            ${sorted.length === 0 ? '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--muted)">No data yet — scores warm up within a minute</td></tr>' : ''}
          </tbody>
        </table>
      </div>
      <p style="font-size:11px;color:var(--muted-2);margin-top:10px;text-align:right">
        Calm score 0–100: low = stretched / high-risk · HIGH priority = act with caution · data from Bybit, OKX, Deribit
      </p>`;
  }

  function _offlineHTML() {
    return `
      <div class="page-head"><h1>Liquidity Watcher</h1><p class="subtitle">Live leverage &amp; positioning data</p></div>
      <div class="lw-offline">
        <div class="lw-offline-icon">🌊</div>
        <h2 class="lw-offline-title">Liquidity Watcher offline</h2>
        <p class="lw-offline-sub">Trying <code>localhost:8766</code> — retrying automatically…</p>
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
