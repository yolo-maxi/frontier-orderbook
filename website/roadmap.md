# Roadmap & Caveats

Honesty section. Everything below is documented in-repo and none of it is
hidden in the demo.

## Known limits (current prototype)

1. **EIP-170**: the full-featured book (+factory embedding it) exceeds the
   24,576-byte runtime limit at production optimizer settings. The devnet
   disables the limit. Hardening: split core into external libraries
   and/or a deploy-profile, factory via CREATE2 code pointer.
2. **Bids are not endpoint-telescoped yet** — down-sweeps settle per level
   (~44k/level). The ask side proves the mechanism; the mirror is
   mechanical. (This is why the MM bot recenters with chunked sweeps.)
3. **Maker fills must stay fee-free** — per-liquidity proceeds being a
   pure function of the tick is what keeps claims O(1). Protocol/taker
   fees are fine; crediting fees into fills would need per-fill records.
4. **Linear demo curve** — production wants `1.0001^tick`
  ([details](/guide/pricing)); run math stays closed-form.
5. **Pro-rata levels, not price-time priority** — a deliberate design
   stance (it's what makes O(1) aggregation possible, and requoting
   penalty-free), worth a conscious decision before mainnet.
6. **Unaudited.** 156 tests, differential fuzzing, fork validation — but
   no external review.

## Next, in order of value

1. Bid-side telescoping (kills the recenter chunking, symmetric story)
2. Contract-size split for real-chain deploys (unblocks Base Sepolia,
   which is otherwise one funded key away)
3. Geometric price curve
4. Position NFT wrapper (positions are already transferable)
5. Yield Level 1 — vault-native quoting capital per NOTES-yield.md
6. External audit + invariant-mode fuzzing campaign
