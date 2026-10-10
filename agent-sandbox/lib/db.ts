import { Pool } from "pg";

export const DEFAULT_DATABASE_URL = "postgres://sandbox:sandbox@localhost:5433/sandbox";

// Reuse one pool across Next.js dev hot reloads.
const globalForPool = globalThis as unknown as { pool?: Pool };

export const pool =
  globalForPool.pool ??
  new Pool({ connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, max: 10 });

if (process.env.NODE_ENV !== "production") globalForPool.pool = pool;

export async function logEvent(agent: string, action: string, detail = "") {
  await pool.query("INSERT INTO events (agent, action, detail) VALUES ($1, $2, $3)", [agent, action, detail]);
}
