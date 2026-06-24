# Roadmap & Caveats

Honesty section. Everything below is documented in-repo and none of it is
hidden in the demo.

## Known limits (current prototype)

1. **Optimizer profile matters for EIP-170**: the default runtime-gas
   profile is too large (`GeometricFrontierBook` 27,429 B,
   `UniformFrontierBook` 27,025 B). The deploy profile is the real-chain
   profile: `FOUNDRY_PROFILE=deploy forge build --sizes` reports
   `GeometricFrontierBook` at 22,120 B and `UniformFrontierBook` at
   21,549 B.
2. **Fees are per-book-at-birth** — `MAKER_FEE_BPS` and `TAKER_FEE_BPS`
   default to zero, are capped at 1,000 bps, and require a recipient when
   nonzero. They are not a mutable protocol switch in the deployed book.
3. **Copy liquidity is still experimental** — `depositShadow` /
   `withdrawShadow` and `shadowReserves` are in the book, but the current
   design deliberately uses budget-halving, one pooled inventory, and a
   constant 30 bps copy fee when a fee recipient exists.
4. **Pro-rata levels, not price-time priority** — a deliberate design
   stance (it's what makes O(1) aggregation possible, and requoting
   penalty-free), worth a conscious decision before mainnet.
5. **Unaudited.** 206 test/invariant entrypoints, differential fuzzing,
   fee invariants, and fork validation — but no external review.

## Next, in order of value

1. External audit + invariant-mode fuzzing campaign
2. Mainnet-style deploy runbook using `FOUNDRY_PROFILE=deploy` and the
   deployer/factory split
3. Fee policy: decide who may choose maker/taker bps and fee recipients
   before any production venue has revenue
4. Copy-liquidity hardening: remove budget-halving, make fee config
   explicit, and decide whether synthetic depth belongs in production
5. Yield Level 2 — buffered adapters for posted capital, if Level 1 vault
   LPs prove useful
