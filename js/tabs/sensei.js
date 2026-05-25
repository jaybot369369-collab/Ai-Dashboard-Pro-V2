/* ═══════════════════════════════════════════════════════════
   SENSEI — AI COACH TAB
   Renders the daily coaching report from the fund API.

   Reads:
     GET  /api/coach/latest                — most-recent report + meta
     GET  /api/coach/history?limit=14      — last N report headlines
     GET  /api/coach/by_date/{YYYY-MM-DD}  — historical report

   The Sensei bot writes one report per day (~09:00 UTC) and
   posts metadata via the message bus (`coach_report` type).
   This tab pairs the Markdown body with that metadata.

   Local access (dashboard opened on host): http://127.0.0.1:8767/
   Remote access: reuse FundTab's `fund_remote_url` localStorage.
═══════════════════════════════════════════════════════════ */
const SenseiTab = (() => {

  const LOCAL_URL = 'http://127.0.0.1:8767/';
  const LS_KEY    = 'fund_remote_url';   // shared with FundTab — same fund API

  function _isLocal() {
    const h = window.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '' || h === '0.0.0.0';
  }

  function _resolveBase() {
    if (_isLocal()) return LOCAL_URL;
    const override = (localStorage.getItem(LS_KEY) || '').trim();
    // On Railway / remote: same-origin (nginx proxies /api/ to fund.api)
    return (override || (window.location.origin + '/')).replace(/\/?$/, '/');
  }

  async function _fetchJSON(base, path) {
    const url = base + path.replace(/^\//, '');
    try {
      const r = await fetch(url, {
        method: 'GET', mode: 'cors', cache: 'no-store',
        signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
      });
      if (!r.ok) return { _err: `HTTP ${r.status}` };
      return await r.json();
    } catch (e) {
      return { _err: e.message || String(e) };
    }
  }

  /* ── tiny Markdown → HTML (handles what Sensei's prompt emits) ── */
  function _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function _inline(s) {
    // Bold **text**, italic *text*, inline `code`
    return _esc(s)
      .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*(?!\s)([^*]+)(?<!\s)\*/g, '<em>$1</em>');
  }
  function _renderMarkdown(md) {
    const lines = (md || '').split(/\r?\n/);
    const out = [];
    let inList = false, inCode = false;
    const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      if (/^```/.test(line)) {
        closeList();
        if (inCode) { out.push('</pre>'); inCode = false; }
        else        { out.push('<pre>'); inCode = true; }
        continue;
      }
      if (inCode) { out.push(_esc(line)); continue; }
      if (!line.trim()) { closeList(); continue; }
      let m;
      if ((m = /^# (.+)$/.exec(line))) {
        closeList(); out.push(`<h1 class="sn-h1">${_inline(m[1])}</h1>`); continue;
      }
      if ((m = /^## (.+)$/.exec(line))) {
        closeList(); out.push(`<h2 class="sn-h2">${_inline(m[1])}</h2>`); continue;
      }
      if ((m = /^### (.+)$/.exec(line))) {
        closeList(); out.push(`<h3 class="sn-h3">${_inline(m[1])}</h3>`); continue;
      }
      if ((m = /^[-*] (.+)$/.exec(line))) {
        if (!inList) { out.push('<ul class="sn-ul">'); inList = true; }
        out.push(`<li>${_inline(m[1])}</li>`); continue;
      }
      if ((m = /^(\d+)\. (.+)$/.exec(line))) {
        if (!inList) { out.push('<ol class="sn-ol">'); inList = true; }
        out.push(`<li>${_inline(m[2])}</li>`); continue;
      }
      closeList();
      out.push(`<p>${_inline(line)}</p>`);
    }
    closeList();
    if (inCode) out.push('</pre>');
    return out.join('\n');
  }

  /* ── Metadata bar ───────────────────────────────────────── */
  function _metaBar(meta, date) {
    if (!meta || typeof meta !== 'object') {
      return `<div class="sn-meta-bar sn-meta-empty">No metadata for ${date} yet</div>`;
    }
    const cost = (typeof meta.cost_usd === 'number')
      ? `$${meta.cost_usd.toFixed(4)}` : '—';
    const tIn  = meta.tokens_in  ?? '—';
    const tOut = meta.tokens_out ?? '—';
    const tools = meta.tool_calls ?? '—';
    const pc = meta.pass_count, pt = meta.pass_total;
    const stage2 = (pc != null && pt != null)
      ? `<span class="sn-meta-stage2">Stage 2 — ${pc}/${pt} passing</span>`
      : '';
    return `<div class="sn-meta-bar">
      ${stage2}
      <span class="sn-meta-pill">cost ${cost}</span>
      <span class="sn-meta-pill">${tIn}↓ / ${tOut}↑ tok</span>
      <span class="sn-meta-pill">${tools} tools</span>
    </div>`;
  }

  /* ── State (per-render) ─────────────────────────────────── */
  let _history = [];
  let _selectedDate = null;
  let _baseUrl = '';

  /* ── HTML scaffolding ───────────────────────────────────── */
  function _shellHTML(headerHTML, bodyHTML) {
    return `
      <div class="sn-wrap">
        <div class="sn-header">
          <div class="sn-header-left">
            <span class="sn-icon">🧙</span>
            <span class="sn-title">Sensei — Coach Report</span>
          </div>
          ${headerHTML}
        </div>
        <div class="sn-body">${bodyHTML}</div>
      </div>
      ${_styles()}
    `;
  }

  function _historyDropdown() {
    if (!_history.length) return '';
    const opts = _history.map(r => {
      const sel = r.date === _selectedDate ? ' selected' : '';
      const lbl = r.date + (r.headline && r.headline !== '(no headline)'
        ? ` — ${r.headline.slice(0, 60)}${r.headline.length > 60 ? '…' : ''}`
        : '');
      return `<option value="${r.date}"${sel}>${_esc(lbl)}</option>`;
    }).join('');
    return `<select id="snDatePicker" class="sn-date-picker">${opts}</select>`;
  }

  function _headerControls() {
    return `
      <div class="sn-header-right">
        ${_historyDropdown()}
        <button class="btn-ghost btn-sm" id="snRefresh" title="Re-fetch">↻</button>
      </div>
    `;
  }

  /* State-aware offline panels. Pick the friendliest template based on
     what's actually wrong. Never shows raw terminal commands to the
     operator (they hired Claude precisely to not see those). */
  function _offlineHTML_FundDown(detail) {
    return `
      <div class="sn-offline">
        <div class="sn-offline-icon">⚠️</div>
        <h2 class="sn-offline-title">Bot Farm is offline</h2>
        <p class="sn-offline-sub">Sensei lives inside the fund, so when the fund API isn't running, the report panel can't load.</p>
        <p class="sn-offline-sub" style="opacity:.6; font-size:11px;">${_esc(detail || '')}</p>
        <div class="sn-offline-actions">
          <button class="btn-primary" id="snRetry">Retry now</button>
        </div>
        <p class="sn-offline-sub" style="margin-top:14px; opacity:.6; font-size:11px;">
          The fund's launcher script auto-restarts crashed bots. If this stays red for more than a minute, your operator needs to run the launcher.
        </p>
      </div>`;
  }

  function _offlineHTML_NoKey() {
    return `
      <div class="sn-offline">
        <div class="sn-offline-icon">🔑</div>
        <h2 class="sn-offline-title">Sensei is waiting for an API key</h2>
        <p class="sn-offline-sub">Sensei calls Anthropic's Claude to write the daily coaching report. To do that it needs your API key. Paste it once below — both Sensei AND the AI Coach feature use the same key.</p>

        <div class="sn-key-form">
          <label class="sn-key-label">Anthropic API key</label>
          <input type="password" id="snKeyInput" class="sn-key-input"
            placeholder="sk-ant-api03-..." autocomplete="off" spellcheck="false" />
          <div class="sn-key-actions">
            <button class="btn-primary" id="snKeySave">Save key</button>
            <a class="sn-key-link" href="https://console.anthropic.com/" target="_blank" rel="noopener">Get a key →</a>
          </div>
          <div id="snKeyResult" class="sn-key-result"></div>
        </div>

        <p class="sn-offline-sub" style="margin-top:14px; opacity:.55; font-size:11px;">
          Stored on your Mac in <code>fund_data/dashboard_state.json</code> (chmod 600, never sent to GitHub). Sensei picks it up within 60 seconds — no restart needed.
        </p>
      </div>`;
  }

  function _offlineHTML_WaitingFirstRun(scheduleHourUtc) {
    // Convert UTC hour to next-fire local time string
    let nextStr = '';
    try {
      const now = new Date();
      const next = new Date(now);
      next.setUTCHours(scheduleHourUtc, 0, 0, 0);
      if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
      const hours = Math.round((next - now) / 3600000);
      const localStr = next.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      nextStr = `Next run at ${localStr} (${hours}h ${hours===1?'':'away'})`;
    } catch (_) { nextStr = 'Next run scheduled'; }
    return `
      <div class="sn-offline">
        <div class="sn-offline-icon">🧙</div>
        <h2 class="sn-offline-title">Sensei is ready — first report pending</h2>
        <p class="sn-offline-sub">API key is wired and Sensei is online. It runs once a day. ${_esc(nextStr)}.</p>
        <p class="sn-offline-sub" style="opacity:.65; font-size:11px;">Tip: while you wait, add a few closed trades to the Trade Log so Sensei has material to critique on its first run.</p>
        <div class="sn-offline-actions">
          <button class="btn-primary" id="snRetry">Refresh</button>
        </div>
      </div>`;
  }

  function _offlineHTML_Generic(reason) {
    return `
      <div class="sn-offline">
        <div class="sn-offline-icon">🧙</div>
        <h2 class="sn-offline-title">Sensei is taking a moment</h2>
        <p class="sn-offline-sub">${_esc(reason || '')}</p>
        <div class="sn-offline-actions">
          <button class="btn-primary" id="snRetry">Retry</button>
        </div>
      </div>`;
  }

  function _reportHTML(rep, meta) {
    const headlineText = _extractHeadline(rep.markdown) || '(no headline)';
    return `
      <div class="sn-headline">
        <div class="sn-headline-tag">HEADLINE</div>
        <div class="sn-headline-body">${_inline(headlineText)}</div>
      </div>
      ${_metaBar(meta, rep.date)}
      <article class="sn-report">${_renderMarkdown(rep.markdown)}</article>
      <div class="sn-footer">
        <span class="text-dim">file: ${_esc(rep.file_path || '')}</span>
      </div>
    `;
  }

  function _extractHeadline(md) {
    if (!md) return '';
    // Find "## Headline" then the next non-blank, non-header line
    const lines = md.split(/\r?\n/);
    let i = lines.findIndex(l => /^##\s+Headline\s*$/i.test(l));
    if (i < 0) return '';
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (!t) continue;
      if (/^#/.test(t)) break;
      return t;
    }
    return '';
  }

  /* ── Wire-up ────────────────────────────────────────────── */
  function _wireHandlers() {
    const retry = document.getElementById('snRetry');
    if (retry) retry.addEventListener('click', () => render());

    const refresh = document.getElementById('snRefresh');
    if (refresh) refresh.addEventListener('click', () => render());

    const picker = document.getElementById('snDatePicker');
    if (picker) picker.addEventListener('change', (e) => {
      _selectedDate = e.target.value;
      _renderForSelectedDate();
    });

    // Inline "Save key" form (only present in the no-key panel)
    const keySave = document.getElementById('snKeySave');
    const keyInput = document.getElementById('snKeyInput');
    const keyResult = document.getElementById('snKeyResult');
    if (keySave && keyInput) {
      const doSave = async () => {
        const k = (keyInput.value || '').trim();
        if (!k) { keyResult.textContent = 'Paste a key first.'; keyResult.className = 'sn-key-result err'; return; }
        if (!k.startsWith('sk-ant-')) { keyResult.textContent = 'Anthropic keys start with sk-ant-.'; keyResult.className = 'sn-key-result err'; return; }
        keySave.disabled = true; keyResult.textContent = 'Saving…'; keyResult.className = 'sn-key-result';
        try {
          // Persist to the fund's disk store (single source of truth for both Sensei + AI Coach)
          const r = await fetch(_baseUrl + 'api/dashboard/state', {
            method: 'POST', mode: 'cors', cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ai_key: k }),
          });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          // Also mirror to localStorage so the AI Coach feature sees it immediately
          localStorage.setItem('jb_ai_key', k);
          keyInput.value = '';
          keyResult.innerHTML = '✓ Saved. Sensei will pick this up within 60 seconds. <a href="#" id="snKeyRefresh">Refresh now</a>';
          keyResult.className = 'sn-key-result ok';
          const ref = document.getElementById('snKeyRefresh');
          if (ref) ref.addEventListener('click', (e) => { e.preventDefault(); render(); });
        } catch (e) {
          keyResult.textContent = 'Save failed: ' + e.message;
          keyResult.className = 'sn-key-result err';
        } finally {
          keySave.disabled = false;
        }
      };
      keySave.addEventListener('click', doSave);
      keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); });
    }
  }

  async function _renderForSelectedDate() {
    const content = document.getElementById('content');
    if (!content) return;
    if (!_selectedDate) return;
    // Whitelist date format before injecting into URL — protects against
    // crafted dropdown values steering the request to a different path.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(_selectedDate)) {
      content.innerHTML = _shellHTML(_headerControls(), _offlineHTML_Generic('Invalid date format'));
      _wireHandlers();
      return;
    }

    const data = await _fetchJSON(_baseUrl, `api/coach/by_date/${_selectedDate}`);
    if (data._err) {
      // Was calling _offlineHTML(...) which doesn't exist (only the
      // _FundDown / _NoKey / _WaitingFirstRun / _Generic variants do).
      // Would have thrown ReferenceError whenever a historical date load
      // failed. Use _offlineHTML_Generic which exists and accepts a reason.
      content.innerHTML = _shellHTML(_headerControls(), _offlineHTML_Generic(`Could not load ${_selectedDate}: ${data._err}`));
      _wireHandlers();
      return;
    }
    const rep = data.report || {};
    // For historical view, fetch matching meta from history list
    const meta = _history.find(h => h.date === _selectedDate) || {};
    content.innerHTML = _shellHTML(_headerControls(), _reportHTML(rep, meta));
    _wireHandlers();
  }

  async function render() {
    const content = document.getElementById('content');
    if (!content) return;
    content.innerHTML = `<div class="sn-loading">Loading Sensei reports…</div>`;

    _baseUrl = _resolveBase();

    // Three parallel fetches — coach reports + dashboard state (so we
    // can detect "no API key" specifically) + history
    const [latest, history, state] = await Promise.all([
      _fetchJSON(_baseUrl, 'api/coach/latest'),
      _fetchJSON(_baseUrl, 'api/coach/history?limit=14'),
      _fetchJSON(_baseUrl, 'api/dashboard/state'),
    ]);

    /* ─── State 1: fund API totally unreachable ─── */
    if (latest._err && history._err && state._err) {
      content.innerHTML = _shellHTML('', _offlineHTML_FundDown(
        `Tried ${_baseUrl}: ${latest._err}`));
      _wireHandlers();
      return;
    }

    _history = (history && history.reports) ? history.reports : [];

    /* ─── State 2: fund up but no API key yet ─── */
    const haveKey = !!(state && state.ai_key && state.ai_key.length > 10);
    if (!latest.report && !haveKey) {
      content.innerHTML = _shellHTML(_headerControls(), _offlineHTML_NoKey());
      _wireHandlers();
      return;
    }

    /* ─── State 3: fund up, key set, but Sensei hasn't fired yet ─── */
    // Schedule hour comes from config.SENSEI_DAILY_HOUR (5 UTC = 06:00 UK BST)
    const SCHEDULE_HOUR_UTC = 5;
    if (!latest.report && haveKey) {
      content.innerHTML = _shellHTML(_headerControls(),
        _offlineHTML_WaitingFirstRun(SCHEDULE_HOUR_UTC));
      _wireHandlers();
      return;
    }

    /* ─── State 4: happy path — show report ─── */
    _selectedDate = latest.report.date;
    const meta = (latest.report.meta && Object.keys(latest.report.meta).length)
      ? latest.report.meta
      : (_history.find(h => h.date === _selectedDate) || {});
    content.innerHTML = _shellHTML(_headerControls(), _reportHTML(latest.report, meta));
    _wireHandlers();
  }

  /* ── Styles (scoped by sn- prefix) ──────────────────────── */
  function _styles() {
    return `<style>
      .sn-wrap { display:flex; flex-direction:column; height:100%; min-height:0; }
      .sn-header {
        display:flex; align-items:center; justify-content:space-between;
        padding:14px 18px; border-bottom:1px solid var(--border, #2a2f37);
        background:var(--surface, #161b22); flex-shrink:0;
      }
      .sn-header-left { display:flex; align-items:center; gap:10px; }
      .sn-icon { font-size:22px; }
      .sn-title { font-weight:600; font-size:15px; letter-spacing:.3px; }
      .sn-header-right { display:flex; align-items:center; gap:8px; }
      .sn-date-picker {
        background:var(--bg, #0d1117); color:var(--text, #fff);
        border:1px solid var(--border, #30363d); border-radius:6px;
        padding:6px 10px; font-size:12px; max-width:340px;
      }
      .sn-body { flex:1; overflow-y:auto; padding:0; min-height:0; }
      .sn-loading { padding:40px; text-align:center; opacity:.65; }

      .sn-headline {
        margin:18px 18px 12px;
        background:linear-gradient(135deg, rgba(238,180,80,.10), rgba(238,180,80,.02));
        border-left:3px solid var(--gold, #eeb450);
        padding:14px 18px; border-radius:6px;
      }
      .sn-headline-tag {
        font-size:10px; letter-spacing:.18em; opacity:.7;
        color:var(--gold, #eeb450); margin-bottom:4px;
      }
      .sn-headline-body { font-size:15px; line-height:1.5; font-weight:500; }

      .sn-meta-bar {
        margin:0 18px 14px; padding:8px 12px;
        background:var(--surface, #161b22); border:1px solid var(--border, #2a2f37);
        border-radius:6px; display:flex; flex-wrap:wrap; gap:10px; align-items:center;
        font-size:11px;
      }
      .sn-meta-bar.sn-meta-empty { opacity:.5; font-style:italic; }
      .sn-meta-pill {
        background:rgba(255,255,255,.04); padding:3px 9px; border-radius:10px;
      }
      .sn-meta-stage2 {
        background:rgba(80,200,140,.12); color:#58d099;
        padding:3px 9px; border-radius:10px; font-weight:500;
      }

      .sn-report {
        padding:6px 22px 18px; line-height:1.55;
      }
      .sn-report .sn-h1 {
        font-size:18px; margin:18px 0 10px; padding-bottom:6px;
        border-bottom:1px solid var(--border, #2a2f37);
      }
      .sn-report .sn-h2 {
        font-size:15px; margin:22px 0 10px;
        color:var(--gold, #eeb450); letter-spacing:.2px;
      }
      .sn-report .sn-h3 {
        font-size:13px; margin:18px 0 6px; opacity:.92;
      }
      .sn-report p { margin:6px 0; font-size:13px; opacity:.92; }
      .sn-report .sn-ul, .sn-report .sn-ol {
        margin:4px 0 8px 22px; font-size:13px;
      }
      .sn-report li { margin:3px 0; opacity:.92; }
      .sn-report code {
        background:rgba(255,255,255,.06); padding:1px 5px; border-radius:3px;
        font-family:'SF Mono', Menlo, monospace; font-size:11px;
      }
      .sn-report pre {
        background:#0d1117; border:1px solid var(--border, #2a2f37);
        padding:10px 12px; border-radius:6px; overflow-x:auto;
        font-family:'SF Mono', Menlo, monospace; font-size:11px;
        margin:8px 0;
      }
      .sn-report strong { font-weight:600; color:var(--text, #fff); }

      .sn-footer {
        padding:10px 22px 18px; font-size:10px;
        border-top:1px solid var(--border, #2a2f37);
      }

      .sn-offline {
        padding:36px 24px; text-align:center; max-width:560px; margin:0 auto;
      }
      .sn-offline-icon { font-size:48px; margin-bottom:12px; }
      .sn-offline-title { font-size:16px; margin:8px 0; font-weight:600; }
      .sn-offline-sub { font-size:13px; opacity:.75; margin:6px 0; }
      .sn-offline-cmd {
        margin:14px 0; text-align:left; background:var(--surface, #161b22);
        border:1px solid var(--border, #2a2f37); border-radius:6px; padding:10px 12px;
      }
      .sn-cmd-label { font-size:10px; letter-spacing:.15em; opacity:.7; margin-bottom:4px; text-transform:uppercase; }
      .sn-offline-cmd pre {
        background:#0d1117; padding:8px 10px; border-radius:4px; overflow-x:auto;
        font-family:'SF Mono', Menlo, monospace; font-size:11px; margin:0;
      }
      .sn-offline-actions { margin-top:18px; display:flex; gap:8px; justify-content:center; }

      /* Inline "save API key" form (no-key state) */
      .sn-key-form {
        margin: 18px auto 6px; max-width: 460px; text-align: left;
        background: var(--surface, #161b22); border: 1px solid var(--border, #2a2f37);
        border-radius: 8px; padding: 14px 16px;
      }
      .sn-key-label {
        display:block; font-size:11px; letter-spacing:.08em; text-transform:uppercase;
        color: var(--muted, #8b8b90); margin-bottom: 6px; font-weight: 600;
      }
      .sn-key-input {
        width: 100%; box-sizing: border-box;
        background: var(--bg, #0d1117); color: var(--fg, #fff);
        border: 1px solid var(--border, #30363d); border-radius: 5px;
        padding: 9px 11px; font-size: 12px; font-family: 'SF Mono', Menlo, monospace;
      }
      .sn-key-input:focus { outline: none; border-color: var(--gold, #eeb450); }
      .sn-key-actions {
        display:flex; gap:10px; align-items:center; margin-top:10px;
      }
      .sn-key-link {
        font-size: 11px; color: var(--gold, #eeb450); text-decoration: none;
        margin-left: auto;
      }
      .sn-key-link:hover { text-decoration: underline; }
      .sn-key-result { margin-top: 8px; font-size: 11px; min-height: 1em; }
      .sn-key-result.ok  { color: #4ade80; }
      .sn-key-result.err { color: #ef4444; }
      .sn-key-result a { color: var(--gold, #eeb450); }
    </style>`;
  }

  return { render };
})();
