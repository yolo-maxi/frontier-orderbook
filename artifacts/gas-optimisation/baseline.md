# Frontier Gas Optimisation Baseline

Branch: `experiment-gas-optimisation`

Baseline command:

```sh
cd prototype
forge test --match-path 'test/GasMatrix.t.sol' --match-test 'testBidOperationCosts' --isolate -vv --gas-report
```

Result: 1 test passed.

Key logs:

- `bid deposit (10 levels)`: `230054`
- `bid deposit (10,000 levels)`: `251978`
- `bid witness-claim (5 filled levels, ERC20 transfer)`: `53656`
- `bid witness-cancel (refund transfer, no proceeds)`: `65200`

`RollingFrontierBook` gas report:

- deployment cost: `6507746`
- deployment size: `30805`
- `depositBid`: min `229546`, avg `236854`, median `229546`, max `251470`, calls `3`
- `claimBidTo`: `48634`
- `cancelBidWithWitness`: `60105`
- `moveTickTo`: `158857`

`FrontierMakerOps` gas report:

- deployment cost: `3460766`
- deployment size: `16383`
- `cancelBidWithWitness`: `50535`

