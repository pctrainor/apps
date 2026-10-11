// Long-term memory for traders. It lives in Postgres and survives restarts and `--reset` (only `--forget`
// clears it). Three kinds:
//   note        a short thing a trader chose to remember during a turn
//   lesson      a rule of thumb distilled during reflection
//   reflection  the trader's consolidated memory, rewritten every few turns from the notes since the last one

import type pg from "pg";

export type MemoryView = {
  reflection: string | null;
  reflectedAt: Date | null;
  lessons: string[];
  notes: string[];
  turnsSinceReflection: number;
};

const NOTE_LIMIT = 8; // newest notes shown each turn
const LESSON_LIMIT = 6;
const KEEP_NOTES = 60; // older notes are deleted after a reflection
const KEEP_LESSONS = 20;

export async function loadMemory(pool: pg.Pool, trader: string): Promise<MemoryView> {
  const { rows: refl } = await pool.query<{ body: string; created_at: Date }>(
    "SELECT body, created_at FROM trader_memories WHERE trader = $1 AND kind = 'reflection' ORDER BY id DESC LIMIT 1",
    [trader],
  );
  const since = refl[0]?.created_at ?? new Date(0);
  const [{ rows: lessons }, { rows: notes }, { rows: turns }] = await Promise.all([
    pool.query<{ body: string }>(
      "SELECT body FROM trader_memories WHERE trader = $1 AND kind = 'lesson' ORDER BY id DESC LIMIT $2",
      [trader, LESSON_LIMIT],
    ),
    pool.query<{ body: string }>(
      "SELECT body FROM trader_memories WHERE trader = $1 AND kind = 'note' AND created_at > $2 ORDER BY id DESC LIMIT $3",
      [trader, since, NOTE_LIMIT],
    ),
    pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM floor_messages WHERE trader = $1 AND kind = 'chat' AND created_at > $2",
      [trader, since],
    ),
  ]);
  return {
    reflection: refl[0]?.body ?? null,
    reflectedAt: refl[0]?.created_at ?? null,
    lessons: lessons.map((r) => r.body),
    notes: notes.map((r) => r.body).reverse(),
    turnsSinceReflection: turns[0].n,
  };
}

/** Saves a memory. Returns false when it's too short or the trader already has the same note or lesson. */
export async function remember(
  pool: pg.Pool,
  trader: string,
  body: string,
  kind: "note" | "lesson" | "reflection" = "note",
): Promise<boolean> {
  const text = body.trim().slice(0, kind === "reflection" ? 1200 : 300);
  if (text.length < 3) return false;
  if (kind !== "reflection") {
    const { rowCount } = await pool.query(
      "SELECT 1 FROM trader_memories WHERE trader = $1 AND kind = $2 AND lower(body) = lower($3) LIMIT 1",
      [trader, kind, text],
    );
    if (rowCount) return false;
  }
  await pool.query("INSERT INTO trader_memories (trader, kind, body) VALUES ($1, $2, $3)", [trader, kind, text]);
  return true;
}

export async function prune(pool: pg.Pool, trader: string) {
  for (const [kind, keep] of [["note", KEEP_NOTES], ["lesson", KEEP_LESSONS]] as const) {
    await pool.query(
      `DELETE FROM trader_memories WHERE trader = $1 AND kind = $2 AND id NOT IN (
         SELECT id FROM trader_memories WHERE trader = $1 AND kind = $2 ORDER BY id DESC LIMIT $3)`,
      [trader, kind, keep],
    );
  }
}

/** The memory section of a trader's prompt. */
export function memoryText(m: MemoryView): string {
  const lines: string[] = [];
  lines.push(m.reflection ? `Long-term memory: ${m.reflection}` : "Long-term memory: empty so far. This is your first session.");
  if (m.lessons.length) lines.push("Lessons you learned:", ...m.lessons.map((l) => `- ${l}`));
  if (m.notes.length) lines.push("Recent notes to yourself:", ...m.notes.map((n) => `- ${n}`));
  return lines.join("\n");
}
