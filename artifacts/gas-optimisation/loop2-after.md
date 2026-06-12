# Frontier Gas Optimisation Loop 2 After

Branch: `experiment-gas-optimisation`

After command:

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

Additional required gas suite:

```sh
cd prototype
forge test --match-path 'test/*Gas*.t.sol' --isolate -vv --gas-report
```

Result: 19 tests passed.

Selected after-suite logs:

- `frontier deposit gas at width: 10`: `187338`
- `frontier deposit gas at width: 1000`: `209250`
- `frontier deposit gas at width: 10000`: `209250`
- `frontier deposit gas at width: 100000`: `209262`
- `bid deposit (10 levels)`: `178500`
- `bid deposit (10,000 levels)`: `200725`
- `down-sweep 20 bid levels`: `129550`, per level `6477`
- `claimBid + deposit (round trip)`: `145057`
- `recycleBidIntoAsk`: `126241`

Internal-credit benchmark:

- Temporary contained benchmark using existing APIs (`deposit` -> `moveTickTo` -> `claimInternal` -> `depositBid`) measured `bid deposit from internal credit (10 levels)`: `143821` console, gas-report `depositBid` min `143436`.
- The temporary benchmark test was removed before commit.

Storage/write breakdown after loop 2:

- Fresh bid position: 2 storage slots.
  - slot 0: `owner`, `lower`, `upper`, `claimedUpper`, `live`, `isBid`
  - slot 1: `liquidity`, `depositClock`
- Ask slope: moved to `_positionSlope[positionId]`; bids and flat asks do not write it.
- Bid endpoints: still 2 cold `bidDelta` zero-to-nonzero writes.
- Bid bitmap: fresh same-word endpoints use a single coalesced bitmap word update; wide bids still write two bitmap words.
- Boundary/view state: bid deposits no longer write `_maxBoundary`; `bidLiquidity` derives its scan ceiling from `_currentTick`.
- Position id: `_nextPositionId` is a packed `uint64` with an unchanged `nextPositionId()` getter returning `uint256`.
- Funding: wallet-funded `depositBid` still checks internal credit first, then performs a bool-returning `token1.transferFrom`; fully credit-funded deposits avoid the ERC20 transfer.
