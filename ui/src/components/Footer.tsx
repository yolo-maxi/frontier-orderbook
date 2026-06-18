import { VenueStatus } from "./VenueStatus";

export function Footer() {
  return (
    <footer className="ftr">
      <span className="ftr-meta">
        Frontier — thin-tick on-chain CLOB · endpoint-telescoped settlement · devnet
      </span>
      <VenueStatus />
      <span className="ftr-links">
        <a href="/docs/">Docs</a>
        <span className="ftr-sep" />
        <a
          href="https://github.com/yolo-maxi/frontier-orderbook"
          target="_blank"
          rel="noreferrer"
        >
          github.com/yolo-maxi/frontier-orderbook
        </a>
      </span>
    </footer>
  );
}
