# Brand

<div class="fr-wordmark"><FrMark variant="lockup" :size="64" /></div>
<p class="fr-line"><b>The order book is back onchain.</b> — the line. Short forms: <b>Onchain is back.</b> · <b>Trade at the edge.</b> · <b>Every tick, settled.</b></p>

The frontier is the live edge of the book — the exact tick where the last
trade stopped and the next one starts. It's the protocol's core object
*and* the claim we're making: order books were exiled from chains because
fine prices cost gas. Settlement compression ended that. The name is the
mechanism. Use the double meaning everywhere.

## Wordmark & mark

A geometric/mono hybrid. The glyph is a **stepped-F**: a ladder of price
levels that resolves into an F. The top rung is **gold** — the touch, the
frontier, *your* edge — and the rungs step down through signal green into
deep green as the book thins out. The mark *is* the product: a book, a
ladder, the frontier, all in one shape.

<div class="fr-variants">
  <div class="fr-variant-cell"><FrMark variant="mark" :size="64" /><span class="cap">Mark · color</span></div>
  <div class="fr-variant-cell"><FrMark variant="mark" tone="mono" :size="64" style="color:var(--fr-bone)" /><span class="cap">Mark · mono</span></div>
  <div class="fr-variant-cell"><FrMark variant="lockup" :size="40" /><span class="cap">Lockup · color</span></div>
  <div class="fr-variant-cell"><FrMark variant="lockup" tone="mono" :blink="false" :size="36" style="color:var(--fr-bone)" /><span class="cap">Lockup · mono</span></div>
</div>

Static assets live in `public/brand/` (`mark.svg`, `wordmark.svg`) for
favicons, social cards, and READMEs. Clear space = one rung-height on all
sides. Never recolor the gold rung to anything but gold — it's load-bearing.

## Motifs

Three recurring shapes carry the brand beyond the logo:

- **The ladder** — stacked rungs of decreasing width. Loading states,
  dividers, the F itself. Depth made visible.
- **The frontier line** — a single gold hairline marking the touch.
  Section breaks, the active row, the "you are here" of any book.
- **The tick cursor** — a blinking green block (`▌`). The terminal is
  live. Ends the wordmark, marks input, signals "real, now."

## Color

Markets live in the dark. The palette is a trading terminal at 2am.
**Gold is sacred**: it marks *the user's own intent* — previews, your
ladders, your actions — and nothing else. When you see gold, it's about
you.

<div class="fr-swatches">
  <div class="fr-swatch"><div class="chip" style="background:#0b0e11"></div><div class="meta"><b>Ink</b><code>#0B0E11</code><span>Background. Everything floats on it. Layers: #0F1318, #11161C.</span></div></div>
  <div class="fr-swatch"><div class="chip" style="background:#2ebd85"></div><div class="meta"><b>Signal green</b><code>#2EBD85</code><span>The brand color. Bids, ups, liquidity, go. Deep variant #1EA06D.</span></div></div>
  <div class="fr-swatch"><div class="chip" style="background:#f6465d"></div><div class="meta"><b>Alarm red</b><code>#F6465D</code><span>Asks, downs. Information only — never decoration.</span></div></div>
  <div class="fr-swatch"><div class="chip" style="background:#f0b90b"></div><div class="meta"><b>Frontier gold</b><code>#F0B90B</code><span>Yours. Previews, your ladders, your actions. Scarce on purpose.</span></div></div>
  <div class="fr-swatch"><div class="chip" style="background:#3bd6e0"></div><div class="meta"><b>Cyan signal</b><code>#3BD6E0</code><span>Secondary accent — the venue/system voice: code links, oracle ticks, infra. Cool, scarce. Deep #1F9AA3.</span></div></div>
  <div class="fr-swatch"><div class="chip" style="background:#e6e8ea"></div><div class="meta"><b>Bone</b><code>#E6E8EA</code><span>Primary text. Dim variant #8A93A0 for secondary.</span></div></div>
</div>

**Three accents, three jobs, never crossed:** **gold** is *yours* (intent,
previews, your ladders), **green/red** are *the market* (bids/asks, up/down),
**cyan** is *the venue* (system, code, oracles). If a color is doing two
jobs, it's wrong.

### Depth-heatmap ramps

Book depth fades from the touch outward — bright near the frontier, dim deep
in the book. Bids ride the green ramp, asks the red ramp. Tokens
`--fr-depth-bid-0…3` / `--fr-depth-ask-0…3`; use the `0` and `1` endpoints
for a single bar gradient.

<div class="fr-ramp">
  <span style="background:var(--fr-depth-bid-0)"></span>
  <span style="background:var(--fr-depth-bid-1)"></span>
  <span style="background:var(--fr-depth-bid-2)"></span>
  <span style="background:var(--fr-depth-bid-3)"></span>
</div>
<div class="fr-ramp">
  <span style="background:var(--fr-depth-ask-0)"></span>
  <span style="background:var(--fr-depth-ask-1)"></span>
  <span style="background:var(--fr-depth-ask-2)"></span>
  <span style="background:var(--fr-depth-ask-3)"></span>
</div>

### Fill-flash

The highlight that ripples a level the instant it trades — gold-white,
brief, additive. The visual signature of a fill. Tokens `--fr-fill-flash`
(ambient) and `--fr-fill-flash-strong` (the peak). Used by the hero motif
and anywhere a level settles. Never static; a flash that lingers is a bug.

