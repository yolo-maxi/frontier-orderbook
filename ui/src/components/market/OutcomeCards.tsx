import { fmtCents, fmtPct, type Outcome, type PredictionBook } from "../../lib/prediction";

export function OutcomeCards({
  outcome,
  onOutcome,
  yes,
  no,
}: {
  outcome: Outcome;
  onOutcome: (o: Outcome) => void;
  yes: PredictionBook;
  no: PredictionBook;
}) {
  return (
    <div className="dbx-outcomes">
      <OutcomeCard book={yes} active={outcome === "YES"} onSelect={() => onOutcome("YES")} />
      <OutcomeCard book={no} active={outcome === "NO"} onSelect={() => onOutcome("NO")} />
    </div>
  );
}

function OutcomeCard({ book, active, onSelect }: { book: PredictionBook; active: boolean; onSelect: () => void }) {
  const tone = book.outcome === "YES" ? "yes" : "no";
  return (
    <button className={`dbx-outcome-card ${tone} ${active ? "on" : ""}`} onClick={onSelect}>
      <div className="dbx-outcome-l">
        <span className="dbx-outcome-name">{book.outcome}</span>
        <span className="dbx-outcome-pct num">{fmtPct(book.prob)}</span>
      </div>
      <div className="dbx-outcome-r num">
        <span className="dbx-outcome-price">{fmtCents(book.bestAsk ?? book.prob)}</span>
        <span className="dbx-outcome-sub dim">{book.source === "synthetic" ? "complement" : "best ask"}</span>
      </div>
    </button>
  );
}
