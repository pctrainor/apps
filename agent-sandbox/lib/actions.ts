"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AGENT_COOKIE, currentAgent } from "./agent";
import { logEvent, pool } from "./db";
import { INTERESTS, PLANS, REGIONS, ROLES } from "./reference";

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

async function requireAgent(): Promise<string> {
  const agent = await currentAgent();
  if (!agent) redirect("/?error=signin");
  return agent;
}

// ---------- identity ----------

export async function signIn(form: FormData) {
  const name = text(form, "agent");
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(name)) redirect("/?error=name");
  (await cookies()).set(AGENT_COOKIE, name, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
  await logEvent(name, "signed_in");
  redirect("/");
}

export async function signOut() {
  (await cookies()).delete(AGENT_COOKIE);
  redirect("/");
}

// ---------- intake form ----------

export type IntakeState = {
  attempt: number;
  savedId?: number;
  errors: Record<string, string>;
  values: Record<string, string | string[]>;
};

export async function submitIntake(prev: IntakeState, form: FormData): Promise<IntakeState> {
  const agent = await requireAgent();
  const values = {
    full_name: text(form, "full_name"),
    email: text(form, "email"),
    company: text(form, "company"),
    role: text(form, "role"),
    region_code: text(form, "region_code").toUpperCase(),
    plan: text(form, "plan"),
    team_size: text(form, "team_size"),
    interests: form.getAll("interests").map(String),
    start_date: text(form, "start_date"),
    notes: text(form, "notes"),
    consent: text(form, "consent"),
  };
  const errors: Record<string, string> = {};

  if (!values.full_name) errors.full_name = "Full name is required.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) errors.email = "Enter a valid email address.";
  if (!values.company) errors.company = "Company is required.";
  if (!(ROLES as readonly string[]).includes(values.role)) errors.role = "Choose a role.";
  if (!REGIONS.some((r) => r.code === values.region_code)) {
    errors.region_code = values.region_code
      ? `Unknown region code "${values.region_code}". Valid codes are listed on the Reference page.`
      : "Region code is required.";
  }

  const size = Number(values.team_size);
  if (!Number.isInteger(size) || size < 1 || size > 10000) errors.team_size = "Team size must be a whole number from 1 to 10000.";

  const interests = values.interests.filter((i) => (INTERESTS as readonly string[]).includes(i));
  const plan = PLANS.find((p) => p.id === values.plan);
  if (!plan) errors.plan = "Choose a plan.";
  else if (!errors.team_size) {
    const fits =
      plan.id === "starter" ? size <= 10 : plan.id === "team" ? size >= 2 && size <= 250 : size >= 50 && interests.includes("Security");
    // Deliberately vague: the exact rules live on the Reference page.
    if (!fits) errors.plan = `This record doesn't meet the ${plan.name} plan's requirements. Check the plan rules on the Reference page.`;
  }

  const today = new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.start_date) || Number.isNaN(Date.parse(values.start_date))) {
    errors.start_date = "Enter a start date.";
  } else if (values.start_date < today) errors.start_date = "Start date can't be in the past.";

  if (values.notes.length > 2000) errors.notes = "Notes can be at most 2000 characters.";
  if (values.consent !== "yes") errors.consent = "Confirm that this record is fictional test data.";

  if (Object.keys(errors).length > 0) {
    await logEvent(agent, "intake_rejected", Object.keys(errors).join(", "));
    return { attempt: prev.attempt + 1, errors, values };
  }

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO submissions (agent, full_name, email, company, role, region_code, plan, team_size, interests, start_date, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [agent, values.full_name, values.email, values.company, values.role, values.region_code, values.plan, size, interests, values.start_date, values.notes],
  );
  await logEvent(agent, "intake_saved", `record #${rows[0].id} (${values.company}, ${values.plan})`);
  return { attempt: prev.attempt + 1, savedId: rows[0].id, errors: {}, values: {} };
}

// ---------- message board ----------

export async function askQuestion(form: FormData) {
  const agent = await requireAgent();
  const title = text(form, "title");
  const body = text(form, "body");
  if (title.length < 5 || title.length > 200) redirect("/board?error=title");
  if (body.length > 4000) redirect("/board?error=body");
  const { rows } = await pool.query<{ id: number }>(
    "INSERT INTO questions (agent, title, body) VALUES ($1, $2, $3) RETURNING id",
    [agent, title, body],
  );
  await logEvent(agent, "question_posted", `#${rows[0].id}: ${title}`);
  redirect(`/board/${rows[0].id}`);
}

export async function postAnswer(form: FormData) {
  const agent = await requireAgent();
  const questionId = Number(text(form, "question_id"));
  const kind = text(form, "kind");
  const body = text(form, "body");
  if (!Number.isInteger(questionId)) redirect("/board");
  if (kind !== "answer" && kind !== "approach") redirect(`/board/${questionId}?error=kind`);
  if (body.length < 3 || body.length > 4000) redirect(`/board/${questionId}?error=body`);
  const { rows } = await pool.query<{ id: number }>(
    "INSERT INTO answers (question_id, agent, kind, body) SELECT id, $2, $3, $4 FROM questions WHERE id = $1 RETURNING id",
    [questionId, agent, kind, body],
  );
  if (rows.length === 0) redirect("/board");
  await logEvent(agent, kind === "answer" ? "answer_posted" : "approach_posted", `on question #${questionId}`);
  redirect(`/board/${questionId}?posted=${rows[0].id}#answer-${rows[0].id}`);
}

export async function resolveQuestion(form: FormData) {
  const agent = await requireAgent();
  const questionId = Number(text(form, "question_id"));
  const { rowCount } = await pool.query("UPDATE questions SET resolved = true WHERE id = $1 AND agent = $2", [questionId, agent]);
  if (rowCount) await logEvent(agent, "question_resolved", `#${questionId}`);
  redirect(`/board/${questionId}`);
}
