# Frontier Gas Optimisation Loop 2 Baseline

Branch: `experiment-gas-optimisation`

Baseline commit: `d89d735 optimise frontier maker deposit gas`

Baseline command:

```sh
cd prototype
forge test --match-path 'test/GasMatrix.t.sol' --match-test 'testBidOperationCosts' --isolate -vv --gas-report
```

Result: 1 test passed.

Key logs:

- `bid deposit (10 levels)`: `212212`
- `bid deposit (10,000 levels)`: `234136`
- `bid witness-claim (5 filled levels, ERC20 transfer)`: `53645`
- `bid witness-cancel (refund transfer, no proceeds)`: `65200`

`RollingFrontierBook` gas report:

- deployment cost: `6535075`
- deployment size: `30863`
- `depositBid`: min `211704`, avg `219012`, median `211704`, max `233628`, calls `3`
- `claimBidTo`: `48623`
- `cancelBidWithWitness`: `60105`
- `moveTickTo`: `158857`

Storage/write breakdown before loop 2:

- Fresh bid position: 3 storage slots.
  - slot 0: `owner`, `lower`, `upper`
  - slot 1: `liquidity`, `slope` (`0` for bids but still in the shared slot)
  - slot 2: `depositClock`, `claimedUpper`, `live`, `isBid`
- Bid endpoints: 2 cold `bidDelta` zero-to-nonzero writes.
- Bid bitmap: 1 same-word bitmap zero-to-nonzero write plus a second same-word nonzero-to-nonzero bit update for the 10-level case; 2 cold bitmap-word writes for the 10,000-level case.
- Boundary/view state: first bid writes `_maxBoundary`.
- Position id: `nextPositionId` nonzero-to-nonzero update.
- Funding: `_pull1` checks `internalBalance1` then performs `token1.transferFrom`.
