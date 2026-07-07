/* ═══════════════════════════════════════════════════════════
   CONTEXT DEFAULTS — shipped starting text for the 🧠 Context tab
   (Trader Profile · Theme Map · Catalyst Rules)

   These are DRAFTS written from the repo's own records (risk charter,
   trade reviews, catalyst calendar). The user edits the live copies in
   the Context tab (localStorage jb_ctx_*); this file is only the
   "Restore default" source. Do not put private keys or secrets here —
   this file ships to a public repo.
═══════════════════════════════════════════════════════════ */
window.CONTEXT_DEFAULTS = {

profile: `# Trader Profile — Jay
You own this document. Every AI layer that coaches you or writes your morning brief reads it.
It only works if it describes the trader you ARE, not the one you'd like to look like.
Lines marked ✎ are guesses — correct them.

## 1 · Identity & style
- Discretionary ICT/SMC crypto trader. Entries on 15m–1h inside killzones; bias from 4h / Daily.
- Separately runs an autonomous paper bot farm (OBxADX). Bot results are NOT part of my manual record — never mix them.
- Manual account restarted 2026-04-27 (day one). Imported Notion/Binance history before that is reference only.
- Long-biased by history; actively training the short side under a gated plan (see section 7).

## 2 · Instruments & venues
- Universe: BTC, ETH, XRP, SOL, SUI, HBAR, XLM. USDT.D watched as the risk-on/off gauge.
- Spot and perps. Pairs may be USDT- or USDC-quoted — the exact quote matters; never analyse the twin pair as if it were the traded one.
- ✎ Venues I actually execute on: (fill in — e.g. Binance spot, Bybit perps)

## 3 · Sessions I trade
- ✎ Primary: London open and NY AM killzones. (Correct to the sessions you genuinely take entries in.)
- Hard rule: no new entries within 60 minutes before red-impact USD news (CPI, NFP, FOMC, PPI).

## 4 · Risk — the contract lives in RISK_CHARTER.md (that file wins over any summary)
- 1R = $50 fixed. Size = 50 / |entry − stop|. Conviction is expressed through selection and grade, never size.
- One Rule: no live stop in the market = no trade.
- Breakers: day −2R = done for the day · week −4R = flat until written review · 3 straight losses = half size · any loss > 1.5R = day off + post-mortem.

## 5 · Playbook philosophy
- Tradeable = pre-graded A or B AND tagged with an existing playbook setup. Everything else is paper or a skip.
- New setup ideas earn playbook entry via 10+ paper trades, not live money.
- Setup verdicts (kill / keep / scale) need ≥ 20 closed trades. Below that a setup is "collecting data".

## 6 · Known tendencies (from the 2026-07-06 desk review, 60 closed trades)
- Grading IS the edge: A/B pre-graded trades +$1,649 · C/D/ungraded −$2,610.
- Stops decide survival: trades with a live stop +$268 · without −$1,229. Three unstopped losses were 40% of all loss dollars.
- Untagged trades bleed: playbook-tagged +$847 · untagged −$1,808.
- Tilt signature: revenge-sizing and "clawback" trades after a loss. Own words (May 22): "clawback = dead out."
- News risk is real: the −$740 CPI lesson is why the pre-news rule exists.

## 7 · Goals & current focus
- Consistency over P&L: 100% stop coverage, 0 charter overrides, A/B-only entries.
- Short-side gate (ICT_Methodology/SHORT_SIDE_TRAINING.md): 20 graded paper shorts + 10 quarter-size lives before full-size shorts.
- Build ≥ 20-trade samples per playbook setup before judging any of them.

## 8 · How AI should talk to me
- Direct and evidence-cited: trades by date + symbol, rules by name, numbers from data — no vibes.
- Tag confidence on non-obvious claims: [Certain] / [Likely] / [Guessing].
- Lead with the uncomfortable thing. No flattery, no manufactured criticism.
- Judge process first: a stopped-out A-trade is a GOOD trade; an off-plan winner is a BAD one.`,

themes: `# Theme Map — the only storylines AI may tag
RULE: when any report, coach or brief tags a theme, the tag MUST come from this list, spelled exactly.
Something genuinely new → tag it "Unclassified" + one line on why it might deserve a slot here.
Never invent theme names. A theme is "in play" only on a dated, sourced event or a measurable flow —
an influencer thread is not a theme.

| Theme | What it means (one line) | Coins |
|---|---|---|
| ETF & Flows | Spot/futures ETF approvals, launches, daily creations/redemptions, AUM shifts | BTC, ETH, XRP, SOL |
| Regulatory-US | Bills (CLARITY etc.), SEC/CFTC actions, court rulings, Senate hearings | XRP first, all majors |
| Macro-Risk | Fed, CPI/NFP/FOMC, DXY, yields — the "everything moves together" driver | ALL (BTC leads) |
| L1 Rotation | Money rotating between layer-1 ecosystems; relative-strength shifts | SOL, SUI, HBAR, ETH |
| CME & Institutional | CME listings, custody launches, corporate treasuries, bank rails | SUI, BTC, ETH |
| Payments & RWA | Cross-border payments, stablecoin rails, real-world-asset tokenization | XRP, XLM, HBAR |
| Protocol & Upgrades | Chain upgrades, XRPL amendments, forks, major mainnet events | per-chain |
| Token Unlocks | Scheduled supply unlocks and vesting cliffs | SUI (monthly), others as scheduled |
| Whale & Smart Money | Large wallet moves, exchange in/outflows, OTC prints | per-coin |
| Alt-Season Gauge | BTC dominance / USDT.D direction as the rotation regime signal | market-wide |

Maintenance: retire a theme that hasn't fired in 90 days; promote an "Unclassified" that keeps
recurring. Review this map in the weekly review, not mid-day.`,

catalyst: `# Catalyst Rules — how to weigh events before they touch a trade

1 · Confidence tiers (mirror catalysts.json)
- confirmed — a primary source states the date. Tradeable context.
- likely — credible but unconfirmed. Plan around it, size-aware.
- rumored — a WATCH reason, never an ENTRY reason. No exceptions.

2 · Verification standard
- Any date, price target or number must be verified against a live primary source before it is
  presented — two independent sources for anything I might trade around. AI training-data memory
  does not count as a source.

3 · Proximity
- Events inside 7 days outrank far ones. Events with month/quarter precision never get treated
  as this-week triggers — no fake-precise dates.

4 · Ranking when several compete
- confirmed on MY coins  >  red-impact USD macro  >  likely on MY coins  >  everything else.
- The loudest headline is not the most tradeable one. Rank by inflection potential for the
  specific coin, not by coverage volume.

5 · No-entry window (charter rule)
- No new entries within 60 minutes before red-impact USD events: CPI, NFP, FOMC, PPI.

6 · Ghost check
- If price has already run through the levels tied to a catalyst, the setup is a ghost —
  say so plainly instead of presenting it.

7 · Post-event honesty
- Within a day of the event, record the outcome: played out / faded / no impact / postponed
  (feeds the catalyst outcome log on the Catalysts tab).`,

};
