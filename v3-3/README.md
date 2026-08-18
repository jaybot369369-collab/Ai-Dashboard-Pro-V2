# JP Dashboard 3.3

A private trading journal. Eleven pages, no framework, no build step.
This is the **Pearl** styling, designed and handed back as version 3.3.

## Run it

```bash
python3 -m http.server 8791
```

Then <http://localhost:8791>.

## The trades in here are invented

`data/seed.json` holds 63 placeholder trades so the pages have something to
draw. **No real trading record is in this repository.**

To load your own: open the site, go to **Settings → Load a backup back in**, and
pick your export file. Your data lives in the browser under `jp3_*` keys, not in
any file here.

Note that `store.js` reads `seed.json` exactly once per browser — the first time
the app runs — then sets `jp3_seeded_v1` and never reads it again. So on a
browser that has already used the dashboard, nothing here overwrites anything.

## What's in 3.3

- The Pearl skin proper, replacing the earlier layered extract
- The gate on Morning Desk is a traffic light again, on its own tokens
  (`--gate-go` / `--gate-hold` / `--gate-stop`) so the monochrome P&L palette
  doesn't drain it
- Mobile navigation — the sidebar becomes a drawer below 860px
- Emoji removed from display strings; copy no longer names colours
- Day/night and four text sizes, in the header

## Layout

```
index.html
css/desk.css     base
css/ported.css   older components carried over
css/pearl.css    the skin, loaded last
js/pearl-boot.js theme + text size, loaded first
js/pages/*.js    one file per page
data/            example trades, market statistics, reference documents
```

`HANDBACK.md` records what changed in 3.3 and why.
