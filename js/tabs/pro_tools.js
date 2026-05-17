/* ═══════════════════════════════════════════════════════════
   PRO TOOLS — Position sizer · Trade replay · Correlation matrix
════════════════════════════════════════════════════════════ */
const ProToolsTab = (() => {

  const KEYS = {
    sizer: 'jb_pro_sizer',  // { account, riskPct }
    corrPairs: 'jb_pro_corr_pairs',
  };

  /* ── State ──────────────────────────────────────────── */
  let _sub        = localStorage.getItem('jb_pro_sub') || 'sizer';
  let _sizerCfg   = JSON.parse(localStorage.getItem(KEYS.sizer) || '{"account":10000,"riskPct":1}');
  let _corrPairs  = JSON.parse(localStorage.getItem(KEYS.corrPairs) || '["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT","BNBUSDT","DOGEUSDT","ADAUSDT","AVAXUSDT"]');
  let _corrData   = null;
  let _replayChart= null;

  function saveSizer() { localStorage.setItem(KEYS.sizer, JSON.stringify(_sizerCfg)); }
  function saveCorr()  { localStorage.setItem(KEYS.corrPairs, JSON.stringify(_corrPairs)); }
  function saveSub(s)  { _sub = s; localStorage.setItem('jb_pro_sub', s); }

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  // Pair symbols: uppercase alphanumeric only, same hardening as Dojo.
  // Anything else won't render its onclick chip (defense-in-depth).
  const safeSym = s => typeof s === 'string' && /^[A-Z0-9]+$/.test(s);

  /* ══════════════════════════════════════════════════════
     POSITION SIZER
  ══════════════════════════════════════════════════════ */
  function calcPosition(account, riskPct, entry, stop) {
    const riskUSD = account * (riskPct / 100);
    const distance = Math.abs(entry - stop);
    if (distance <= 0) return null;
    const distancePct = (distance / entry) * 100;
    const positionUSD = riskUSD / (distancePct / 100);
    const units = positionUSD / entry;
    const leverage = positionUSD / account;
    return { riskUSD, distance, distancePct, positionUSD, units, leverage };
  }

  function renderSizer() {
    return `<div class="pro-section">
      <h3 class="pro-hdr">📐 Position Sizing Calculator</h3>
      <div class="pro-grid pro-grid-3">
        <div class="form-group">
          <label>Account Size ($)</label>
          <input type="number" id="psAccount" value="${_sizerCfg.account}" step="any" />
        </div>
        <div class="form-group">
          <label>Risk per Trade (%)</label>
          <input type="number" id="psRisk" value="${_sizerCfg.riskPct}" step="0.1" min="0.1" max="10" />
        </div>
        <div class="form-group">
          <label>&nbsp;</label>
          <button class="btn-ghost" id="psSaveBtn">💾 Save defaults</button>
        </div>
      </div>
      <div class="pro-grid pro-grid-3" style="margin-top:10px">
        <div class="form-group">
          <label>Entry Price</label>
          <input type="number" id="psEntry" placeholder="e.g. 95000" step="any" />
        </div>
        <div class="form-group">
          <label>Stop Loss</label>
          <input type="number" id="psStop" placeholder="e.g. 94200" step="any" />
        </div>
        <div class="form-group">
          <label>Take Profit (optional)</label>
          <input type="number" id="psTP" placeholder="e.g. 96800" step="any" />
        </div>
      </div>
      <div id="psResult" style="margin-top:14px"></div>
      <div class="pro-tip">
        💡 Tip: 1% risk on a $10k account = max $100 loss per trade. With a 1% stop distance, that buys you a $10,000 position — 1x leverage. Tighter stops = bigger position size at the same risk.
      </div>
    </div>`;
  }

  function renderSizerResult() {
    const acct = parseFloat(document.getElementById('psAccount').value) || 0;
    const risk = parseFloat(document.getElementById('psRisk').value) || 0;
    const entry = parseFloat(document.getElementById('psEntry').value) || 0;
    const stop = parseFloat(document.getElementById('psStop').value) || 0;
    const tp = parseFloat(document.getElementById('psTP').value) || 0;
    const out = document.getElementById('psResult');
    if (!out) return;
    if (!entry || !stop) { out.innerHTML = ''; return; }
    const r = calcPosition(acct, risk, entry, stop);
    if (!r) { out.innerHTML = '<div class="text-dim">Entry must differ from stop</div>'; return; }
    const rr = tp ? Math.abs(tp - entry) / r.distance : null;
    const tpUSD = tp ? r.units * Math.abs(tp - entry) : null;
    const levColor = r.leverage > 5 ? 'var(--red)' : r.leverage > 2 ? 'var(--gold)' : 'var(--green)';
    out.innerHTML = `<div class="pro-result-grid">
      <div class="pro-result-card">
        <div class="pro-r-lbl">Position Size ($)</div>
        <div class="pro-r-val">$${r.positionUSD.toLocaleString('en-US',{maximumFractionDigits:0})}</div>
      </div>
      <div class="pro-result-card">
        <div class="pro-r-lbl">Position (units)</div>
        <div class="pro-r-val">${r.units.toFixed(r.units > 1 ? 4 : 6)}</div>
      </div>
      <div class="pro-result-card">
        <div class="pro-r-lbl">Risk ($)</div>
        <div class="pro-r-val" style="color:var(--red)">−$${r.riskUSD.toFixed(2)}</div>
        <div class="pro-r-sub">${r.distancePct.toFixed(2)}% stop distance</div>
      </div>
      <div class="pro-result-card">
        <div class="pro-r-lbl">Leverage</div>
        <div class="pro-r-val" style="color:${levColor}">${r.leverage.toFixed(2)}x</div>
      </div>
      ${tpUSD ? `<div class="pro-result-card">
        <div class="pro-r-lbl">Reward ($)</div>
        <div class="pro-r-val" style="color:var(--green)">+$${tpUSD.toFixed(2)}</div>
        <div class="pro-r-sub">${rr.toFixed(2)} : 1 R:R</div>
      </div>` : ''}
    </div>`;
  }

  /* ══════════════════════════════════════════════════════
     TRADE REPLAY
  ══════════════════════════════════════════════════════ */
  async function fetchReplayCandles(symbol, entryTime) {
    // Fetch ~50 candles centered around entry: 20 before + 30 after
    const tfMs = 60*60e3; // 1H
    const start = entryTime - 20 * tfMs;
    const end   = entryTime + 30 * tfMs;
    // Strip any non-alphanumeric chars from the symbol before injecting
    // into the URL — protects against URL injection if a trade row's
    // symbol came from a malformed CSV import.
    const cleanSym = String(symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!cleanSym) throw new Error('invalid symbol');
    const url = `https://api.binance.com/api/v3/klines?symbol=${cleanSym}&interval=1h&startTime=${start}&endTime=${end}&limit=100`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Binance ' + r.status);
    const raw = await r.json();
    return raw.map(k => ({ time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4] }));
  }

  function renderReplay() {
    const trades = (typeof DB !== 'undefined' && DB.getTrades) ? DB.getTrades().filter(t => t.entry && t.date).slice(-30).reverse() : [];
    return `<div class="pro-section">
      <h3 class="pro-hdr">▶ Trade Replay</h3>
      <p class="text-sub" style="font-size:.85rem;margin:0 0 10px">Pick a closed trade → see 20 hourly candles before your entry + 30 after, with entry/SL/TP markers.</p>
      ${trades.length ? `
        <div class="form-group">
          <label>Select Trade</label>
          <select id="rpTrade">
            <option value="">— pick a trade —</option>
            ${trades.map(t => `<option value="${esc(t.id)}">${esc(t.date)} · ${esc(t.symbol)} ${esc(t.direction)} @ ${esc(t.entry)}${t.rMultiple ? ` (${(+t.rMultiple).toFixed(1)}R)` : ''}</option>`).join('')}
          </select>
        </div>
        <div id="rpStatus" class="text-dim" style="font-size:.8rem;margin-top:6px"></div>
        <div class="pro-replay-wrap" style="margin-top:14px;display:none" id="rpWrap">
          <canvas id="rpChart" height="100"></canvas>
        </div>
      ` : `<div class="empty-state"><div class="empty-icon">📭</div><p>No trades to replay yet.</p></div>`}
    </div>`;
  }

  async function runReplay(tradeId) {
    const trade = DB.getTrades().find(t => t.id === tradeId);
    if (!trade) return;
    const status = document.getElementById('rpStatus');
    const wrap   = document.getElementById('rpWrap');
    status.textContent = 'Fetching candles…'; status.style.color = 'var(--gold)';
    try {
      const entryTime = new Date(trade.date + (trade.time ? 'T' + trade.time : 'T12:00')).getTime();
      const candles = await fetchReplayCandles(trade.symbol, entryTime);
      if (!candles.length) throw new Error('no candle data');
      wrap.style.display = 'block';
      const ctx = document.getElementById('rpChart');
      if (_replayChart) _replayChart.destroy();
      const labels = candles.map(c => new Date(c.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit' }));
      const closes = candles.map(c => c.close);
      const highs  = candles.map(c => c.high);
      const lows   = candles.map(c => c.low);
      const entryIdx = candles.findIndex(c => c.time >= entryTime);

      const dirColor = trade.direction === 'Long' ? '#00c896' : '#ff505a';
      _replayChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'High', data: highs,  borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1, pointRadius: 0, fill: false },
            { label: 'Low',  data: lows,   borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1, pointRadius: 0, fill: false },
            { label: 'Close',data: closes, borderColor: dirColor, borderWidth: 2, pointRadius: 0, fill: false, tension: 0.1 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { mode: 'index', intersect: false },
            annotation: {},
          },
          scales: {
            x: { ticks: { color: '#8b949e', maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,0.04)' } },
            y: { ticks: { color: '#8b949e' }, grid: { color: 'rgba(255,255,255,0.04)' } },
          },
        },
        plugins: [{
          id: 'tradeLines',
          afterDraw(chart) {
            const { ctx, chartArea: ca, scales: { x, y } } = chart;
            // Entry vertical line
            if (entryIdx >= 0) {
              const xPos = x.getPixelForValue(entryIdx);
              ctx.save();
              ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.setLineDash([4,4]);
              ctx.beginPath(); ctx.moveTo(xPos, ca.top); ctx.lineTo(xPos, ca.bottom); ctx.stroke();
              ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif';
              ctx.fillText('ENTRY', xPos + 4, ca.top + 12);
              ctx.restore();
            }
            // Entry/SL/TP horizontal lines
            const drawHLine = (price, color, label) => {
              if (!price) return;
              const yPos = y.getPixelForValue(+price);
              ctx.save();
              ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([6,3]);
              ctx.beginPath(); ctx.moveTo(ca.left, yPos); ctx.lineTo(ca.right, yPos); ctx.stroke();
              ctx.fillStyle = color; ctx.font = 'bold 10px sans-serif';
              ctx.fillText(label + ' ' + price, ca.left + 4, yPos - 3);
              ctx.restore();
            };
            drawHLine(trade.entry,     dirColor,    'Entry');
            drawHLine(trade.sl,        '#ff505a',   'SL');
            drawHLine(trade.tp,        '#00c896',   'TP');
            drawHLine(trade.exitPrice, '#facc15',   'Exit');
          },
        }],
      });
      status.textContent = `${candles.length} hourly candles loaded · ${trade.symbol} ${trade.direction}`; status.style.color = 'var(--text-sub)';
    } catch (e) {
      status.textContent = '⚠ ' + e.message; status.style.color = 'var(--red)';
    }
  }

  /* ══════════════════════════════════════════════════════
     CORRELATION MATRIX
  ══════════════════════════════════════════════════════ */
  async function fetchDailyCloses(symbol, days) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=${days}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(symbol + ' ' + r.status);
    return (await r.json()).map(k => +k[4]);
  }

  function correlation(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 5) return null;
    // Convert to log returns
    const ra = []; const rb = [];
    for (let i = 1; i < n; i++) { ra.push(Math.log(a[i]/a[i-1])); rb.push(Math.log(b[i]/b[i-1])); }
    const ma = ra.reduce((a,b)=>a+b,0) / ra.length;
    const mb = rb.reduce((a,b)=>a+b,0) / rb.length;
    let cov = 0, va = 0, vb = 0;
    for (let i = 0; i < ra.length; i++) {
      cov += (ra[i]-ma) * (rb[i]-mb);
      va  += (ra[i]-ma) ** 2;
      vb  += (rb[i]-mb) ** 2;
    }
    if (va * vb === 0) return null;
    return cov / Math.sqrt(va * vb);
  }

  async function loadCorrData() {
    const out = document.getElementById('corrBody');
    if (out) out.innerHTML = '<div class="loading-state">Fetching 30d daily data for ' + _corrPairs.length + ' pairs…</div>';
    try {
      const closes = {};
      for (let i = 0; i < _corrPairs.length; i += 4) {
        const batch = _corrPairs.slice(i, i+4);
        const data = await Promise.all(batch.map(s => fetchDailyCloses(s, 30).catch(() => null)));
        batch.forEach((s, j) => { if (data[j]) closes[s] = data[j]; });
      }
      const matrix = {};
      for (const a of _corrPairs) {
        matrix[a] = {};
        for (const b of _corrPairs) {
          if (!closes[a] || !closes[b]) { matrix[a][b] = null; continue; }
          matrix[a][b] = a === b ? 1 : correlation(closes[a], closes[b]);
        }
      }
      _corrData = matrix;
      renderCorrTable();
    } catch (e) {
      if (out) out.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>' + e.message + '</p></div>';
    }
  }

  function corrColor(c) {
    if (c == null) return 'var(--bg)';
    const v = Math.abs(c);
    // Red high (≥0.7), gold mid (0.4-0.7), green low (<0.4)
    if (v >= 0.7) return c > 0 ? 'rgba(255,80,90,0.7)' : 'rgba(139,92,246,0.6)';
    if (v >= 0.4) return c > 0 ? 'rgba(245,200,66,0.5)' : 'rgba(79,142,247,0.4)';
    return 'rgba(0,200,150,0.3)';
  }

  function renderCorrTable() {
    const out = document.getElementById('corrBody');
    if (!out) return;
    if (!_corrData) { out.innerHTML = ''; return; }
    const pairs = _corrPairs.filter(p => _corrData[p] && safeSym(p));
    out.innerHTML = `<div class="corr-table-wrap"><table class="corr-table">
      <thead><tr><th></th>${pairs.map(p => `<th>${esc(p.replace('USDT',''))}</th>`).join('')}</tr></thead>
      <tbody>
        ${pairs.map(a => `<tr><th>${esc(a.replace('USDT',''))}</th>${pairs.map(b => {
          const v = _corrData[a]?.[b];
          return `<td style="background:${corrColor(v)}">${v == null ? '—' : v.toFixed(2)}</td>`;
        }).join('')}</tr>`).join('')}
      </tbody>
    </table></div>
    <div class="corr-legend">
      <span><span class="corr-sw" style="background:rgba(255,80,90,0.7)"></span> ≥ 0.7 high (avoid stacking)</span>
      <span><span class="corr-sw" style="background:rgba(245,200,66,0.5)"></span> 0.4-0.7 medium</span>
      <span><span class="corr-sw" style="background:rgba(0,200,150,0.3)"></span> &lt; 0.4 diversified</span>
    </div>`;
  }

  function renderCorrelation() {
    return `<div class="pro-section">
      <h3 class="pro-hdr">📊 Correlation Matrix (30d)</h3>
      <p class="text-sub" style="font-size:.85rem;margin:0 0 10px">High correlations mean stacking longs across these coins doesn't diversify your risk.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
        <input type="text" id="corrAddInput" placeholder="add pair e.g. SOL or LINKUSDT" style="background:var(--bg);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:4px;font-size:.82rem" />
        <button class="btn-ghost btn-sm" id="corrAddBtn">＋ Add</button>
        <button class="btn-primary btn-sm" id="corrLoadBtn" style="margin-left:auto">↻ Refresh data</button>
      </div>
      <div class="pro-pair-chips">
        ${_corrPairs.filter(safeSym).map(p => `<span class="pro-pair-chip">${esc(p.replace('USDT',''))}<button onclick="ProToolsTab._removeCorrPair('${p}')">✕</button></span>`).join('')}
      </div>
      <div id="corrBody" style="margin-top:14px">
        ${_corrData ? '' : '<div class="empty-state"><div class="empty-icon">📊</div><p>Click <strong>↻ Refresh data</strong> to compute the matrix.</p></div>'}
      </div>
    </div>`;
  }

  /* ══════════════════════════════════════════════════════
     TELEGRAM SETTINGS — bot integration for phone alerts
  ══════════════════════════════════════════════════════ */
  function renderTelegram() {
    const token   = (typeof Telegram !== 'undefined') ? Telegram.getToken() : '';
    const chat    = (typeof Telegram !== 'undefined') ? Telegram.getChat() : '';
    const enabled = (typeof Telegram !== 'undefined') ? Telegram.getEnabled() : false;
    const log     = (typeof Telegram !== 'undefined') ? Telegram.getLog() : [];
    const masked  = token ? token.slice(0,8) + '••••' + token.slice(-4) : '';
    return `<div class="pro-section">
      <h3 class="pro-hdr">🔔 Telegram Bot — Dino Alerts</h3>
      <p class="text-sub" style="font-size:.85rem;margin:0 0 14px">Get pinged on your phone <strong>only</strong> when 🦖 dino fires in <strong>ICT Dojo</strong> or <strong>Scanner</strong>. Each alert includes entry, SL, TP, PD ratio, direction, and live market conditions.</p>

      <div class="tg-grid">
        <div class="form-group">
          <label>Bot Token <span class="text-xs text-sub">${token ? '· current: ' + esc(masked) : ''}</span></label>
          <input type="password" id="tgToken" value="${esc(token)}" placeholder="paste from @BotFather (e.g. 123:AAH...)" />
        </div>
        <div class="form-group">
          <label>Chat ID</label>
          <div style="display:flex;gap:6px">
            <input type="text" id="tgChat" value="${esc(chat)}" placeholder="auto-discover or paste manually" style="flex:1" />
            <button class="btn-ghost" id="tgDiscoverBtn" title="Auto-find from /getUpdates (DM your bot first)">🔍 Find</button>
          </div>
        </div>
        <div class="form-group">
          <label>Enabled</label>
          <label class="tg-switch">
            <input type="checkbox" id="tgEnabled"${enabled?' checked':''} />
            <span class="tg-slider"></span>
          </label>
        </div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
        <button class="btn-primary" id="tgSaveBtn">💾 Save</button>
        <button class="btn-ghost" id="tgTestBtn">📨 Send Test Message</button>
        <span id="tgStatus" class="text-dim" style="font-size:.82rem;align-self:center"></span>
      </div>

      <h4 class="pro-hdr" style="font-size:.88rem;margin-top:20px">📜 Recent sends (last ${log.length})</h4>
      ${log.length ? `<div class="tg-log">
        ${log.map(e => `<div class="tg-log-row">
          <span class="tg-log-icon">${e.ok ? '✅' : '⚠'}</span>
          <span class="tg-log-time text-dim">${esc(new Date(e.time).toLocaleString())}</span>
          <span class="tg-log-text">${esc((e.text || '').slice(0,80).replace(/\n/g,' '))}${(e.text||'').length>80?'…':''}</span>
          ${!e.ok ? `<span style="color:var(--red);font-size:.75rem">${esc(e.err||'')}</span>` : ''}
        </div>`).join('')}
      </div>` : '<p class="text-dim" style="font-size:.85rem">No messages sent yet.</p>'}

      <div class="pro-tip" style="margin-top:14px">
        <strong>How alerts trigger:</strong> Scanner (every 60s) and ICT Dojo (every 60s) both check for dino conditions on each scan. When 3+ PD confluence aligns inside an active killzone with a confirming sweep, you get a single alert per pair (10-min throttle to prevent spam).
      </div>

      <h4 class="pro-hdr" style="font-size:.88rem;margin-top:24px">📨 On-demand "Daily Report" command</h4>
      <p class="text-sub" style="font-size:.85rem;margin:0 0 12px">
        Send <code>Daily Report</code> (or <code>/daily</code>) to your bot and it'll trigger a fresh ICT watchlist generation.
        PDF arrives in ~60 seconds via the existing alert flow above.
      </p>
      <details style="margin-bottom:10px">
        <summary class="text-sub" style="cursor:pointer;font-size:.82rem">🛠 Setup guide (~5 min, one-time)</summary>
        <ol style="font-size:.82rem;color:var(--text-sub);padding-left:20px;line-height:1.7;margin-top:10px">
          <li>Cloudflare Dashboard → <strong>Workers &amp; Pages</strong> → <strong>Create</strong> → "Hello World" template → name <code>telegram-dispatch</code> → <strong>Deploy</strong></li>
          <li>Click your new Worker → <strong>Edit code</strong> → delete sample → paste contents of <code>CLOUDFLARE_TELEGRAM_WORKER.js</code> from your repo (copy below) → <strong>Save and Deploy</strong></li>
          <li>Worker → <strong>Settings → Variables and Secrets</strong> → add ALL of these as <strong>SECRETS</strong> (encrypted):
            <ul style="margin-top:4px">
              <li><code>TG_BOT_TOKEN</code> — same value as the cron secret</li>
              <li><code>TG_CHAT_ID</code> — same value as the cron secret (used as whitelist)</li>
              <li><code>GH_DISPATCH_PAT</code> — classic GitHub PAT with <strong>workflow</strong> scope on the <code>ict-watchlist</code> repo (<a href="https://github.com/settings/tokens/new?scopes=workflow,repo&description=Telegram%20on-demand%20dispatch" target="_blank">create here</a>)</li>
              <li><code>GH_REPO</code> — <code>jaybot369369-collab/ict-watchlist</code></li>
              <li><code>GH_WORKFLOW</code> — <code>daily_watchlist.yml</code></li>
            </ul>
          </li>
          <li>Copy the Worker URL (e.g. <code>https://telegram-dispatch.YOURACCOUNT.workers.dev</code>)</li>
          <li>From your terminal, set the Telegram webhook (replace both placeholders):
            <pre style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px;overflow-x:auto;font-size:.72rem;margin-top:6px">curl -F "url=https://telegram-dispatch.YOURACCOUNT.workers.dev/tg-webhook" \
  https://api.telegram.org/bot&lt;TG_BOT_TOKEN&gt;/setWebhook</pre>
          </li>
          <li>Open the bot chat and send <code>Daily Report</code> — you should get a "⏳ Generating…" reply, then the PDF arrives via the cron's existing send_telegram() flow.</li>
        </ol>
        <details style="margin-top:10px">
          <summary class="text-sub" style="cursor:pointer;font-size:.82rem">📜 Show Worker code to paste</summary>
          <pre style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:12px;overflow-x:auto;font-size:.72rem;margin-top:8px;max-height:240px"><code id="tgWorkerCode">Loading…</code></pre>
        </details>
      </details>
    </div>`;
  }

  function wireTelegram() {
    document.getElementById('tgSaveBtn')?.addEventListener('click', () => {
      Telegram.setToken(document.getElementById('tgToken').value.trim());
      Telegram.setChat(document.getElementById('tgChat').value.trim());
      Telegram.setEnabled(document.getElementById('tgEnabled').checked);
      if (typeof toast === 'function') toast('Telegram settings saved', 'success');
      render();
    });
    document.getElementById('tgDiscoverBtn')?.addEventListener('click', async () => {
      const status = document.getElementById('tgStatus');
      const tokenInput = document.getElementById('tgToken').value.trim();
      if (!tokenInput) { status.textContent = '⚠ Paste token first'; status.style.color = 'var(--red)'; return; }
      Telegram.setToken(tokenInput);
      status.textContent = 'Looking…'; status.style.color = 'var(--gold)';
      try {
        const id = await Telegram.discoverChatId();
        document.getElementById('tgChat').value = id;
        status.textContent = '✅ Found: ' + id; status.style.color = 'var(--green)';
      } catch (e) { status.textContent = '⚠ ' + e.message; status.style.color = 'var(--red)'; }
    });
    document.getElementById('tgTestBtn')?.addEventListener('click', async () => {
      const status = document.getElementById('tgStatus');
      Telegram.setToken(document.getElementById('tgToken').value.trim());
      Telegram.setChat(document.getElementById('tgChat').value.trim());
      Telegram.setEnabled(true);
      status.textContent = 'Sending…'; status.style.color = 'var(--gold)';
      try {
        await Telegram.send(`🧪 *Test from AI Dashboard Pro*\n\nIf you see this on your phone, alerts are working ✅\n\n_Sent ${new Date().toLocaleString()}_`, { force: true });
        status.textContent = '✅ Message sent! Check your phone.'; status.style.color = 'var(--green)';
        setTimeout(render, 1500);
      } catch (e) { status.textContent = '⚠ ' + e.message; status.style.color = 'var(--red)'; }
    });
    // Lazy-load the Telegram-dispatch worker code into the <pre> block when expanded
    const tgCodeEl = document.getElementById('tgWorkerCode');
    if (tgCodeEl) {
      fetch('CLOUDFLARE_TELEGRAM_WORKER.js').then(r => r.text()).then(t => { tgCodeEl.textContent = t; }).catch(() => { tgCodeEl.textContent = 'Could not load — find it in the repo root: CLOUDFLARE_TELEGRAM_WORKER.js'; });
    }
  }

  /* ══════════════════════════════════════════════════════
     STORAGE — Cloudflare R2 image upload settings
  ══════════════════════════════════════════════════════ */
  function renderStorage() {
    const workerUrl = (typeof R2 !== 'undefined') ? R2.getWorkerUrl() : '';
    const enabled   = (typeof R2 !== 'undefined') ? R2.getEnabled() : false;
    const log       = (typeof R2 !== 'undefined') ? R2.getLog() : [];
    // Count localStorage usage
    let base64Count = 0, base64Bytes = 0;
    if (typeof DB !== 'undefined') {
      DB.getTrades().forEach(t => {
        const urls = DB.getScreenshots(t);
        urls.forEach(u => {
          if (u.startsWith('data:image')) { base64Count++; base64Bytes += u.length; }
        });
      });
    }
    const base64MB = (base64Bytes / 1024 / 1024).toFixed(2);

    return `<div class="pro-section">
      <h3 class="pro-hdr">📦 Cloudflare R2 — Cloud Image Storage</h3>
      <p class="text-sub" style="font-size:.85rem;margin:0 0 14px">Replace base64 images in localStorage with R2 cloud URLs. New uploads compress to WebP @ 80% quality, max 1200px wide. Free 10GB / forever.</p>

      <div class="form-group">
        <label>Cloudflare Worker URL <span class="text-xs text-sub">(from Worker deploy)</span></label>
        <input type="text" id="r2Url" value="${esc(workerUrl)}" placeholder="https://image-uploader.YOURACCOUNT.workers.dev" />
      </div>

      <div style="display:flex;align-items:center;gap:14px;margin-top:10px">
        <label style="display:flex;align-items:center;gap:8px;font-size:.9rem">
          <span>Enabled</span>
          <label class="tg-switch">
            <input type="checkbox" id="r2Enabled"${enabled?' checked':''} />
            <span class="tg-slider"></span>
          </label>
        </label>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
        <button class="btn-primary" id="r2SaveBtn">💾 Save</button>
        <button class="btn-ghost" id="r2TestBtn">📡 Test Connection</button>
        <span id="r2Status" class="text-dim" style="font-size:.82rem;align-self:center"></span>
      </div>

      <div class="pro-tip" style="margin-top:18px">
        <strong>Current localStorage image bloat:</strong>
        <span style="color:${base64Count>10?'var(--gold)':'var(--text)'}">${base64Count} base64 image${base64Count===1?'':'s'} · ${base64MB} MB</span>
        ${base64Count > 0 ? '<br>Click <strong>Migrate now</strong> to move them all to R2 and reclaim that localStorage space.' : '<br>No base64 images detected. New uploads will go straight to R2 once configured.'}
      </div>

      ${base64Count > 0 ? `<div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn-primary" id="r2MigrateBtn">🚚 Migrate ${base64Count} image${base64Count===1?'':'s'} to R2</button>
        <span id="r2MigrateStatus" class="text-dim" style="font-size:.82rem;align-self:center"></span>
      </div>` : ''}

      <h4 class="pro-hdr" style="font-size:.88rem;margin-top:24px">📜 Recent activity (last ${log.length})</h4>
      ${log.length ? `<div class="tg-log">
        ${log.map(e => `<div class="tg-log-row">
          <span class="tg-log-icon">${e.op==='upload'?'⬆':e.op==='delete'?'🗑':'📡'}</span>
          <span class="tg-log-time text-dim">${esc(new Date(e.time).toLocaleString())}</span>
          <span class="tg-log-text">${e.op === 'upload' ? `${(e.size/1024).toFixed(1)} KB · ${esc(e.url||'')}` : esc(e.key || e.op)}</span>
        </div>`).join('')}
      </div>` : '<p class="text-dim" style="font-size:.85rem">No activity yet.</p>'}

      <h4 class="pro-hdr" style="font-size:.88rem;margin-top:24px">🆘 Setup Guide (~7 min)</h4>
      <ol style="font-size:.85rem;color:var(--text-sub);padding-left:20px;line-height:1.8">
        <li>Go to <strong>cloudflare.com</strong> → sign up free → confirm email</li>
        <li>Left sidebar → <strong>R2 Object Storage</strong> → <strong>Create bucket</strong> → name it <code>ai-dashboard-images</code></li>
        <li>Open the bucket → <strong>Settings</strong> tab → scroll to <strong>Public Access</strong> → click <strong>Allow Access</strong> on the <em>R2.dev subdomain</em> row → copy that <code>https://pub-XXXXX.r2.dev</code> URL</li>
        <li>Left sidebar → <strong>Workers &amp; Pages</strong> → <strong>Create application</strong> → <strong>Create Worker</strong> → name <code>image-uploader</code> → <strong>Deploy</strong></li>
        <li>Click your new Worker → <strong>Edit code</strong> → delete sample → paste the contents of <code>CLOUDFLARE_R2_WORKER.js</code> from your repo (or copy from the Setup Guide tooltip below) → <strong>Save and Deploy</strong></li>
        <li>Back to Worker → <strong>Settings → Variables</strong>:
          <ul style="margin-top:4px">
            <li>Under <strong>R2 Bucket Bindings</strong>: variable name <code>IMAGES</code>, bucket <code>ai-dashboard-images</code></li>
            <li>Under <strong>Environment Variables</strong>: name <code>PUBLIC_URL</code>, value the <code>pub-XXXXX.r2.dev</code> URL from step 3</li>
          </ul>
        </li>
        <li>Copy the Worker URL from the top of the page (e.g. <code>https://image-uploader.YOURACCOUNT.workers.dev</code>) → paste it above → toggle Enabled → 📡 Test Connection</li>
      </ol>
      <details style="margin-top:10px">
        <summary class="text-sub" style="cursor:pointer;font-size:.82rem">📜 Show Worker code to paste</summary>
        <pre style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:12px;overflow-x:auto;font-size:.75rem;margin-top:8px;max-height:240px"><code id="r2WorkerCode">Loading…</code></pre>
      </details>
    </div>`;
  }

  function wireStorage() {
    document.getElementById('r2SaveBtn')?.addEventListener('click', () => {
      R2.setWorkerUrl(document.getElementById('r2Url').value.trim());
      R2.setEnabled(document.getElementById('r2Enabled').checked);
      if (typeof toast === 'function') toast('R2 settings saved', 'success');
      render();
    });
    document.getElementById('r2TestBtn')?.addEventListener('click', async () => {
      const status = document.getElementById('r2Status');
      R2.setWorkerUrl(document.getElementById('r2Url').value.trim());
      status.textContent = 'Pinging worker…'; status.style.color = 'var(--gold)';
      try {
        const txt = await R2.testConnection();
        status.textContent = '✅ Worker says: ' + txt; status.style.color = 'var(--green)';
      } catch (e) { status.textContent = '⚠ ' + e.message; status.style.color = 'var(--red)'; }
    });
    document.getElementById('r2MigrateBtn')?.addEventListener('click', async () => {
      const status = document.getElementById('r2MigrateStatus');
      const btn = document.getElementById('r2MigrateBtn');
      btn.disabled = true; status.textContent = 'Starting…'; status.style.color = 'var(--gold)';
      try {
        const result = await R2.migrateAllBase64({
          onProgress: ({done, total, fail}) => { status.textContent = `${done}/${total} done${fail?` (${fail} failed)`:''}`; },
        });
        status.textContent = `✅ Migrated ${result.done}/${result.total}${result.fail?` (${result.fail} failed)`:''}`;
        status.style.color = 'var(--green)';
        setTimeout(render, 1500);
      } catch (e) { status.textContent = '⚠ ' + e.message; status.style.color = 'var(--red)'; btn.disabled = false; }
    });
    // Load worker code into <pre> when expanded
    const codeEl = document.getElementById('r2WorkerCode');
    if (codeEl) {
      fetch('CLOUDFLARE_R2_WORKER.js').then(r => r.text()).then(t => { codeEl.textContent = t; }).catch(() => { codeEl.textContent = 'Could not load — find it in the repo root: CLOUDFLARE_R2_WORKER.js'; });
    }
  }

  /* ── PIN lock ───────────────────────────────────────── */
  function renderPin() {
    const pinSet = typeof Lock !== 'undefined' && Lock.isSet();
    const idleMins = typeof Lock !== 'undefined' ? Lock.getIdleMins() : 15;
    return `<div class="pro-section">
      <h3 class="pro-section-hdr">🔐 PIN Lock</h3>
      <p class="text-sub" style="font-size:.85rem;margin:0 0 14px">
        Protect the dashboard with a 4-digit PIN. Lock screen appears on every page load and after idle timeout.
        ${!pinSet ? '' : '<br><strong style="color:var(--green)">✅ PIN is active</strong>'}
      </p>
      <div class="ai-grid">
        <div class="form-group">
          <label>${pinSet ? 'Change PIN' : 'Set PIN'}</label>
          <input type="password" id="pinA" maxlength="4" inputmode="numeric" pattern="[0-9]*" placeholder="New 4-digit PIN" style="letter-spacing:.3em;font-size:1.2rem" />
        </div>
        <div class="form-group">
          <label>Confirm PIN</label>
          <input type="password" id="pinB" maxlength="4" inputmode="numeric" pattern="[0-9]*" placeholder="Repeat PIN" style="letter-spacing:.3em;font-size:1.2rem" />
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
        <button class="btn-primary" id="pinSetBtn">${pinSet ? '🔄 Change PIN' : '🔐 Set PIN'}</button>
        ${pinSet ? `<button class="btn-ghost" id="pinRemoveBtn" style="color:var(--red)">🗑 Remove PIN</button>` : ''}
        <span id="pinStatus" class="text-dim" style="font-size:.82rem;align-self:center"></span>
      </div>
      <div class="form-group" style="max-width:220px">
        <label>Auto-lock after idle</label>
        <select id="pinIdleSelect">
          ${[5,10,15,30,60].map(m => `<option value="${m}"${m===idleMins?' selected':''}>${m} min</option>`).join('')}
        </select>
      </div>
      <button class="btn-ghost btn-sm" id="pinIdleSaveBtn" style="margin-top:6px">Save idle timeout</button>
      <p class="text-sub" style="font-size:.75rem;margin-top:14px">
        🔑 Forgot PIN? Open browser DevTools → Console → type <code>localStorage.removeItem('jb_pin')</code> → reload.
      </p>
    </div>`;
  }

  function wirePin() {
    const status = document.getElementById('pinStatus');
    document.getElementById('pinSetBtn')?.addEventListener('click', async () => {
      const a = document.getElementById('pinA').value.trim();
      const b = document.getElementById('pinB').value.trim();
      if (!/^\d{4}$/.test(a)) { status.textContent = '⚠ PIN must be exactly 4 digits'; status.style.color = 'var(--red)'; return; }
      if (a !== b) { status.textContent = '⚠ PINs do not match'; status.style.color = 'var(--red)'; return; }
      await Lock.setup(a);
      if (typeof toast === 'function') toast('PIN saved — active on next load', 'success');
      Lock.startIdleWatch();
      render();
    });
    document.getElementById('pinRemoveBtn')?.addEventListener('click', () => {
      Lock.remove();
      Lock.stopIdleWatch();
      if (typeof toast === 'function') toast('PIN removed', 'success');
      render();
    });
    document.getElementById('pinIdleSaveBtn')?.addEventListener('click', () => {
      const v = parseInt(document.getElementById('pinIdleSelect').value);
      Lock.setIdleMins(v);
      Lock.startIdleWatch(); // restart with new timeout
      if (typeof toast === 'function') toast(`Idle lock set to ${v} min`, 'success');
    });
  }

  /* ── Backup & Export ─────────────────────────────────── */
  const TRADE_COLS = [
    'id','date','dateEnd','symbol','direction','session','htfBias','setupType',
    'entry','sl','tp','exitPrice','size','result','rMultiple',
    'preGrade','preGradeNotes','postGrade','postGradeNotes','notes',
    'source','createdAt'
  ];

  function _csvEscape(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function _tradesToRows() {
    const trades = DB.getTrades();
    const header = TRADE_COLS;
    const rows   = trades.map(t => TRADE_COLS.map(c => t[c] !== undefined ? t[c] : ''));
    return { header, rows, count: trades.length };
  }

  function _download(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function _todayStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  function exportTradesCSV() {
    const { header, rows, count } = _tradesToRows();
    if (!count) { if (typeof toast === 'function') toast('No trades to export', 'warn'); return; }
    const lines = [header.map(_csvEscape).join(',')]
      .concat(rows.map(r => r.map(_csvEscape).join(',')));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    _download(`trades_${_todayStamp()}.csv`, blob);
    if (typeof toast === 'function') toast(`Exported ${count} trades → CSV`, 'success');
  }

  function _loadSheetJS() {
    return new Promise((resolve, reject) => {
      if (typeof XLSX !== 'undefined') return resolve(XLSX);
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload  = () => resolve(window.XLSX);
      s.onerror = () => reject(new Error('Failed to load SheetJS'));
      document.head.appendChild(s);
    });
  }

  async function exportTradesXLSX() {
    const { header, rows, count } = _tradesToRows();
    if (!count) { if (typeof toast === 'function') toast('No trades to export', 'warn'); return; }
    try {
      const X = await _loadSheetJS();
      const aoa = [header, ...rows];
      const ws  = X.utils.aoa_to_sheet(aoa);
      const wb  = X.utils.book_new();
      X.utils.book_append_sheet(wb, ws, 'Trades');
      X.writeFile(wb, `trades_${_todayStamp()}.xlsx`);
      if (typeof toast === 'function') toast(`Exported ${count} trades → Excel`, 'success');
    } catch (e) {
      if (typeof toast === 'function') toast('Excel export failed: ' + e.message, 'error');
    }
  }

  function exportFullBackupJSON() {
    const dump = { _meta: { exported: new Date().toISOString(), app: 'AI Dashboard Pro' }, data: {} };
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('jb_')) dump.data[k] = localStorage.getItem(k);
    }
    const keyCount = Object.keys(dump.data).length;
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    _download(`dashboard_backup_${_todayStamp()}.json`, blob);
    if (typeof toast === 'function') toast(`Backed up ${keyCount} keys → JSON`, 'success');
  }

  function restoreBackupJSON(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (!parsed.data || typeof parsed.data !== 'object') throw new Error('Invalid backup file');
        const keys = Object.keys(parsed.data);
        if (!keys.length) throw new Error('Backup contains no data');
        if (!confirm(`Restore ${keys.length} keys from backup?\n\nThis will OVERWRITE matching keys in your current dashboard. Continue?`)) return;
        keys.forEach(k => {
          if (k.startsWith('jb_')) localStorage.setItem(k, parsed.data[k]);
        });
        if (typeof toast === 'function') toast(`Restored ${keys.length} keys — reloading...`, 'success');
        setTimeout(() => location.reload(), 800);
      } catch (err) {
        if (typeof toast === 'function') toast('Restore failed: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  }

  function renderBackup() {
    const tradeCount = DB.getTrades().length;
    let totalKeys = 0, totalBytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('jb_')) {
        totalKeys++;
        totalBytes += (localStorage.getItem(k) || '').length;
      }
    }
    const sizeKB = (totalBytes / 1024).toFixed(1);

    return `<div class="pro-section">
      <h3 class="pro-section-hdr">💾 Backup & Export</h3>
      <p class="text-sub" style="font-size:.85rem;margin:0 0 14px">
        Your data lives in this browser only. Export it for safekeeping or to move to another device.<br>
        <strong>Local store:</strong> ${tradeCount} trades · ${totalKeys} keys · ${sizeKB} KB
      </p>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:20px">
        <button class="btn-primary" id="bkCsvBtn">📥 Trades → CSV</button>
        <button class="btn-primary" id="bkXlsxBtn">📥 Trades → Excel (.xlsx)</button>
        <button class="btn-primary" id="bkJsonBtn">📥 Full Backup → JSON</button>
      </div>

      <h4 style="margin:18px 0 8px;font-size:.95rem">📤 Restore from JSON backup</h4>
      <p class="text-sub" style="font-size:.78rem;margin:0 0 10px">
        Select a previously-downloaded <code>dashboard_backup_*.json</code>. Matching keys will be overwritten.
      </p>
      <input type="file" id="bkRestoreFile" accept="application/json,.json" style="font-size:.85rem" />

      <h4 style="margin:24px 0 8px;font-size:.95rem">☁️ Cloud sync (private GitHub Gist)</h4>
      ${renderCloudSection()}
    </div>`;
  }

  function _fmtAge(iso) {
    if (!iso) return 'never';
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.round(ms / 60000);
    if (m < 1)   return 'just now';
    if (m < 60)  return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 48)  return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }

  function renderCloudSection() {
    if (typeof CloudSync === 'undefined') {
      return `<p class="text-sub" style="font-size:.8rem">CloudSync module not loaded.</p>`;
    }
    const inf = CloudSync.info();
    const statusColors = { ok: 'var(--green)', error: 'var(--red)', dirty: 'var(--accent)', syncing: 'var(--accent)', restoring: 'var(--accent)', off: 'var(--text-dim)', idle: 'var(--text-dim)' };
    const statusLabel = { ok: '✅ Synced', error: '⚠ Error', dirty: '⏳ Pending sync', syncing: '⟳ Syncing…', restoring: '⟳ Restoring…', off: '○ Off', idle: '○ Idle' };
    const sc = statusColors[inf.status] || 'var(--text-dim)';
    const sl = statusLabel[inf.status]  || esc(inf.status);
    // GitHub gist IDs are alphanumeric — validate before injecting into href.
    const safeGistId = (typeof inf.gistId === 'string' && /^[a-zA-Z0-9]+$/.test(inf.gistId)) ? inf.gistId : '';
    const gistLink = safeGistId ? `<a href="https://gist.github.com/${safeGistId}" target="_blank" rel="noopener">${esc(safeGistId.slice(0, 12))}…</a>` : '—';

    if (!inf.enabled) {
      return `<p class="text-sub" style="font-size:.8rem;margin:0 0 10px">
          Auto-syncs every change (debounced 5s) to a <strong>private gist</strong> on your GitHub.
          Restore on any device by pasting the same token.
        </p>
        <ol style="font-size:.78rem;color:var(--text-sub);margin:0 0 12px 18px;padding:0">
          <li>Go to <a href="https://github.com/settings/tokens/new?scopes=gist&description=AI%20Dashboard%20Pro%20cloud%20sync" target="_blank">github.com/settings/tokens/new</a> (this is the <strong>classic</strong> token page — fine-grained tokens don't support gists yet)</li>
          <li>The <strong>gist</strong> scope checkbox is already ticked via the link above. Set expiration if you want, then click <strong>Generate token</strong></li>
          <li>Copy the token (starts with <code>ghp_…</code>) and paste below</li>
        </ol>
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
          <div class="form-group" style="flex:1;min-width:280px;margin:0">
            <label>GitHub PAT (gist scope)</label>
            <input type="password" id="csTokenInput" placeholder="github_pat_…" autocomplete="off" />
          </div>
          <button class="btn-primary" id="csEnableBtn">Enable cloud sync</button>
        </div>
        <p class="text-sub" style="font-size:.72rem;margin-top:8px">
          ⚠ The token is stored in this browser's localStorage. Treat it like a password.
        </p>`;
    }

    return `<div style="background:var(--bg-mid);padding:12px 14px;border-radius:8px;margin-bottom:12px">
      <div style="display:flex;gap:18px;flex-wrap:wrap;font-size:.85rem">
        <div><span class="text-dim">Status:</span> <strong style="color:${sc}">${sl}</strong></div>
        <div><span class="text-dim">Gist:</span> ${gistLink}</div>
        <div><span class="text-dim">Last sync:</span> ${_fmtAge(inf.lastSync)}</div>
      </div>
      ${inf.lastError ? `<div style="margin-top:10px;padding:10px 12px;background:rgba(220,60,60,0.08);border:1px solid rgba(220,60,60,0.3);border-radius:6px;font-size:.8rem;color:var(--red);word-break:break-word">
        <strong>Error:</strong> ${esc(inf.lastError)}
        ${/Resource not accessible by personal access token|403/i.test(inf.lastError) ? `<div style="color:var(--text-sub);margin-top:6px;font-size:.75rem">→ Most likely cause: you used a <strong>fine-grained</strong> token (<code>github_pat_…</code>). GitHub's Gist API only accepts <strong>classic</strong> tokens (<code>ghp_…</code>). Click <strong>Disable cloud sync</strong>, then create a classic token at <a href="https://github.com/settings/tokens/new?scopes=gist&description=AI%20Dashboard%20Pro%20cloud%20sync" target="_blank">github.com/settings/tokens/new</a> with the <strong>gist</strong> scope ticked.</div>` : ''}
        ${/401|Bad credentials/i.test(inf.lastError) ? `<div style="color:var(--text-sub);margin-top:6px;font-size:.75rem">→ The token is invalid or expired. Regenerate a classic token at <a href="https://github.com/settings/tokens/new?scopes=gist" target="_blank">github.com/settings/tokens/new</a>.</div>` : ''}
        ${/404|Not Found/i.test(inf.lastError) ? `<div style="color:var(--text-sub);margin-top:6px;font-size:.75rem">→ The gist may have been deleted on GitHub. Click <strong>Disable cloud sync</strong> and re-enable to create a fresh one.</div>` : ''}
      </div>` : ''}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <button class="btn-primary" id="csSyncBtn">⟳ Sync now</button>
      <button class="btn-ghost" id="csRestoreBtn">↓ Restore from cloud</button>
      <button class="btn-ghost" id="csDisableBtn" style="color:var(--red);margin-left:auto">Disable cloud sync</button>
    </div>
    <p id="csMsg" class="text-sub" style="font-size:.78rem;margin:0;min-height:1.2em"></p>`;
  }

  function wireCloud() {
    const msg = document.getElementById('csMsg');
    const showMsg = (text, isErr) => { if (msg) { msg.textContent = text; msg.style.color = isErr ? 'var(--red)' : 'var(--green)'; } };

    document.getElementById('csEnableBtn')?.addEventListener('click', async () => {
      const tok = document.getElementById('csTokenInput').value.trim();
      if (!tok.startsWith('ghp_')) {
        if (typeof toast === 'function') toast('Token must be a CLASSIC token (starts with ghp_). Fine-grained tokens are not yet supported by the Gist API.', 'error');
        return;
      }
      CloudSync.setToken(tok);
      const r = await CloudSync.syncNow();
      if (typeof toast === 'function') toast(r.ok ? 'Cloud sync enabled — first backup uploaded' : 'Failed: ' + r.msg, r.ok ? 'success' : 'error');
      render();
    });

    document.getElementById('csSyncBtn')?.addEventListener('click', async () => {
      showMsg('Syncing…', false);
      const r = await CloudSync.syncNow();
      showMsg(r.ok ? `✓ ${r.msg}` : `⚠ ${r.msg}`, !r.ok);
      render();
    });

    document.getElementById('csRestoreBtn')?.addEventListener('click', async () => {
      if (!confirm('Restore from cloud will OVERWRITE matching keys in this browser with the version stored in your gist. Continue?')) return;
      showMsg('Restoring…', false);
      const r = await CloudSync.restoreFromCloud();
      showMsg(r.ok ? `✓ ${r.msg} — reloading…` : `⚠ ${r.msg}`, !r.ok);
      if (r.ok) setTimeout(() => location.reload(), 800);
    });

    document.getElementById('csDisableBtn')?.addEventListener('click', () => {
      if (!confirm('Disable cloud sync? Your gist will remain on GitHub but auto-sync will stop and the token will be removed from this browser.')) return;
      CloudSync.clearToken();
      if (typeof toast === 'function') toast('Cloud sync disabled', 'success');
      render();
    });
  }

  function wireBackup() {
    document.getElementById('bkCsvBtn')?.addEventListener('click', exportTradesCSV);
    document.getElementById('bkXlsxBtn')?.addEventListener('click', exportTradesXLSX);
    document.getElementById('bkJsonBtn')?.addEventListener('click', exportFullBackupJSON);
    document.getElementById('bkRestoreFile')?.addEventListener('change', e => {
      const f = e.target.files?.[0];
      if (f) restoreBackupJSON(f);
    });
    wireCloud();
  }

  /* ── Inline calculators ─────────────────────────────── */
  function _calcRR() {
    const entry  = parseFloat(document.getElementById('rrEntry')?.value)  || 0;
    const stop   = parseFloat(document.getElementById('rrStop')?.value)   || 0;
    const target = parseFloat(document.getElementById('rrTarget')?.value) || 0;
    const out = document.getElementById('rrResult');
    if (!out) return;
    if (!entry || !stop || !target) { out.innerHTML = '<span style="color:var(--text-dim);font-size:.82rem">Enter all three values</span>'; return; }
    const risk   = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    const rr     = risk > 0 ? reward / risk : 0;
    const rrColor = rr >= 2 ? 'var(--green)' : rr >= 1 ? 'var(--gold)' : 'var(--red)';
    out.innerHTML = `<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:4px">
      <div><div style="font-size:.75rem;color:var(--text-dim)">Risk</div><div style="color:var(--red);font-weight:600">$${risk.toFixed(2)}</div></div>
      <div><div style="font-size:.75rem;color:var(--text-dim)">Reward</div><div style="color:var(--green);font-weight:600">$${reward.toFixed(2)}</div></div>
      <div><div style="font-size:.75rem;color:var(--text-dim)">R:R</div><div style="color:${rrColor};font-weight:700;font-size:1.1rem">${rr.toFixed(2)} : 1</div></div>
    </div>`;
  }

  function _calcCompound() {
    const capital = parseFloat(document.getElementById('cpCapital')?.value) || 0;
    const monthly = parseFloat(document.getElementById('cpMonthly')?.value) || 0;
    const out = document.getElementById('cpResult');
    if (!out) return;
    if (!capital || !monthly) { out.innerHTML = '<span style="color:var(--text-dim);font-size:.82rem">Enter capital and monthly %</span>'; return; }
    const r = monthly / 100;
    const m3  = capital * Math.pow(1 + r, 3);
    const m6  = capital * Math.pow(1 + r, 6);
    const m12 = capital * Math.pow(1 + r, 12);
    const fmt = v => '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    out.innerHTML = `<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:4px">
      <div><div style="font-size:.75rem;color:var(--text-dim)">3M</div><div style="color:var(--green);font-weight:600">${fmt(m3)}</div></div>
      <div><div style="font-size:.75rem;color:var(--text-dim)">6M</div><div style="color:var(--green);font-weight:600">${fmt(m6)}</div></div>
      <div><div style="font-size:.75rem;color:var(--text-dim)">12M</div><div style="color:var(--green);font-weight:700;font-size:1.05rem">${fmt(m12)}</div></div>
    </div>`;
  }

  function _calcDD() {
    const dd  = parseFloat(document.getElementById('ddPct')?.value) || 0;
    const out = document.getElementById('ddResult');
    if (!out) return;
    if (!dd || dd <= 0 || dd >= 100) { out.innerHTML = '<span style="color:var(--text-dim);font-size:.82rem">Enter drawdown % (1–99)</span>'; return; }
    const required = (1 / (1 - dd / 100) - 1) * 100;
    const rrColor = required > 100 ? 'var(--red)' : required > 50 ? 'var(--gold)' : 'var(--text)';
    out.innerHTML = `<div style="margin-top:4px">
      <div style="font-size:.75rem;color:var(--text-dim)">Required gain to break even</div>
      <div style="color:${rrColor};font-weight:700;font-size:1.15rem">${required.toFixed(1)}%</div>
    </div>`;
  }

  function _renderCalcCards() {
    return `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px">

      <div class="card" style="padding:16px">
        <div style="font-weight:600;font-size:15px;margin-bottom:4px">R:R Calculator</div>
        <div style="font-size:12px;color:var(--text-dim);margin-bottom:12px">Entry, stop &amp; target → ratio</div>
        <div class="form-group" style="margin-bottom:8px">
          <label>Entry</label>
          <input type="number" id="rrEntry" placeholder="e.g. 95000" step="any" oninput="ProToolsTab._calcRR()" />
        </div>
        <div class="form-group" style="margin-bottom:8px">
          <label>Stop</label>
          <input type="number" id="rrStop" placeholder="e.g. 94200" step="any" oninput="ProToolsTab._calcRR()" />
        </div>
        <div class="form-group" style="margin-bottom:10px">
          <label>Target</label>
          <input type="number" id="rrTarget" placeholder="e.g. 96800" step="any" oninput="ProToolsTab._calcRR()" />
        </div>
        <div id="rrResult"><span style="color:var(--text-dim);font-size:.82rem">Enter all three values</span></div>
      </div>

      <div class="card" style="padding:16px">
        <div style="font-weight:600;font-size:15px;margin-bottom:4px">Compound Projection</div>
        <div style="font-size:12px;color:var(--text-dim);margin-bottom:12px">Capital × monthly % → 3/6/12M</div>
        <div class="form-group" style="margin-bottom:8px">
          <label>Starting Capital ($)</label>
          <input type="number" id="cpCapital" placeholder="e.g. 10000" step="any" oninput="ProToolsTab._calcCompound()" />
        </div>
        <div class="form-group" style="margin-bottom:10px">
          <label>Monthly % Return</label>
          <input type="number" id="cpMonthly" placeholder="e.g. 5" step="0.1" oninput="ProToolsTab._calcCompound()" />
        </div>
        <div id="cpResult"><span style="color:var(--text-dim);font-size:.82rem">Enter capital and monthly %</span></div>
      </div>

      <div class="card" style="padding:16px">
        <div style="font-weight:600;font-size:15px;margin-bottom:4px">Drawdown Recovery</div>
        <div style="font-size:12px;color:var(--text-dim);margin-bottom:12px">Drawdown % → gain needed</div>
        <div class="form-group" style="margin-bottom:10px">
          <label>Drawdown (%)</label>
          <input type="number" id="ddPct" placeholder="e.g. 20" step="0.1" min="1" max="99" oninput="ProToolsTab._calcDD()" />
        </div>
        <div id="ddResult"><span style="color:var(--text-dim);font-size:.82rem">Enter drawdown % (1–99)</span></div>
      </div>

    </div>`;
  }

  /* ── Tab nav ────────────────────────────────────────── */
  function render() {
    const content = document.getElementById('content');
    content.innerHTML = `<div class="page-head">
      <h1>Pro Tools</h1>
      <p class="subtitle">Calculators and utilities</p>
    </div>
    ${_renderCalcCards()}
    <div class="pro-wrap">
      <div class="pro-subnav">
        <button class="pro-sub-btn${_sub==='sizer'?' active':''}" data-sub="sizer">📐 Position Sizer</button>
        <button class="pro-sub-btn${_sub==='qstats'?' active':''}" data-sub="qstats">📊 Quick Stats</button>
        <button class="pro-sub-btn${_sub==='replay'?' active':''}" data-sub="replay">▶ Trade Replay</button>
        <button class="pro-sub-btn${_sub==='corr'?' active':''}" data-sub="corr">📊 Correlation</button>
        <button class="pro-sub-btn${_sub==='telegram'?' active':''}" data-sub="telegram">🔔 Telegram</button>
        <button class="pro-sub-btn${_sub==='storage'?' active':''}" data-sub="storage">📦 Storage</button>
        <button class="pro-sub-btn${_sub==='pin'?' active':''}" data-sub="pin">🔐 PIN Lock</button>
        <button class="pro-sub-btn${_sub==='backup'?' active':''}" data-sub="backup">💾 Backup</button>
      </div>
      <div id="proBody">${
        _sub === 'sizer'   ? renderSizer() :
        _sub === 'qstats'  ? `<div class="pro-section"><div class="qs-wrap" style="padding:0">${typeof QuickStatsTab !== 'undefined' ? QuickStatsTab._renderHTML() : '<div class="empty-state">QuickStatsTab not loaded</div>'}</div></div>` :
        _sub === 'replay'  ? renderReplay() :
        _sub === 'telegram'? renderTelegram() :
        _sub === 'storage' ? renderStorage() :
        _sub === 'pin'     ? renderPin() :
        _sub === 'backup'  ? renderBackup() :
        renderCorrelation()
      }</div>
    </div>`;

    // Subnav wiring
    document.querySelectorAll('.pro-sub-btn').forEach(b => {
      b.addEventListener('click', () => { saveSub(b.dataset.sub); render(); });
    });

    // Sub-feature wiring
    if (_sub === 'sizer') {
      ['psAccount','psRisk','psEntry','psStop','psTP'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', renderSizerResult);
      });
      document.getElementById('psSaveBtn')?.addEventListener('click', () => {
        _sizerCfg.account = parseFloat(document.getElementById('psAccount').value) || 10000;
        _sizerCfg.riskPct = parseFloat(document.getElementById('psRisk').value) || 1;
        saveSizer();
        if (typeof toast === 'function') toast('Defaults saved', 'success');
      });
    } else if (_sub === 'qstats') {
      if (typeof QuickStatsTab !== 'undefined') QuickStatsTab._wireUp();
    } else if (_sub === 'telegram') {
      wireTelegram();
    } else if (_sub === 'storage') {
      wireStorage();
    } else if (_sub === 'pin') {
      wirePin();
    } else if (_sub === 'backup') {
      wireBackup();
    } else if (_sub === 'replay') {
      document.getElementById('rpTrade')?.addEventListener('change', e => {
        if (e.target.value) runReplay(e.target.value);
      });
    } else if (_sub === 'corr') {
      document.getElementById('corrLoadBtn')?.addEventListener('click', loadCorrData);
      document.getElementById('corrAddBtn')?.addEventListener('click', () => {
        const raw = document.getElementById('corrAddInput').value.trim().toUpperCase();
        // Strip non-alphanumerics — protects the onclick="...('${p}')"
        // interpolation downstream and keeps the Binance call valid.
        const v = raw.replace(/[^A-Z0-9]/g, '');
        if (!v) return;
        const sym = v.endsWith('USDT') ? v : v + 'USDT';
        if (!safeSym(sym)) return;
        if (!_corrPairs.includes(sym)) { _corrPairs.push(sym); saveCorr(); render(); }
      });
      if (_corrData) renderCorrTable();
    }
  }

  return {
    render,
    _calcRR,
    _calcCompound,
    _calcDD,
    _removeCorrPair: sym => {
      _corrPairs = _corrPairs.filter(p => p !== sym);
      saveCorr();
      _corrData = null;
      render();
    },
  };
})();
