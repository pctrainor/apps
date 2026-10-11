// npm run db:reset — drop all sandbox tables and recreate them from db/schema.sql.

import { readFileSync } from "node:fs";
import pg from "pg";
import { DEFAULT_DATABASE_URL } from "../lib/db";

try {
  process.loadEnvFile(".env");
} catch {}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL });
await client.connect();
try {
  await client.query("DROP TABLE IF EXISTS answers, questions, submissions, events, traders, holdings, trades, floor_messages, prices, value_history, market_meta CASCADE");
  await client.query(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  console.log("Database reset: all tables are empty.");
} finally {
  await client.end();
}
