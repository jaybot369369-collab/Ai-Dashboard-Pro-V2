/* ═══════════════════════════════════════════════════════════
   CLOUDFLARE R2 IMAGE STORAGE
   Browser → Cloudflare Worker → R2 bucket
   Worker handles auth + upload, returns public URL
   Dashboard stores only the URL (small string), no base64 bloat.
════════════════════════════════════════════════════════════ */
const R2 = (() => {
  const KEYS = {
    workerUrl: 'jb_r2_worker',  // e.g. https://images.YOURACCOUNT.workers.dev
    enabled:   'jb_r2_enabled', // '1' | '0'
    log:       'jb_r2_log',     // recent uploads/deletes
  };
  const get = k => localStorage.getItem(k) || '';
  const setS = (k,v) => localStorage.setItem(k, v);

  function isEnabled() { return get(KEYS.enabled) === '1' && get(KEYS.workerUrl); }
  function getWorkerUrl() { return get(KEYS.workerUrl).replace(/\/$/, ''); }

  /* ── Image compression (1200px max, WebP @ 80%) ─────── */
  async function compressImage(file, maxWidth = 1200, quality = 0.8) {
    const img = await loadImage(file);
    const ratio = Math.min(1, maxWidth / img.width);
    const w = Math.round(img.width  * ratio);
    const h = Math.round(img.height * ratio);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return new Promise((res, rej) => {
      canvas.toBlob(blob => {
        if (!blob) return rej(new Error('toBlob failed'));
        res(blob);
      }, 'image/webp', quality);
    });
  }

  function loadImage(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('image load failed'));
      // Accept File, Blob, or data URL string
      img.src = typeof file === 'string' ? file : URL.createObjectURL(file);
    });
  }

  /* ── Upload to Worker ───────────────────────────────── */
  async function upload(file, opts = {}) {
    if (!isEnabled()) throw new Error('R2 not configured — open Pro Tools → Storage');
    // Compress unless told otherwise
    const blob = opts.skipCompress ? file : await compressImage(file, opts.maxWidth, opts.quality);
    const url = `${getWorkerUrl()}/upload`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'image/webp' },
      body: blob,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Upload failed (${res.status}): ${errText}`);
    }
    const json = await res.json();
    logEvent({ time: Date.now(), op: 'upload', url: json.url, size: blob.size });
    return json; // { url, key }
  }

  /* ── Convert any base64 data URL → R2 URL ───────────── */
  async function uploadDataUrl(dataUrl) {
    if (!dataUrl.startsWith('data:image')) throw new Error('not an image data URL');
    const blob = await (await fetch(dataUrl)).blob();
    return upload(blob);
  }

  /* ── Delete (optional) ──────────────────────────────── */
  async function deleteByKey(key) {
    if (!isEnabled()) throw new Error('R2 not configured');
    const url = `${getWorkerUrl()}/delete?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error('delete failed: ' + res.status);
    logEvent({ time: Date.now(), op: 'delete', key });
    return true;
  }

  /* ── Migrate all existing base64 images in trades to R2 ── */
  async function migrateAllBase64({ onProgress } = {}) {
    if (!isEnabled()) throw new Error('R2 not configured');
    const trades = DB.getTrades();
    let total = 0, done = 0, fail = 0;
    // First pass: count
    trades.forEach(t => {
      const urls = DB.getScreenshots(t);
      total += urls.filter(u => u.startsWith('data:image')).length;
    });
    if (!total) return { total: 0, done: 0, fail: 0 };

    // Second pass: upload + replace
    for (const t of trades) {
      const urls = DB.getScreenshots(t);
      const newUrls = [];
      let changed = false;
      for (const u of urls) {
        if (u.startsWith('data:image')) {
          try {
            const r = await uploadDataUrl(u);
            newUrls.push(r.url);
            changed = true; done++;
          } catch (e) {
            console.warn('Migrate fail for trade', t.id, e.message);
            newUrls.push(u); fail++;
          }
          if (onProgress) onProgress({ done, total, fail });
        } else {
          newUrls.push(u);
        }
      }
      if (changed) {
        t.screenshotUrls = newUrls;
        DB.updateTrade(t.id, t);
      }
    }
    return { total, done, fail };
  }

  /* ── Log helpers ────────────────────────────────────── */
  function logEvent(e) {
    try {
      const log = JSON.parse(localStorage.getItem(KEYS.log) || '[]');
      log.unshift(e);
      localStorage.setItem(KEYS.log, JSON.stringify(log.slice(0, 30)));
    } catch {}
  }
  function getLog() {
    try { return JSON.parse(localStorage.getItem(KEYS.log) || '[]'); }
    catch { return []; }
  }

  /* ── Test connection ────────────────────────────────── */
  async function testConnection() {
    if (!getWorkerUrl()) throw new Error('No worker URL set');
    const res = await fetch(`${getWorkerUrl()}/ping`);
    if (!res.ok) throw new Error(`Worker not reachable (${res.status})`);
    return await res.text();
  }

  return {
    KEYS, isEnabled, upload, uploadDataUrl, deleteByKey,
    compressImage, migrateAllBase64, getLog, testConnection,
    getWorkerUrl, getEnabled: () => get(KEYS.enabled) === '1',
    setWorkerUrl: u => setS(KEYS.workerUrl, u.replace(/\/$/, '')),
    setEnabled:   b => setS(KEYS.enabled, b ? '1' : '0'),
  };
})();
