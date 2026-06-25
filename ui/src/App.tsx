import { useEffect, useState } from "react";
import { loadConfig, type DeploymentConfig } from "./lib/config";
import { startPresenceHeartbeat } from "./lib/heartbeat";
import { AppProvider, useApp } from "./state/app";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { Toasts } from "./components/Toasts";
import { Brand } from "./components/Brand";
import { PredictionWorkspace } from "./components/PredictionWorkspace";

type ConfigState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; cfg: DeploymentConfig };

export default function App() {
  const [state, setState] = useState<ConfigState>({ phase: "loading" });

  useEffect(() => startPresenceHeartbeat(), []);

  useEffect(() => {
    let cancelled = false;
    const attempt = (retries: number) => {
      loadConfig()
        .then((cfg) => {
          if (!cancelled) setState({ phase: "ready", cfg });
        })
        .catch((e) => {
          if (cancelled) return;
          if (retries > 0) {
            setTimeout(() => attempt(retries - 1), 2000);
          } else {
            setState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
          }
        });
    };
    attempt(2);
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.phase === "loading") {
    return (
      <div className="boot">
        <div className="boot-brand">
          <Brand markSize={30} />
        </div>
        <div className="dim">loading deployment config…</div>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="boot">
        <div className="boot-brand">
          <Brand markSize={30} />
        </div>
        <div className="note warn boot-note">
          Could not load <span className="num">deployment.json</span>: {state.message}
        </div>
      </div>
    );
  }

  return (
    <AppProvider cfg={state.cfg}>
      <Shell />
    </AppProvider>
  );
}

function Shell() {
  const { cfg, configured, rpcError } = useApp();

  return (
    <div className="app">
      <Header />
      {rpcError && configured && (
        <div className="banner banner-bad">
          RPC unreachable — retrying… <span className="num dim">{rpcError}</span>
        </div>
      )}
      {!configured ? (
        <main className="awaiting">
          <div className="awaiting-card panel">
            <div className="awaiting-title">Awaiting deployment config</div>
            <p className="dim">
              This frontend is live, but <span className="num">deployment.json</span> still
              contains placeholder (zero) contract addresses for{" "}
              <span className="num">{cfg.name}</span> (chain{" "}
              <span className="num">#{cfg.chainId}</span>).
            </p>
            <p className="dim">
              Drop the real deployment manifest next to <span className="num">index.html</span>{" "}
              and reload.
            </p>
          </div>
        </main>
      ) : (
        <PredictionWorkspace />
      )}
      <Footer />
      <Toasts />
    </div>
  );
}
