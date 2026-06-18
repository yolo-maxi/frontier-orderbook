import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema.js";

export type DB = Database.Database;

/**
 * Open (or create) the SQLite database and ensure the schema exists.
 * Pass ":memory:" for an ephemeral DB (used by tests).
 */
export function openDb(path: string): DB {
  const db = new Database(path);
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA_SQL);
  return db;
}

export function getCursor(db: DB, scope: string): number {
  const row = db.prepare("SELECT last_block FROM cursors WHERE scope = ?").get(scope) as
    | { last_block: number }
    | undefined;
  return row?.last_block ?? 0;
}

export function setCursor(db: DB, scope: string, block: number): void {
  db.prepare(
    `INSERT INTO cursors (scope, last_block) VALUES (?, ?)
     ON CONFLICT(scope) DO UPDATE SET last_block = excluded.last_block`,
  ).run(scope, block);
}
