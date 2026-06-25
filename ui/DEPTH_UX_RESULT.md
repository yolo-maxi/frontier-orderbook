# Depth UX Result

## Axis fix

Before, the depth axis included the active order preview:

```ts
spans = [
  ...all.map((level) => Math.abs(level.probability - mid)),
  Math.abs(pv.fromProb - mid),
  Math.abs(pv.toProb - mid),
];
liveHalf = Math.max(0.006, ...spans) * 1.16;
```

That meant widening a range preview widened the price axis and compressed the
resting-liquidity bars.

After, `liveHalf` is computed only from resting liquidity levels:

```ts
liquiditySpans = all.map((level) => Math.abs(level.probability - mid));
liveHalf = Math.max(0.006, ...liquiditySpans) * 1.16;
```

The preview range is rendered inside that stable axis. Its raw endpoints are
converted to percentages, then the visible box is clipped to the plot edges. If a
range extends beyond the visible axis, the clipped edge is dashed; if the whole
range is off one side, a minimum-width edge marker is kept at the plot boundary.

## Top-edge size drag

`DepthBars` now accepts `onDragSize(shares: number)`. For range previews, the
box fills from the bottom and exposes `.dbx-range-top-handle`. Dragging that top
edge maps vertical position to shares and calls `onDragSize`.

The size scale is:

```ts
rangeSizeMax = Math.max(500, maxRestingLevelSize * 2);
```

So a full-height range box is at least 500 shares, or twice the largest visible
resting level when the book is deeper. Dragging to the bottom clamps at 1 share.

The callback is wired through `PredictionWorkspace` into `MarketTicket` as
`draggedRangeSize`; `MarketTicket` applies it with:

```ts
setAmountStr(formatNumberInput(shares, Math.min(4, baseDec)));
```

The existing lo/hi/move horizontal drags still update the shared `band` state.

## Verification

- Build: `cd ui && CI=true npx vite build` passed. Vite emitted only the existing
  large chunk warning.
- Publish: `~/clawd/scripts/repo-box-publish.sh static ui/dist frontier-pm`
  passed and published `ui/dist`.
- Live DOM: verified against
  `https://frontier-pm.repo.box/?depthUxVerify=1782357489746`.

Live check details:

- Created a wide valid buy range preview: `lo=1`, `hi=49`, `amount=100`.
- Resting bars before preview: 12.
- Resting bars after preview: 12.
- Max `.dbx-bar2` inline `left` delta before vs after preview: `0`.
- Sample first bar before and after:
  - before: `49.9c - 975 sh`, `left: 41.7388%`
  - after: `49.9c - 975 sh`, `left: 41.7388%`
- Top handle existed: `.dbx-range-top-handle.dbx-box-edge.t`.
- Simulated a vertical drag on the top handle; amount input changed from `100`
  to `3219.1579`.
