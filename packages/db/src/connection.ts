import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

let _db: Database | null = null;

function findDbPath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH;

  // Walk up from cwd to find padel.db
  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    const candidate = resolve(dir, "padel.db");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }

  // Fallback: relative to this file
  return new URL("../../../padel.db", import.meta.url).pathname;
}

export function getDb(): Database {
  if (_db) return _db;
  _db = new Database(findDbPath(), { readonly: true });
  return _db;
}
