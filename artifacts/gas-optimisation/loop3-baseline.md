# Frontier Gas Optimisation Loop 3 Baseline

Branch: `experiment-gas-optimisation`

Baseline commit: `f729863 optimise frontier bid deposit gas`

Command:

```sh
cd prototype
forge test --match-path 'test/GasMatrix.t.sol' --match-test 'testBidOperationCosts' --isolate -vv --gas-report
```

Result: 1 test passed.

Key logs:

- `bid deposit (10 levels)`: `178500`
- `bid deposit (10,000 levels)`: `200725`
- `bid witness-claim (5 filled levels, ERC20 transfer)`: `51512`
- `bid witness-cancel (refund transfer, no proceeds)`: `62847`

`RollingFrontierBook` gas report:

- deployment cost: `6604976`
- deployment size: `31346`
- `depositBid`: min `177992`, avg `185400`, median `177992`, max `200217`, calls `3`
- `claimBidTo`: `46490`
- `cancelBidWithWitness`: `57752`
- `moveTickTo`: `158745`

`FrontierMakerOps` gas report:

- deployment cost: `3642701`
- deployment size: `17196`
- `cancelBidWithWitness`: `47594`

Baseline interpretation:

- Loop 3 starts at the loop 2 endpoint.
- The isolated wallet-funded 10-level bid is already at `178500` console / `177992` gas-report min.
- The remaining wallet-funded path still pays for two packed position slots, two bid endpoint slots, one same-word bitmap slot, `_nextPositionId`, the internal-credit lookup, and token1 `transferFrom`.
