# Design: Cross-Posted Clusters (vault-backed books)

Status: designed, not implemented. Composes with endpoint sweeps
(NOTES-endpoint-sweeps.md) and shaped orders.

## The idea

Separate the QUOTE layer from the SETTLEMENT layer. Today a book escrows
full principal at deposit; in a cluster, a MakerVault holds the inventory
ONCE and N "vault-mode" books quote against it:

  MakerVault (holds X WETH, approves its books)
    |- book A: WETH/USDC, 0.1bp grid     (owner-gated, no escrow)
    |- book B: WETH/USDC, 5bp grid
    |- book C: WETH/DAI                  (same WETH inventory!)

- deposit/requote in a vault-mode book writes quote state only (endpoint
  deltas) — no token transfer. O(1) as always.
- sweep computes owed0 as usual and PULLS from the vault at fill time;
  proceeds (token1) flow to the vault. One transferFrom per sweep.
- Effective depth on every book = min(quoted, vault balance), updating
  implicitly and instantly when any sibling book fills. No cancel race:
  the EVM serializes, so being filled beyond actual inventory is
  IMPOSSIBLE — the hard-inventory guarantee CEX market makers never get.

## Why this fits our design specifically (and not classic CLOBs)

Escrowed books need per-order deposits, so shared backing means per-order
credit accounting. Here (a) fills are aggregate per level, (b) books are
ephemeral and ~2.4M gas to deploy, so "the MM deploys their own venues" is
realistic, and (c) if a vault-mode book is SINGLE-OWNER, attribution is the
whole book — solvency per sweep is one balance check, zero per-maker work.
The no-per-user-swap-work invariant survives untouched.

## The hard constraint

Mixed backing inside one aggregated level does NOT work: if escrowed makers
and vault makers share a bucket and the vault is dry, attributing the
shortfall means looping makers. Hence:

- v1: vault-mode books are owner-gated (cluster = vault + own books).
  Public books stay fully escrowed. Routers aggregate across books.
- v2 (optional): "house quoter" lane — each public book may have AT MOST
  ONE vault-backed quoter beside the escrowed crowd. Two lanes per level is
  O(1); sweeps fill escrow lane fully, vault lane up to vault balance.
  More complexity; only if demanded.

## Sweep changes (vault mode)

- Before settling each run, check the vault covers its owed0; if not, find
  the affordable prefix of the run (run cost is linear/quadratic in level
  count -> closed form or O(log) bisection) and PARK there. Reuses the
  resumable-sweep machinery; takers see a clean partial fill at level
  granularity.
- Taker protections: sweeps already take budget params; add maxPay/minOut.
  Vault-mode books are flagged in their key so UIs/routers can badge
  displayed depth as "vault-backed (soft)" vs "escrowed (hard)".

## Trust / failure modes

- MM withdraws from vault before a sweep lands: economically identical to
  a cancel; taker gets a smaller fill, never a loss. (This is the soft-quote
  trade-off, same as CEX quote-pulling, but bounded by atomicity.)
- Two takers race sibling books in one block: serialized pulls; later one
  gets the remainder. No insolvency possible.
- Claims: the MM owns all positions in its books; proceeds can route
  straight to the vault at fill time (no lazy-claim machinery needed for
  vault books), or stay lazy with the vault as owner. Straight-to-vault is
  simpler AND removes the solvency-buffer bookkeeping.
- Cross-CHAIN cross-posting: out of scope — no shared state, no guarantee.

## What this buys

A market maker funds inventory once and quotes it everywhere: many grids,
many pairs (any book whose ask asset matches the vault's holding), updating
with O(1) requotes per book. Capital efficiency of CEX-style cross-venue
quoting, with on-chain-atomic inventory safety that CEXs cannot offer.
