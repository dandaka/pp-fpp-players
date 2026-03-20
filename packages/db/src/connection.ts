import { Database } from "bun:sqlite";

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  const dbPath = process.env.DB_PATH ?? new URL("../../../padel.db", import.meta.url).pathname;
  _db = new Database(dbPath, { readonly: true });
  return _db;
}
