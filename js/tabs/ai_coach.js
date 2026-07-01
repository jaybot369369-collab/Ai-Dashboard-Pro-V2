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

  /* ── Local AI proxy (Claude Code CLI, port 8770 by default) ───── */
  const DEFAULT_LOCAL_AI_URL = 'http://127.0.0.1:8770';
  const LOCAL_KEY = 'jb_ai_local';              // 'on' | 'off'
  const LOCAL_URL_KEY = 'jb_local_ai_url';      // override (used when on Railway)
  const LOCAL_TOKEN_KEY = 'jb_local_ai_token';  // X-Shim-Token (required if tunneled)

  function isLocalMode() { return get(LOCAL_KEY) === 'on'; }

  /* Resolve the local-AI base URL. On localhost we use 127.0.0.1:8770
     directly. On any public host (Railway, github.io, etc.) Chrome's
     Private Network Access policy hard-blocks localhost fetches — so
     the operator must point at a public tunnel (e.g. cloudflared
     quick-tunnel) and paste that URL into Settings. */
  function getLocalAIUrl() {
    const override = (localStorage.getItem(LOCAL_URL_KEY) || '').trim();
    if (override) return override.replace(/\/$/, '');
    const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    return isLocalHost ? DEFAULT_LOCAL_AI_URL : '';   // empty → unreachable
  }

  /* Async URL resolver — used by _callLocal so we can fetch the current
     tunnel URL from Railway's /api/_ai/tunnel_url endpoint (published
     by the operator's launchd-managed cloudflared wrapper). This kills
     the "tunnel died overnight, paste new URL into Settings" loop —
     the dashboard auto-discovers the latest URL on every call.

     Precedence: localStorage override (manual paste, for dev) > server
     discovery > DEFAULT_LOCAL_AI_URL when on localhost. */
  let _tunnelUrlCache = { url: null, ts: 0 };
  async function _resolveLocalAIUrl() {
    const override = (localStorage.getItem(LOCAL_URL_KEY) || '').trim();
    if (override) return override.replace(/\/$/, '');
    const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    if (isLocalHost) return DEFAULT_LOCAL_AI_URL;
    // Public origin (Railway, github.io, etc.) — ask the server.
    // 60s cache so back-to-back Scan Trade calls don't hammer the endpoint.
    if (_tunnelUrlCache.url && Date.now() - _tunnelUrlCache.ts < 60_000) {
      return _tunnelUrlCache.url;
    }
    try {
      const r = await fetch(`${window.location.origin}/api/_ai/tunnel_url`, { cache: 'no-store' });
      const j = await r.json();
      if (j && j.ok && j.url) {
        _tunnelUrlCache = { url: j.url.replace(/\/$/, ''), ts: Date.now() };
        return _tunnelUrlCache.url;
      }
    } catch (_) { /* fall through to empty (unreachable) */ }
    return '';
  }

  function getLocalAIToken() {
    return (localStorage.getItem(LOCAL_TOKEN_KEY) || '').trim();
  }

  async function _localAvailable() {
    const base = getLocalAIUrl();
    if (!base) return false;
    try {
      const r = await fetch(base + '/health', {
        signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined,
      });
      if (!r.ok) return false;
      const j = await r.json();
      // If shim requires auth but client has no token, surface that too
      return { ok: true, auth_required: !!j.auth_required };
    } catch { return false; }
  }

  // Sentinel error type so callClaude() can distinguish "tunnel is dead, please
  // fall back to server proxy" from "request reached the shim but failed".
  class LocalUnreachableError extends Error {
    constructor(msg) { super(msg); this.name = 'LocalUnreachableError'; }
  }

  async function _callLocal({ system, user, imageData = null }) {
    const base = await _resolveLocalAIUrl();
    if (!base) {
      throw new LocalUnreachableError(
        'Local AI URL is not configured. On Railway you need a public tunnel:\n' +
        '  1. On your Mac: ./bin/cloudflared tunnel --url http://localhost:8770\n' +
        '  2. Copy the https://*.trycloudflare.com URL it prints\n' +
        '  3. Paste it into AI Coach → ⚙ Settings → Local AI URL → Save'
      );
    }
    const payload = { prompt: user, system };
    if (imageData) {
      payload.image_b64          = imageData.b64;
      payload.image_media_type   = imageData.mediaType;
    }
    const headers = { 'content-type': 'application/json' };
    const token = getLocalAIToken();
    if (token) headers['x-shim-token'] = token;

    let r;
    try {
      r = await fetch(base + '/chat', { method: 'POST', headers, body: JSON.stringify(payload) });
    } catch (netErr) {
      // Network-layer failure — usually a dead Cloudflare quick-tunnel (they
      // expire when the cloudflared process stops) or DNS error.
      throw new LocalUnreachableError(
        `Local AI tunnel unreachable: ${base} — ${netErr.message || 'fetch failed'}.\n` +
        `Cloudflare quick-tunnels expire when the local process stops. Either:\n` +
        `  1. Restart cloudflared on your Mac, copy the NEW URL, update AI Coach → Settings → Local AI URL, OR\n` +
        `  2. Toggle Local mode OFF in Settings to use the Railway server proxy instead.`
      );
    }
    if (r.status === 403) {
      throw new Error('Local shim rejected the request — token mismatch. Paste the LOCAL_SHIM_TOKEN value you set when starting local_ai_server.py into AI Coach → Settings → Local AI Token.');
    }
    let j;
    try { j = await r.json(); }
    catch { throw new Error(`Local AI returned non-JSON (HTTP ${r.status}). Tunnel may be misconfigured.`); }
    if (!r.ok) {
      const errMsg = j.error || `Local AI ${r.status}`;
      // CLI execution failures (exit code, not found, timed out, auth) mean the
      // local shim can't produce output — treat as unreachable so callClaude()
      // can fall back to the Railway server proxy automatically.
      if (/CLI exited|not found at|timed out|authentication/i.test(errMsg)) {
        throw new LocalUnreachableError(errMsg);
      }
      throw new Error(errMsg);
    }
    return { text: j.text, usage: { input_tokens: 0, output_tokens: 0 } };
  }

  /* ── Server-side proxy (Railway's ANTHROPIC_API_KEY env var) ──
     Works from ANY Mac with no per-browser setup. Used as the default
     fallback when the operator hasn't pasted a local API key. */
  async function _callServerProxy({ system, user, maxTokens = 1024, imageData = null }) {
    const payload = { system, user, max_tokens: maxTokens, model: getModel() };
    if (imageData) {
      payload.image_b64        = imageData.b64;
      payload.image_media_type = imageData.mediaType;
    }
    let r;
    try {
      r = await fetch(`${window.location.origin}/api/_ai/claude`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (netErr) {
      // Fetch itself failed — DNS, offline, CORS, mixed-content, etc.
      // Surface as a clear network error instead of bubbling raw "Failed to fetch".
      throw new Error(`Network error reaching ${window.location.origin}/api/_ai/claude — ${netErr.message || 'fetch failed'}. Try hard-reload (Cmd+Shift+R) to clear cached JS, or check Railway service health.`);
    }
    // Parse defensively — if the server returned HTML (error page, nginx 502, etc.)
    // we don't want a JSON.parse crash to surface as a useless message.
    let j;
    try {
      j = await r.json();
    } catch (parseErr) {
      const ct = r.headers.get('content-type') || 'unknown';
      throw new Error(`Server proxy returned non-JSON (HTTP ${r.status}, content-type ${ct}). Likely Railway/nginx error page. Check Railway logs for /api/_ai/claude.`);
    }
    if (!r.ok || !j.ok) {
      throw new Error(j.error || `server proxy ${r.status}`);
    }
    return { text: j.text, usage: j.usage || { input_tokens: 0, output_tokens: 0 } };
  }

  /* ── Claude API call ────────────────────────────────── */
  async function callClaude({ system, user, maxTokens = 1024, imageData = null }) {
    const apiKey = getKey();
    const localOn = isLocalMode();
    const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);

    // Routing rules (most specific → most generic):
    //   1. Operator explicitly turned on Local mode → use the localhost shim
    //   2. Operator pasted an API key in Settings → use direct browser-to-Anthropic
    //   3. We're on Railway / any non-localhost host → use the server-side proxy
    //      (uses Railway's ANTHROPIC_API_KEY env var; works on every Mac)
    //   4. Otherwise (localhost dev with no key, no local mode) → try the shim
    //      and surface a clear error if it isn't running

    if (localOn) {
      try {
        return await _callLocal({ system, user, imageData });
      } catch (e) {
        // If the local tunnel is dead (DNS error, expired Cloudflare quick-tunnel,
        // shim not running, URL not set) AND we're on a non-localhost origin,
        // automatically fall back to the server proxy instead of dead-ending.
        const isUnreachable = e && e.name === 'LocalUnreachableError';
        if (isUnreachable && !isLocalHost) {
          try {
            const r = await _callServerProxy({ system, user, maxTokens, imageData });
            return r;
          } catch (proxyErr) {
            // Both paths failed — give the operator a combined explanation.
            throw new Error(
              `Both AI paths failed:\n\n` +
              `LOCAL: ${e.message}\n\n` +
              `RAILWAY PROXY FALLBACK: ${proxyErr.message}`
            );
          }
        }
        throw e;
      }
    }
    if (!apiKey && !isLocalHost) {
      // Default cross-Mac path — Railway-hosted dashboard, no per-browser setup.
      try {
        return await _callServerProxy({ system, user, maxTokens, imageData });
      } catch (e) {
        // Auto-fallback when Anthropic billing is exhausted. We can ONLY
        // reach the local shim if the dashboard itself is served from
        // localhost (Chrome Private Network Access blocks public→localhost
        // fetches). Surface a clear, actionable error instead of "Failed
        // to fetch" so the operator knows what to switch.
        const msg = (e && e.message) || '';
        if (/credit balance|insufficient|quota|too low|billing/i.test(msg)) {
          throw new Error(
            'No API credits. Quickest fix: generate the review on your local dashboard ' +
            '(localhost:8768) → click Export → Import the file here. Reviews travel with your export.\n\n' +
            'To enable live generation on Railway: add credits at console.anthropic.com.'
          );
        }
        throw e;
      }
    }
    if (!apiKey) {
      // Localhost dev, no key, no local-mode toggle → fall back to shim with a useful error
      return await _callLocal({ system, user, imageData });
    }

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
    if (!res.ok) {
      const msg = json.error?.message || `API ${res.status}`;
      if (res.status === 402 || /credit balance|insufficient|quota|too low|billing/i.test(msg)) {
        throw new Error(
          'No API credits. Quickest fix: generate the review on your local dashboard ' +
          '(localhost:8768) → click Export → Import the file here. Reviews travel with your export.\n\n' +
          'To enable live generation on Railway: add credits at console.anthropic.com.'
        );
      }
      throw new Error(msg);
    }

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

  /* ══════════════════════════════════════════════════════
     FEATURE 1b — FULL TRADE SCANNER (chart with E/SL/TP drawn)
     Reads a marked-up TradingView screenshot end-to-end:
     symbol, timeframe, entry/SL/TP prices, direction, session,
     HTF bias, setup types, plus an ICT-coach critique.
  ══════════════════════════════════════════════════════ */
  // Build a compact playbook digest (name + 1-line description) for the
  // AI prompt — so the scanner picks from the user's REAL setup library
  // instead of a hardcoded ICT list, and flags genuinely-new patterns
  // as candidates to add to the playbook rather than inventing names.
  function _playbookDigest() {
    try {
      const pb = (typeof DB !== 'undefined' && DB.getPlaybook) ? DB.getPlaybook() : [];
      return pb.map(s => ({
        name: s.name,
        desc: (s.description || '').replace(/\s+/g, ' ').slice(0, 180),
      }));
    } catch { return []; }
  }

  function _playbookPromptBlock() {
    const digest = _playbookDigest();
    if (!digest.length) return '(empty playbook — pick the closest standard ICT/SMC label)';
    return digest.map((s, i) => `  ${i+1}. "${s.name}" — ${s.desc}`).join('\n');
  }

  async function scanTradeImage(b64DataUrl) {
    const m = b64DataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!m) throw new Error('Bad image data');
    const mediaType = m[1];
    const b64       = m[2];

    const pbBlock = _playbookPromptBlock();

    const system = `You are an ICT/SMC trade-journal scanner. The image is a TradingView chart with the trader's planned trade ALREADY DRAWN — typically horizontal lines for ENTRY, STOP LOSS, and TAKE PROFIT. Read the chart literally.

THE TRADER'S PLAYBOOK (their actual catalogued setups):
${pbBlock}

EXTRACT:
- symbol from the top-left header (return as "BTC/USDT" style with slash).
- timeframe (1m / 5m / 15m / 1h / 4h / D / W).
- chart_timestamp — last visible candle, UTC if shown (string, else null).
- entry / sl / tp — numeric prices by reading the levels of the drawn horizontal lines against the right-side price scale. If a line is labelled, prefer the label.
- direction: "Long" if entry > sl, "Short" if entry < sl.
- rr_planned = |tp - entry| / |entry - sl|, 2 decimal places.
- session from the chart timestamp: Asian (21:00-07:00 UTC), London (07:00-13:00 UTC), NY (13:00-21:00 UTC). If unknown → "Other".
- htf_bias from visible structure: "Bullish" / "Bearish" / "Neutral".
- setup_types: array of 1–3 strings. EACH STRING MUST BE THE EXACT \`name\` of a setup from the playbook above. Pick the playbook entries that best fit what's on the chart. If nothing in the playbook fits, return an empty array — DO NOT invent or use generic ICT labels.
- key_features: array of up to 4 short phrases describing what's actually visible on this chart.
- confidence: object with numeric 0–1 values for keys symbol, entry, sl, tp, setup.
- exit_price: number if a trade has clearly already closed, else null.
- playbook_suggestion: null in most cases. ONLY when the chart shows a recurring, recognizable pattern that does NOT match any playbook entry above AND would be a credible new entry for an ICT/SMC trader, return:
    { "name": "<short title, 3-6 words>",
      "description": "<1-2 sentence definition of when this setup applies and how to enter>",
      "why_missing": "<1 sentence on why none of the existing playbook entries fit>" }
  Be conservative — only suggest if you're confident this is a distinct, repeatable setup. Otherwise null.

THEN CRITIQUE the trade as an ICT coach:
- grade: "A" / "B" / "C" / "D".
- strengths: array of 2–3 short phrases.
- weaknesses: array of 2–3 short phrases.
- rr_assessment: 1 sentence.
- suggested_pre_grade: "A" / "B" / "C" / "D".

Return JSON only, no prose, no markdown fences. Use null for any field you genuinely cannot read.`;

    const user = `Scan this chart. Return one JSON object with keys: symbol, timeframe, chart_timestamp, entry, sl, tp, direction, rr_planned, session, htf_bias, setup_types, key_features, confidence, exit_price, playbook_suggestion, critique. critique is an object with keys: grade, strengths, weaknesses, rr_assessment, suggested_pre_grade.`;

    const { text } = await callClaude({
      system, user, maxTokens: 1500,
      imageData: { mediaType, b64 },
    });
    try { return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text); }
    catch { return { _raw: text, _parseError: true }; }
  }

  async function scanTradeFromText(description) {
    const pbBlock = _playbookPromptBlock();
    const system = `You are an ICT/SMC trade-journal scanner. Vision is not available — the trader has described their setup in text. Infer trade fields and critique.

THE TRADER'S PLAYBOOK (their actual catalogued setups):
${pbBlock}

Return JSON only with the same schema as the vision scanner: symbol, timeframe, chart_timestamp (null if not stated), entry, sl, tp (numbers if stated, else null), direction, rr_planned, session, htf_bias, setup_types (array of EXACT playbook names; empty array if none fit), key_features (array), confidence (object, lower values since no vision), exit_price (null if not stated), playbook_suggestion (object with name/description/why_missing if a credible new pattern emerges, else null), critique: { grade, strengths, weaknesses, rr_assessment, suggested_pre_grade }.

Do not invent numbers — use null if the trader did not give a value.
Do not invent setup labels — only use names from the playbook above; if nothing fits, leave setup_types empty and optionally fill playbook_suggestion.`;
    const user = `Trade description: "${description}"`;
    // Use callClaude() (not _callLocal) so this routes properly:
    //   - Local mode ON       → localhost shim / tunnel
    //   - API key set         → direct browser → Anthropic
    //   - Otherwise (Railway) → /api/_ai/claude server proxy
    // The previous version hard-coded _callLocal which failed on Railway.
    const { text } = await callClaude({ system, user, maxTokens: 1200 });
    try { return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text); }
    catch { return { _raw: text, _parseError: true }; }
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
    // Route via callClaude so Railway users hit the server proxy instead
    // of the unreachable localhost shim (same fix as scanTradeFromText).
    const { text } = await callClaude({ system, user, maxTokens: 600 });
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
  /* Rolling last-7-days window ending today (inclusive). The old weekRange()
     had a -7 that pushed it back an extra week, so on a Sunday it reviewed the
     week-before-last and missed the most recent trades. */
  function reviewRange() {
    const to = new Date();
    const from = new Date(to); from.setUTCDate(to.getUTCDate() - 6);
    return { from: from.toISOString().slice(0,10), to: to.toISOString().slice(0,10) };
  }
  // Back-compat alias (older callers referenced weekRange()).
  function weekRange() { return reviewRange(); }

  /* Human label like "Jun 16 – Jun 22" for the UI. */
  function _fmtRange(from, to) {
    const f = d => new Date(d + 'T00:00:00Z').toLocaleDateString(undefined,
      { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `${f(from)} – ${f(to)}`;
  }

  /* Map a trade's ruleChecks against the user's rule text so the model can
     judge adherence. Only emit a rule set that has ≥1 checked box (the set the
     trade belongs to) — avoids falsely reporting "broke every swing rule" on a
     scalp where that set is simply untouched. */
  function _ruleAdherence(t) {
    const checks = t && t.ruleChecks;
    if (!checks || typeof checks !== 'object') return null;
    let rules = {};
    try { rules = (typeof DB !== 'undefined' && DB.getRules) ? DB.getRules() : {}; }
    catch (_) { rules = {}; }
    const out = {};
    Object.keys(checks).forEach(style => {
      const flags = checks[style];
      if (!Array.isArray(flags) || !flags.some(Boolean)) return; // untouched set
      const set = Array.isArray(rules[style]) ? rules[style] : [];
      const followed = [], notFollowed = [];
      flags.forEach((on, i) => {
        const txt = set[i] && set[i].text ? set[i].text : `rule ${i + 1}`;
        (on ? followed : notFollowed).push(txt);
      });
      out[style] = { followed, notFollowed };
    });
    return Object.keys(out).length ? out : null;
  }

  /* The user's playbook of rules / recurring mistakes / strengths — sent once
     as account context so the model can cite specific rules and flag repeats. */
  function _accountContext() {
    const safe = (fn, d) => { try { return fn(); } catch (_) { return d; } };
    const rules = safe(() => DB.getRules(), {});
    const rulesByStyle = {};
    Object.keys(rules || {}).forEach(style => {
      const arr = Array.isArray(rules[style]) ? rules[style] : [];
      const on = arr.filter(r => r && r.enabled !== false).map(r => r.text);
      if (on.length) rulesByStyle[style] = on;
    });
    const mistakes = safe(() => DB.getMistakes(), [])
      .map(m => ({ name: m.name || m.title || m.text, seen: m.seenCount || 1 }));
    const strengths = safe(() => DB.getStrengths(), [])
      .map(s => ({ name: s.name || s.title || s.text, seen: s.seenCount || 1 }));
    return { rulesByStyle, recurringMistakes: mistakes, strengths };
  }

  async function generateWeeklyReview() {
    const { from, to } = reviewRange();
    const manual = (typeof DB !== 'undefined' && DB.filterByMode && DB.getTrades)
      ? DB.filterByMode(DB.getTrades(), 'new')
      : (typeof DB !== 'undefined' && DB.getTrades ? DB.getTrades() : []);
    const trades = manual.filter(t => t.date >= from && t.date <= to);

    if (!trades.length) {
      throw new Error(`No manual trades found for ${_fmtRange(from, to)} (${from} → ${to}). Log some trades in that window, or check the date range.`);
    }

    const system = `You are a sharp, honest trading coach reviewing a discretionary ICT trader's week. Be specific and evidence-based — cite individual trades by DATE + SYMBOL. Substance over praise: name real mistakes plainly, but also give genuine credit where the data earns it. Read the trader's own notes for psychology (tilt, revenge trades, FOMO, fixation on outcome, moving stops) and call those patterns out by name.

Output MARKDOWN ONLY (no HTML). Use these EXACT section headers in this order, each on its own line:

## 📊 Snapshot
## 📅 Trade-by-trade
## ✅ What you did right
## ❌ What went wrong
## 📏 Rule adherence
## 🧠 Psychology & discipline
## 🎯 What you missed
## 📈 Getting better at
## 🗓️ Next week — 3 focus areas

Section guidance:
- 📊 Snapshot: bullets — trades, win rate, net R, net $, best & worst trade, avg win vs avg loss. Bullets, not a table.
- 📅 Trade-by-trade: one bullet per trade — "**Jun 17 XLM Long** — +2.76R (A) — clean OTE+sweep entry, let it run". Include the grade.
- ✅ / ❌: specific trades and the exact behaviour that was right or wrong. Quote the trade.
- 📏 Rule adherence: using each trade's ruleAdherence data + the trader's rule list, state which rules were followed vs broken. Cite the rule text and the trade. **Explicitly flag any rule broken more than once this week.**
- 🧠 Psychology & discipline: read the notes. Name tilt / revenge / fixation / over-trading patterns and which trades show them.
- 🎯 What you missed: setups skipped, partials not taken, runners cut early, management errors.
- 📈 Getting better at: improvements vs the recurringMistakes/strengths history — what's trending the right way.
- 🗓️ Next week: numbered 1. 2. 3., each a single concrete, testable action.

Bold key labels, use the emojis, keep bullets punchy. It's fine to write a short sentence or two where the insight needs it — depth over brevity here.`;

    const payload = {
      window: { from, to, label: _fmtRange(from, to) },
      account: _accountContext(),
      trades: trades.map(t => ({
        date: t.date, symbol: t.symbol, direction: t.direction,
        session: t.session, htfBias: t.htfBias,
        setups: (t.setupTypes && t.setupTypes.length ? t.setupTypes : [t.setupType]).filter(Boolean),
        entry: t.entry, sl: t.sl, exit: t.exitPrice,
        result_usd: t.result, rMultiple: t.rMultiple,
        preGrade: t.preGrade, postGrade: t.postGrade,
        preGradeNotes: t.preGradeNotes, postGradeNotes: t.postGradeNotes,
        notes: t.notes,
        ruleAdherence: _ruleAdherence(t),
      })),
    };

    const user = `Here is the trader's week (${_fmtRange(from, to)}). "account" holds their rule book, recurring mistakes, and strengths. Each trade has "ruleAdherence" (rules they followed vs broke) and free-text "notes". Write the full review.\n\n${JSON.stringify(payload, null, 2)}`;

    const { text } = await callClaude({ system, user, maxTokens: 6000 });
    const all = getJ(KEYS.reviews, []);
    all.unshift({ weekOf: from, rangeTo: to, rangeLabel: _fmtRange(from, to), html: text, generated: Date.now() });
    setJ(KEYS.reviews, all.slice(0, 12));
    return { html: text, weekOf: from };
  }

  /* Self-contained markdown → HTML renderer for the Weekly Review.
     Escapes first (via esc), then converts headings / bold / italic / code /
     lists / hr / GitHub-style pipe tables / paragraphs. Built in-module so it
     doesn't depend on the retired Sensei tab (whose parser lacks tables). */
  function _reviewMd(src) {
    if (!src) return '';
    // If the text is already HTML (legacy reviews generated under the old
    // "clean HTML" prompt), pass it through untouched.
    if (/<(h3|h4|ul|ol|li|p|table|strong|em)\b/i.test(src)) return src;

    const inline = s => esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

    const lines = String(src).replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let i = 0;
    const closeList = (tag) => { if (tag) out.push(`</${tag}>`); };

    while (i < lines.length) {
      let line = lines[i];
      const trimmed = line.trim();

      // blank
      if (!trimmed) { i++; continue; }

      // horizontal rule
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { out.push('<hr>'); i++; continue; }

      // headings
      let m;
      if ((m = trimmed.match(/^(#{1,6})\s+(.*)$/))) {
        const level = m[1].length;
        const tag = level <= 2 ? 'h3' : 'h4';
        out.push(`<${tag}>${inline(m[2])}</${tag}>`);
        i++; continue;
      }

      // pipe table: header row + separator row of dashes
      if (/^\|.*\|$/.test(trimmed) && i + 1 < lines.length &&
          /^\|?[\s:|-]+\|?$/.test(lines[i + 1].trim()) &&
          lines[i + 1].includes('-')) {
        const splitRow = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const headers = splitRow(trimmed);
        i += 2; // skip header + separator
        const rows = [];
        while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
          rows.push(splitRow(lines[i].trim()));
          i++;
        }
        let t = '<table class="ai-review-tbl"><thead><tr>';
        t += headers.map(h => `<th>${inline(h)}</th>`).join('');
        t += '</tr></thead><tbody>';
        for (const r of rows) {
          t += '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>';
        }
        t += '</tbody></table>';
        out.push(t);
        continue;
      }

      // unordered list
      if (/^[-*]\s+/.test(trimmed)) {
        out.push('<ul>');
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          out.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`);
          i++;
        }
        closeList('ul');
        continue;
      }

      // ordered list
      if (/^\d+\.\s+/.test(trimmed)) {
        out.push('<ol>');
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          out.push(`<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`);
          i++;
        }
        closeList('ol');
        continue;
      }

      // paragraph — gather consecutive non-blank, non-special lines
      const para = [];
      while (i < lines.length) {
        const t2 = lines[i].trim();
        if (!t2) break;
        if (/^(#{1,6})\s+/.test(t2) || /^[-*]\s+/.test(t2) || /^\d+\.\s+/.test(t2) ||
            /^(-{3,}|\*{3,}|_{3,})$/.test(t2) || /^\|.*\|$/.test(t2)) break;
        para.push(t2);
        i++;
      }
      if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    }
    return out.join('\n');
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

      <div class="ai-local-card" style="margin-bottom:18px;padding:18px 20px;background:var(--surface2);border:1px solid var(--border);border-radius:12px;display:block;">

        <!-- HEADER ROW: title (left) + ON/OFF toggle (right) ─────── -->
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:10px;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:15px;color:var(--heading);display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              🖥️ Local mode
              <span style="font-size:11px;font-weight:600;color:var(--accent);background:var(--accent-soft);padding:2px 8px;border-radius:8px;">Free · Uses Claude Code CLI</span>
            </div>
            <div style="font-size:12.5px;color:var(--muted);margin-top:4px;line-height:1.5;">
              When ON, all AI calls go to your local Claude Code subscription instead of Anthropic's billable API. Zero credits used.
            </div>
          </div>

          <!-- Toggle switch — proper styled switch, not a stock checkbox -->
          <label class="ai-toggle" style="display:inline-flex;align-items:center;gap:10px;cursor:pointer;flex-shrink:0;user-select:none;">
            <span id="aiLocalToggleLabel" style="font-size:13px;font-weight:700;color:${localOn ? '#16a34a' : 'var(--muted)'};min-width:28px;text-align:right;">${localOn ? 'ON' : 'OFF'}</span>
            <span style="position:relative;display:inline-block;width:44px;height:24px;">
              <input type="checkbox" id="aiLocalToggle" ${localOn ? 'checked' : ''} style="opacity:0;width:0;height:0;" onchange="document.getElementById('aiLocalToggleLabel').textContent = this.checked ? 'ON' : 'OFF'; document.getElementById('aiLocalToggleLabel').style.color = this.checked ? '#16a34a' : 'var(--muted)'; this.nextElementSibling.style.background = this.checked ? '#16a34a' : 'var(--border)'; this.nextElementSibling.querySelector('span').style.transform = this.checked ? 'translateX(20px)' : 'translateX(0)';" />
              <span style="position:absolute;top:0;left:0;right:0;bottom:0;background:${localOn ? '#16a34a' : 'var(--border)'};border-radius:24px;transition:background .2s;">
                <span style="position:absolute;top:2px;left:2px;width:20px;height:20px;background:#fff;border-radius:50%;transition:transform .2s;transform:${localOn ? 'translateX(20px)' : 'translateX(0)'};box-shadow:0 1px 3px rgba(0,0,0,.2);"></span>
              </span>
            </span>
          </label>
        </div>

        <!-- STATUS PILL ─────────────────────────────────────────── -->
        <div id="aiLocalStatus" style="margin:10px 0 14px;padding:8px 12px;border-radius:8px;background:var(--bg);font-size:12px;color:var(--muted);border:1px solid var(--border);">Checking local server…</div>

        <!-- URL INPUT ──────────────────────────────────────────── -->
        <label for="aiLocalUrl" style="display:block;font-size:12px;font-weight:700;color:var(--heading);margin-bottom:4px;">
          Local AI URL
        </label>
        <div style="font-size:11.5px;color:var(--muted);margin-bottom:6px;line-height:1.45;">
          Empty when running dashboard from <code>localhost</code>. Required when on Railway — paste the public Cloudflare tunnel URL.
        </div>
        <input type="url" id="aiLocalUrl"
          value="${esc(localStorage.getItem('jb_local_ai_url') || '')}"
          placeholder="https://shed-recovery-tracks.trycloudflare.com"
          style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;box-sizing:border-box;" />

        <!-- TOKEN INPUT ─────────────────────────────────────────── -->
        <label for="aiLocalToken" style="display:block;font-size:12px;font-weight:700;color:var(--heading);margin-top:14px;margin-bottom:4px;">
          Local AI Token
        </label>
        <div style="font-size:11.5px;color:var(--muted);margin-bottom:6px;line-height:1.45;">
          Must match the <code>LOCAL_SHIM_TOKEN</code> env var you set when starting the shim. <strong>Required when tunneling</strong> — otherwise anyone with the tunnel URL hits your local Claude.
        </div>
        <input type="password" id="aiLocalToken"
          value="${esc(localStorage.getItem('jb_local_ai_token') || '')}"
          placeholder="paste the same string you used for LOCAL_SHIM_TOKEN"
          style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;box-sizing:border-box;" />

        <!-- SETUP INSTRUCTIONS ────────────────────────────────── -->
        <details style="margin-top:16px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 14px;">
          <summary style="cursor:pointer;font-size:12.5px;font-weight:700;color:var(--heading);user-select:none;">
            📖 Setup — 3 commands on your Mac
          </summary>
          <div style="margin-top:10px;font-size:11.5px;color:var(--text);line-height:1.6;">
            <strong>Why this is needed:</strong> Chrome blocks <code>railway.app</code> from fetching <code>localhost:8770</code> (Private Network Access policy). Tunnel localhost to a public URL so the Railway tab can reach it.

            <div style="margin-top:10px;padding:10px 12px;background:#0d1117;color:#e6edf3;border-radius:6px;font-family:ui-monospace,monospace;font-size:11px;line-height:1.6;overflow-x:auto;">
              <div style="color:#7d8590;"># 1 · Generate token (copy it for the box above)</div>
              <div>TOKEN=$(openssl rand -hex 24); echo "Token: $TOKEN"</div>
              <div style="margin-top:6px;color:#7d8590;"># 2 · Start the hardened shim with auth</div>
              <div>LOCAL_SHIM_TOKEN=$TOKEN nohup python3 ~/.local/bin/local_ai_server.py &amp;</div>
              <div style="margin-top:6px;color:#7d8590;"># 3 · Start the public tunnel (leave running)</div>
              <div>"_CLAUDE PROJECTS/Crypto Liquidity Watcher/bin/cloudflared" tunnel --url http://localhost:8770</div>
            </div>

            <div style="margin-top:10px;">
              Cloudflare prints a <code>https://*.trycloudflare.com</code> URL → paste it into <strong>Local AI URL</strong> above, paste <code>$TOKEN</code> into <strong>Local AI Token</strong>, toggle Local mode <strong>ON</strong>, click Save.
            </div>

            <div style="margin-top:10px;font-size:11px;color:var(--muted);">
              <strong>Safety:</strong> the shim runs spawned sessions with <code>--allowedTools ""</code> so even if someone reaches the tunnel they can't run Bash/Read/Write. The token is a second layer.
            </div>
          </div>
        </details>
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

  /* ── Structured error card for Weekly Review failures ──────────────────
     Detects the two most common failure modes (expired tunnel / no credits)
     and shows a clean card with action buttons instead of a raw text dump. */
  function _renderWeeklyError(msg) {
    const isCredit  = /credit balance|too low|billing|insufficient|quota/i.test(msg);
    const isTunnel  = /tunnel unreachable|expired|cloudflare/i.test(msg);
    const isBoth    = /Both AI paths failed/i.test(msg);

    let headline, detail, actions = '';

    if (isBoth && isCredit) {
      headline = 'Both AI paths failed — API credits depleted';
      detail   = 'The Cloudflare tunnel has expired AND the Railway Anthropic key is out of credits. ' +
                 'Quickest fix: add credits at <b>console.anthropic.com</b>, then click Generate again. ' +
                 'Your existing reviews are still intact below.';
      actions  = `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
        <a href="https://console.anthropic.com/settings/plans" target="_blank" rel="noopener" class="btn-ghost btn-sm">Add credits ↗</a>
        <button class="btn-ghost btn-sm" onclick="AICoachTab._openSettings()">⚙ Update tunnel URL</button>
      </div>`;
    } else if (isCredit) {
      headline = 'API credits depleted';
      detail   = 'The Railway Anthropic key has run out of credits. Add credits at <b>console.anthropic.com</b>, ' +
                 'or switch to Local mode if your Mac is running the local AI server.';
      actions  = `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
        <a href="https://console.anthropic.com/settings/plans" target="_blank" rel="noopener" class="btn-ghost btn-sm">Add credits ↗</a>
        <button class="btn-ghost btn-sm" onclick="AICoachTab._openSettings()">⚙ Settings</button>
      </div>`;
    } else if (isTunnel) {
      headline = 'Local AI tunnel offline';
      detail   = 'The Cloudflare quick-tunnel URL has expired. Restart cloudflared on your Mac and paste the ' +
                 'new URL in Settings → Local AI URL, or turn off Local mode to use the Railway proxy.';
      actions  = `<div style="margin-top:10px">
        <button class="btn-ghost btn-sm" onclick="AICoachTab._openSettings()">⚙ Update URL in Settings</button>
      </div>`;
    } else {
      headline = 'Generation failed';
      detail   = `<pre style="white-space:pre-wrap;font-family:inherit;font-size:.75rem;margin:4px 0 0;color:var(--muted)">${esc(msg)}</pre>`;
    }

    return `<div style="margin-top:12px;padding:14px 16px;border-radius:8px;background:var(--red-subtle,#fff1f0);border:1px solid var(--red-border,#fecaca)">
      <div style="font-weight:600;color:var(--bad,#dc2626);margin-bottom:6px">⚠ ${headline}</div>
      <div style="font-size:.83rem;color:var(--text);line-height:1.55">${detail}</div>
      ${actions}
    </div>`;
  }

  /* ── Download a stored review as a PDF (via browser print dialog) ──────
     Opens a styled print window and auto-triggers window.print(). Chrome/
     Safari both default to "Save as PDF" — no external library needed. */
  function _downloadReview(idx) {
    const all = getJ(KEYS.reviews, []);
    const r = all[idx];
    if (!r) return;
    const lbl  = r.rangeLabel || `Week of ${r.weekOf}`;
    const gen  = r.generated ? new Date(r.generated).toLocaleString() : '';
    const body = _reviewMd(r.html);
    const style = `
      @media print { @page { margin: 18mm 20mm; } }
      body { font-family: system-ui, -apple-system, sans-serif; max-width: 700px; margin: 28px auto; padding: 0 22px; line-height: 1.68; color: #1a1a1a; font-size: 13.5px; }
      h2  { margin: 0 0 4px; font-size: 1.45rem; color: #111; }
      h3  { margin: 22px 0 7px; font-size: 1.05rem; color: #0a5c2f; border-bottom: 1px solid #d4e8d8; padding-bottom: 3px; }
      h4  { margin: 14px 0 5px; color: #333; }
      ul, ol { margin: 5px 0 11px 22px; }
      li  { margin: 4px 0; }
      hr  { border: 0; border-top: 1px solid #ddd; margin: 16px 0; }
      table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: .9em; }
      td, th { border: 1px solid #ddd; padding: 5px 9px; text-align: left; }
      th  { background: #f2f5f0; font-weight: 600; }
      .meta { font-size: .8rem; color: #888; margin-bottom: 22px; }
      strong { color: #111; }
    `;
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${lbl}</title><style>${style}</style></head>` +
                 `<body onload="setTimeout(()=>{window.print();window.onafterprint=()=>window.close();},350)">` +
                 `<h2>${lbl}</h2><div class="meta">Generated ${gen}</div>${body}</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { if (typeof App !== 'undefined' && App.toast) App.toast('Allow pop-ups to download the review', 'warn'); return; }
    w.document.write(html);
    w.document.close();
  }

  function renderWeeklyReview() {
    const all = getJ(KEYS.reviews, []);
    const latest = all[0];
    const { from, to } = reviewRange();
    const upcoming = _fmtRange(from, to);
    const lbl = r => r && r.rangeLabel ? r.rangeLabel : `Week of ${r ? r.weekOf : ''}`;
    return `<div class="ai-section">
      <h3 class="ai-section-hdr">📅 Weekly Review</h3>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <button class="btn-primary" id="aiWeeklyBtn">🧠 Generate review — last 7 days (${esc(upcoming)})</button>
        ${latest ? `<button class="btn-ghost btn-sm" onclick="AICoachTab._downloadReview(0)" title="Download this review as HTML">📥 Download</button>` : ''}
      </div>
      <div id="aiWeeklyStatus" class="text-dim" style="font-size:.8rem;margin-top:6px"></div>
      ${latest ? `
        <div class="ai-review" style="margin-top:14px">
          <div class="text-sub" style="font-size:.78rem;margin-bottom:8px">${esc(lbl(latest))} · generated ${new Date(latest.generated).toLocaleString()}</div>
          <div class="ai-review-body">${_reviewMd(latest.html)}</div>
        </div>
      ` : ''}
      ${all.length > 1 ? `<details style="margin-top:14px"><summary class="text-sub" style="cursor:pointer;font-size:.82rem">Past reviews (${all.length-1})</summary>
        <div style="margin-top:10px">${all.slice(1).map((r, i) => {
          const safeWeek = /^\d{4}-\d{2}-\d{2}$/.test(r.weekOf) ? r.weekOf : '';
          const dlIdx = i + 1;
          return `
          <div class="ai-hist-row" style="cursor:pointer;display:flex;align-items:center">
            <span class="text-sub" onclick="AICoachTab._showReview('${safeWeek}')" style="flex:1">📅 ${esc(lbl(r))}</span>
            <button class="btn-ghost btn-sm" onclick="AICoachTab._downloadReview(${dlIdx})" title="Download" style="margin-left:8px;flex-shrink:0">📥</button>
            <span class="text-dim" onclick="AICoachTab._showReview('${safeWeek}')" style="font-size:.7rem;margin-left:8px">${new Date(r.generated).toLocaleDateString()}</span>
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
    { id: 'alerts',       label: '🚨 Alerts',          needsKey: false },
    { id: 'grading',      label: '📊 Grade Insights',  needsKey: false },
    { id: 'catalogue',    label: '📖 Setup Catalogue', needsKey: false },
    { id: 'getfreescore', label: '🏆 Get Free Score',  needsKey: false },
    { id: 'review',       label: '📅 Weekly Review',   needsKey: true  },
    { id: 'settings',     label: '⚙️ Settings',         needsKey: false },
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
        const localUrl   = document.getElementById('aiLocalUrl')?.value.trim();
        const localToken = document.getElementById('aiLocalToken')?.value.trim();
        if (k !== undefined) setS(KEYS.apiKey, k);
        if (m) setS(KEYS.model, m);
        if (localChk) localStorage.setItem(LOCAL_KEY, localChk.checked ? 'on' : 'off');
        if (localUrl !== undefined) {
          if (localUrl) localStorage.setItem(LOCAL_URL_KEY, localUrl.replace(/\/$/, ''));
          else localStorage.removeItem(LOCAL_URL_KEY);
        }
        if (localToken !== undefined) {
          if (localToken) localStorage.setItem(LOCAL_TOKEN_KEY, localToken);
          else localStorage.removeItem(LOCAL_TOKEN_KEY);
        }
        if (typeof App !== 'undefined' && App.toast) App.toast('Settings saved');
        _settingsOpen = false; render();
      });
      // Probe local server status immediately when settings is shown
      _localAvailable().then(probe => {
        const el = document.getElementById('aiLocalStatus');
        if (!el) return;
        const base = getLocalAIUrl();
        const haveToken = !!getLocalAIToken();
        const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
        if (probe && probe.ok) {
          const tokenNote = probe.auth_required
            ? (haveToken ? ' · token configured' : ' · ⚠ shim requires token but none configured here')
            : ' · auth off (localhost only)';
          el.innerHTML = `✅ Local server reachable at <code>${esc(base)}</code>${tokenNote}`;
          el.style.color = probe.auth_required && !haveToken
            ? 'var(--warn, #ca8a04)' : 'var(--good, #16a34a)';
        } else if (!base) {
          el.innerHTML = `⚠️ Local AI URL not set. Paste a public tunnel URL above (Chrome PNA blocks direct localhost from this Railway-served page).`;
          el.style.color = 'var(--warn, #ca8a04)';
        } else if (isLocalHost) {
          el.innerHTML = `⚠️ Local server not reachable at <code>${esc(base)}</code> — start <code>python3 ~/.local/bin/local_ai_server.py</code> on this Mac.`;
          el.style.color = 'var(--warn, #ca8a04)';
        } else {
          el.innerHTML = `❌ Tunnel URL <code>${esc(base)}</code> didn't respond. The Cloudflare quick-tunnel URL may have expired — restart <code>cloudflared tunnel</code> and paste the fresh URL.`;
          el.style.color = 'var(--bad, #dc2626)';
        }
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
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn-ghost btn-sm" onclick="AICoachTab._launchTrainer()" title="Open the ICT TradingView Replay Trainer (auto-starts it if it isn't running)">🥋 ICT Trainer</button>
          <button class="btn-ghost btn-sm" onclick="AICoachTab._openSettings()">⚙️ Settings</button>
        </div>
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

      <div id="aiWeeklySection" style="margin-bottom:20px"></div>

      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px">
        ${insights.length ? insights.map(insightCard).join('') : emptyCard}
      </div>

      <!-- ── Merged sections (2026-05-19 audit: Rules / Playbook / My Reports) ─ -->
      <div style="border-top:1px solid var(--border);padding-top:28px;margin-top:24px">
        <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:#666;margin-bottom:4px">Discipline &amp; Reference</div>
        <div style="font-size:.95rem;font-weight:700;color:var(--text);margin-bottom:18px">Rules, setups, and post-hoc reports</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px">
          ${_mergedCard('📜', 'Rules', _rulesSummary(), 'rules')}
          ${_mergedCard('📖', 'Playbook', _playbookSummary(), 'playbook')}
          ${_mergedCard('📑', 'My Reports', 'Weekly / monthly performance, imports, and setup breakdowns. Generated post-hoc from your trade log.', 'reports')}
        </div>
      </div>

      <!-- ── Patterns (Tendencies merged) ─────────────────── -->
      <div style="border-top:1px solid var(--border);padding-top:28px;margin-top:32px">
        <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:#666;margin-bottom:4px">Patterns</div>
        <div style="font-size:.95rem;font-weight:700;color:var(--text);margin-bottom:18px">Where you make money and where you don't</div>
        <div id="tendencies-embed"></div>
      </div>
    `;

    if (typeof TendenciesTab !== 'undefined') TendenciesTab.renderInto('tendencies-embed');
    _mountWeeklyReview();
  }

  function _mountWeeklyReview() {
    const wrap = document.getElementById('aiWeeklySection');
    if (!wrap) return;
    const apiKey = getKey();
    const localOn = localStorage.getItem(LOCAL_KEY) === 'on';
    if (!apiKey && !localOn) {
      wrap.innerHTML = `
        <div class="card" style="padding:14px 18px">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="font-size:1.2rem">📅</div>
            <div style="font-weight:700;color:var(--text)">Weekly Review</div>
          </div>
          <div style="font-size:.8rem;color:var(--muted);margin-top:6px">
            🔑 Add your Anthropic API key in ⚙️ Settings (or enable Local mode) to generate a review of last week's trades.
          </div>
        </div>`;
      return;
    }
    wrap.innerHTML = `<div class="card" style="padding:16px 20px">${renderWeeklyReview()}</div>`;
    document.getElementById('aiWeeklyBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('aiWeeklyBtn');
      const status = document.getElementById('aiWeeklyStatus');
      btn.disabled = true; status.innerHTML = '<span style="color:var(--gold)">Generating (15-30s)…</span>';
      try { await generateWeeklyReview(); _mountWeeklyReview(); }
      catch (e) { status.innerHTML = _renderWeeklyError(e.message); btn.disabled = false; }
    });
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

      case 'getfreescore':
        wrap.innerHTML = '<div id="aicScore"></div>';
        try { if (typeof CoachTab !== 'undefined') CoachTab._renderScore(document.getElementById('aicScore')); }
        catch (e) { document.getElementById('aicScore').innerHTML = `<div class="text-dim">Score unavailable: ${e.message}</div>`; }
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
          btn.disabled = true; status.innerHTML = '<span style="color:var(--gold)">Generating (15-30s)…</span>';
          try { await generateWeeklyReview(); _renderSubTab(getKey()); }
          catch (e) { status.innerHTML = _renderWeeklyError(e.message); btn.disabled = false; }
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
    _launchTrainer: () => {
      // ICT TV Replay Trainer runs in its own Node bridge (HUD on :8800), kept
      // alive by a launchd agent (com.claudebot.ict-tv-trainer) so it's always up.
      // Open the tab synchronously (popup-safe). The :8770 helper fetch is only a
      // best-effort cold-start for localhost:8768 users — from the Railway HTTPS
      // dashboard it's PNA-blocked, which is fine: the bridge is already running,
      // so the opened tab loads regardless. A blocked/failed fetch stays silent.
      const url = 'http://localhost:8800';
      const w = window.open(url, 'ict_trainer');
      const toast = (m) => { if (typeof App !== 'undefined' && App.toast) App.toast(m); };
      toast('🥋 Opening ICT Trainer…');
      fetch('http://127.0.0.1:8770/launch-trainer', { method: 'POST', mode: 'cors', cache: 'no-store' })
        .then(r => r.json())
        .then(j => { if (w && j && j.ok) { try { w.location = url; } catch (_) {} } })  // reload once the bridge confirms up
        .catch(() => {});   // PNA-blocked on Railway / helper offline — tab already opened, stay silent
    },
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
    scanTradeImage,
    scanTradeFromText,
    callClaude,
    isLocalMode,
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
      w.document.write(`<html><head><title>Review · Week of ${weekOf}</title><style>body{font-family:system-ui;max-width:720px;margin:30px auto;padding:0 20px;line-height:1.65;color:#222}h3{margin:24px 0 8px;color:#0a3;border-bottom:1px solid #eee;padding-bottom:4px}h4{margin:16px 0 6px;color:#444}ul,ol{margin:6px 0 12px 22px}li{margin:5px 0}hr{border:0;border-top:1px solid #ddd;margin:18px 0}table{border-collapse:collapse;width:100%;margin:10px 0}td,th{border:1px solid #ddd;padding:6px 10px;text-align:left}th{background:#f5f5f5}</style></head><body>${_reviewMd(r.html)}</body></html>`);
      w.document.close();
    },
    _downloadReview,
  };
})();
