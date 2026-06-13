# Frontier Singleton Credits Prototype Report

## Summary

This branch implements a real vertical slice of singleton/global credits for the prototype Frontier book:

- `FrontierVault` holds ERC20 custody once and tracks per-user liquid credits by token.
- `SingletonFrontierBook` is a vault-backed `RollingFrontierBook` variant.
- Vault-backed book deposits debit user vault credits instead of pulling ERC20s into the book.
- Taker settlement routes through the vault.
- Maker claims, cancels, and negative requote deltas credit the vault instead of transferring to wallets.
- Users withdraw liquid credits directly from the vault.

Recommendation: keep this as a prototype and split into smaller production PRs. The gas result is directionally good for repeat wallet-avoidant trading, but the security model and code-size impact need a cleaner production design before merge.

## Architecture Chosen

Chosen route: `FrontierVault` / clearinghouse with opt-in book integration.

The implementation keeps the existing rolling book mechanics and adds an optional `frontierVault` storage slot to `FrontierBookBase`:

- `frontierVault == address(0)`: original per-book custody/internal-credit behavior.
- `frontierVault != address(0)`: singleton custody mode.

`SingletonFrontierBook` sets `frontierVault` during construction. It uses the existing `FrontierMakerOps` delegatecall companion because the companion reads the book's storage during delegatecall, including the vault address.

The vault tracks only liquid credits:

```text
balanceOf[user][token] = withdrawable/redeployable liquid credit
totalCredits[token] = sum of liquid credits for solvency checks
authorizedBook[book] = book can debit, credit, and pay from custody
```

Deployed liquidity is not represented as user liquid credit. When a maker deposits into a vault-backed book, the vault debits their liquid credit and leaves the physical ERC20 in vault custody. When fills/cancels/claims settle, the book credits liquid balances back to the maker.

## Implemented

Contracts:

- `prototype/src/FrontierVault.sol`
  - user `deposit(token, amount)`
  - user `withdraw(token, amount)`
  - owner-controlled `setBookAuthorization(book, authorized)`
  - book-only `debit(user, token, amount)`
  - book-only `credit(user, token, amount)`
  - book-only `pay(token, to, amount)`
  - `solvent(token)` check for current liquid credits

- `prototype/src/SingletonFrontierBook.sol`
  - constructor wrapper around `RollingFrontierBook`
  - enables singleton vault mode at deployment time

- `prototype/src/FrontierBookBase.sol`
  - optional `frontierVault`
  - vault-aware `_pull0`, `_pull1`
  - `_creditOrTransfer0`, `_creditOrTransfer1`

- `prototype/src/RollingFrontierBook.sol`
  - vault-backed bid and ask deposits
  - vault-backed taker sweep settlement
  - vault-backed claims and internal-claim variants
  - `withdrawInternal` disabled in vault mode; users withdraw via `FrontierVault`

- `prototype/src/FrontierMakerOps.sol`
  - vault-backed cancel proceeds/refunds
  - vault-backed negative requote deltas

Tests:

- `prototype/test/FrontierVault.t.sol`
  - deposit/withdraw
  - owner-only authorization
  - unauthorized book cannot debit/credit/pay
  - liquid-credit solvency

- `prototype/test/SingletonCredits.t.sol`
  - bid deposit consumes singleton credit
  - bid fill, claim, cancel, withdraw
  - ask deposit consumes singleton credit
  - ask fill, claim, cancel, withdraw
  - unauthorized singleton book cannot consume credit
  - assertions that the book itself holds no token custody in the tested paths

- `prototype/test/SingletonGas.t.sol`
  - compares fresh wallet-funded bid deposit, existing per-book internal-credit deposit, and singleton-credit deposit

## Not Implemented

- Full factory integration for creating singleton books.
- Geometric singleton book variant.
- ERC6909 interface or tokenized credit IDs.
- A PoolManager-style singleton that owns all books/markets.
- Explicit vault accounting for active deployed liabilities per book.
- Cross-book netting beyond shared liquid balances in `FrontierVault`.
- Migration tooling for existing per-book custody/internal balances.
- Production-grade access control, pausing, delayed book authorization, or revocation procedures.
- Formal invariant suite spanning all authorized books and vault active liabilities.

## Gas Numbers

Command:

```sh
cd prototype
forge test --match-path 'test/*Gas*.t.sol' --isolate -vv --gas-report
```

Relevant console measurements:

| Flow | Gas |
| --- | ---: |
| Current wallet-funded `depositBid` (10 levels) | `180687` |
| Existing per-book internal-credit `depositBid` (10 levels) | `146142` |
| Singleton/global-credit `depositBid` (10 levels) | `154110` |

Gas-report function min:

| Contract/function | Min |
| --- | ---: |
| `SingletonFrontierBook.depositBid` | `153602` |
| `RollingFrontierBook.depositBid` | `145634` |
| `FrontierVault.deposit` | `101151` |

Interpretation:

- Singleton credit is about `26.6k` gas cheaper than wallet-funded fresh `depositBid` in this branch's isolated console benchmark.
- Singleton credit is about `8.0k` gas more expensive than the existing per-book internal-credit path because it crosses an external vault authorization/accounting boundary.
- The vault deposit itself costs about `101k`; this only amortizes if makers/arbers redeploy repeatedly across books/markets before withdrawing.
- These numbers differ from the prior gas branch figures because this prototype adds an optional vault branch to the existing book and measures after that code change.

