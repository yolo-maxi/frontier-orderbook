# Frontier Gas Optimisation Loop 3 After

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
- `bid witness-claim (5 filled levels, ERC20 transfer)`: `51507`
- `bid witness-cancel (refund transfer, no proceeds)`: `62846`

`RollingFrontierBook` gas report:

- deployment cost: `6604976`
- deployment size: `31346`
- `depositBid`: min `177992`, avg `185400`, median `177992`, max `200217`, calls `3`
- `claimBidTo`: `46490`
- `cancelBidWithWitness`: `57752`
- `moveTickTo`: `158745`

Loop 3 permanent internal-credit benchmark:

```sh
cd prototype
forge test --match-path 'test/GasMatrix.t.sol' --match-test 'testCreditFundedBidDepositCost' --isolate -vv --gas-report
```

Result: 1 test passed.

- Console `bid deposit from internal credit (10 levels)`: `148444`
- Gas-report `depositBid`: min `143436`, avg `143436`, median `143436`, max `143436`, calls `1`
- Setup: `deposit(101, 111, L)` -> `moveTickTo(111)` -> `claimInternal(ask)` -> zero token1 approval -> `depositBid(101, 111, L)`.
- The test asserts the credited token1 exactly funds the bid, token1 wallet balance is unchanged, token1 approval is zero for the measured bid, and `internalBalance1` is spent to zero.

Additional required gas suite:

```sh
cd prototype
forge test --match-path 'test/*Gas*.t.sol' --isolate -vv --gas-report
```

Result: 20 tests passed.

Selected after-suite logs:

- `bid deposit (10 levels)`: `178500`
- `bid deposit (10,000 levels)`: `200725`
- `bid deposit from internal credit (10 levels)`: `148444`
- gas-report `depositBid`: min `143436`, avg `175525`, median `177992`, max `200217`, calls `5`
- `frontier deposit gas at width: 10`: `187338`
- `frontier deposit gas at width: 1000`: `209250`
- `frontier deposit gas at width: 10000`: `209250`
- `frontier deposit gas at width: 100000`: `209262`
- `down-sweep 20 bid levels`: `129550`, per level `6477`

Required behavior suites:

```sh
cd prototype
forge test --match-contract 'FrontierTwoSidedTest|FrontierRecycleTest|PeripheryTest|PositionNFTTest|RangeLPTest|YieldRangeLPTest' -vv
```

Result: 41 tests passed.

Selected recycle logs:

- `claimBid + deposit (round trip)`: `145057`
- `recycleBidIntoAsk`: `126241`
- `bid requote gas`: `81918`

Full suite:

```sh
cd prototype
forge test
```

Result: 194 passed, 0 failed, 2 fork tests skipped.

Loop 3 deltas:

- Wallet-funded console `bid deposit (10 levels)`: `178500 -> 178500`, delta `0`.
- Wallet-funded gas-report `depositBid` min: `177992 -> 177992`, delta `0`.
- Wallet-funded wide console `bid deposit (10,000 levels)`: `200725 -> 200725`, delta `0`.
- Permanent credit-funded gas-report `depositBid` min: `177992 -> 143436` versus wallet min, delta `-34556`.
- Permanent credit-funded console `bid deposit`: `178500 -> 148444` versus wallet console, delta `-30056`.

What changed:

- Added `GasMatrixTest.testCreditFundedBidDepositCost` as a durable benchmark.
- No production contract code changed in loop 3; the storage/endpoint/funding review did not find a safe remaining wallet-funded SSTORE removal.

Storage and funding conclusion:

- `live` and `isBid` are already packed in the first position word; encoding them differently would not remove a fresh SSTORE while preserving `positions(id)` compatibility.
- `claimedUpper` is also already packed in the first position word; implying it for fresh bids would not remove a slot, and it must become mutable after claim/cancel.
- Two bid endpoint writes remain required for current sweep/no-resurrection semantics: the upper frontier endpoint and lower sentinel define the live descending run.
- Same-word bitmap writes are already coalesced; wide/straddling bids still need the second bitmap word.
- Wallet-funded deposits still need the credit-first lookup plus token1 `transferFrom`; fully credit-funded deposits avoid the ERC20 transfer path and are already below 150k in gas-report terms.
