---
name: frontier-orderbook
description: Create markets, make/take liquidity, manage positions, and delegate bot control on the Frontier on-chain order-book + prediction-market venue (GeometricFrontierBook via FrontierGeoBookFactory, quoted with FrontierLens, taken via FrontierRouter, delegated with PermissionRegistry). Use when the user wants to deploy or find a Frontier market, place asks/bids, swap/take liquidity, claim or cancel positions, or grant a maker bot scoped permissions.
---

# Frontier order-book skill

Frontier is a thin-tick on-chain CLOB built on range orders. This skill is the
operating guide for agents acting as a **market creator**, **maker**, **taker**,
or **delegated bot manager**.

Use the typed [`@frontier/sdk`](../sdk) or the [`@frontier/mcp`](../mcp) server to
execute; this skill tells you *which path to take and how to stay safe*.

## Mental model (read first)

- `token0` = base asset (sold by asks, bought by bids). `token1` = quote asset.
- **Ask**: sell `token0` for `token1` over `[lower, upper)` **above** the current
  tick. **Bid**: buy `token0` with `token1` over `[lower, upper)` **at or below**
  the current tick.
- Ticks must be aligned to `tickSpacing`. Prices follow `1.0001^tick`.
- `claim` settles filled proceeds; `cancel` settles proceeds **plus** unfilled
  inventory and ends eligibility.
- The deployed `GeometricFrontierBook` is **uniform-only** (one liquidity size per
  level). For a slope, place a few uniform ladders.

## Pick your path

| Intent | Go to |
| --- | --- |
| Deploy a venue / create a market | [`reference/deploy-path.md`](reference/deploy-path.md) |
| Place / manage asks (maker) | [`reference/maker-templates.md`](reference/maker-templates.md) |
| Place / manage bids (maker) | [`reference/maker-templates.md`](reference/maker-templates.md) |
| Swap / take liquidity | [`reference/taker-templates.md`](reference/taker-templates.md) |
| Let a bot manage someone's positions | [`reference/delegation-templates.md`](reference/delegation-templates.md) |
| Before any broadcast | [`reference/safety-checklist.md`](reference/safety-checklist.md) |
| Something reverted / failed | [`reference/error-recovery.md`](reference/error-recovery.md) |

A full intent→call decision tree lives in
[`../docs/agent-decision-tree.md`](../docs/agent-decision-tree.md), and exact
signatures/events/reverts in
[`../docs/contract-interface-reference.md`](../docs/contract-interface-reference.md).

## Non-negotiable rules

1. **Quote → apply slippage → submit** for every take; re-quote near execution.
2. **Use explicit `book` addresses.** A pair can have many books — never rely on
   `defaultBook` under ambiguity. Persist the address from `BookCreated`.
3. **Persist `positionId`** with owner, book, side, range, and strategy after
   every deposit — you need it to claim, cancel, requote, or transfer.
4. **Approve the right token**: token0 for asks/sells, token1 for bids/buys; add
   the taker fee on top of taker input.
5. **Bound every direct sweep** with `maxFills`, `maxPay`, `minOut`, `deadline`.
   Prefer the router for normal swaps; never use `moveTickTo`/`sweep` as a trade.
6. **Validate before creating a market** (distinct non-zero tokens, positive
   spacing, aligned start tick, fee ≤ 1000 bps, fee recipient if fees > 0).
7. **Use normal ERC20s.** Rebasing / fee-on-transfer / callback tokens are out of
   scope. Hooks, singleton credits, referrers, and rebates are not deploy-day.
8. **Funds settle to the owner**, even when a delegated bot triggers the action.

## Confidence

High confidence: factory book creation; ask/bid place/claim/cancel; router
buy/sell with lens quotes; zero-fee and simple immutable maker/taker fees;
selector-scoped delegation.

Treat as needing separate review: hook-enabled books, singleton/global-credit
prototypes, referrer fee splits, maker rebates/emissions, exotic ERC20s.
