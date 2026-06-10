# Potential Topologies

Frontier's core is a single-pair book. How books are *organized* — and who
controls what — is a product decision with real consequences. Four shapes,
from what exists today to where it could go.

## 1. Factory of ephemeral books (what's built)

Anyone deploys a book for any pair at any tick spacing; many books per
pair coexist; the factory tracks a canonical book per pair for routers.
Books are disposable — no protocol-wide state, no cleanup.

| Surface | Controlled by |
|---|---|
| Factory | nobody after deploy (immutable) |
| A book | nobody — creator only picks tick spacing + hook **at birth** |
| Hooks | **their own admins** — this is the real power surface |
| Permission registry | nobody (shared public good; users manage their own grants) |
| Router / Lens / MakerKit | stateless, permissionless, replaceable |

**Properties:** maximal credible neutrality; liquidity can fragment across
spacings/hooks (routers mitigate via the canonical-book map); each book
pays its own deployment.

## 2. Singleton (v4-style)

All books live in one contract, keyed by `(token0, token1, spacing, hook)`.

**Gains:** one deployment forever; cross-book token netting (a
recycle-style internal ledger spanning every market — flash-accounting
multi-hop swaps with zero intermediate transfers); one approval per token
for everything; cheaper book creation (a storage write, not a deploy).

**Costs:** systemic risk concentrates (one bug = every market); the
code-size ceiling bites hard (the feature-complete book already brushes
EIP-170 alone); and **whoever can upgrade or parametrize the singleton
governs every market at once**. A singleton makes a protocol fee switch
trivially enforceable — and trivially political.

## 3. Clustered markets (maker-side topology)

Orthogonal to 1 vs 2: organize the *makers*. A cluster vault holds pooled
inventory and quotes across many books at once (RangeLP is the
single-book seed of this; NOTES-yield Level 1 adds idle capital earning
lending yield inside the vault). Inventory nets across markets; one
rebalance pass re-prices a whole portfolio; vault shares can tokenize LP.

**Control:** the vault operator (or its tokenholders) controls quoting
strategy — concentrated, but per-vault and opt-in. Delegated permissions
keep operators custody-free even here.

## 4. Hook-differentiated venue families

Same core, many flavors: a KYC-gated book, a fee-experiment book, an
incentive-emitting book, all sharing routers, the registry, and the lens.
The product becomes a **family of venues** where the hook *is* the brand.
Control shifts entirely to hook admins — which is healthy exactly when
hook power is visible (it is: capabilities are encoded in the hook's
address and immutable per book).

## What actually matters

- **Fee power**: nonexistent today; trivially global in a singleton;
  per-book-at-birth in the factory model. Decide before there's revenue.
- **Upgrade power**: factory model has none (redeploy + migrate by
  choice); singleton needs explicit governance or strict immutability.
- **The registry should stay adminless** in every topology — it's the
  trust anchor for delegation.
- Pragmatic path: factory now → singleton when cross-book netting earns
  its audit budget → clusters as the maker product on top of either.
