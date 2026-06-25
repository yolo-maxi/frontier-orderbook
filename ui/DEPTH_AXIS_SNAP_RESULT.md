# Depth Axis Snap Result

## Changes

- Carried the real book `tickSpacing` from `BookSummary` / `deployment.json` into
  `PredictionBook`.
- `MarketTicket` now aligns limit order ticks with the selected book spacing and
  previews/escrows the snapped tick price.
- Range order lo/hi ticks now align to the selected book spacing: lo rounds down,
  hi rounds up, and per-level liquidity divides by tick-spacing levels.
- Range drag edges in `DepthBars` now snap pointer prices to the tick grid and
  write four-decimal cent values so they round-trip back to the same tick.
- `DepthBars` freezes the first real price axis per outcome. Polling updates can
  change bar heights and live median, but axis labels remain fixed until the
  `Recenter` button is clicked.
- Drift detection shows `Recenter` when the live mid/range no longer fits the
  frozen axis comfortably. Clicking it recomputes and refreezes the axis.

## Build And Publish

- Build: `cd ui && CI=true npx vite build` passed.
- Publish: `~/clawd/scripts/repo-box-publish.sh static ui/dist frontier-pm`
  passed.
- Published asset checked on live DOM:
  `https://frontier-pm.repo.box/assets/index-Dvf7zfdY.js`.

Vite emitted only the existing large chunk warning.

## Live DOM Verification

Live URL:
`https://frontier-pm.repo.box/?depthAxisSnapLive=1782422049366`

Before sampling, posted:

```sh
curl -X POST -H 'Origin: https://frontier-pm.repo.box' https://frontier-bots.repo.box/heartbeat
```

Heartbeat response was active:
`{"active":true,"lastSeen":"2026-06-25T21:14:09.650Z","lastSeenSecsAgo":0,"activeWindowSecs":60}`

Axis freeze across polling:

- First snapshot: axis `48¢ / 50¢ / 52¢`, median `50%`, bars `12`.
- After 30 seconds: axis `48¢ / 50¢ / 52¢`, median `51%`, bars `12`.
- Result: axis labels were identical while live data changed.

Drift refresh button:

- After the same 30-second poll window, `.dbx-depth-refresh` appeared with text
  `Recenter`.
- Clicking it changed the frozen axis to `48¢ / 51¢ / 54¢` and the button cleared.

Range drag snap:

- Before drag, range inputs were `47 / 50`.
- After dragging the right edge on the live depth box, inputs were
  `46.9559 / 51.0703`.
- Converting back to geometric ticks:
  - `46.9559¢ -> tick -7560`, `-7560 % 60 = 0`.
  - `51.0703¢ -> tick -6720`, `-6720 % 60 = 0`.

No contracts or bots files were edited.
