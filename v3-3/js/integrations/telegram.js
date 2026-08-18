/* ═══════════════════════════════════════════════════════════
   TELEGRAM INTEGRATION — bot alerts to your phone
   Settings stored in localStorage:
     jb_tg_token   — bot token from @BotFather
     jb_tg_chat    — chat ID (auto-discovered or pasted)
     jb_tg_enabled — '1' or '0'
     jb_tg_log     — JSON array of last 30 sends
════════════════════════════════════════════════════════════ */
const Telegram = (() => {
  const KEYS = {
    token: 'jb_tg_token', chat: 'jb_tg_chat', enabled: 'jb_tg_enabled', log: 'jb_tg_log',
  };
  const get = k => localStorage.getItem(k) || '';
  const setS = (k,v) => localStorage.setItem(k, v);

  function isEnabled() { return get(KEYS.enabled) === '1' && get(KEYS.token) && get(KEYS.chat); }

  async function api(method, params = {}) {
    const token = get(KEYS.token);
    if (!token) throw new Error('No bot token');
    const url = `https://api.telegram.org/bot${token}/${method}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.description || 'Telegram API error');
    return json.result;
  }

  async function getMe() { return api('getMe'); }

  // Auto-discover chat ID from getUpdates (user must have messaged bot first)
  async function discoverChatId() {
    const updates = await api('getUpdates');
    if (!updates.length) throw new Error('No messages found. DM your bot first then click again.');
    // Find most recent private chat
    const chats = updates
      .map(u => u.message?.chat || u.edited_message?.chat || u.channel_post?.chat)
      .filter(c => c && c.type === 'private');
    if (!chats.length) throw new Error('No private chats found in updates.');
    const chatId = String(chats[chats.length - 1].id);
    setS(KEYS.chat, chatId);
    return chatId;
  }

  async function send(text, opts = {}) {
    if (!isEnabled() && !opts.force) return { skipped: true };
    const chat = get(KEYS.chat);
    if (!chat) throw new Error('No chat ID set');
    try {
      const res = await api('sendMessage', {
        chat_id: chat,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });
      logSend({ time: Date.now(), text, ok: true });
      return res;
    } catch (e) {
      logSend({ time: Date.now(), text, ok: false, err: e.message });
      throw e;
    }
  }

  function logSend(entry) {
    try {
      const log = JSON.parse(localStorage.getItem(KEYS.log) || '[]');
      log.unshift(entry);
      localStorage.setItem(KEYS.log, JSON.stringify(log.slice(0, 30)));
    } catch {}
  }

  function getLog() {
    try { return JSON.parse(localStorage.getItem(KEYS.log) || '[]'); }
    catch { return []; }
  }

  // Format a setup alert (called from Dojo when 🦖 fires)
  function formatDinoAlert(s) {
    const conf = s.confluence;
    const dir = conf.bulls > conf.bears ? 'LONG' : 'SHORT';
    const arrow = dir === 'LONG' ? '🟢' : '🔴';
    return `🦖 *DINO FIRE* ${arrow}\n\n` +
      `*${s.symbol || 'Pair'}* — *${dir}* setup\n` +
      `Confluence: ${conf.bulls}▲ / ${conf.bears}▼ (${dir} dominant)\n` +
      `Killzone: ${s.killzone || 'active'}\n` +
      (s.entry ? `Entry: \`${s.entry}\`\n` : '') +
      (s.sl    ? `SL: \`${s.sl}\`\n` : '') +
      (s.tp    ? `TP: \`${s.tp}\`\n` : '') +
      `\n_Open dashboard → ICT Dojo_`;
  }

  return {
    KEYS, isEnabled, api, getMe, discoverChatId, send,
    formatDinoAlert, getLog,
    setToken:   t => setS(KEYS.token, t),
    setChat:    c => setS(KEYS.chat, c),
    setEnabled: b => setS(KEYS.enabled, b ? '1' : '0'),
    getToken:   () => get(KEYS.token),
    getChat:    () => get(KEYS.chat),
    getEnabled: () => get(KEYS.enabled) === '1',
  };
})();
