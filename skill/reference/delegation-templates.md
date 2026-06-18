# Delegation templates (PermissionRegistry)

Use `PermissionRegistry` when a **bot (operator)** manages positions owned by a
**human/account (owner)**. Funds always settle to the owner; the operator only
triggers scoped actions. Grant the **least** privilege needed, with an expiry.

## Recommended: scoped bundle with expiry

```solidity
bytes4[] memory selectors = new bytes4[](3);
selectors[0] = book.claim.selector;
selectors[1] = book.cancel.selector;
selectors[2] = book.requote.selector;
registry.grantSelectorBundle(agent, address(book), selectors, uint48(block.timestamp + 1 days));
```

TypeScript (`BOOK_SELECTORS` verified against the ABI in the SDK tests):

```ts
import { PermissionClient, BOOK_SELECTORS } from "@frontier/sdk";
const perms = new PermissionClient(REGISTRY, { publicClient, walletClient, account });
const expiry = BigInt(Math.floor(Date.now() / 1000) + 86_400);
await perms.grantBundle(
  agent, book,
  [BOOK_SELECTORS.claim, BOOK_SELECTORS.cancel, BOOK_SELECTORS.requote],
  expiry,
);
```

## Single selector

```solidity
registry.grant(agent, address(book), book.claim.selector);                       // no expiry
registry.grantWithExpiry(agent, address(book), book.cancel.selector, expiry);    // with expiry
```

## Gasless (EIP-712 signed) grant

The owner signs a permit off-chain; anyone can submit it:

```solidity
registry.permitPermission(permit, signature);          // single/bundle
registry.permitFullAuthorization(fullPermit, signature);
```

Read `domainSeparator()`, `PERMISSION_PERMIT_TYPEHASH()`, and
`permissionNonce(user)` to build the typed data.

## Full delegation — trusted automation only

```solidity
registry.grantFull(agent, address(book));   // every selector on the target
```

Use only when the operator is fully trusted. Prefer scoped bundles otherwise.

## Verify before relying on a grant

```solidity
bool ok = registry.isAuthorizedCall(owner, agent, address(book), book.claim.selector);
uint48 expiry = registry.permissionExpiry(owner, agent, address(book), book.claim.selector);
```

```ts
await perms.isAuthorized(owner, agent, book, BOOK_SELECTORS.claim);
await perms.expiryOf(owner, agent, book, BOOK_SELECTORS.claim);
```

## Revoke

```solidity
registry.revoke(agent, address(book), book.claim.selector);  // one selector
registry.revokeAll(agent, address(book));                    // everything on target
```

## Selector cheatsheet

| Function | Selector |
| --- | --- |
| `claim(uint256)` | `0x379607f5` |
| `claimTo(uint256,int24)` | `0xac3b68e3` |
| `cancel(uint256)` | `0x40e58ee5` |
| `claimBid(uint256)` | `0x21113057` |
| `cancelBid(uint256)` | `0x9703ef35` |
| `requote(uint256,int24,int24,uint128)` | `0xbcf82d31` |
| `requoteBid(uint256,int24,int24,uint128)` | `0x84616e58` |
| `transferPosition(uint256,address)` | `0x55bd513f` |
