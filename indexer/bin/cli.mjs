#!/usr/bin/env node
// Thin launcher so `npx frontier-indexer [serve|index]` works after build.
// In dev, prefer `pnpm dev` / `pnpm index` (tsx). This runs the compiled dist.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cmd = process.argv[2] ?? "serve";
const target =
  cmd === "index"
    ? resolve(here, "../dist/indexer/run.js")
    : resolve(here, "../dist/server.js");

const r = spawnSync(process.execPath, [target, ...process.argv.slice(3)], { stdio: "inherit" });
process.exit(r.status ?? 0);
