// ----------------------------------------------------------------------------
// Indexer client (loop 2)
//
// Frontier reads its live state straight from the chain via the lens (summary,
// depth, quotes) and event logs (fills, maker activity). That is fully correct
// but expensive for AGGREGATES: 24h volume, cumulative liquidity, unique
// holders, and long-horizon probability history all want a server that has
// already folded the log stream.
//
// This module is that server's client. It is intentionally OPTIONAL: the UI is
// designed to run with no indexer at all. Every call:
//   - resolves to `null` (not a throw) when the indexer is absent/unreachable,
//   - is short-timeout + AbortController guarded so a dead endpoint never
//     stalls the polling loops,
//   - is shape-validated before it reaches a component.
//
// Resolution order for the base URL:
//   1. `deployment.json` -> `indexer.url`
//   2. `window.__FRONTIER_INDEXER__` (injected at deploy time)
//   3. Vite env `VITE_INDEXER_URL`
// When none is set, `indexerEnabled()` is false and the hooks below never fire,
// so components transparently fall back to on-chain reads + catalog seeds.
// ----------------------------------------------------------------------------

import type { DeploymentConfig } from "./config";

export interface MarketStats {
  /** Cumulative notional traded, quote units. */
  volume: number;
  /** Trailing-24h notional traded, quote units. */
  volume24h: number;
  /** Resting + claimable liquidity, quote units. */
  liquidity: number;
  /** Unique addresses currently holding a position / share. */
  holders: number;
  /** Trades in the trailing 24h. */
  trades24h: number;
}

export interface ProbabilityPoint {
  /** Unix ms. */
  t: number;
  /** Implied YES probability, 0..1. */
  p: number;
}

export interface IndexerStatus {
  ok: boolean;
  /** Block height the indexer has folded up to (lag vs chain head = staleness). */
  head: bigint | null;
  /** Round-trip latency of the health probe, ms. */
  latencyMs: number | null;
}

declare global {
  interface Window {
    __FRONTIER_INDEXER__?: string;
  }
}

function trimSlash(u: string): string {
  return u.replace(/\/+$/, "");
}

/** Resolve the indexer base URL, or null when no indexer is configured. */
export function indexerBaseUrl(cfg: DeploymentConfig): string | null {
  const fromCfg = cfg.indexer?.url;
  const fromWindow = typeof window !== "undefined" ? window.__FRONTIER_INDEXER__ : undefined;
  const fromEnv =
    typeof import.meta !== "undefined"
      ? (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_INDEXER_URL
      : undefined;
  const url = fromCfg || fromWindow || fromEnv;
  if (!url || typeof url !== "string") return null;
  const t = trimSlash(url.trim());
  return /^https?:\/\//.test(t) ? t : null;
}

export function indexerEnabled(cfg: DeploymentConfig): boolean {
  return indexerBaseUrl(cfg) !== null;
}

async function getJson<T>(url: string, timeoutMs = 4000): Promise<{ data: T; latencyMs: number } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = performance.now();
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as T;
    return { data, latencyMs: Math.round(performance.now() - started) };
  } catch {
    return null; // unreachable / aborted / bad JSON — caller falls back
  } finally {
    clearTimeout(timer);
  }
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Probe the indexer's health + folded head. Cheap; used for the status pill. */
export async function fetchIndexerStatus(cfg: DeploymentConfig): Promise<IndexerStatus | null> {
  const base = indexerBaseUrl(cfg);
  if (!base) return null;
  const r = await getJson<{ head?: number | string }>(`${base}/health`, 2500);
  if (!r) return { ok: false, head: null, latencyMs: null };
  let head: bigint | null = null;
  try {
    if (r.data.head !== undefined) head = BigInt(r.data.head);
  } catch {
    head = null;
  }
  return { ok: true, head, latencyMs: r.latencyMs };
}

/** Aggregate stats for one market. Null when indexer absent/unreachable. */
export async function fetchMarketStats(
  cfg: DeploymentConfig,
  marketId: string,
): Promise<MarketStats | null> {
  const base = indexerBaseUrl(cfg);
  if (!base) return null;
  const r = await getJson<Partial<MarketStats>>(
    `${base}/markets/${encodeURIComponent(marketId)}/stats`,
  );
  if (!r) return null;
  const d = r.data;
  return {
    volume: num(d.volume),
    volume24h: num(d.volume24h),
    liquidity: num(d.liquidity),
    holders: num(d.holders),
    trades24h: num(d.trades24h),
  };
}

/**
 * Long-horizon implied-probability history for the probability-over-time chart.
 * Null when indexer absent; components fall back to the in-session price line.
 */
export async function fetchProbabilityHistory(
  cfg: DeploymentConfig,
  marketId: string,
  rangeHours = 168,
): Promise<ProbabilityPoint[] | null> {
  const base = indexerBaseUrl(cfg);
  if (!base) return null;
  const r = await getJson<{ points?: { t?: number; p?: number }[] }>(
    `${base}/markets/${encodeURIComponent(marketId)}/probability?hours=${rangeHours}`,
  );
  if (!r || !Array.isArray(r.data.points)) return null;
  const pts = r.data.points
    .map((x) => ({ t: num(x?.t), p: Math.max(0, Math.min(1, num(x?.p))) }))
    .filter((x) => x.t > 0);
  return pts.length > 0 ? pts : null;
}
