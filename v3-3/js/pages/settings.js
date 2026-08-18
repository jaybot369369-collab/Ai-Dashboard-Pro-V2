/* ═══════════════════════════════════════════════════════════
   SETTINGS — the housekeeping that used to be buried three
   levels deep in Pro Tools.

   Backup sits at the top because it is the most important
   control in the whole thing and it was the hardest to find.

   One export route only, and it can never carry your key, your
   PIN or your upload address. The old dump did, and it landed
   in Downloads with a live token inside it.
════════════════════════════════════════════════════════════ */
const SettingsPage = (() => {
  'use strict';
  const { esc, money, toast } = UI;

  let sizer = { balance: 5000, entry: '', stop: '' };

  /* ── Position size, using Jay's fixed $50 ─────────── */
  function sizeResult() {
    const e = parseFloat(sizer.entry), s = parseFloat(sizer.stop);
    if (!Number.isFinite(e) || !Number.isFinite(s) || e === s) return null;
    const gap = Math.abs(e - s);
    const units = Stats.RISK_PER_TRADE / gap;
    return {
      gap, units, notional: units * e,
      pctAway: (gap / e) * 100,
      direction: s < e ? 'Long' : 'Short',
    };
  }

  /* Shows whether the quiet background copy is getting through. */
  function savingCard() {
    const st = (typeof ServerSave !== 'undefined') ? ServerSave.status() : null;
    if (!st) return '';
    const ok = st.reachable === true;
    const unknown = st.reachable === null;
    return `
      <div class="card">
        <div class="card-title"><span class="card-emoji"></span>Second copy, saved for you</div>
        <div class="notice ${ok ? 'info' : unknown ? 'info' : ''}" style="margin-top:12px">
          <span class="notice-ico">${ok ? '' : unknown ? '⏳' : ''}</span><div>
          ${ok
            ? `<b>Working.</b> Everything you write is copied to ${esc(st.where)} a few seconds later,
               so clearing your browser cannot lose it.`
            : unknown
            ? `<b>Checking…</b>`
            : `<b>Not getting through right now.</b> Your work is safe in this browser and the copy
               will go out on its own as soon as the connection is back. Nothing is lost.
               ${st.owed ? 'There are changes waiting to be sent.' : ''}`}
          <br><span class="small">Last copy: ${st.lastSaved ? esc(UI.ago(st.lastSaved)) : 'none yet'}.
          Your key, your PIN and your uploader address are never included.</span>
        </div></div>
        <button class="btn ghost btn-sm" id="saveNow" style="margin-top:12px">Copy it now</button>
      </div>`;
  }

  function backupCard() {
    const days = Store.daysSinceExport();
    const last = Store.lastExport();
    const mb = Store.storageUsedMB();
    const nag = days === null ? 'You have never exported a backup from here.'
      : days === 0 ? 'You exported one today.'
      : `Last export was ${days} ${days === 1 ? 'day' : 'days'} ago.`;
    const bad = days === null || days > 7;

    return `
      <div class="card">
        <div class="card-title"><span class="card-emoji"></span>Backup</div>
        <div class="notice ${bad ? '' : 'info'}" style="margin-top:12px">
          <span class="notice-ico">${bad ? '' : ''}</span><div>
          <b>${esc(nag)}</b> Everything you write lives in this browser. Clearing your browser
          data, or the browser deciding it needs the space, takes it with it. An export file is
          the only thing that survives that.</div></div>

        ${(() => {
          /* The JSON export does not contain the screenshots — they were
             uploaded to Cloudflare and the trade only keeps a link. Saying
             "export everything" while 95 pictures stay behind is the kind of
             thing you only find out when you need them. */
          const inv = Backup.inventory();
          return `<div class="notice ${inv.linked ? '' : 'info'}" style="margin-top:16px">
            <span class="notice-ico">${inv.linked ? '' : ''}</span><div>
            <b>Your screenshots are not in the plain backup file.</b>
            ${inv.linked} of them live on Cloudflare and your trades only keep the link, so the
            JSON file is a set of pointers at somebody else's server. If that bucket ever goes
            away, so do the pictures. <b>Save the whole lot</b> below downloads them and puts
            them in the file with everything else.
          </div></div>`;
        })()}

        <div class="row-gap" style="margin-top:16px">
          <button class="btn" id="doZip">Save the whole lot</button>
          <button class="btn ghost" id="doExport">Just the data (JSON)</button>
          <button class="btn ghost" id="doCsv">Just the trades (spreadsheet)</button>
          <label class="btn ghost" style="cursor:pointer;margin:0">
            Load a backup back in<input type="file" id="doImport" accept=".json" hidden></label>
        </div>
        <p class="dim small" style="margin:8px 0 0" id="zipNote">
          The whole lot = your trades, the spreadsheet, every weekly review as readable text,
          and the screenshots themselves, in one zip.</p>

        ${(() => {
          const chk = Store.exportIsClean();
          return `<div class="notice ${chk.clean ? 'info' : ''}" style="margin-top:16px">
            <span class="notice-ico">${chk.clean ? '' : ''}</span><div>
            <b>Your key, your PIN and your upload address are never written into an export file.</b>
            The old dashboard had a second export that did include them, and it saved a live token
            straight into your Downloads folder. That route does not exist here.
            ${chk.clean
              ? `<br><span class="small">Just checked the file it would produce: nothing sensitive in it.</span>`
              : `<br><b class="bad">Check failed — ${esc(chk.leaked.join(', '))} would still go in the file. Do not export.</b>`}
          </div></div>`;
        })()}

        ${(() => {
          /* "Getting full" on its own is useless — it does not say what is
             filling it. Nearly all of it is usually one or two pictures
             pasted straight in instead of uploaded. */
          const inv = Backup.inventory();
          if (!inv.inline) return '';
          const left = Backup.leftovers();
          const safe = left.filter(r => r.safe);
          const stuck = left.filter(r => !r.safe);
          const freeMB = safe.reduce((a, r) => a + r.mb, 0).toFixed(1);

          return `<div class="notice" style="margin-top:16px">
            <span class="notice-ico"></span><div>
            <b>${inv.inline} picture${inv.inline === 1 ? ' was' : 's were'} pasted straight in
            rather than uploaded, and ${inv.inline === 1 ? 'it is' : 'they are'} taking
            ${inv.inlineMB} MB of the ${mb.toFixed(1)} MB this dashboard is using.</b>
            ${safe.length ? `<br><br>
              ${safe.length === 1 ? 'One trade is' : `${safe.length} trades are`} holding on to
              the original${safe.length === 1 && safe[0].pictures === 1 ? '' : 's'} of
              picture${safe.length === 1 && safe[0].pictures === 1 ? '' : 's'} that already
              uploaded properly. ${safe.length === 1 ? 'It does' : 'They do'} not show anywhere
              — the uploaded cop${safe.length === 1 && safe[0].pictures === 1 ? 'y is' : 'ies are'}
              what you see on the trade. Clearing
              ${safe.length === 1 ? 'it' : 'them'} frees <b>${freeMB} MB</b> and removes no
              picture from any trade.
              <div class="row-gap" style="margin-top:12px">
                <button class="btn ghost btn-sm" id="doTidy">Clear the leftovers</button>
              </div>
              <span class="small dim">Save a backup first — the button below does that.</span>`
            : ''}
            ${stuck.length ? `<br><br><b>${stuck.length} left alone.</b> The only picture on
              ${stuck.length === 1 ? 'that trade' : 'those trades'} is the pasted-in one, so
              removing it would be deleting the picture rather than tidying up:
              ${esc(stuck.map(r => r.label).join(', '))}.` : ''}
          </div></div>`;
        })()}

        <p class="dim small" style="margin:14px 0 0">
          Using ${mb.toFixed(1)} MB of browser storage${mb > 4 ? ' — getting full.' : '.'}
          ${last ? `<br>Last export: ${esc(new Date(last).toLocaleString('en-GB'))}` : ''}</p>
      </div>`;
  }

  /* ── Screenshot storage (Cloudflare R2 through your worker) ──────────
     This is the thing that broke saving on the old dashboard. A pasted-in
     picture gets stored as a giant block of text inside the trade itself.
     Enough of those and the browser runs out of room, and saving a trade
     starts failing without saying anything. Sending them to the worker
     instead means the trade only keeps a short web address. */
  function storageCard() {
    const on = R2.isEnabled();
    const url = R2.getWorkerUrl();
    const log = R2.getLog().slice(0, 5);
    const inline = countInlineImages();

    return `
      <div class="card">
        <div class="card-title"><span class="card-emoji"></span>Where screenshots go</div>
        <p class="dim small" style="margin:6px 0 14px;max-width:78ch">
          Pictures pasted straight in get saved as a huge block of text inside the trade. Enough of
          them and the browser runs out of room and saving quietly stops working — that is exactly
          what went wrong before. Sending them to your own storage instead means each trade only
          keeps a short web address.</p>

        <div class="form-grid">
          <label class="span2">Your uploader address
            <input type="text" id="r2Url" value="${esc(url)}" placeholder="https://images.yourname.workers.dev">
            <span class="hint">The Cloudflare worker you already set up. Never written into a backup file.</span></label>
        </div>
        <div class="row-gap" style="margin-top:12px">
          <button class="btn" id="r2Save">Save</button>
          <button class="btn ghost" id="r2Test">Test it works</button>
          <label class="row-gap small" style="margin-left:6px;cursor:pointer">
            <input type="checkbox" id="r2On" ${on ? 'checked' : ''} style="width:auto">
            Use it for new screenshots</label>
          <span id="r2Status" class="small"></span>
        </div>

        ${inline.count ? `
          <div class="notice" style="margin-top:16px"><span class="notice-ico"></span><div>
            <b>${inline.count} pasted-in ${inline.count === 1 ? 'picture is' : 'pictures are'}
            still stored as text</b> across ${inline.trades} ${inline.trades === 1 ? 'trade' : 'trades'},
            taking up about ${inline.mb.toFixed(1)} MB. Move them across and that space comes back.
            <div class="row-gap" style="margin-top:10px">
              <button class="btn btn-sm" id="r2Migrate" ${on ? '' : 'disabled'}>Move them across</button>
              ${!on ? '<span class="small dim">Set the address above and tick the box first.</span>' : ''}
            </div>
            <div id="r2Prog" class="small" style="margin-top:8px"></div>
          </div>`
        : `<p class="dim small" style="margin-top:14px">No pasted-in pictures clogging things up.</p>`}

        ${log.length ? `<div style="margin-top:16px">
          <div class="gm-l" style="margin-bottom:7px">Recent uploads</div>
          ${log.map(e => `<div class="dec-row"><span class="dec-date">${esc(UI.ago(new Date(e.time).toISOString()))}</span>
            <span class="small">${esc(e.op)}${e.size ? ` · ${(e.size / 1024).toFixed(0)} KB` : ''}</span></div>`).join('')}
        </div>` : ''}
      </div>`;
  }

  function countInlineImages() {
    let count = 0, bytes = 0;
    const ids = new Set();
    Store.trades().forEach(t => {
      (t.screenshotUrls || []).forEach(u => {
        if (typeof u === 'string' && u.startsWith('data:image')) {
          count++; bytes += u.length; ids.add(t.id);
        }
      });
    });
    return { count, trades: ids.size, mb: bytes / 1048576 };
  }

  function wireStorage() {
    const on = (id, ev, fn) => { const el = UI.$(id); if (el) el.addEventListener(ev, fn); };
    const status = m => { const el = UI.$('r2Status'); if (el) el.innerHTML = m; };

    on('r2Save', 'click', () => {
      R2.setWorkerUrl(UI.$('r2Url').value.trim());
      toast('Address saved'); render();
    });
    on('r2On', 'change', e => { R2.setEnabled(e.target.checked); render(); });

    on('r2Test', 'click', async () => {
      const u = UI.$('r2Url').value.trim();
      if (!u) { toast('Put the address in first', 'bad'); return; }
      R2.setWorkerUrl(u);
      status('<span class="dim">checking…</span>');
      try {
        await R2.testConnection();
        status('<span class="good">working</span>');
        toast('Your uploader is reachable');
      } catch (err) {
        status(`<span class="bad">✕ ${esc(err.message)}</span>`);
        toast('Could not reach it', 'bad');
      }
    });

    on('r2Migrate', 'click', async () => {
      if (!confirm('Move every pasted-in picture across to your own storage?\n\nThe trades keep the pictures — they just point at them instead of holding them.')) return;
      const prog = UI.$('r2Prog');
      try {
        const res = await migrateInline(p => {
          if (prog) prog.innerHTML = `Moved ${p.done} of ${p.total}${p.fail ? ` · ${p.fail} would not go` : ''}…`;
        });
        toast(res.fail ? `Moved ${res.done}, ${res.fail} would not go` : `Moved all ${res.done} across`);
        render();
      } catch (err) { toast(err.message, 'bad'); }
    });
  }

  /** Same job as the old dashboard's migrate, but going through Store. */
  async function migrateInline(onProgress) {
    if (!R2.isEnabled()) throw new Error('Set the address and tick the box first');
    const all = Store.trades();
    let total = 0, done = 0, fail = 0;
    all.forEach(t => (t.screenshotUrls || []).forEach(u => {
      if (typeof u === 'string' && u.startsWith('data:image')) total++;
    }));
    if (!total) return { total: 0, done: 0, fail: 0 };

    for (const t of all) {
      const urls = t.screenshotUrls || [];
      if (!urls.some(u => typeof u === 'string' && u.startsWith('data:image'))) continue;
      const next = [];
      for (const u of urls) {
        if (typeof u === 'string' && u.startsWith('data:image')) {
          try { next.push((await R2.uploadDataUrl(u)).url); done++; }
          catch (e) { next.push(u); fail++; }
          if (onProgress) onProgress({ done, total, fail });
        } else next.push(u);
      }
      Store.updateTrade(t.id, { screenshotUrls: next });
    }
    return { total, done, fail };
  }

  function render() {
    const cfg = Store.settings();
    const r = sizeResult();

    UI.$('view').innerHTML = `
      ${backupCard()}

      ${savingCard()}

      <div class="card">
        <div class="card-title"><span class="card-emoji"></span>What size should this trade be</div>
        <p class="dim small" style="margin:6px 0 14px">
          Your rule is the same $${Stats.RISK_PER_TRADE} at risk on every trade, no matter how
          sure you feel. Put the entry and the stop in and this works out the size that does that.</p>
        <div class="form-grid">
          <label>Entry price<input type="text" id="szEntry" value="${esc(sizer.entry)}" placeholder="1.0183"></label>
          <label>Stop price<input type="text" id="szStop" value="${esc(sizer.stop)}" placeholder="0.9950"></label>
        </div>
        ${r ? `
          <div class="kpi-grid" style="margin-top:16px">
            <div class="kpi"><div class="kpi-l">Buy this many</div>
              <div class="kpi-v">${r.units.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
              <div class="kpi-s">${esc(r.direction)}</div></div>
            <div class="kpi"><div class="kpi-l">Which costs</div>
              <div class="kpi-v">${money(r.notional)}</div>
              <div class="kpi-s">total position</div></div>
            <div class="kpi"><div class="kpi-l">Stop is this far</div>
              <div class="kpi-v">${r.pctAway.toFixed(2)}%</div>
              <div class="kpi-s">from your entry</div></div>
            <div class="kpi"><div class="kpi-l">You lose if stopped</div>
              <div class="kpi-v bad">−$${Stats.RISK_PER_TRADE}</div>
              <div class="kpi-s">always the same</div></div>
          </div>
          ${r.pctAway > 8 ? `<div class="notice" style="margin-top:14px"><span class="notice-ico"></span><div>
            That stop is ${r.pctAway.toFixed(1)}% away, which is a long way. The size comes out small
            to keep the loss at $${Stats.RISK_PER_TRADE}. Worth asking whether the stop is in the
            right place.</div></div>` : ''}`
        : `<p class="dim small" style="margin-top:14px">Put an entry and a stop in above.</p>`}
      </div>

      ${storageCard()}

      <div class="card">
        <div class="card-title"><span class="card-emoji"></span>How it looks</div>
        <p class="dim small" style="margin:6px 0 14px">
          Day or night. Your choice is remembered and beats whatever your Mac is set to.</p>
        <div class="theme-tog" id="setTheme">
          <button data-theme-set="day">Day</button>
          <button data-theme-set="night">Night</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><span class="card-emoji"></span>Lock</div>
        <p class="dim small" style="margin:6px 0 14px">
          A three digit code to open the dashboard. It stops someone glancing at your numbers.
          It is not real security — anyone who can open this computer can get round it.</p>
        <div class="form-grid">
          <label>Code<input type="password" id="pin" value="${esc(cfg.pin || '')}" maxlength="3"
                 inputmode="numeric" placeholder="123"></label>
        </div>
        <div class="row-gap" style="margin-top:12px">
          <button class="btn" id="savePin">Save</button>
          ${cfg.pin ? `<button class="btn ghost" id="clearPin">Turn it off</button>` : ''}
        </div>
      </div>

      `;

    wire();
  }

  function wire() {
    const on = (id, ev, fn) => { const el = UI.$(id); if (el) el.addEventListener(ev, fn); };

    on('doTidy', 'click', () => {
      const rows = Backup.leftovers().filter(r => r.safe);
      if (!rows.length) { toast('Nothing to clear', 'warn'); return; }
      const list = rows.map(r => `  ${r.label} — ${r.mb} MB, keeps ${r.keepsPictures} uploaded picture${r.keepsPictures === 1 ? '' : 's'}`).join('\n');
      if (!confirm(
        `Clear the leftover originals from ${rows.length} trade${rows.length === 1 ? '' : 's'}?\n\n`
        + `${list}\n\n`
        + `Nothing else on the trade changes, and every trade keeps the pictures you see on it. `
        + `This cannot be undone from here — take a backup first if you have not.`)) return;
      const r = Backup.clearLeftovers();
      toast(`Cleared ${r.mb} MB`);
      render();
    });

    on('doZip', 'click', async () => {
      const btn = UI.$('doZip'), note = UI.$('zipNote');
      btn.disabled = true;
      const say = t => { if (note) note.textContent = t; };
      say('Collecting…');
      try {
        const r = await Backup.build((n, of) => say(`Downloading picture ${n} of ${of}…`));
        const a = document.createElement('a');
        a.href = URL.createObjectURL(r.blob);
        a.download = `jp_dashboard_backup_${new Date().toISOString().slice(0, 10)}.zip`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        Store.markExported();

        /* Say what actually made it. A backup that quietly lost the
           pictures is worse than one that admits it did. */
        if (r.picturesMissed) {
          toast(`Saved — but ${r.picturesMissed} pictures could not be downloaded`, 'warn');
          say(`Saved to Downloads: ${r.trades} trades, ${r.reviews} reviews, `
            + `${r.pictures} pictures. ${r.picturesMissed} could NOT be downloaded — `
            + `read WHAT-IS-IN-HERE.txt inside the zip, it lists them and how to fix it.`);
        } else {
          toast('Backup saved to Downloads');
          say(`Saved to Downloads: ${r.trades} trades, ${r.reviews} reviews, `
            + `${r.pictures} pictures. Nothing was left behind.`);
        }
      } catch (e) {
        toast('Backup failed: ' + e.message, 'bad');
        say('Backup failed: ' + e.message + ' — nothing was saved.');
      }
      btn.disabled = false;
    });

    on('doExport', 'click', () => {
      const blob = new Blob([JSON.stringify(Store.exportAll(), null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `jp_dashboard_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 200);
      Store.markExported(); toast('Backup saved to Downloads'); render();
    });

    on('doCsv', 'click', () => {
      const cols = ['date', 'time', 'symbol', 'direction', 'session', 'setupType', 'preGrade',
                    'postGrade', 'entry', 'sl', 'tp', 'exitPrice', 'size', 'result', 'fees', 'notes'];
      const q = v => `"${String(v ?? '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;
      const csv = [cols.join(','), ...Store.trades().map(t => cols.map(c => q(t[c])).join(','))].join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = `trades_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      toast('Spreadsheet saved to Downloads');
    });

    on('doImport', 'change', e => {
      const f = e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const res = Store.importAll(JSON.parse(rd.result));
          toast(res.skipped
            ? `Loaded ${res.tradesKept} trades. ${res.skipped} from before 27 April were left out.`
            : `Loaded ${res.tradesKept} trades back in`);
          setTimeout(() => location.reload(), res.skipped ? 1800 : 700);
        } catch (err) { toast('That file did not read properly', 'bad'); }
      };
      rd.readAsText(f);
    });

    ['szEntry', 'szStop'].forEach(id => on(id, 'input', e => {
      sizer[id === 'szEntry' ? 'entry' : 'stop'] = e.target.value;
      render();
      const el = UI.$(id); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }));

    wireStorage();

    on('saveNow', 'click', async () => {
      toast('Copying…');
      const ok = await ServerSave.saveNow();
      toast(ok ? 'Copy saved' : 'Could not reach it — it will go on its own later', ok ? '' : 'bad');
      render();
    });

    on('savePin', 'click', () => {
      const p = UI.$('pin').value.trim();
      if (p && !/^\d{3}$/.test(p)) { toast('Three numbers, please', 'bad'); return; }
      Store.saveSettings({ pin: p }); toast(p ? 'Lock on' : 'Lock off'); render();
    });
    on('clearPin', 'click', () => { Store.saveSettings({ pin: '' }); toast('Lock off'); render(); });

    UI.$$('#setTheme [data-theme-set]').forEach(b => {
      b.classList.toggle('on', document.documentElement.getAttribute('data-theme') === b.dataset.themeSet);
      b.addEventListener('click', () => { App.setTheme(b.dataset.themeSet); render(); });
    });
  }

  return { render, title: 'Settings', sub: () => 'Backup, sizing, and how it looks' };
})();