## Typography

Two voices: a monospace **display** voice (the terminal talking) and a
quiet system **body** voice. Numbers always render in tabular figures —
numbers are the product.

<div class="fr-type">
  <div class="label">Display — mono, caps, letterspaced · ui-monospace / JetBrains Mono / SF Mono</div>
  <div class="spec-display">FRONTIER · GAS · THE MECHANISM</div>
</div>

<div class="fr-type">
  <div class="label">Body — system sans, sentence case, max ~65ch</div>
  <div class="spec-body">Quote a whole price range in one transaction — flat, or weighted toward the touch. When the market trades through your prices, the proceeds are simply yours.</div>
</div>

<div class="fr-type">
  <div class="label">Numerals — mono, tabular, signed by color</div>
  <div class="spec-num"><span class="up">1,653.504 ▲ +0.42%</span> &nbsp; <span class="down">1,651.951 ▼ −0.18%</span> &nbsp; <span class="gold">your ladder 1,652.10 → 1,652.60</span></div>
</div>

Rules: display voice for H1/H2, panel titles, table headers, the
wordmark. Body voice for everything explanatory. Never letterspace body
text. Never proportional figures in a table.

## Motion

Nothing disappears without a trace. State changes **animate at 350–700ms
ease**: removed book rows fade out as ghosts, size changes flash their
direction, layout shifts slide rather than snap. Motion is information —
it shows *what changed* — never ornament.

## Voice

Confident, kinetic, precise. We're announcing something that works, not
asking permission.

- **Declarative sentences.** "Fills are yours. Claim whenever."
- **Numbers beat adjectives.** Never "low gas" — say "a market order for
  a tenth of a cent on Base." Swagger is earned by receipts: every number
  is measured, tested, or linked to code.
- **The reader is smart.** No "simply," no crypto word-salad.
- **Energy without emoji.** Exclamation points are a budget: ~one per page.

<div class="fr-dont">
  <div class="yes">"Prices step in tenths of a cent. Gas doesn't care."</div>
  <div class="no">"Ultra-low fees with granular pricing technology"</div>
  <div class="yes">"1,335× cheaper than the naive book. Here's the table."</div>
  <div class="no">"Blazingly fast and efficient"</div>
  <div class="yes">"No operator. Nothing to trust but the chain."</div>
  <div class="no">"Trustless decentralized paradigm"</div>
</div>

## Vocabulary

**book** (a market — cheap, parallel, abandonable) · **ladder** (a range
of limit orders placed as one position) · **sweep** (what takers do) ·
**the frontier** (the live edge) · **claim** (collect fills — never
expires) · **recycle** (filled liquidity straight into a new quote).

Avoid: "swap" for book trades (AMM language — say *trade* or *sweep*),
"pool," "LP" outside the actual LP-wrapper experiments, "slippage
tolerance" where "minimum received" is clearer.

## Icon set

Geometric mono line icons, 2px stroke, `currentColor` — they take the
accent of whatever they sit in. Eight to start, all in `public/icons/`
and as the `<FrIcon>` component.

<div class="fr-icongrid">
  <div class="cell"><FrIcon name="ladder" :size="34" /><span class="lbl">ladder</span></div>
  <div class="cell"><FrIcon name="settlement" :size="34" /><span class="lbl">settlement</span></div>
  <div class="cell"><FrIcon name="gas" :size="34" /><span class="lbl">gas</span></div>
  <div class="cell"><FrIcon name="permission" :size="34" /><span class="lbl">permission</span></div>
  <div class="cell"><FrIcon name="ticks" :size="34" /><span class="lbl">ticks</span></div>
  <div class="cell"><FrIcon name="hooks" :size="34" /><span class="lbl">hooks</span></div>
  <div class="cell"><FrIcon name="claim" :size="34" /><span class="lbl">claim</span></div>
  <div class="cell"><FrIcon name="book" :size="34" /><span class="lbl">book</span></div>
</div>

## Component variants

Reusable brand primitives. Buttons inherit the accent rule: **green
primary** for going to market, **gold intent** only for the user's own
actions, **ghost** for everything secondary.

<div class="fr-variants">
  <div class="fr-variant-cell"><a class="fr-btn primary">Trade at the edge</a><span class="cap">Button · primary</span></div>
  <div class="fr-variant-cell"><a class="fr-btn intent">Place ladder</a><span class="cap">Button · intent (gold)</span></div>
  <div class="fr-variant-cell"><a class="fr-btn ghost">How it works</a><span class="cap">Button · ghost</span></div>
</div>

<div class="fr-variants">
  <div class="fr-variant-cell"><span class="fr-badge live">Live</span><span class="cap">Badge · live (pulse)</span></div>
  <div class="fr-variant-cell"><span class="fr-badge gold">Your ladder</span><span class="cap">Badge · gold</span></div>
  <div class="fr-variant-cell"><span class="fr-badge cyan">Oracle</span><span class="cap">Badge · cyan (venue)</span></div>
</div>

## Where it lands

- **Exchange UI** — terse labels; helper notes in full sentences; gold
  only for the user's own intent.
- **Docs** — display voice in headings and landings, precision prose in
  the body. Skimming the H1s should feel the energy; deep reading should
  find zero fluff.
- **The repo** — comments explain *why* in plain confident English. The
  receipts live there; the repo is part of the brand.
