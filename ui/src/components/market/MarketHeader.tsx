import { useState } from "react";
import { useApp } from "../../state/app";
import { marketCategory, marketQuestion } from "../../lib/config";
import { fmtUsd } from "../../lib/format";
import { formatUnits } from "viem";
import { quoteDecimals } from "../../lib/config";

export function MarketHeader() {
  const { cfg, fills, summary } = useApp();
  const quoteDec = quoteDecimals(cfg);
  const [saved, setSaved] = useState(false);
  const question = marketQuestion(cfg);
  const category = marketCategory(cfg);
  const volume = fills.reduce((acc, f) => acc + Number(formatUnits(f.value1, quoteDec)), 0);
  const live = summary !== null;

  const pills = [
    { label: live ? "● Live" : "○ Connecting", cls: live ? "live" : "" },
    { label: cfg.darkbox?.network ? cfg.darkbox.network.replace(/-/g, " ") : `chain #${cfg.chainId}`, cls: "" },
    { label: "Binary · YES / NO", cls: "" },
    { label: "Resolves Dec 31, 2026", cls: "" },
  ];

  return (
    <header className="dbx-mh panel">
      <div className="dbx-mh-row">
        <div className="dbx-thumb" aria-hidden="true">
          <svg viewBox="0 0 48 48" width="48" height="48">
            <defs>
              <linearGradient id="dbxThumb" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#1a2030" />
                <stop offset="100%" stopColor="#0c1018" />
              </linearGradient>
            </defs>
            <rect width="48" height="48" rx="12" fill="url(#dbxThumb)" />
            <path d="M24 9 38 16.5V31.5L24 39 10 31.5V16.5Z" fill="none" stroke="var(--db-accent)" strokeWidth="2" strokeLinejoin="round" />
            <path d="M24 9 24 24 38 16.5M24 24 10 16.5M24 24 24 39" stroke="var(--db-accent)" strokeWidth="1.2" opacity="0.55" />
          </svg>
        </div>
        <div className="dbx-mh-text">
          <div className="dbx-breadcrumb">
            <span className="dbx-crumb-accent">{category}</span>
            <span className="dim"> · {fmtUsd(volume)} Vol.</span>
          </div>
          <h1 className="dbx-question">{question}</h1>
        </div>
        <div className="dbx-mh-actions">
          <button title="Embed" className="dbx-icon-btn">{"</>"}</button>
          <button title="Copy link" className="dbx-icon-btn" onClick={() => navigator.clipboard?.writeText(location.href)}>
            ⌘
          </button>
          <button
            title="Watch"
            className={`dbx-icon-btn ${saved ? "on" : ""}`}
            onClick={() => setSaved((s) => !s)}
          >
            {saved ? "★" : "☆"}
          </button>
        </div>
      </div>
      <div className="dbx-pills">
        {pills.map((p) => (
          <span key={p.label} className={`dbx-pill ${p.cls}`}>
            {p.label}
          </span>
        ))}
      </div>
    </header>
  );
}
