import { useEffect, useRef, useState } from "react";
import { predictionPriceToProbability } from "../lib/format";

/**
 * P6 — probability pill / meter.
 *
 * In prediction mode the book price IS the implied probability of YES
 * (USDC per YES share, where $1 settles to the winning side). We render it
 * as a Polymarket-style pill with a YES/NO split meter and a directional
 * flash on change.
 */
export function ProbabilityPill({
  price,
  size = "md",
}: {
  price: number | null;
  size?: "sm" | "md" | "lg";
}) {
  const prob = price === null ? null : Math.max(0, Math.min(1, predictionPriceToProbability(price)));
  const pct = prob === null ? null : prob * 100;

  const prev = useRef<number | null>(null);
  const [flash, setFlash] = useState<{ dir: "up" | "down"; key: number } | null>(null);
  useEffect(() => {
    if (pct !== null && prev.current !== null && Math.abs(pct - prev.current) > 0.05) {
      setFlash({ dir: pct > prev.current ? "up" : "down", key: Date.now() });
    }
    if (pct !== null) prev.current = pct;
  }, [pct]);

  if (pct === null) {
    return <span className={`prob-pill prob-${size}`}>YES —</span>;
  }

  return (
    <span className={`prob-pill prob-${size} ${flash ? `prob-flash-${flash.dir}` : ""}`} key={flash?.key ?? "p"}>
      <span className="prob-meter" aria-hidden="true">
        <span className="prob-meter-yes" style={{ width: `${pct}%` }} />
      </span>
      <span className="prob-label num">
        <span className="prob-yes">YES {pct.toFixed(0)}%</span>
        <span className="prob-no dim">NO {(100 - pct).toFixed(0)}%</span>
      </span>
    </span>
  );
}
