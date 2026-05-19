/* ═══════════════════════════════════════════════════════════
   AI COACH  (v2 visual redesign — 2026-05-17)
   Claude-powered trading coach
   Features:
     1. Screenshot auto-tag (vision → setup metadata)
     2. Daily journal prompt (evening reflection)
     3. Weekly auto-review (Monday HTML report)
   API: Anthropic Messages API direct from browser
        (anthropic-dangerous-direct-browser-access: true)
   Layout: .page-head + ask-coach bar + existing sub-tab content
════════════════════════════════════════════════════════════ */
const AICoachTab = (() => {

  /* ── Settings & state ───────────────────────────────── */
  const KEYS = {
    apiKey:   'jb_ai_key',
    model:    'jb_ai_model',
    spend:    'jb_ai_spend',     // { month: 'YYYY-MM', inTok, outTok, calls }
    prompts:  'jb_ai_prompts',   // { 'YYYY-MM-DD': { questions, answers } }
    reviews:  'jb_ai_reviews',   // [ {weekOf, html, summary} ]
  };

  const MODELS = {
    'claude-sonnet-4-5':   { label: 'Sonnet 4.5 (recommended)',   inP: 3,    outP: 15  },
    'claude-opus-4-5':     { label: 'Opus 4.5 (higher quality)',  inP: 15,   outP: 75  },
    'claude-haiku-4-5':    { label: 'Haiku 4.5 (cheapest)',       inP: 0.80, outP: 4   },
    'claude-sonnet-4-7':   { label: 'Sonnet 4.7 (newest)',        inP: 3,    outP: 15  },
    'claude-opus-4-7':     { label: 'Opus 4.7 (newest, premium)', inP: 15,   outP: 75  },
  };

  /* ── Helpers ────────────────────────────────────────── */
  const get  = k => localStorage.getItem(k);
  const getJ = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  const setS = (k, v) => {
    localStorage.setItem(k, v);
    // Mirror AI key + model to the fund-API disk store so they survive
    // localStorage clears (Chrome auto-eviction etc).
    if ((k === KEYS.apiKey || k === KEYS.model) &&
        typeof LocalPersist !== 'undefined') LocalPersist.scheduleSave();
  };
  const setJ = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  function getKey()    { return get(KEYS.apiKey) || ''; }
  function getModel()  { return get(KEYS.model) || 'claude-sonnet-4-5'; }
  function getSpend()  {
    const month = new Date().toISOString().slice(0,7);
    const s = getJ(KEYS.spend, null);
    if (!s || s.month !== month) return { month, inTok: 0, outTok: 0, calls: 0 };
    return s;
  }
  function addSpend(inTok, outTok) {
    const s = getSpend();
    s.inTok  += inTok;
    s.outTok += outTok;
    s.calls  += 1;
    setJ(KEYS.spend, s);
  }
  function spendUSD(s, modelKey) {
    const m = MODELS[modelKey] || MODELS['claude-sonnet-4-5'];
    return (s.inTok / 1e6) * m.inP + (s.outTok / 1e6) * m.outP;
  }

  /* ── Local AI proxy (Claude Code CLI, port 8770) ───── */
  const LOCAL_AI_URL = 'http://127.0.0.1:8770';
  const LOCAL_KEY = 'jb_ai_local';   // 'on' | 'off'

  function isLocalMode() { return get(LOCAL_KEY) === 'on'; }

  async function _localAvailable() {
    try {
      const r = await fetch(LOCAL_AI_URL + '/health', { signal: AbortSignal.timeout ? AbortSignal.timeout(2000) : undefined });
      return r.ok;
    } catch { return false; }
  }

  async function _callLocal({ system, user }) {
    const r = await fetch(LOCAL_AI_URL + '/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: user, system }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `Local AI ${r.status}`);
    return { text: j.text, usage: { input_tokens: 0, output_tokens: 0 } };
  }

  /* ── Claude API call ────────────────────────────────── */
  async function callClaude({ system, user, maxTokens = 1024, imageData = null }) {
    // Use local Claude Code proxy if in local mode or no API key
    const apiKey = getKey();
    const useLocal = isLocalMode() || !apiKey;

    if (useLocal && !imageData) {
      return await _callLocal({ system, user });
    }

    if (!apiKey) throw new Error('No API key — set one in Settings, or run ai_local_server.py and enable Local mode');
    const model = getModel();

    const userContent = imageData
      ? [
          { type: 'image', source: { type: 'base64', media_type: imageData.mediaType, data: imageData.b64 } },
          { type: 'text',  text: user },
        ]
      : user;

    const body = {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userContent }],
    };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `API ${res.status}`);

    const text = json.content?.map(b => b.type === 'text' ? b.text : '').join('') || '';
    const usage = json.usage || { input_tokens: 0, output_tokens: 0 };
    addSpend(usage.input_tokens, usage.output_tokens);

    return { text, usage };
  }

  /* ══════════════════════════════════════════════════════
     FEATURE 1 — SCREENSHOT AUTO-TAG
  ══════════════════════════════════════════════════════ */
  async function autoTagImage(b64DataUrl) {
    // b64DataUrl is "data:image/jpeg;base64,XXXX"
    const m = b64DataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!m) throw new Error('Bad image data');
    const mediaType = m[1];
    const b64       = m[2];

    const system = `You are an ICT/SMC chart analyst. Identify what's visible in this trading chart screenshot.
Return JSON only: {
  "setup_type": "FVG|OB|OTE|Sweep|BB|Other",
  "direction": "Long|Short",
  "session": "London|NY|Asian|Other",
  "key_features": ["feature 1", "feature 2"],
  "suggested_entry": "price level if visible, else null",
  "suggested_stop": "price level if visible, else null",
  "notes": "1 sentence read of the setup"
}`;
    const user = 'Analyze this chart.';
    const { text } = await callClaude({
      system, user, maxTokens: 600,
      imageData: { mediaType, b64 },
    });
    try { return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text); }
    catch { return { notes: text, setup_type: '?', direction: '?', session: '?', key_features: [] }; }
  }

  /* ── Local-mode text-based auto-tag (no vision) ────────── */
  async function autoTagFromText(description) {
    const system = `You are an ICT/SMC chart analyst. The trader has described their chart setup in text (vision not available). Identify the ICT/SMC setup from the description.
Return JSON only: {
  "setup_type": "FVG|OB|OTE|Sweep|BB|SilverBullet|TurtleSoup|Continuation|Other",
  "direction": "Long|Short",
  "session": "London|NY|Asian|Other",
  "key_features": ["feature 1", "feature 2"],
  "suggested_entry": "price level if mentioned, else null",
  "suggested_stop": "price level if mentioned, else null",
  "notes": "1 sentence read of the setup"
}`;
    const user = `Chart setup description: "${description}"`;
    const { text } = await _callLocal({ system, user });
    try { return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text); }
    catch { return { notes: text, setup_type: '?', direction: '?', session: '?', key_features: [] }; }
  }

  /* ══════════════════════════════════════════════════════
     FEATURE 2 — DAILY JOURNAL PROMPT
  ══════════════════════════════════════════════════════ */
  async function generateDailyPrompt() {
    const today = new Date().toISOString().slice(0,10);
    const trades = (typeof DB !== 'undefined' && DB.getTrades)
      ? DB.getTrades().filter(t => t.date && t.date.startsWith(today))
      : [];

    const system = `You are a trading psychology coach. Generate 3-4 short reflective questions tailored to today's trading. Keep them specific to the trades, not generic.
Return JSON only: { "questions": ["Q1?", "Q2?", "Q3?"] }`;

    const user = `Today's trades (${today}):
${JSON.stringify(trades.map(t => ({
  symbol: t.symbol, dir: t.direction, setup: (t.setupTypes||[t.setupType]).join('/'),
  pre: t.preGrade, post: t.postGrade, r: t.rMultiple, notes: t.notes,
})), null, 2)}`;

    const { text } = await callClaude({ system, user, maxTokens: 400 });
    let parsed;
    try { parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text); }
    catch { parsed = { questions: text.split('\n').filter(Boolean).slice(0,4) }; }

    const all = getJ(KEYS.prompts, {});
    all[today] = { questions: parsed.questions, answers: all[today]?.answers || [] };
    setJ(KEYS.prompts, all);
    return parsed;
  }

  function saveDailyAnswers(answers) {
    const today = new Date().toISOString().slice(0,10);
    const all = getJ(KEYS.prompts, {});
    if (!all[today]) all[today] = { questions: [], answers: [] };
    all[today].answers = answers;
    setJ(KEYS.prompts, all);
  }

  /* ══════════════════════════════════════════════════════
     FEATURE 3 — WEEKLY AUTO-REVIEW
  ══════════════════════════════════════════════════════ */
  function weekRange() {
    const now = new Date();
    const monday = new Date(now);
    const day = monday.getUTCDay() || 7;
    monday.setUTCDate(monday.getUTCDate() - day + 1 - 7); // last week's Monday
    const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
    return { from: monday.toISOString().slice(0,10), to: sunday.toISOString().slice(0,10) };
  }

  async function generateWeeklyReview() {
    const { from, to } = weekRange();
    const trades = (typeof DB !== 'undefined' && DB.getTrades)
      ? DB.getTrades().filter(t => t.date >= from && t.date <= to)
      : [];

    if (!trades.length) throw new Error(`No trades found in ${from} → ${to}`);

    const system = `You are a structured trading coach. Generate a weekly performance review as clean HTML (no <html>/<body> tags, just inline content). Use sections:
1. <h3>📊 Summary</h3> — total trades, win rate, P&L, best/worst day
2. <h3>✅ Best setup</h3> — which setup performed best, why likely
3. <h3>⚠️ Worst setup / rule violations</h3> — what to avoid
4. <h3>🎯 3 focus areas for next week</h3> — concrete actions
Use <p>, <ul>, <li>, <strong>. Keep it punchy.`;

    const user = `Trades from ${from} to ${to}:
${JSON.stringify(trades.map(t => ({
  date: t.date, symbol: t.symbol, dir: t.direction,
  setup: (t.setupTypes||[t.setupType]).join('/'),
  session: t.session, htf: t.htfBias,
  pre: t.preGrade, post: t.postGrade, r: t.rMultiple, result: t.result,
})), null, 2)}`;

    const { text } = await callClaude({ system, user, maxTokens: 2000 });
    const all = getJ(KEYS.reviews, []);
    all.unshift({ weekOf: from, html: text, generated: Date.now() });
    setJ(KEYS.reviews, all.slice(0, 12));
    return { html: text, weekOf: from };
  }

  /* ══════════════════════════════════════════════════════
     RENDERING
  ══════════════════════════════════════════════════════ */
  function renderSettings() {
    const apiKey = getKey();
    const model = getModel();
    const spend = getSpend();
    const usd   = spendUSD(spend, model);
    // Show first 8 + last 4 only when key is long enough; otherwise just '••••'.
    const masked = apiKey
      ? (apiKey.length > 16 ? apiKey.slice(0,8) + '••••' + apiKey.slice(-4) : '••••')
      : '';
    const localOn = isLocalMode();
    return `<div class="ai-section">
      <h3 class="ai-section-hdr">⚙️ Settings</h3>

      <div class="ai-grid" style="margin-bottom:18px; padding:14px 16px; background:var(--surface2); border:1px solid var(--border); border-radius:12px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
          <div>
            <div style="font-weight:700; font-size:14px; color:var(--heading);">🖥️ Local mode <span style="font-size:11px; font-weight:500; color:var(--accent); background:var(--accent-soft); padding:2px 7px; border-radius:8px; margin-left:6px;">Free — uses Claude Code</span></div>
            <div style="font-size:12px; color:var(--muted); margin-top:3px;">Routes all AI calls through your local Claude Code CLI (port 8770). No API credits needed.</div>
            <div style="font-size:11px; color:var(--muted-2); margin-top:3px;">Start: <code style="font-size:10px;">cd automation && python3 ai_local_server.py</code></div>
          </div>
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; flex-shrink:0;">
            <input type="checkbox" id="aiLocalToggle" ${localOn ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent);" />
            <span style="font-size:13px; font-weight:600;">${localOn ? 'On' : 'Off'}</span>
          </label>
        </div>
        <div id="aiLocalStatus" style="margin-top:10px; font-size:11px; color:var(--muted);">Checking local server…</div>
      </div>

      <div class="ai-grid">
        <div class="form-group">
          <label>Anthropic API Key <span class="text-xs text-sub">(fallback · stored locally only)</span></label>
          <input type="password" id="aiKey" value="${esc(apiKey)}" placeholder="sk-ant-api03-..."${apiKey?` title="Currently: ${esc(masked)}"`:''} />
          <div class="text-xs text-sub" style="margin-top:4px">
            Get one at <a href="https://console.anthropic.com" target="_blank" style="color:var(--accent)">console.anthropic.com</a> · ~$5 starter credit
            ${apiKey ? ` · <a href="javascript:AICoachTab._clearKey()" style="color:var(--red)">clear key</a>` : ''}
          </div>
        </div>
        <div class="form-group">
          <label>Model</label>
          <select id="aiModel">
            ${Object.entries(MODELS).map(([k,v]) => `<option value="${k}"${k===model?' selected':''}>${v.label}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>This month's spend (estimated)</label>
          <div class="ai-spend">
            <div class="ai-spend-val">$${usd.toFixed(3)}</div>
            <div class="text-xs text-sub">${spend.calls} calls · ${(spend.inTok/1000).toFixed(1)}k in / ${(spend.outTok/1000).toFixed(1)}k out</div>
          </div>
        </div>
      </div>
      <button class="btn-primary" id="aiSaveBtn">💾 Save Settings</button>
    </div>`;
  }

  function renderDailyPrompt() {
    const today = new Date().toISOString().slice(0,10);
    const all = getJ(KEYS.prompts, {});
    const todays = all[today];
    return `<div class="ai-section">
      <h3 class="ai-section-hdr">📝 Daily Journal Prompt</h3>
      ${todays?.questions?.length ? `
        <p class="text-sub" style="font-size:.85rem;margin:0 0 10px">${esc(today)}'s reflection prompts:</p>
        <div class="ai-questions">
          ${todays.questions.map((q,i) => `
            <div class="ai-question">
              <div class="ai-q-text">${i+1}. ${esc(q)}</div>
              <textarea class="ai-q-input" data-i="${i}" rows="2" placeholder="Your answer…">${esc(todays.answers?.[i] || '')}</textarea>
            </div>
          `).join('')}
        </div>
        <button class="btn-primary" id="aiSavePromptsBtn" style="margin-top:10px">💾 Save Answers</button>
        <button class="btn-ghost" id="aiNewPromptsBtn" style="margin-left:6px">🔄 Generate new questions</button>
      ` : `
        <p class="text-sub" style="font-size:.85rem">No prompts yet for today.</p>
        <button class="btn-primary" id="aiNewPromptsBtn">✨ Generate today's questions</button>
      `}
    </div>`;
  }

  function renderWeeklyReview() {
    const all = getJ(KEYS.reviews, []);
    const latest = all[0];
    return `<div class="ai-section">
      <h3 class="ai-section-hdr">📅 Weekly Review</h3>
      <button class="btn-primary" id="aiWeeklyBtn">🧠 Generate review for last week</button>
      <span id="aiWeeklyStatus" class="text-dim" style="font-size:.8rem;margin-left:10px"></span>
      ${latest ? `
        <div class="ai-review" style="margin-top:14px">
          <div class="text-sub" style="font-size:.78rem;margin-bottom:8px">Week of ${esc(latest.weekOf)} · generated ${new Date(latest.generated).toLocaleString()}</div>
          <div class="ai-review-body">${latest.html}</div>
        </div>
      ` : ''}
      ${all.length > 1 ? `<details style="margin-top:14px"><summary class="text-sub" style="cursor:pointer;font-size:.82rem">Past reviews (${all.length-1})</summary>
        <div style="margin-top:10px">${all.slice(1).map(r => {
          const safeWeek = /^\d{4}-\d{2}-\d{2}$/.test(r.weekOf) ? r.weekOf : '';
          return `
          <div class="ai-hist-row" onclick="AICoachTab._showReview('${safeWeek}')" style="cursor:pointer">
            <span class="text-sub">📅 Week of ${esc(r.weekOf)}</span>
            <span class="text-dim" style="font-size:.7rem;margin-left:auto">${new Date(r.generated).toLocaleDateString()}</span>
          </div>`;
        }).join('')}</div>
      </details>` : ''}
    </div>`;
  }

  /* ── Alert count helper (best-effort) ───────────────── */
  function _alertCount() {
    try {
      if (typeof CoachTab !== 'undefined' && CoachTab._alertCount) return CoachTab._alertCount();
    } catch {}
    return null;
  }

  /* ── Sub-tab state ──────────────────────────────────── */
  // v1.1 (2026-05-10): Dr. Coach merged in as internal sub-tabs.
  // Five sub-tabs: Alerts, Grade Insights, Setup Catalogue, Weekly
  // Review (Claude-powered), Settings. Daily journal prompt removed.
  // Settings is the LAST tab (operator preferred "API key at bottom"
  // — same intent: out of the way, accessed only when needed).
  let _activeSubTab = 'alerts';

  const _SUB_TABS = [
    { id: 'alerts',    label: '🚨 Alerts',         needsKey: false },
    { id: 'grading',   label: '📊 Grade Insights', needsKey: false },
    { id: 'catalogue', label: '📖 Setup Catalogue', needsKey: false },
    { id: 'review',    label: '📅 Weekly Review',  needsKey: true  },
    { id: 'settings',  label: '⚙️ Settings',        needsKey: false },
  ];

  /* ── Dismissed insight titles (session-only) ─────────── */
  const _dismissed = new Set();
  let _settingsOpen = false;

  function _dotColor(type) {
    return type === 'positive' ? '#22c55e' : type === 'danger' ? '#ef4444' : type === 'info' ? '#3b82f6' : '#f59e0b';
  }

  /* ── Public render ──────────────────────────────────── */
  function render() {
    const content = document.getElementById('content');
    if (!content) return;
    const apiKey = getKey();

    // Settings view
    if (_settingsOpen) {
      content.innerHTML = `
        <div class="page-head">
          <div><h1>AI Coach · Settings</h1><div class="page-head-sub">API key &amp; model configuration</div></div>
          <button class="btn-ghost btn-sm" onclick="AICoachTab._closeSettings()">← Back</button>
        </div>
        <div class="card" style="max-width:520px">${renderSettings()}</div>`;
      document.getElementById('aiSaveBtn')?.addEventListener('click', () => {
        const k = document.getElementById('aiKey')?.value.trim();
        const m = document.getElementById('aiModel')?.value;
        const localChk = document.getElementById('aiLocalToggle');
        if (k !== undefined) setS(KEYS.apiKey, k);
        if (m) setS(KEYS.model, m);
        if (localChk) localStorage.setItem(LOCAL_KEY, localChk.checked ? 'on' : 'off');
        if (typeof App !== 'undefined' && App.toast) App.toast('Settings saved');
        _settingsOpen = false; render();
      });
      // Probe local server status immediately when settings is shown
      _localAvailable().then(ok => {
        const el = document.getElementById('aiLocalStatus');
        if (el) el.innerHTML = ok
          ? '✅ Local server reachable at localhost:8770 — ready to use'
          : '⚠️ Local server not found at localhost:8770 — start <code>ai_local_server.py</code> first';
      });
      return;
    }

    // Gather insights
    let insights = [];
    try {
      if (typeof CoachTab !== 'undefined' && CoachTab._getAlerts) {
        insights = CoachTab._getAlerts().filter(a => !_dismissed.has(a.title));
      }
    } catch (_) {}

    const insightBadge = insights.length
      ? `<span style="margin-left:10px;font-size:.72rem;font-weight:600;padding:3px 9px;border-radius:10px;background:rgba(124,92,255,.18);color:#a78bfa">${insights.length} ${insights.length === 1 ? 'insight' : 'insights'}</span>`
      : '';

    const insightCard = (a, i) => `
      <div class="card" style="padding:0;overflow:hidden;display:flex;flex-direction:column">
        <div style="display:flex;align-items:flex-start;gap:12px;padding:18px 20px;flex:1">
          <div style="width:10px;height:10px;border-radius:50%;background:${_dotColor(a.type)};flex-shrink:0;margin-top:5px"></div>
          <div>
            <div style="font-weight:700;font-size:.9rem;color:var(--text);margin-bottom:5px">${esc(a.title)}</div>
            <div style="font-size:.82rem;color:var(--muted);line-height:1.55">${esc(a.desc)}</div>
          </div>
        </div>
        <div style="display:flex;border-top:1px solid var(--border)">
          <button class="btn-ghost" style="flex:1;border-radius:0;border-right:1px solid var(--border);padding:10px;font-size:.82rem"
                  onclick="AICoachTab._showEvidence(${i})">Show evidence</button>
          <button class="btn-ghost" style="flex:1;border-radius:0;padding:10px;font-size:.82rem"
                  onclick="AICoachTab._dismiss(${i})">Dismiss</button>
        </div>
      </div>`;

    const emptyCard = `
      <div class="card" style="grid-column:1/-1;text-align:center;padding:48px 20px">
        <div style="font-size:2rem;margin-bottom:12px">✅</div>
        <div style="font-weight:700;color:var(--text)">All clear</div>
        <div style="font-size:.84rem;color:var(--muted);margin-top:6px">No issues detected in your recent trade data.</div>
      </div>`;

    content.innerHTML = `
      <div class="page-head">
        <div>
          <h1>AI Coach${insightBadge}</h1>
          <div class="page-head-sub">Personalized insights from your trade history</div>
        </div>
        <button class="btn-ghost btn-sm" onclick="AICoachTab._openSettings()">⚙️ Settings</button>
      </div>

      <div style="background:linear-gradient(135deg,rgba(124,92,255,.12),rgba(124,92,255,.04));border:1px solid rgba(124,92,255,.22);border-radius:12px;padding:16px 20px;display:flex;align-items:center;gap:14px;margin-bottom:20px">
        <div style="width:40px;height:40px;border-radius:10px;background:var(--accent,#7c5cff);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:1.2rem">⭐</div>
        <div style="flex:0 0 auto">
          <div style="font-weight:700;font-size:.9rem;color:var(--text);margin-bottom:2px">Ask your coach anything</div>
          <div style="font-size:.75rem;color:var(--muted)">"Why am I losing money on Fridays?" · "Is my position sizing too aggressive?"</div>
        </div>
        <input id="askCoachInput" type="text" placeholder="Ask the coach…"
               style="flex:1;background:var(--surface,#fff);border:1px solid var(--border);border-radius:8px;padding:9px 14px;font-size:.85rem;color:var(--text);outline:none;font-family:inherit;min-width:0"
               onkeydown="if(event.key==='Enter')AICoachTab._askCoach()" />
        <button onclick="AICoachTab._askCoach()"
                style="flex-shrink:0;padding:9px 22px;background:var(--accent,#7c5cff);color:#fff;border:none;border-radius:8px;font-size:.85rem;font-weight:600;cursor:pointer">
          Send
        </button>
      </div>
      <div id="askCoachResponse" style="display:none;margin-bottom:20px"></div>

      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px">
        ${insights.length ? insights.map(insightCard).join('') : emptyCard}
      </div>

      <!-- ── Patterns (Tendencies merged) ─────────────────── -->
      <div style="border-top:1px solid var(--border);padding-top:28px;margin-top:24px">
        <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:#666;margin-bottom:4px">Patterns</div>
        <div style="font-size:.95rem;font-weight:700;color:var(--text);margin-bottom:18px">Where you make money and where you don't</div>
        <div id="tendencies-embed"></div>
      </div>

      <!-- ── Merged sections (2026-05-19 audit: Rules / Playbook / My Reports) ─ -->
      <div style="border-top:1px solid var(--border);padding-top:28px;margin-top:32px">
        <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:#666;margin-bottom:4px">Discipline &amp; Reference</div>
        <div style="font-size:.95rem;font-weight:700;color:var(--text);margin-bottom:18px">Rules, setups, and post-hoc reports</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px">
          ${_mergedCard('📜', 'Rules', _rulesSummary(), 'rules')}
          ${_mergedCard('📖', 'Playbook', _playbookSummary(), 'playbook')}
          ${_mergedCard('📑', 'My Reports', 'Weekly / monthly performance, imports, and setup breakdowns. Generated post-hoc from your trade log.', 'reports')}
        </div>
      </div>
    `;

    if (typeof TendenciesTab !== 'undefined') TendenciesTab.renderInto('tendencies-embed');
  }

  /* ── Merged-section helpers (2026-05-19 audit) ──────── */
  function _mergedCard(icon, title, body, tabId) {
    return `
      <div class="card" style="padding:18px 20px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="font-size:1.4rem">${icon}</div>
          <div style="font-weight:700;color:var(--text)">${title}</div>
        </div>
        <div style="font-size:.82rem;color:var(--muted);line-height:1.55;flex:1">${body}</div>
        <button class="btn-ghost btn-sm" style="align-self:flex-start"
                onclick="App.navigate('${tabId}')">Open full ▸</button>
      </div>`;
  }
  function _rulesSummary() {
    try {
      if (typeof DB !== 'undefined' && DB.getRules) {
        const r = DB.getRules ? DB.getRules() : null;
        if (r && r.bySet) {
          const total = Object.values(r.bySet).reduce((s,arr)=>s+arr.length,0);
          const on = Object.values(r.bySet).reduce((s,arr)=>s+arr.filter(x=>x.enabled).length,0);
          return `<b>${on}/${total}</b> rules enabled across pre-trade · risk · psychology sets.`;
        }
      }
    } catch(_) {}
    return 'Tiered rule sets across pre-trade, risk, and psychology. Track compliance against the discipline you committed to.';
  }
  function _playbookSummary() {
    try {
      if (typeof DB !== 'undefined' && DB.get && DB.KEYS && DB.KEYS.play) {
        const list = DB.get(DB.KEYS.play) || [];
        if (Array.isArray(list) && list.length) {
          return `<b>${list.length}</b> setups catalogued. Win-rate badges, trade counts, and SVG chart examples.`;
        }
      }
    } catch(_) {}
    return 'Setup catalogue with FVG, OB, sweep, CISD, OTE, and more. Each setup includes win-rate, trade count, and chart examples.';
  }

  function _renderSubTab(apiKey) {
    const wrap = document.getElementById('aicSubContent');
    if (!wrap) return;

    switch (_activeSubTab) {
      case 'alerts':
        wrap.innerHTML = '<div id="aicAlerts"></div>';
        try { if (typeof CoachTab !== 'undefined') CoachTab._renderAlerts(document.getElementById('aicAlerts')); }
        catch (e) { document.getElementById('aicAlerts').innerHTML = `<div class="text-dim">Alerts unavailable: ${e.message}</div>`; }
        break;

      case 'grading':
        wrap.innerHTML = '<div id="aicGrading"></div>';
        try { if (typeof CoachTab !== 'undefined') CoachTab._renderGrading(document.getElementById('aicGrading')); }
        catch (e) { document.getElementById('aicGrading').innerHTML = `<div class="text-dim">Grading unavailable: ${e.message}</div>`; }
        break;

      case 'catalogue':
        wrap.innerHTML = '<div id="aicCatalogue"></div>';
        try { if (typeof CoachTab !== 'undefined') CoachTab._renderCatalogue(document.getElementById('aicCatalogue')); }
        catch (e) { document.getElementById('aicCatalogue').innerHTML = `<div class="text-dim">Catalogue unavailable: ${e.message}</div>`; }
        break;

      case 'review':
        if (!apiKey) {
          wrap.innerHTML = `<div class="ai-section"><div class="text-dim" style="padding:20px;text-align:center">
            🔑 Weekly Review needs your Anthropic API key. Add it in the ⚙️ Settings tab first.</div></div>`;
          break;
        }
        wrap.innerHTML = renderWeeklyReview();
        // Wire the generate button + history clicks
        document.getElementById('aiWeeklyBtn')?.addEventListener('click', async () => {
          const btn = document.getElementById('aiWeeklyBtn');
          const status = document.getElementById('aiWeeklyStatus');
          btn.disabled = true; status.textContent = 'Generating (15-30s)…'; status.style.color = 'var(--gold)';
          try { await generateWeeklyReview(); _renderSubTab(getKey()); }
          catch (e) { status.textContent = '⚠ ' + e.message; status.style.color = 'var(--red)'; btn.disabled = false; }
        });
        break;

      case 'settings':
        wrap.innerHTML = renderSettings();
        // Wire save
        const saveBtn = document.getElementById('aiSaveBtn');
        if (saveBtn) saveBtn.addEventListener('click', () => {
          const k = document.getElementById('aiKey').value.trim();
          const m = document.getElementById('aiModel').value;
          setS(KEYS.apiKey, k);
          setS(KEYS.model, m);
          if (typeof toast === 'function') toast('Settings saved', 'success');
          render();
        });
        break;
    }
  }

  /* ── Ask coach handler ──────────────────────────────── */
  async function _askCoach() {
    const input    = document.getElementById('askCoachInput');
    const respDiv  = document.getElementById('askCoachResponse');
    const question = input?.value?.trim();
    if (!question) return;

    if (!getKey()) {
      if (respDiv) {
        respDiv.style.display = 'block';
        respDiv.innerHTML = `<div class="ai-banner">🔑 Add your Anthropic API key in the ⚙️ Settings tab to use Ask Coach.</div>`;
      }
      return;
    }

    if (respDiv) {
      respDiv.style.display = 'block';
      respDiv.innerHTML = `<div class="card" style="padding:16px 20px;color:var(--text-dim);font-size:.85rem">⏳ Thinking…</div>`;
    }

    try {
      const trades = (typeof DB !== 'undefined' && DB.getTrades) ? DB.getTrades() : [];
      const stats  = (typeof DB !== 'undefined' && DB.calcStats) ? DB.calcStats(trades) : {};

      const system = `You are a trading coach analyzing a trader's journal data. Be direct, specific, and actionable.`;
      const user   = `Trader question: "${question}"

Trade stats summary: ${JSON.stringify({
  totalTrades: trades.length,
  winRate: stats.winRate,
  avgR: stats.avgR,
  totalPL: stats.totalPL,
})}

Recent trades (last 20): ${JSON.stringify(trades.slice(-20).map(t => ({
  date: t.date, symbol: t.symbol, dir: t.direction,
  setup: (t.setupTypes||[t.setupType||'']).join('/'),
  pre: t.preGrade, post: t.postGrade, r: t.rMultiple, result: t.result,
})), null, 2)}`;

      const { text } = await callClaude({ system, user, maxTokens: 800 });

      if (respDiv) {
        respDiv.style.display = 'block';
        respDiv.innerHTML = `<div class="card" style="padding:16px 20px">
          <div style="font-size:.72rem;font-weight:600;color:var(--accent);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Coach Response</div>
          <div style="font-size:.86rem;line-height:1.6;color:var(--text-primary);white-space:pre-wrap">${esc(text)}</div>
        </div>`;
      }
    } catch (e) {
      if (respDiv) {
        respDiv.innerHTML = `<div class="card" style="padding:16px 20px;color:var(--red);font-size:.85rem">⚠ ${esc(e.message)}</div>`;
      }
    }
  }

  /* ── Public API ─────────────────────────────────────── */
  return {
    render,
    _sub: (id) => { _activeSubTab = id; render(); },
    _askCoach,
    _openSettings:  () => { _settingsOpen = true;  render(); },
    _closeSettings: () => { _settingsOpen = false; render(); },
    _dismiss: (i) => {
      // Look up the title at dismiss time (insights array rebuilt each render)
      try {
        const alerts = typeof CoachTab !== 'undefined' && CoachTab._getAlerts ? CoachTab._getAlerts() : [];
        const visible = alerts.filter(a => !_dismissed.has(a.title));
        if (visible[i]) _dismissed.add(visible[i].title);
      } catch (_) {}
      render();
    },
    _showEvidence: (i) => {
      try {
        const alerts = typeof CoachTab !== 'undefined' && CoachTab._getAlerts ? CoachTab._getAlerts() : [];
        const visible = alerts.filter(a => !_dismissed.has(a.title));
        const a = visible[i];
        if (!a) return;
        if (typeof App !== 'undefined' && App.toast) App.toast(a.title, 'info');
      } catch (_) {}
    },
    // Public API for use from other tabs (e.g. trade form auto-tag button)
    autoTagImage,
    autoTagFromText,
    callClaude,
    hasKey: () => !!getKey(),
    saveKey: (key) => { setS(KEYS.apiKey, (key || '').trim()); },
    _clearKey: () => {
      if (!confirm('Clear the saved API key? You will need to paste it again to use AI features.')) return;
      setS(KEYS.apiKey, '');
      if (typeof toast === 'function') toast('API key cleared', 'success');
      render();
    },
    _showReview: (weekOf) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekOf)) return;
      const all = getJ(KEYS.reviews, []);
      const r = all.find(x => x.weekOf === weekOf);
      if (!r) return;
      const w = window.open('', '_blank');
      // weekOf is whitelisted (regex above) so it's safe in <title>; html is
      // intentional rendered AI output (see audit deferred note).
      w.document.write(`<html><head><title>Review · Week of ${weekOf}</title><style>body{font-family:system-ui;max-width:720px;margin:30px auto;padding:0 20px;line-height:1.55;color:#222}h3{margin-top:24px;color:#0a3}</style></head><body>${r.html}</body></html>`);
      w.document.close();
    },
  };
})();
