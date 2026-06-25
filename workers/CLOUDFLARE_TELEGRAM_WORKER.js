// ═══════════════════════════════════════════════════════════
// CLOUDFLARE WORKER — Telegram → GitHub Actions dispatcher
// Lets you message your bot "Daily Report" and get a fresh
// PDF back in ~60 seconds.
//
// Setup:
//  1. Cloudflare Dashboard → Workers & Pages → Create → "Hello World"
//  2. Paste this entire file as the Worker code → Save and Deploy
//  3. Settings → Variables → add as SECRETS (encrypt all three):
//        TG_BOT_TOKEN     — same value as your existing cron secret
//        TG_CHAT_ID       — same value as your existing cron secret
//                           (used as the whitelist; only YOUR chat
//                            can trigger the workflow)
//        GH_DISPATCH_PAT  — classic GitHub PAT with "workflow"
//                           scope on the ict-watchlist repo
//        GH_REPO          — "jaybot369369-collab/ict-watchlist"
//        GH_WORKFLOW      — "daily_watchlist.yml"
//  4. Copy the worker URL (e.g. https://telegram-dispatch.YOURACCOUNT.workers.dev)
//  5. Set the Telegram webhook (one-time, from terminal):
//        curl -F "url=https://telegram-dispatch.YOURACCOUNT.workers.dev/tg-webhook" \
//          https://api.telegram.org/bot<TG_BOT_TOKEN>/setWebhook
//  6. Open the bot chat and send: Daily Report
// ═══════════════════════════════════════════════════════════

const TRIGGER_PHRASES = [
  /^\s*\/?daily(\s+report)?\s*$/i,
  /^\s*\/?report\s*$/i,
  /^\s*\/?watchlist\s*$/i,
];

const HELP_TEXT =
  "Hi 👋 — send `Daily Report` (or `/daily`) to trigger a fresh ICT watchlist. " +
  "It'll arrive as a PDF in ~60 seconds.";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health check (visit in browser to confirm worker is alive)
    if (url.pathname === '/ping') {
      return new Response('pong', { status: 200 });
    }

    // Telegram webhook
    if (url.pathname === '/tg-webhook' && request.method === 'POST') {
      let update;
      try {
        update = await request.json();
      } catch (_e) {
        return ok(); // bad JSON — Telegram still wants 200
      }

      const msg     = update.message || update.edited_message;
      const chatId  = msg?.chat?.id?.toString();
      const text    = (msg?.text || '').trim();
      const allowed = String(env.TG_CHAT_ID || '');

      // Whitelist: only the configured chat can dispatch
      if (!chatId || !allowed || chatId !== allowed) {
        return ok(); // silently ignore strangers
      }

      // /start or /help → friendly intro
      if (/^\/(start|help)\b/i.test(text)) {
        await tgReply(env, chatId, HELP_TEXT);
        return ok();
      }

      // Match a trigger phrase
      const matched = TRIGGER_PHRASES.some(rx => rx.test(text));
      if (!matched) return ok();

      // Dispatch GitHub workflow
      try {
        await dispatchGitHub(env);
        await tgReply(env, chatId,
          "⏳ Generating today's Daily Report — should arrive in ~60s.");
      } catch (e) {
        await tgReply(env, chatId,
          "⚠ Failed to trigger report: " + (e.message || e));
      }
      return ok();
    }

    return new Response('Not found', { status: 404 });
  },
};

function ok() { return new Response('ok', { status: 200 }); }

async function dispatchGitHub(env) {
  const repo     = env.GH_REPO     || 'jaybot369369-collab/ict-watchlist';
  const workflow = env.GH_WORKFLOW || 'daily_watchlist.yml';
  const token    = env.GH_DISPATCH_PAT;
  if (!token) throw new Error('GH_DISPATCH_PAT secret not set');

  const r = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: 'POST',
      headers: {
        'Accept':        'application/vnd.github+json',
        'Authorization': 'Bearer ' + token,
        'Content-Type':  'application/json',
        'User-Agent':    'cf-worker-tg-dispatch',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main' }),
    }
  );
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`GitHub ${r.status}: ${txt.slice(0, 300)}`);
  }
}

async function tgReply(env, chatId, text) {
  const token = env.TG_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
}
