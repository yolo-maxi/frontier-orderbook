# GTM notes: what Hyperliquid got right, and what Frontier should copy

Deep-research synthesis (June 2026): 23 sources, 115 extracted claims, 25
adversarially verified (16 confirmed, 9 refuted). Confidence labels per
section; the Frontier synthesis is inference from the verified record,
not itself a verified claim.

## What actually made Hyperliquid win (verified)

1. **Product first, and genuinely better** — fully on-chain CLOB on a
   purpose-built L1: gasless order placement, ~0.2s median latency
   (self-reported; p99 0.9s, co-located), ~200k orders/sec stated
   capacity. CEX-grade execution where GMX compromised on performance
   and dYdX kept the book off-chain/in-memory. The appchain alone wasn't
   causal — dYdX v4 was also an appchain and still declined.
2. **Traction BEFORE the token.** By Oct 2024 — a month pre-airdrop —
   already 26% of perp-DEX volume and $1.5B open interest, having passed
   dYdX on product alone. The airdrop amplified real demand; it didn't
   manufacture it.
3. **HLP solved the CLOB cold-start.** A protocol-operated market-making
   vault: open USDC deposits, house quant strategy (closed source),
   PnL shared with depositors (~50-65% return in 2024), also ran
   liquidations. Nuance: earliest closed-alpha liquidity was team
   capital; external MMs later displaced much of HLP's maker share.
4. **No-insider distribution as a moat.** Zero VC (rejected ~$1B and
   ~$10B valuations), 11-person self-funded team, ~70% of supply to
   users (31% genesis airdrop, fully unlocked, ~94k wallets), points
   from Nov 2023.
5. **Fees to community, visibly.** 93→99% of fee revenue into automated
   HYPE buybacks (~$1.1B repurchased by Apr 2026) on ~$843M 2025
   revenue. Zero fee flow to team or investors.
6. **Trust incidents handled by owning the chain.** JELLY squeeze (Mar
   2025): validators voted in minutes to delist and override the oracle.
   Worked, but criticized as centralized — Foundation stake ~81% at the
   time.

## Why competitors lost (verified, medium confidence)

- **dYdX**: 73% share (Jan 2023) → ~7% (end 2024). Off-chain/in-memory
  book even after the v4 appchain move; volume was trade-mining-inflated
  ($197M rewards vs $128M revenue in 2022) and evaporated with the
  incentives; ~50% of token to investors/team.
- **Aster**: out-volumed Hyperliquid briefly via airdrop farming;
  delisted by DefiLlama over wash-trading signatures. Token rewards
  alone produce mercenary volume.
- **GMX**: no VC either — and still lost. No-VC purity without the
  product is not a strategy.

## Myths that FAILED verification (don't repeat these)

- "Cancel/post-only prioritization for MMs" as a documented HyperBFT
  feature (0-3).
- "2M TPS / 70ms blocktime" (0-3) and several specific HLP TVL/yield
  figures (0-3).
- "46% of perp fees to HLP depositors" (0-3).
- "The airdrop was the tipping point that created dominance" (0-3 — the
  dominance preceded it).

## What transfers to Frontier

1. **The MM-vault bootstrap is a smart-contract pattern, not a chain
   feature** — and Frontier's delegated-permission system is exactly the
   infrastructure for it (the vault quotes via grants, never custody).
2. **Sequencing: organic traction before any token.**
3. **No-insider distribution + fees-to-community**, committed early and
   publicly — cheap now, impossible to retrofit credibly.
4. **Incentives scored on maker quality** (uptime, depth-at-spread,
   time-in-book), never raw volume — volume-scored programs created the
   wash-trading blowups.

## What does NOT transfer (we don't own the chain)

- Gasless orders/cancels → can't court quote-stuffing HFT; don't try to
  win cancel-heavy latency games.
- Sub-second co-located matching → we inherit the host chain's blocktime
  and MEV environment.
- Validator-level incident response → safety must be pre-built at the
  contract layer (circuit-breaker hooks, oracle bounds, transparent
  pause semantics). Flip it: "no validator can delist your market by
  fiat" is a *feature* here.
- 97% fee capture is structurally harder when the host chain taxes every
  action.

Strategic implication: do not pitch "Hyperliquid but EVM" on speed.
Pick markets where latency doesn't decide the winner and where fine tick
grids, passive ladder liquidity, composability, and verifiable
non-custody do.

## The playbook (prioritized)

1. **One wedge market** where the primitives decide the outcome — a
   stable/correlated or long-tail spot pair on a cheap L2 where dense
   passive grids beat AMM LPs on capital efficiency. Publish the
   head-to-head capital-efficiency benchmark vs the incumbent pool.
2. **Build the FLP** — a Frontier-operated MM vault, team-seeded,
   quoting through delegated permissions, depositor PnL on-chain. It's
   the liquidity bootstrap, the flagship demo of bot delegation, and the
   community-economics story in one artifact.
3. **5–10 algo-trader design partners** with white-glove SDK support.
   Pitch: "run your strategy with zero custody risk and one-tx ladder
   management." Devnet trading competitions with small real prizes
   convert the existing bot demo into a funnel.
4. **Commit publicly to the distribution doctrine now** (no/minimal VC,
   majority to users, fees to community).
5. **Defer points until organic volume exists**; score maker quality,
   never raw volume.
6. **Sell the hooks story to other protocols** (vault strategies,
   oracle-gated permissioned markets, structured products) — integrations
   accrete to Frontier in a way Hyperliquid structurally can't match.
7. **Pre-publish the incident playbook** (pause semantics, oracle
   bounds, timelocks) and market the absence of a delist-by-fiat lever.

## Open questions worth chasing

- Realistic seed-capital floor for an FLP (how much did HLP actually
  need before public depth was competitive?).
- Did any on-chain CLOB ever succeed in a latency-insensitive niche on a
  general-purpose chain — or did Serum/Phoenix fail for reasons (no
  native MM vault, fragmentation) that would also bite Frontier?
- Exact scoring of Hyperliquid's points seasons (and whether it
  measurably reduced farming vs dYdX/Aster).
- Hyperliquid's pre-points zero-to-one: how did the first few hundred
  real traders arrive at a closed alpha with no token promise? That's
  precisely Frontier's current stage.
