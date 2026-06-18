import { useEffect, useState } from "react";
import { useApp } from "../state/app";

/**
 * MM (loop 2) — venue health indicator.
 *
 * Surfaces the two numbers a market-maker watches between quotes:
 *   - RPC latency: how long an eth_blockNumber round-trip takes. Color steps
 *     at 150 / 400 ms.
 *   - Block cadence + age: the smoothed inter-block interval and how long since
 *     the head last advanced. A stale head (age > ~3 block times) means quotes
 *     aren't finalising — flagged amber/red.
 * Also shows indexer freshness when an indexer is configured (its folded head
 * vs. chain head = staleness in blocks).
 *
 * Everything is derived from `chainStatus` / `indexerStatus` in app state; this
 * component is pure presentation and re-renders on the 2s status poll.
 */
function latencyCls(ms: number | null): string {
  if (ms === null) return "vs-bad";
  if (ms <= 150) return "vs-good";
  if (ms <= 400) return "vs-warn";
  return "vs-bad";
}

export function VenueStatus() {
  const { chainStatus, indexerStatus, configured } = useApp();
  // a 1s ticker so "block age" counts up smoothly between status polls
  const [, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!configured) return null;

  const { latencyMs, head, blockTimeMs, lastBlockAt } = chainStatus;
  const ageMs = lastBlockAt !== null ? Date.now() - lastBlockAt : null;
  const blockS = blockTimeMs !== null ? blockTimeMs / 1000 : null;
  // stale if the head hasn't moved in > 3 expected block intervals (min 6s)
  const staleThresh = blockTimeMs !== null ? Math.max(6000, blockTimeMs * 3) : 12000;
  const stale = ageMs !== null && ageMs > staleThresh;
  const headStr = head !== null ? head.toLocaleString("en-US") : "—";

  const idxLag =
    indexerStatus?.ok && indexerStatus.head !== null && head !== null
      ? head - indexerStatus.head
      : null;

  return (
    <span className="venue-status num" title="Live venue health — RPC latency, block cadence, finality">
      <span className={`vs-item ${latencyCls(latencyMs)}`} title="RPC round-trip latency">
        <i className="vs-dot" />
        {latencyMs !== null ? `${latencyMs}ms` : "rpc?"}
      </span>
      <span className="vs-sep" />
      <span className={`vs-item ${stale ? "vs-warn" : "vs-good"}`} title="Inter-block interval (finality cadence)">
        {blockS !== null ? `${blockS.toFixed(blockS < 10 ? 1 : 0)}s/blk` : "—/blk"}
      </span>
      <span className="vs-sep" />
      <span className={`vs-item ${stale ? "vs-bad" : ""}`} title="Latest block · time since it advanced">
        #{headStr}
        {ageMs !== null && (
          <span className="vs-age dim"> · {ageMs < 1000 ? "<1s" : `${Math.floor(ageMs / 1000)}s`}</span>
        )}
      </span>
      {indexerStatus !== null && (
        <>
          <span className="vs-sep" />
          <span
            className={`vs-item ${!indexerStatus.ok ? "vs-bad" : idxLag !== null && idxLag > 25n ? "vs-warn" : "vs-good"}`}
            title="Indexer status: reachability + blocks behind chain head"
          >
            idx{" "}
            {!indexerStatus.ok
              ? "down"
              : idxLag !== null
                ? idxLag <= 1n
                  ? "live"
                  : `−${idxLag.toString()}`
                : "ok"}
          </span>
        </>
      )}
    </span>
  );
}
