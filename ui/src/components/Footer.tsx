import { VenueStatus } from "./VenueStatus";
import { useApp } from "../state/app";

export function Footer() {
  const { marketMode } = useApp();
  const copy =
    marketMode === "prediction"
      ? "Frontier — outcome market · YES/NO settlement · devnet"
      : "Frontier — ETH/USDC spot CLOB · maker ladders · devnet";

  return (
    <footer className="ftr">
      <span className="ftr-meta">{copy}</span>
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
