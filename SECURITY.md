# Security Policy

## Status: unaudited research prototype

Frontier is an experimental, **unaudited** research prototype. It has not
undergone a third-party security audit and is **not intended for production
use or for handling real funds**. The live demo runs on a disposable devnet
with synthetic assets only.

Do not deploy this code to a public chain or use it to operate a live
market. See [`LICENSE`](LICENSE) — production and commercial use require the
author's prior written permission.

## Known caveats

- **Hooks are unreviewed.** The hook framework and example hooks in
  `prototype/src/hooks/` are experiments. Do not run hooks in production
  without hook-specific review.
- **Demo keys are public.** Any private keys that appear in the demo bots
  (`bots/`) or `prototype/deploy-devnet.sh` are the well-known deterministic
  Anvil/Foundry test keys, used only on a local devnet. They control nothing
  of value. Never reuse them on a real chain.
- **No custody guarantees off the happy path.** The mechanism is verified
  against a reference oracle and fuzzed, but the surrounding tooling is
  demo-grade.

## Reporting a vulnerability

If you find a security issue, please report it **privately** — do not open a
public issue or PR that discloses the vulnerability.

1. Contact the author, **Francesco Renzi**, privately.
   <!-- TODO(@fran-handle): add a verified contact (X/email) for disclosures -->
2. Include a description, affected files/commit, and a proof-of-concept or
   reproduction steps if you have them.
3. Please allow reasonable time for a fix before any public disclosure.

We appreciate responsible disclosure and will credit reporters who want it.
