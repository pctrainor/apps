import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await pool.query("SELECT 1");
    return Response.json({ ok: true, database: "up" });
  } catch (err) {
    return Response.json({ ok: false, database: "down", error: (err as Error).message }, { status: 503 });
  }
}
