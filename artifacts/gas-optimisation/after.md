# Frontier Gas Optimisation After

Branch: `experiment-gas-optimisation`

After command:

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

`FrontierMakerOps` gas report:

- deployment cost: `3462467`
- deployment size: `16309`
- `cancelBidWithWitness`: `50535`

Additional required gas suite:

```sh
cd prototype
forge test --match-path 'test/*Gas*.t.sol' --isolate -vv --gas-report
```

Result: 19 tests passed.

Selected after-suite logs:

- `frontier deposit gas at width: 10`: `213573`
- `frontier deposit gas at width: 1000`: `235485`
- `frontier deposit gas at width: 10000`: `235485`
- `frontier deposit gas at width: 100000`: `235497`
- `down-sweep 20 bid levels`: `129662`, per level `6483`
- `bid deposit (10 levels)`: `212212`
- `bid deposit (10,000 levels)`: `234136`
