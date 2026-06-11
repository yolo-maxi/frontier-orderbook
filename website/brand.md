# Brand

<div class="fr-wordmark">FRONTIER<span class="tick">_</span></div>
<p class="fr-line"><b>The order book is back onchain.</b> — the line. Short forms: <b>Onchain is back.</b> · <b>Trade at the edge.</b></p>

The frontier is the live edge of the book — the exact tick where the last
trade stopped and the next one starts. It's the protocol's core object
*and* the claim we're making: order books were exiled from chains because
fine prices cost gas. Settlement compression ended that. The name is the
mechanism. Use the double meaning everywhere.

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
  <div class="fr-swatch"><div class="chip" style="background:#e6e8ea"></div><div class="meta"><b>Bone</b><code>#E6E8EA</code><span>Primary text. Dim variant #8A93A0 for secondary.</span></div></div>
</div>

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

## Where it lands

- **Exchange UI** — terse labels; helper notes in full sentences; gold
  only for the user's own intent.
- **Docs** — display voice in headings and landings, precision prose in
  the body. Skimming the H1s should feel the energy; deep reading should
  find zero fluff.
- **The repo** — comments explain *why* in plain confident English. The
  receipts live there; the repo is part of the brand.
