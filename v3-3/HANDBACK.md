# Handing it back

`css/` and `index.html`, as asked. Two things go beyond that brief and they are
both marked below.

## What was actually wrong

The package's `pearl.css` was an extract of Pearl sitting on top of an **older
`desk.css`** — v14 here, v23 in the design build. That is the hybrid. The extract
carried Pearl's tokens, so colour looked roughly right, but every component rule
written during the design work was missing underneath it, and the old base kept
supplying spacing, weights, borders and the odd background. The contrast bug you
found — button background changed, `desk.css` still supplying the ink — is one
instance of that, not a one-off.

So this is not a patch. **All three stylesheets are replaced** with the design
build's versions. Filenames are unchanged (`pearl.css`, not `skin-pearl.css`) so
nothing else needs touching.

## The deviation from "change css/ only"

**The page JavaScript is replaced too.** I would rather have avoided it, but part
of what you approved lives in JS strings and cannot be reached from a stylesheet:

- **212 emoji** hardcoded into display strings in the page builders. CSS can hide
  a span; it cannot remove an emoji from the middle of a label. Functional glyphs
  (✓ ✗ ✕ ★ ☆ ＋) were kept.
- **Copy that named colours.** Guides, captions and worked examples said "green"
  and "red". With gains grey and losses near-black that copy described something
  no longer on screen; it now reads light/dark, oversold/overbought, up/down.
- **Playbook modal internals** — candles, zones, arrows, badges and legend
  swatches were drawing their own colours inline.

No logic, class names, markup or data handling changed — the diffs are strings and
inline style values. `store.js`, `stats.js`, `ui.js`, `compat.js` and `backup.js`
are byte-identical to yours and were not touched.

## The two gaps from the brief, closed

Both are at the bottom of `pearl.css`, under a marked heading.

**1. The gate is a traffic light again.** It was rendering in greys because it was
wired to `--good` / `--warn` / `--bad`, and Pearl turns those monochrome. You were
right that this stops working. The monochrome rule is there for money: P&L is read
down a column, by sign and weight, and hue adds nothing. The gate is not money —
it is read once, from across the room, and answers one question. It now has three
tokens of its own, `--gate-go` / `--gate-hold` / `--gate-stop`, in all four theme
places. Same exception already made for RSI. Nothing else references them.

If you would rather it stayed monochrome, delete section A — the rules it
overrides are still in place above it.

**2. Mobile navigation exists.** Below 860px `desk.css` hid the sidebar and put
nothing in its place, so past the first page the app was unreachable on a phone.
The sidebar now slides in as a drawer, opened by a 48px button, with a scrim
behind it. Closes on: the button, the scrim, Escape, tapping a nav item, and
resizing back over 860px.

This one needed markup — a button, a scrim div, and a small script at the bottom
of `index.html`. There is no way to do it in CSS alone without a checkbox hack,
which would have been worse. Nav items get a 46px minimum height in the drawer.

## The `?v=` bumps

Done, in `index.html`. Every file I touched went up one; `calendar.js` is at 21,
`desk.css` 15, `ported.css` 9, `pearl.css` 4, `pearl-boot.js` 2.

## The toggles moved into the page

`pearl-boot.js` was injecting the day/night and text-size buttons into
`[data-pearl-controls]` at `DOMContentLoaded`. `app.js` binds those buttons at
start-up and it is the only thing that knows to redraw the canvas charts when the
theme changes — so depending on which ran first, switching to night on Performance
or Radar could leave the charts drawn in the old colours.

The markup is now static in `index.html`. `pearl-boot.js` checks whether the
controls are already built and leaves them alone, so it needs no change. The
`data-pearl-controls` attribute is still there and still works on a page that has
no `app.js`.

## About the data in this folder — read before you open it

`data/seed.json` here is **not your record**. Its own `_note` says so: *"EXAMPLE
DATA ONLY — generated for design work. No real trading record."* 63 invented
trades dated 27 April to 11 August 2026, and three invented setups (OTE,
FVG / IFVG, Liquidity Sweep + Reversal). It exists so the pages have something to
draw while being styled.

**Your 81 trades and your real playbook are in your browser, not in any file
here.** `store.js` reads `seed.json` exactly once ever — on a browser that has
never run the app — then sets `jp3_seeded_v1` and never looks at it again. Your
browser set that flag months ago, so dropping these files over your live site
cannot overwrite anything. Same origin, same `jp3_*` keys, your data loads as
normal.

The risk runs the other way: open this folder in a **fresh** browser or a private
window and it will seed the 63 fake trades, and an export from that window would
be a fake backup. Export from your real browser before you touch anything.

## Worth knowing

- **Trades carry a date and a `createdAt` timestamp but no `time` field**, which is
  what the day-and-hour grid on Tendencies reads. That is data, not styling.
- **Level 2 needs its connection** to show anything real.
- `data/seed.json` and the seasonality file fetch with a `?t=` cache-buster, which
  a sandboxed preview blocks. On `python3 -m http.server` they load normally.
- The four text sizes multiply `--fs` into `calc()`. If you add anything new, size
  it in `rem` or `calc(px * var(--fs))` or it will not move with the switch.

## Check it in this order

`python3 -m http.server 8791`, then: Morning Desk in both themes (the gate),
Performance and Radar (canvas charts read from CSS — switch theme while looking at
them), Playbook with a setup under 20 trades (grey "collecting" badge, no verdict),
Settings (most panels), AI Coach with nothing generated (empty state), and any page
at phone width for the drawer.
