import { useEffect, useRef } from "react";
import { FrontierMark } from "./Brand";
import "./landing.css";

/**
 * Frontier landing page — the narrative comes first, the live terminal after.
 * Self-contained: the hero animation is synthetic (no chain dependency), so the
 * page is alive and on-brand even when the demo book is offline.
 */
export function Landing({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="lp">
      <LpNav onEnter={onEnter} />
      <Hero onEnter={onEnter} />
      <Ticker />
      <Thesis />
      <Mechanism />
      <Ideas />
      <Audience />
      <Receipts />
      <FinalCta onEnter={onEnter} />
      <LpFooter />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── nav ── */

function LpNav({ onEnter }: { onEnter: () => void }) {
  return (
    <header className="lp-nav">
      <a className="lp-brand" href="#home">
        <FrontierMark size={26} />
        <span className="lp-brand-word">FRONTIER</span>
        <span className="lp-brand-tag">CLOB</span>
      </a>
      <nav className="lp-nav-links">
        <a href="#mechanism">Mechanism</a>
        <a href="#ideas">The ideas</a>
        <a href="#makers">Makers</a>
        <a href="#receipts">Receipts</a>
      </nav>
      <button className="lp-enter" onClick={onEnter}>
        Enter terminal <span className="lp-enter-arrow">→</span>
      </button>
    </header>
  );
}

/* ────────────────────────────────────────────────────────── hero ── */

function Hero({ onEnter }: { onEnter: () => void }) {
  return (
    <section className="lp-hero" id="home">
      <FrontierViz />
      <div className="lp-hero-inner">
        <div className="lp-eyebrow">
          <span className="lp-eyebrow-dot" />
          ON-CHAIN CENTRAL LIMIT ORDER BOOK
        </div>
        <h1 className="lp-h1">
          The order book is
          <br />
          back onchain<span className="lp-cursor">_</span>
        </h1>
        <p className="lp-sub">
          A full central limit order book that lives on the chain. Prices step in
          tenths of a cent. Whole ladders go down in one transaction. Fills wait
          for you, onchain, until you claim them. No operator — nothing to trust
          but the chain.
        </p>
        <div className="lp-cta-row">
          <button className="lp-cta lp-cta-primary" onClick={onEnter}>
            Enter the live terminal <span className="lp-enter-arrow">→</span>
          </button>
          <a className="lp-cta lp-cta-ghost" href="#mechanism">
            How it works
          </a>
        </div>
        <div className="lp-hero-meta">
          <span>
            <b className="up">131–1,335×</b> cheaper sweeps
          </span>
          <span className="lp-dot-sep" />
          <span>
            <b>$0.001</b> tick grid
          </span>
          <span className="lp-dot-sep" />
          <span>
            <b>135</b> tests · Base fork-proven
          </span>
        </div>
      </div>
    </section>
  );
}

/** Synthetic frontier terrain: a stepped price walk with a glowing live edge
 *  and a breathing bid/ask ladder. Pure decoration, deterministic-feeling. */
function FrontierViz() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let W = 0;
    let H = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = canvas.getBoundingClientRect();
      W = r.width;
      H = r.height;
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    // price-walk buffer (normalized roughly to [-1, 1])
    const N = 200;
    const buf = new Array<number>(N).fill(0);
    let p = 0;
    let vel = 0;
    let target = 0;
    let tNext = 0;
    let lastDir = 1;

    const GREEN = "46, 189, 133";
    const RED = "246, 70, 93";
    const GOLD = "240, 185, 11";

    const advance = (now: number) => {
      // pick a new meander target periodically
      if (now > tNext) {
        target = (Math.random() * 2 - 1) * 0.82;
        tNext = now + 900 + Math.random() * 2200;
      }
      const prev = p;
      // critically-damped-ish pull toward target + a little jitter
      vel += (target - p) * 0.004;
      vel *= 0.9;
      p += vel + (Math.random() - 0.5) * 0.012;
      if (p > 1) p = 1;
      if (p < -1) p = -1;
      if (Math.abs(p - prev) > 1e-4) lastDir = p >= prev ? 1 : -1;
      buf.push(p);
      buf.shift();
    };

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      if (W < 2 || H < 2) return;

      const padR = Math.min(150, W * 0.22); // ladder gutter on the right
      const plotW = W - padR;
      const midY = H * 0.52;
      const amp = H * 0.3;
      const yOf = (v: number) => midY - v * amp;
      const xOf = (i: number) => (i / (N - 1)) * plotW;

      // faint tick gridlines
      ctx.lineWidth = 1;
      for (let g = -3; g <= 3; g++) {
        const y = midY - (g / 3) * amp;
        ctx.strokeStyle = "rgba(255,255,255,0.035)";
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      // area fill under the staircase
      const edgeColor = lastDir >= 0 ? GREEN : RED;
      const grad = ctx.createLinearGradient(0, midY - amp, 0, H);
      grad.addColorStop(0, `rgba(${edgeColor}, 0.16)`);
      grad.addColorStop(1, `rgba(${edgeColor}, 0)`);
      ctx.beginPath();
      ctx.moveTo(0, H);
      ctx.lineTo(0, yOf(buf[0]));
      for (let i = 1; i < N; i++) {
        // staircase: horizontal then vertical — echoes the frontier glyph
        ctx.lineTo(xOf(i), yOf(buf[i - 1]));
        ctx.lineTo(xOf(i), yOf(buf[i]));
      }
      ctx.lineTo(plotW, H);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // the staircase line
      ctx.beginPath();
      ctx.moveTo(0, yOf(buf[0]));
      for (let i = 1; i < N; i++) {
        ctx.lineTo(xOf(i), yOf(buf[i - 1]));
        ctx.lineTo(xOf(i), yOf(buf[i]));
      }
      ctx.strokeStyle = `rgba(${edgeColor}, 0.85)`;
      ctx.lineWidth = 1.6;
      ctx.shadowColor = `rgba(${edgeColor}, 0.5)`;
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // breathing bid/ask ladder in the right gutter, around the live price
      const cur = buf[N - 1];
      const curY = yOf(cur);
      const rungs = 9;
      const step = (amp * 1.7) / rungs;
      const t = performance.now() / 1000;
      for (let k = -rungs; k <= rungs; k++) {
        if (k === 0) continue;
        const y = curY - k * step;
        if (y < 6 || y > H - 6) continue;
        const isAsk = k > 0;
        const breathe = 0.45 + 0.55 * Math.abs(Math.sin(t * 1.1 + k * 0.6));
        const len = (padR - 14) * breathe * (1 - Math.min(0.6, Math.abs(k) / (rungs + 4)));
        ctx.fillStyle = `rgba(${isAsk ? RED : GREEN}, ${0.16 + 0.12 * breathe})`;
        ctx.fillRect(plotW + 8, y - 2, len, 3);
      }

      // the live frontier edge: dashed guide + glowing gold node + label
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = `rgba(${GOLD}, 0.45)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, curY);
      ctx.lineTo(W, curY);
      ctx.stroke();
      ctx.setLineDash([]);

      const pulse = 3.2 + Math.sin(t * 2.4) * 1.1;
      ctx.beginPath();
      ctx.arc(plotW, curY, pulse + 5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${GOLD}, 0.14)`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(plotW, curY, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${GOLD})`;
      ctx.shadowColor = `rgba(${GOLD}, 0.9)`;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;

      // "the frontier" caption near the node
      ctx.font = "600 9px ui-monospace, monospace";
      ctx.fillStyle = `rgba(${GOLD}, 0.85)`;
      ctx.textAlign = "left";
      const labelY = Math.max(14, Math.min(H - 6, curY - 10));
      ctx.fillText("THE FRONTIER", plotW + 8, labelY);
    };

    let raf = 0;
    let prev = 0;
    const loop = (now: number) => {
      if (now - prev > 33) {
        advance(now);
        draw();
        prev = now;
      }
      raf = requestAnimationFrame(loop);
    };

    if (reduce) {
      for (let i = 0; i < 400; i++) advance(i * 33);
      draw();
    } else {
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas className="lp-viz" ref={ref} aria-hidden="true" />;
}

/* ──────────────────────────────────────────────────────── ticker ── */

const TICKER_ITEMS = [
  "5,000-level sweep · 1,335× cheaper",
  "tick grid · $0.001",
  "whole ladder · one transaction",
  "fills · never expire",
  "no operator · settle on the chain",
  "endpoint cost · ~10–13k gas",
  "Base mainnet · fork-proven",
  "makers without custody · delegated keys",
];

function Ticker() {
  const items = [...TICKER_ITEMS, ...TICKER_ITEMS];
  return (
    <div className="lp-ticker" aria-hidden="true">
      <div className="lp-ticker-track">
        {items.map((it, i) => (
          <span className="lp-ticker-item" key={i}>
            {it}
            <span className="lp-ticker-sep">/</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── thesis ── */

function Thesis() {
  return (
    <section className="lp-section lp-thesis">
      <div className="lp-section-label">THE CLAIM</div>
      <p className="lp-thesis-lead">
        Order books lost to AMMs onchain for exactly one reason:{" "}
        <span className="lp-hl">every price level cost gas</span>. A fine-grained
        book was unexecutable — a 5,000-level sweep cost ten blocks of gas. So
        chains got curves, and traders got slippage.
      </p>
      <p className="lp-thesis-lead">
        Frontier ends that trade-off. Settlement compression collapses any run of
        price levels into a single closed-form update, so{" "}
        <span className="lp-hl-gold">tick fineness is free for takers</span>. What
        comes back is everything order books were always better at: real limit
        orders, real price-time priority on a grid, visible depth, and market
        making that doesn't bleed to arbitrage by design.
      </p>
    </section>
  );
}

/* ──────────────────────────────────────────────────── mechanism ── */

function Mechanism() {
  return (
    <section className="lp-section" id="mechanism">
      <div className="lp-section-head">
        <div className="lp-section-label">THE MECHANISM</div>
        <h2 className="lp-h2">Geometric frontier, in three moves</h2>
        <p className="lp-section-intro">
          The book prices on a geometric grid — each tick is a fixed multiplier on
          the last, the same <span className="num">1.0001^tick</span> curve real
          markets use. The frontier is the live edge of that grid: the exact tick
          where the last trade stopped and the next one starts.
        </p>
      </div>
      <div className="lp-steps">
        <Step
          n="01"
          title="Quote the terrain"
          body="A maker places a whole ladder — a contiguous range of limit orders — in one transaction. Flat, or weighted toward the touch. One position, not a hundred orders. Width is free: a 100,000-tick ladder costs within 12 gas of a 1,000-tick one."
        />
        <Step
          n="02"
          title="Sweep the run"
          body="A taker crosses the frontier. Between any two order endpoints the active ladder is a straight line, so the whole run settles with one closed-form sum — not one state write per tick. Cost scales with distinct ranges crossed, not price levels."
        />
        <Step
          n="03"
          title="Roll & claim"
          body="The sweep consumes the edges it crossed and rolls the frontier forward; survivors consolidate into a single edge. Fills sit onchain as proceeds, accruing, claimable whenever — nothing expires, no keeper required."
        />
      </div>
    </section>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="lp-step">
      <div className="lp-step-n">{n}</div>
      <h3 className="lp-step-title">{title}</h3>
      <p className="lp-step-body">{body}</p>
    </div>
  );
}

/* ──────────────────────────────────────────────────────── ideas ── */

const IDEAS = [
  {
    k: "Rolling frontier",
    d: "An order is two ledger deltas. Fills consume the aggregate frontier and roll it forward. Deposits are O(1); swaps never loop over users.",
  },
  {
    k: "Prefix-contiguity",
    d: "A valid order's fills are always a contiguous prefix of its range — so a claim verifies against a single high-water mark, no per-tick bookkeeping.",
  },
  {
    k: "Endpoint telescoping",
    d: "Between order endpoints the ladder is affine. Whole runs settle via a closed-form series, no matter how many thin ticks they span.",
  },
  {
    k: "Delegatable ownership",
    d: "Owner gates consult a permission registry, so a bot can manage your quotes while payouts only ever route to you. Custody never leaves your key.",
  },
];

function Ideas() {
  return (
    <section className="lp-section" id="ideas">
      <div className="lp-section-head">
        <div className="lp-section-label">THE FOUR IDEAS UNDERNEATH</div>
        <h2 className="lp-h2">Why it holds up</h2>
      </div>
      <div className="lp-ideas">
        {IDEAS.map((it, i) => (
          <div className="lp-idea" key={it.k}>
            <div className="lp-idea-num">{String(i + 1).padStart(2, "0")}</div>
            <h3 className="lp-idea-k">{it.k}</h3>
            <p className="lp-idea-d">{it.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────── audience ── */

function Audience() {
  return (
    <section className="lp-section lp-audience" id="makers">
      <div className="lp-aud-col">
        <div className="lp-section-label up">FOR MAKERS</div>
        <h2 className="lp-h2">Quote a curve. Walk away.</h2>
        <ul className="lp-aud-list">
          <li>
            Place your whole spread as one ladder — flat or shaped toward the
            touch — and requote the entire thing in a single call.
          </li>
          <li>
            Hand a bot per-action, expirable grants through the permission
            registry. It moves your quotes; it never touches your coins.
          </li>
          <li>
            Fills accrue onchain as claimable proceeds. Nothing expires, nothing
            needs a keeper — claim a month later if you like.
          </li>
        </ul>
      </div>
      <div className="lp-aud-col">
        <div className="lp-section-label down">FOR ARBERS & TAKERS</div>
        <h2 className="lp-h2">Price it to the wei.</h2>
        <ul className="lp-aud-list">
          <li>
            Every sweep is quoted exactly by the book's closed form before you
            send — minimum received, not slippage guesswork.
          </li>
          <li>
            Deep, fine-grained books mean less to leak across the spread; crossing
            empty distance is nearly free.
          </li>
          <li>
            A market order on an L2 costs less than the dust you'd ignore on the
            floor. Tick fineness adds nothing to your gas.
          </li>
        </ul>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────── receipts ── */

const STATS = [
  { v: "1,335×", l: "cheaper for a 5,000-level sweep vs. the naive book" },
  { v: "$0.001", l: "tick spacing — granularity a CEX would envy" },
  { v: "135", l: "tests passing, incl. 2,000-run differential fuzzing" },
  { v: "~$15", l: "to deploy an entire new market — cheap enough to be ephemeral" },
];

function Receipts() {
  return (
    <section className="lp-section" id="receipts">
      <div className="lp-section-head">
        <div className="lp-section-label">RECEIPTS, NOT ADJECTIVES</div>
        <h2 className="lp-h2">Every number is measured</h2>
        <p className="lp-section-intro">
          All gas figures come from <span className="num">forge test --isolate</span>
          : each operation is its own transaction, and every benchmark asserts its
          outputs so it can't measure a no-op. The mechanism is proven against a
          naive reference oracle and an end-to-end Base mainnet fork.
        </p>
      </div>
      <div className="lp-stats">
        {STATS.map((s) => (
          <div className="lp-stat" key={s.v}>
            <div className="lp-stat-v num">{s.v}</div>
            <div className="lp-stat-l">{s.l}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────── final ── */

function FinalCta({ onEnter }: { onEnter: () => void }) {
  return (
    <section className="lp-final">
      <div className="lp-final-glow" aria-hidden="true" />
      <h2 className="lp-final-h">Trade at the edge.</h2>
      <p className="lp-final-sub">
        The terminal is a real market: bots quote ETH/USDC around the live spot at
        a ±0.1% spread, a flow bot trades against them, and every fill settles
        onchain. A demo wallet is created for you — hit the faucet and go.
      </p>
      <button className="lp-cta lp-cta-primary lp-cta-lg" onClick={onEnter}>
        Enter the live terminal <span className="lp-enter-arrow">→</span>
      </button>
      <p className="lp-final-note">
        Devnet demo · synthetic assets · no real funds at risk
      </p>
    </section>
  );
}

/* ──────────────────────────────────────────────────────── footer ── */

function LpFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-footer-grid">
        <div className="lp-footer-brand">
          <div className="lp-brand">
            <FrontierMark size={24} />
            <span className="lp-brand-word">FRONTIER</span>
          </div>
          <p className="lp-footer-tag">
            A thin-tick on-chain central limit order book with
            endpoint-telescoped settlement.
          </p>
          <p className="lp-footer-created">
            Created by <b>Francesco Renzi</b>
          </p>
        </div>
        <div className="lp-footer-links">
          <div className="lp-footer-col">
            <span className="lp-footer-h">Explore</span>
            <a href="#trade">Live terminal</a>
            <a href="#mechanism">Mechanism</a>
            <a href="#receipts">Receipts</a>
          </div>
          <div className="lp-footer-col">
            <span className="lp-footer-h">Source</span>
            <a
              href="https://github.com/yolo-maxi/frontier-orderbook"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
            <span className="lp-footer-muted">Source-available</span>
          </div>
          <div className="lp-footer-col">
            <span className="lp-footer-h">Contact</span>
            <span className="lp-footer-muted">Francesco Renzi</span>
            {/* TODO(@fran-handle): replace with verified X/Twitter handle */}
            <span className="lp-footer-muted">X: TODO(@fran-handle)</span>
          </div>
        </div>
      </div>
      <div className="lp-footer-cta">
        Interested in deploying Frontier on your chain?{" "}
        <span className="lp-hl-gold">Please reach out.</span>
      </div>
      <div className="lp-footer-base">
        <span>© {new Date().getFullYear()} Francesco Renzi · Source-available, not open-source</span>
        <span className="lp-footer-warn">Research prototype — not for production use</span>
      </div>
    </footer>
  );
}
