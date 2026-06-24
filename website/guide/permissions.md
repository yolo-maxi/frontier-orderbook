# Delegatable Permissions

Frontier integrates a standalone draft ERC — an **approval registry** for
scoped delegated authorization without custody transfer
(`src/permissions/`). Storage is `(user, operator, target) → auth blob`;
grants are either full-target or per-selector bundles, optionally
expiring; EIP-712 permits allow gasless granting.

## How the book uses it

Every owner gate in the protocol runs one check:

```solidity
function _authOwner(address owner) internal view {
    if (msg.sender != owner) {
        if (address(permissions) == address(0)) revert NotOwner();
        permissions.requireAuthorizedCall(owner, msg.sender, address(this), msg.sig);
    }
}
```

So an owner can grant a bot exactly `requote` — and nothing else:

```solidity
registry.grant(bot, book, book.requote.selector);                  // forever
registry.grantWithExpiry(bot, book, selector, expiry);             // bounded
registry.grantFull(bot, book);                                     // everything
```

Three properties make this safe:

1. **Payouts always go to the position owner** — operators trigger, never
   receive.
2. **Scope is per-function**: a requote grant cannot cancel; a claim grant
   cannot withdraw principal.
3. **Books without a registry are strictly owner-only** (the factory binds
   the registry; zero address disables delegation).

## Live, right now

The demo market maker runs exactly this pattern: positions are owned by an
owner key; a **separate operator key** holding only
`requote`/`requoteBid` grants signs the ±0.1% fast-path requotes every few
seconds. When fills land (requoting a filled order is rejected by design),
the bot falls back to the owner key to settle and repost. RangeLP vaults
use the same registry for keeper-driven rebalancing.

Transferable positions compose with this: transfer the position, and the
new owner's grants govern it.