## Solvency And Authorization Model

Current vault invariant:

```text
ERC20(token).balanceOf(vault) >= totalCredits[token]
```

This protects already-liquid user credits from being over-withdrawn or drained by an authorized book through `pay`.

Book authorization:

- Only `owner` can authorize or deauthorize books.
- Only authorized books can call `debit`, `credit`, and `pay`.
- Users do not approve books for maker deposits in singleton mode; they deposit into the vault once and books debit credits.
- Takers still approve the book for swap input because the book calls `transferFrom(taker, vault, paid)`.

Important limitation:

The vault does not independently know active deployed liabilities. Once a book debits liquid credit, that ERC20 remains in vault custody but is no longer part of `totalCredits`. The book is responsible for ensuring future `pay` and `credit` calls match actual fills, refunds, and proceeds. A malicious or buggy authorized book can still misaccount active liabilities. The current vault only prevents draining already-liquid credits.

Production should add one of:

- vault-level active reserve accounting per authorized book/token;
- a singleton manager that owns the book state and settlement together;
- ERC6909-style balance buckets that distinguish liquid, deployed, and claimable states.

## Tradeoffs And Audit Risks

- This is minimally invasive but not production-clean. The optional vault branch touches hot book paths and increases core code size.
- `SingletonFrontierBook` under the default gas profile reports runtime size above EIP-170 limits in the gas report, similar to the existing gas-optimized `RollingFrontierBook` profile. Deployment/profile sizing needs a separate pass.
- The authorized-book trust boundary is large. Book authorization effectively grants custody power over non-liquid vault reserves.
- Taker settlement still requires ERC20 transfers on fills. The main win is for repeat maker/arber placement and recycling, not taker swap gas.
- `withdrawInternal` is disabled for vault-backed books, so integrations must route withdrawals through `FrontierVault`.
- The prototype uses simple owner auth. Production should use governance/multisig/timelock-style controls and an emergency deauthorization design.
- Non-standard ERC20 behavior is not handled beyond the existing boolean-return style.
- Requote/cancel delegatecall storage layout remains sensitive. The vault slot is shared by core and maker-ops through inheritance; future layout changes need explicit review.

## Uniswap v4 / PoolManager Caveat

This prototype borrows the high-level idea of singleton custody and internal accounting from Uniswap v4's PoolManager model, but it is not equivalent:

- v4 centralizes pool state, locks, deltas, and settlement in one manager.
- This prototype keeps independent Frontier book state and adds a separate vault for ERC20 custody/liquid credits.
- The vault does not enforce full pool/book-level active-liability accounting the way a true singleton manager could.
- Frontier's rolling book is still a standalone venue; it is not a vanilla v4 hook that can safely rely on v4 pool liquidity across unmaterialized levels.

## Verification

Commands run:

```sh
cd prototype
forge build
forge test --match-path 'test/*Singleton*.t.sol' -vv
forge test --match-path 'test/*Vault*.t.sol' -vv
forge test --match-path 'test/*Gas*.t.sol' --isolate -vv --gas-report
forge test
```

Results:

- `forge build`: pass.
- `test/*Singleton*.t.sol`: 4 passed, 0 failed.
- `test/*Vault*.t.sol`: 3 passed, 0 failed.
- `test/*Gas*.t.sol --isolate --gas-report`: 21 passed, 0 failed.
- full `forge test`: 201 passed, 0 failed, 2 skipped.

## Recommendation

Do not merge this directly to `main` as-is.

Keep it as a prototype and split the next work into smaller PRs:

1. Land `FrontierVault` behind tests as an experimental module.
2. Add a dedicated singleton book factory/deployer path.
3. Decide whether production should be vault-plus-books or a real singleton manager.
4. Add active-reserve accounting before authorizing more than tightly audited book code.
5. Re-run deploy-profile sizing and decide whether vault support should live in core book code or in a separate singleton-only book implementation.

## Exact Next Steps

1. Add vault reserve accounting:
   - `reserveOfBook[book][token]`
   - debit liquid credit into book reserves
   - pay takers and credit makers out of book reserves
   - assert `tokenBalance >= totalCredits + totalReserves`

2. Build a `SingletonFrontierBookFactory`:
   - creates vault-backed books
   - authorizes books atomically or through an owner-controlled ceremony
   - memoizes matching maker-ops companions

3. Add invariant tests:
   - multi-user, multi-book random deposits/fills/claims/cancels/withdrawals
   - vault physical balances versus liquid credits plus active reserves
   - malicious unauthorized book attempts

4. Decide ERC6909 scope:
   - if credits need approvals/transfers/composability, implement ERC6909-style IDs for liquid asset balances;
   - if credits are only settlement balances, keep the vault ledger private and simpler.

5. Re-benchmark realistic maker workflows:
   - deposit once into vault
   - place/cancel/requote across two or more books
   - claim proceeds
   - redeploy into the other side
   - withdraw at the end

6. Audit before production:
   - book/vault authorization boundaries
   - reserve accounting
   - reentrancy and token callback assumptions
   - storage layout with delegatecall maker-ops
   - deauthorization and emergency withdrawal semantics
