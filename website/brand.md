# The Frontier Brand

This page is the source of truth for how Frontier speaks, looks, and
carries itself. Everything public — the exchange, the docs, the README,
a tweet — should sound like it came from the same place.

## The idea

**The frontier is the live edge of the book** — the exact tick where the
last trade stopped and the next one starts. It's the protocol's core
object (the pointer that sweeps roll forward) *and* the thing we're
claiming: for years "real trading" meant surrendering custody to a
matching engine in someone's datacenter, because order books were too
expensive to put onchain. That's over. Settlement compression made
fine-grained books cheap; the frontier moved.

The name is the mechanism. Use that double meaning everywhere.

## The line

> **The order book is back onchain.**

Short forms, pick by surface:

- **Onchain is back.** (social, swag)
- **Trade at the edge.** (CTA)
- **Exchange-grade. Chain-native. No operator.** (subheads)

## Voice

Confident, kinetic, precise. We're announcing something that works, not
asking permission.

- **Declarative sentences.** "Fills are yours. Claim whenever." Not "fills
  can be claimed at the user's convenience."
- **Numbers beat adjectives.** Never "low gas" — say "a market order for
  a tenth of a cent on Base." Every number we publish is measured,
  tested, or linked to code. Swagger is earned by receipts.
- **The reader is smart.** No talking down, no "simply," no crypto
  word-salad. One idea per sentence.
- **Energy without emoji.** The copy carries the excitement. Exclamation
  points are a budget: about one per page.

| Do | Don't |
|---|---|
| "Prices step in tenths of a cent. Gas doesn't care." | "Ultra-low fees with granular pricing technology" |
| "Quote a whole curve in one transaction." | "Our innovative ladder solution enables…" |
| "1,335× cheaper than the naive book. Here's the table." | "Blazingly fast and efficient" |
| "No operator. Nothing to trust but the chain." | "Trustless decentralized paradigm" |

## The look

Markets live in the dark. The palette is a trading terminal at 2am:

| Token | Hex | Role |
|---|---|---|
| **Ink** | `#0b0e11` | Background. Everything floats on it. |
| **Signal green** | `#2ebd85` | The brand color. Bids, ups, liquidity, go. |
| **Alarm red** | `#f6465d` | Asks, downs. Never decoration. |
| **Frontier gold** | `#f0b90b` | *Yours.* Previews, your ladders, your actions. Scarce on purpose — when you see gold, it's about you. |
| **Bone** | `#e6e8ea` | Primary text. |

The wordmark is **FRONTIER** — monospace, letterspaced, all caps. It
reads like a ticker symbol because it is one in spirit. Tabular numerals
everywhere numbers appear; numbers are the product.

## Words we use

- **book** — a market. Books are cheap, parallel, abandonable.
- **ladder** — a range of limit orders placed as one position. The unit
  of making.
- **sweep** — what takers do: cross the book to a price.
- **the frontier** — the live edge; where the pointer parks.
- **claim** — collecting your fills. Never expires, never needs a keeper.
- **recycle** — flipping filled liquidity straight into a new quote,
  zero transfers.

Avoid: "swap" for book trades (that's AMM language — we say *trade* or
*sweep*), "pool", "LP" (except for the actual LP wrapper experiments),
"slippage tolerance" where "minimum received" is clearer.

## How it lands, by surface

- **Exchange UI**: terse labels, full sentences only in helper notes.
  Gold = the user's own intent, always.
- **Docs**: brand voice in openers and landings; precision prose in the
  technical body. A reader skimming H1s and intros should feel the
  energy; a reader deep in the mechanism should find zero fluff.
- **Code & tests**: comments explain *why*, in plain confident English.
  The repo is part of the brand — receipts live there.
