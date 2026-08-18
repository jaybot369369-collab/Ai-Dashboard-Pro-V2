/* ═══════════════════════════════════════════════════════════
   BACKUP — one file with everything in it.

   The plain JSON export has a hole in it that is easy to miss: your
   screenshots are not in it. They were uploaded to Cloudflare and the
   trade only keeps the LINK. So a backup that looks complete is really
   a set of pointers at somebody else's server, and the day that bucket
   goes away the pictures go with it.

   This builds a real archive instead — a .zip holding:

     backup.json          everything the dashboard stores
     trades.csv           the trades again, openable in any spreadsheet
     reviews/*.md         each weekly review as readable text
     pictures/*           the screenshots, actually downloaded
     WHAT-IS-IN-HERE.txt  written last, listing what made it and what did not

   No library. The zip is written by hand below because the page has to
   stay self-contained.

   ── About the pictures ──────────────────────────────────────
   Cloudflare's public bucket serves images fine to an <img> tag but
   refuses to let a script READ them — no cross-origin header. A page
   may SHOW the picture and may not SAVE it.

   Rather than ask Jay to change her Cloudflare settings, the Railway
   server fetches them on the page's behalf (the /v3/img/ block in
   nginx.conf.template). A server has no same-origin rule to obey, and
   from the browser's point of view it is just another file on /v3/.

   That only exists on Railway. Anywhere else the plain link is tried,
   and where Cloudflare refuses, the picture is listed in
   WHAT-IS-IN-HERE.txt with its address rather than silently dropped —
   a backup that quietly loses 95 pictures is worse than one that
   admits it.
════════════════════════════════════════════════════════════ */
const Backup = (() => {
  'use strict';

  /* ── The zip format, written by hand ──────────────────
     Stored, not compressed. Screenshots are already jpg/png/webp, so
     compressing them again buys nothing and costs a dependency. */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = -1;
    for (let i = 0; i < bytes.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ bytes[i]) & 0xFF];
    return (c ^ -1) >>> 0;
  }

  const enc = new TextEncoder();
  const bytesOf = v => (typeof v === 'string' ? enc.encode(v) : new Uint8Array(v));

  /* MS-DOS packed date and time — what the zip header wants. */
  function dosStamp(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }

  function zip(files) {
    const now = dosStamp(new Date());
    const parts = [], dir = [];
    let offset = 0;

    files.forEach(f => {
      const name = enc.encode(f.name);
      const body = bytesOf(f.body);
      const sum = crc32(body);

      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);       // local file header
      lv.setUint16(4, 20, true);               // version needed
      lv.setUint16(6, 0x0800, true);           // names are utf-8
      lv.setUint16(8, 0, true);                // stored, no compression
      lv.setUint16(10, now.time, true);
      lv.setUint16(12, now.date, true);
      lv.setUint32(14, sum, true);
      lv.setUint32(18, body.length, true);
      lv.setUint32(22, body.length, true);
      lv.setUint16(26, name.length, true);
      local.set(name, 30);

      const central = new Uint8Array(46 + name.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);       // central directory entry
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, now.time, true);
      cv.setUint16(14, now.date, true);
      cv.setUint32(16, sum, true);
      cv.setUint32(20, body.length, true);
      cv.setUint32(24, body.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      central.set(name, 46);

      parts.push(local, body);
      dir.push(central);
      offset += local.length + body.length;
    });

    const dirSize = dir.reduce((a, d) => a + d.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, dirSize, true);
    ev.setUint32(16, offset, true);

    return new Blob([...parts, ...dir, end], { type: 'application/zip' });
  }

  /* ── Pulling the pictures down ─────────────────────── */
  const extOf = url => {
    const m = String(url).split('?')[0].match(/\.(\w{3,4})$/);
    return m ? m[1].toLowerCase() : 'img';
  };

  /* Cloudflare will show a picture to an <img> tag but will not let a script
     read it, so on its own the backup could not include a single screenshot.
     The Railway server fetches them instead — see the /v3/img/ block in
     nginx.conf.template. Coming from our own address, the browser has no
     objection.

     Only rewrite when the page is actually being served from a host that has
     that passthrough. Opened from a file or a local server it does not exist,
     so the plain link is tried and, if Cloudflare refuses, the picture is
     reported as missing rather than silently dropped. */
  const BUCKET = /^https?:\/\/pub-[0-9a-f]+\.r2\.dev\//i;

  function reachable(url) {
    if (!BUCKET.test(url)) return url;
    if (location.protocol === 'file:') return url;
    if (/^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname)) return url;
    return url.replace(BUCKET, '/v3/img/');
  }

  /* Every picture on a trade, whichever field it ended up in.

     `screenshotUrl` — singular — is an old field the current dashboard does
     not read. One trade still has a 1.7 MB pasted-in picture sitting in it:
     invisible on screen, never uploaded to storage (the uploader only walks
     the plural field), and it was being skipped by the backup too. It is
     most of the browser storage this dashboard uses. Read both. */
  function picturesOn(t) {
    const list = [...(t.screenshotUrls || [])];
    if (typeof t.screenshotUrl === 'string' && t.screenshotUrl) list.push(t.screenshotUrl);
    const out = [];
    list.filter(u => typeof u === 'string' && u).forEach(u => {
      // a pasted-in value can hold more than one picture — see splitDataUrls
      if (u.startsWith('data:')) out.push(...splitDataUrls(u));
      else out.push(u);
    });
    return out;
  }

  /* Turn a pasted-in picture back into bytes.

     The obvious way is fetch(dataUrl) — and it fails on the live site. The
     page's security rules do not allow fetching a data: address, so the one
     picture Jay had pasted in came out as "Failed to fetch" and was the only
     thing missing from an otherwise complete backup. Decoding it here needs
     no network and no permission. */
  function toBytes(b64) {
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  /* One stored value can hold more than one picture.

     Jay's 27 Apr trade turned out to be TWO pngs concatenated into a single
     field, and the first was cut off part way through — the tell-tale of a
     browser hitting its storage limit mid-write, which is the silent failure
     this dashboard exists to avoid. Decoding the field as one blob failed,
     so BOTH pictures were being reported as lost when the second one was
     perfectly intact.

     Split on the header, then decode each piece on its own. */
  function splitDataUrls(s) {
    const at = [];
    let i = -1;
    while ((i = s.indexOf('data:', i + 1)) !== -1) at.push(i);
    return at.map((start, n) => s.slice(start, at[n + 1] === undefined ? s.length : at[n + 1]));
  }

  /* Decode as much as there is. A cut-off picture is still worth keeping —
     a png holds its rows in order, so the top of the chart survives even
     when the tail is gone. Saved with `damaged` in the name so it is never
     mistaken for a clean copy. */
  function decodeDataUrl(url) {
    const body = url.slice(url.indexOf(',') + 1);
    try {
      return { bytes: toBytes(body), whole: true };
    } catch {
      const keep = body.slice(0, Math.floor(body.length / 4) * 4);
      try {
        return { bytes: toBytes(keep), whole: false,
                 kept: Math.round((keep.length / body.length) * 100) };
      } catch {
        throw new Error('the stored text is damaged and will not decode at all');
      }
    }
  }

  async function grabPictures(trades, onProgress) {
    const wanted = [];
    trades.forEach(t => picturesOn(t).forEach((u, i) => {
      if (/^https?:/.test(u)) wanted.push({ trade: t, url: u, i });
      else if (u.startsWith('data:')) wanted.push({ trade: t, url: u, i, inline: true });
    }));

    const got = [], missed = [], damaged = [];
    for (let n = 0; n < wanted.length; n++) {
      const w = wanted[n];
      const stem = `${(w.trade.date || 'undated')}_${String(w.trade.symbol || 'coin')
        .replace(/[^\w]/g, '')}_${String(w.trade.id).slice(-6)}_${w.i + 1}`;
      onProgress && onProgress(n + 1, wanted.length);
      try {
        if (w.inline) {
          const d = decodeDataUrl(w.url);
          const kind = (w.url.match(/^data:image\/(\w+)/) || [, 'png'])[1];
          got.push({ name: `pictures/${stem}${d.whole ? '' : '_damaged'}.${kind}`, body: d.bytes });
          if (!d.whole) {
            damaged.push({ trade: `${w.trade.date} ${w.trade.symbol}`,
                           kept: d.kept, name: `${stem}_damaged.${kind}` });
          }
        } else {
          const r = await fetch(reachable(w.url), { cache: 'no-store' });
          if (!r.ok) throw new Error('server said ' + r.status);
          const body = await r.arrayBuffer();
          if (!body.byteLength) throw new Error('came back empty');
          got.push({ name: `pictures/${stem}.${extOf(w.url)}`, body });
        }
      } catch (e) {
        missed.push({ url: w.url, why: e.message, trade: `${w.trade.date} ${w.trade.symbol}` });
      }
    }
    return { got, missed, damaged };
  }

  /* ── Trades as a spreadsheet ───────────────────────── */
  const CSV_COLS = ['date', 'time', 'symbol', 'direction', 'session', 'setupType',
                    'entry', 'sl', 'tp', 'size', 'exitPrice', 'result', 'fees',
                    'htfBias', 'preGrade', 'postGrade', 'notes'];

  function csv(trades) {
    const cell = v => {
      const s = v === undefined || v === null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [CSV_COLS.join(','),
            ...trades.map(t => CSV_COLS.map(c => cell(t[c])).join(','))].join('\n');
  }

  /* ── The whole thing ───────────────────────────────── */
  async function build(onProgress) {
    const payload = Store.exportAll();
    const trades = payload.data.trades || [];
    const reviews = payload.data.reviews || [];

    const { got, missed, damaged } = await grabPictures(trades, onProgress);

    const files = [
      { name: 'backup.json', body: JSON.stringify(payload, null, 1) },
      { name: 'trades.csv', body: csv(trades) },
      /* Two reviews can carry the same week, and a zip will happily hold two
         entries with the same path — then extracting overwrites one and you
         lose it without a word. Jay has two for 8 June. Number the repeats. */
      ...(() => {
        const used = {};
        return reviews.map((r, i) => {
          let stem = r.weekOf || `review-${i + 1}`;
          used[stem] = (used[stem] || 0) + 1;
          if (used[stem] > 1) stem += `-${used[stem]}`;
          return { name: `reviews/${stem}.md`,
                   body: `# Week of ${r.rangeLabel || r.weekOf || ''}\n\n${r.html || ''}\n` };
        });
      })(),
      ...got,
    ];

    const shotTotal = got.length + missed.length;
    const lines = [
      'JP DASHBOARD 3 — BACKUP',
      `Saved ${new Date().toLocaleString('en-GB')}`,
      '',
      'WHAT IS IN HERE',
      `  backup.json    everything the dashboard stores. This is the file you`,
      `                 load back in under Settings if you ever need to.`,
      `  trades.csv     ${trades.length} trades, openable in any spreadsheet`,
      `  reviews/       ${reviews.length} weekly review${reviews.length === 1 ? '' : 's'} as plain text`,
      `  pictures/      ${got.length} of ${shotTotal} screenshots`,
      '',
      'WHAT IS DELIBERATELY NOT IN HERE',
      '  Your AI key, your PIN, and your upload address.',
      '  These are login details. A backup file goes to Downloads, gets emailed,',
      '  gets copied to a drive — it is the wrong place for a live key. Keep',
      '  those in a password manager and type them back in after a restore.',
      '  The old dashboard did include them and put a working token in Downloads.',
      '',
      `  Trades before ${payload._from} are also left out. That account was`,
      '  closed and those trades were never filled in properly.',
    ];

    if (missed.length) {
      lines.push('',
        `THE ${missed.length} PICTURES BELOW COULD NOT BE DOWNLOADED`,
        '  They are still on Cloudflare and the links below still work in a',
        '  browser — but a script is not allowed to read them, so they could',
        '  not be put in this file.',
        '',
        '  To fix it properly: turn on CORS for the bucket in Cloudflare, then',
        '  save a backup again and they will be included.',
        '',
        '  Until then these links ARE the only copy. If that bucket is deleted,',
        '  the pictures are gone.',
        '');
      missed.forEach(m => lines.push(`  ${m.trade}  ${m.url}`));
    }

    if (damaged.length) {
      lines.push('',
        `${damaged.length} PICTURE${damaged.length === 1 ? ' WAS' : 'S WERE'} ONLY PARTLY SAVED`,
        '  These were pasted straight into the trade rather than uploaded, and',
        '  the browser ran out of room part way through writing them. What was',
        '  written is here, with "damaged" in the name — a picture keeps its',
        '  rows in order, so the top of the chart usually still opens.',
        '  There is no complete copy of these anywhere. Nothing can recover the',
        '  missing part.',
        '');
      damaged.forEach(d => lines.push(`  ${d.trade}  ${d.name}  (about ${d.kept}% of it)`));
    }

    files.push({ name: 'WHAT-IS-IN-HERE.txt', body: lines.join('\n') });

    return {
      blob: zip(files),
      trades: trades.length,
      reviews: reviews.length,
      pictures: got.length,
      picturesMissed: missed.length,
      picturesDamaged: damaged.length,
    };
  }

  /** How much of a full backup is actually reachable, without building one. */
  function inventory() {
    const trades = Store.trades();
    let linked = 0, inline = 0, inlineKB = 0, hidden = 0;
    trades.forEach(t => {
      picturesOn(t).forEach(u => {
        if (u.startsWith('data:')) {
          inline++;
          inlineKB += Math.round(u.length * 2 / 1024);
        } else if (/^https?:/.test(u)) linked++;
      });
      /* Sitting in the old singular field: not shown on the trade, never
         uploaded. Counted off the field itself, not the split pieces —
         one field can hold several pictures. */
      if (typeof t.screenshotUrl === 'string' && t.screenshotUrl.startsWith('data:')) {
        hidden += splitDataUrls(t.screenshotUrl).length;
      }
    });
    return { trades: trades.length, reviews: Store.reviews().length,
             linked, inline, inlineMB: +(inlineKB / 1024).toFixed(1), hidden };
  }

  /* ── Clearing out leftover pasted-in pictures ────────
     When a picture is uploaded, the original sometimes stays behind in the
     old `screenshotUrl` field. Nothing reads that field, so the picture is
     invisible while still taking the room — Jay's 27 Apr trade was carrying
     1.7 MB that way, most of the storage this dashboard uses.

     Checked before anything is removed: the trade must still have an
     uploaded picture afterwards. A trade whose ONLY picture lives in that
     field is left alone and reported, because deleting it would be deleting
     the picture, not tidying up. */
  function leftovers() {
    return Store.trades().reduce((out, t) => {
      const v = t.screenshotUrl;
      if (typeof v !== 'string' || !v) return out;
      const links = (t.screenshotUrls || []).filter(u => typeof u === 'string' && /^https?:/.test(u));
      out.push({
        id: t.id,
        label: `${t.date} ${String(t.symbol || '').toUpperCase()}`,
        mb: +(v.length * 2 / 1048576).toFixed(1),
        pictures: v.startsWith('data:') ? splitDataUrls(v).length : 1,
        keepsPictures: links.length,
        safe: links.length > 0,
      });
      return out;
    }, []);
  }

  /** Removes only the leftovers that are safe to remove. Returns what it did. */
  function clearLeftovers() {
    const all = leftovers();
    const safe = all.filter(r => r.safe);
    let mb = 0;
    safe.forEach(r => {
      if (!Store.tradeById(r.id)) return;
      /* updateTrade MERGES its patch, so handing it the trade minus the field
         would leave the old value untouched. Blanking it is what actually
         frees the room. Nothing reads an empty one. */
      Store.updateTrade(r.id, { screenshotUrl: '' });
      mb += r.mb;
    });
    return { cleared: safe.length, mb: +mb.toFixed(1),
             skipped: all.filter(r => !r.safe) };
  }

  return { build, inventory, zip, csv, leftovers, clearLeftovers };
})();
