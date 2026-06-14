# DarkBox demo swarm

Generates realistic, on-chain prediction-market activity on the **ARC testnet**
DarkBox market (`Will DarkBox win a grant from ARC?`) so the UI shows a busy,
Polymarket-like book: a live 2-sided ladder, moving price, and a steady trade
tape. Testnet only — never run against anything holding real value.

## What it does

1. **Funds** ~N throwaway bot wallets from the deployer treasury (the authorized
   sUSDC minter): native gas + minted sUSDC, then ERC-20 approvals. Idempotent —
   reruns skip already-funded/approved bots.
2. **Opens the books.** Two maker bots split sUSDC into YES+NO inventory, drag
   the geometric frontier from the construction tick (200000) into the
   probability band with `moveTickTo`, and rest a 2-sided ladder around the fair
   price on both the YES and NO books.
3. **Drives takers + arbitrage.** The remaining bots fire randomized `buyExactIn`
   / `sellExactIn` on each book — **independent price discovery per leg**, each
   with its own maker fair and spread, so the two are NOT hard-coupled. An
   arbitrage strategy keeps YES + NO ≈ 100¢ the way real prediction markets do:
   when the pair trades under 100¢ an arber buys both legs and **merges** the set
   for risk-free profit; when over 100¢ it **splits** a set and sells both legs.
   Deviations only persist inside a small no-arb band (~1.5¢).

Price model is the real on-chain one: geometric book, `price = 1.0001^tick`,
where the price **is** the implied probability (30¢ ⇒ 30%).

## Safety

- **Dry-run by default.** Without `--live` it only simulates taker quotes against
  the live books (read-only, zero transactions).
- **Bounded.** Hard `--duration`, a `--max-tx` cap, in-flight backpressure, and
  SIGINT draining — no runaway loops.
- **No secrets in logs.** Private keys are loaded from the env file into memory
  only; all log output is run through a redactor.
- Treasury key is read from `--env` (default
  `/home/xiko/darkbox/.secrets/arc-testnet-submission.env`, var `DEPLOYER_KEY`).
  Bot keys are deterministic throwaways derived from `--seed`.

## Usage

```bash
cd bots/darkbox

# read-only dry run (default): 30s, 12 bots, simulates quotes
node dbx-swarm.mjs

# open the book only (fund + 2-sided ladder, no trading loop)
node dbx-swarm.mjs --live --fund-only

# full demo: 12 bots, ~5 trades/sec target, 45s
node dbx-swarm.mjs --live --bots 12 --tps 5 --duration 45

# stop early with Ctrl-C — it drains in-flight txs and prints a summary
```

### Flags

| flag | default | meaning |
|---|---|---|
| `--live` | off (dry-run) | actually send transactions |
| `--bots N` | 12 | wallet count (bots[0], bots[1] are makers) |
| `--tps R` | 2 | target aggregate trades/sec |
| `--duration S` | 30 | trading-loop seconds |
| `--fair P` | 0.30 | initial YES probability the makers quote around |
| `--fund-usdc N` | 2000 | sUSDC minted per bot (if under target) |
| `--gas-eth N` | 0.05 | native gas funded per bot (makers get ≥0.3) |
| `--fund-only` | off | fund + open books, then exit |
| `--no-mm` | off | skip market-making (takers only) |
| `--max-tx N` | auto | hard cap on attempted transactions |
| `--env PATH` | arc submission env | dotenv file with `DEPLOYER_KEY` |
| `--rpc URL` | manifest rpc | override RPC endpoint |
| `--seed S` | `darkbox-arc-demo-swarm-v1` | derives the throwaway bot keys |

## Notes on throughput

ARC testnet blocks are ~0.5s. Per-wallet sends are serialized (one in-flight tx
per wallet, viem-managed nonces); aggregate throughput scales with the number of
bots and confirmation latency. See the parent report for the measured stable
rate. The `moveTickTo` that opens a book is a one-time ~2.2M-gas frontier walk;
ordinary trades and re-centers are cheap.
