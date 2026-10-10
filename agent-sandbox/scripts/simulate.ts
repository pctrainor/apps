// Simulation runner: N browser agents, each driven by a local LLM, use the site like test users.
// They sign in, enter fictional customer records through the intake form, ask on the message board
// when they get stuck, and answer each other's questions.
//
//   npm run simulate -- -n 5 -k 3
//
// Agents act only through the browser (scripts/browser.ts), never through the API or the database.
// The model is any OpenAI-compatible /v1/chat/completions endpoint (default: Ollama on localhost).
// Each run writes runs/<time>/trajectories.jsonl (one line per step) and observations.jsonl (each
// distinct page text once, keyed by hash), which together make a fine-tuning dataset.

import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createAgents, launchBrowser, type Agents } from "./browser";

try {
  process.loadEnvFile(".env");
} catch {}

const { values: opts } = parseArgs({
  options: {
    agents: { type: "string", short: "n", default: "3" },
    records: { type: "string", short: "k", default: "2" },
    steps: { type: "string", short: "s", default: process.env.MAX_STEPS ?? "60" },
    concurrency: { type: "string", short: "c", default: process.env.CONCURRENCY },
    model: { type: "string", short: "m", default: process.env.LLM_MODEL ?? "qwen2.5:7b-instruct" },
    prefix: { type: "string", default: "user" },
    help: { type: "boolean", short: "h" },
  },
});

if (opts.help) {
  console.log(`Usage: npm run simulate -- [-n agents] [-k records each] [-s max steps] [-c concurrency] [-m model] [--prefix user]

Environment (.env):
  SITE_URL       site under test             (default http://localhost:3000)
  LLM_BASE_URL   OpenAI-compatible base URL  (default http://localhost:11434/v1, Ollama)
  LLM_MODEL      model name                  (default qwen2.5:7b-instruct)
  LLM_API_KEY    only if the server wants one
  CONCURRENCY    agents running at once      (default: all of them)
  PAUSE_MS       random pause between actions, "min-max" in ms (default 500-2500)`);
  process.exit(0);
}

const SITE = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const LLM_BASE_URL = (process.env.LLM_BASE_URL ?? "http://localhost:11434/v1").replace(/\/$/, "");
const MODEL = opts.model!;
const AGENT_COUNT = Number(opts.agents);
const RECORDS = Number(opts.records);
const MAX_STEPS = Number(opts.steps);
const CONCURRENCY = Number(opts.concurrency ?? AGENT_COUNT);
const [PAUSE_MIN, PAUSE_MAX] = (process.env.PAUSE_MS ?? "500-2500").split("-").map(Number);
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 180_000);
const HISTORY_LINES = 15;
const MAX_INVALID = 3;

const RUN_DIR = `runs/${new Date().toISOString().replace(/[:.]/g, "-")}`;
const TODAY = new Date().toISOString().slice(0, 10);

// ---------- helpers ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];
const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);
const pathOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
};
const urlOf = (obs: string) => /^URL: (.*)$/m.exec(obs)?.[1] ?? "";

// ---------- personas and customer cards ----------

const ROLES = ["Engineering", "Operations", "Finance", "Sales", "Other"] as const;
const QUIRKS = [
  "is careful and reads the Reference page before guessing",
  "moves fast and tends to submit first and fix errors after",
  "is new to this kind of software and asks for help readily",
  "is an old hand who enjoys answering other people's questions",
  "is skeptical and double-checks every field before saving",
  "is chatty and writes detailed questions and replies",
];

// Some of these deliberately fall in the Reference page's gap (UK, Germany, Mexico).
const COUNTRIES = [
  "United States (New York)", "United States (California)", "Canada (Toronto)", "Brazil", "Mexico",
  "United Kingdom", "Germany", "Sweden", "Italy", "Spain", "Kenya", "Saudi Arabia", "Japan", "Australia",
  "India", "Singapore",
];
const FIRST = ["Ava", "Liam", "Noor", "Mateo", "Yuki", "Priya", "Lars", "Amara", "Diego", "Chloe", "Tomasz", "Wei"];
const LAST = ["Okafor", "Lindqvist", "Ramirez", "Tanaka", "Patel", "Moreau", "Kowalski", "Haddad", "Silva", "Chen"];
const COMPANY_A = ["Blue", "North", "Bright", "Iron", "Silver", "Quiet", "Rapid", "Green", "Lucky", "Prime"];
const COMPANY_B = ["Harbor", "Peak", "Labs", "Works", "Freight", "Bakery", "Analytics", "Systems", "Robotics", "Farms"];
const INTERESTS = ["Analytics", "Automation", "Security", "Integrations"];

type Card = Record<string, string>;

function makeCard(): Card {
  const first = pick(FIRST);
  const last = pick(LAST);
  const company = `${pick(COMPANY_A)} ${pick(COMPANY_B)}`;
  const team = pick([1, 3, 8, 12, 25, 40, 60, 120, 300, 800]);
  // Usually the plan the customer wants fits the rules; sometimes it doesn't, to create questions.
  const fitting = team <= 10 ? "Starter" : team <= 250 ? (team >= 50 && Math.random() < 0.3 ? "Enterprise" : "Team") : "Enterprise";
  const plan = Math.random() < 0.3 ? pick(["Starter", "Team", "Enterprise"]) : fitting;
  const interests = INTERESTS.filter(() => Math.random() < 0.35);
  if (interests.length === 0) interests.push(pick(INTERESTS));
  const start = new Date(Date.now() + rand(3, 90) * 86_400_000).toISOString().slice(0, 10);
  return {
    "Full name": `${first} ${last}`,
    Email: `${first}.${last}@${company.replace(/\s/g, "").toLowerCase()}.example`.toLowerCase(),
    Company: company,
    Role: pick(ROLES),
    "Customer location": pick(COUNTRIES),
    "Team size": String(team),
    "Plan the customer asked for": plan,
    Interests: interests.join(", "),
    "Preferred start": Math.random() < 0.15 ? "as soon as possible" : start,
    Notes: pick(["", "Prefers email contact.", "Referred by a partner.", "Wants a demo first.", ""]),
  };
}

// ---------- model ----------

const SYSTEM = (name: string, role: string, quirk: string) => `You are ${name}, a test user of a website called Agent Sandbox (${SITE}). You work in ${role} and ${quirk}.

You use the site only through a text browser. Each turn you see the current page: its URL, visible text and a numbered list of interactive elements such as:
[7] input:text "Agent name" value=""
The numbers change on every page, so always use numbers from the page you are looking at now.

Your goals, in order:
1. Sign in on the home page with the agent name "${name}" exactly.
2. Use the Intake form to save ${RECORDS} customer records, one per customer card (the current card is shown each turn). Fill in every field, then click "Save record". If the form rejects the record, read the error messages and check the Reference page. If the Reference page doesn't settle it, post a question on the Message board saying exactly what you're stuck on, then carry on with your best guess.
3. After each saved record, open the Message board's Unanswered filter (/board?filter=unanswered). Open other agents' questions and reply. Tick "I know the answer" only if you're sure; otherwise tick "I'll explain how I'd find out" and describe the steps you would take. Don't reply to your own questions.
4. If someone replied helpfully to your question, open it and click "Mark as resolved".
5. When all records are saved and you've checked the board, finish with done.

Reply with ONE JSON object and nothing else, for example:
{"thought": "one short sentence", "action": "click", "n": 5}
Actions:
{"action": "open", "url": "/board?filter=unanswered"}   (paths on this site only)
{"action": "click", "n": 5}
{"action": "type", "n": 3, "text": "Ava Silva"}   (replaces the field's text; dates as YYYY-MM-DD)
{"action": "select", "n": 4, "option": "Finance"}
{"action": "check", "n": 9}   (checkbox or radio button)
{"action": "uncheck", "n": 9}
{"action": "press", "key": "Enter"}
{"action": "back"}
{"action": "done", "summary": "what you did"}
All data here is fictional test data.`;

type Message = { role: "system" | "user" | "assistant"; content: string };

async function chat(messages: Message[]): Promise<{ content: string; promptTokens?: number }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.LLM_API_KEY ? { authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}),
        },
        body: JSON.stringify({ model: MODEL, messages, temperature: 0.6, max_tokens: 500, response_format: { type: "json_object" } }),
        // A wedged model server otherwise stalls the agent forever.
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as { choices: { message: { content: string } }[]; usage?: { prompt_tokens?: number } };
      return { content: data.choices[0]?.message?.content ?? "", promptTokens: data.usage?.prompt_tokens };
    } catch (err) {
      lastError = err;
      await sleep(2000 * (attempt + 1));
    }
  }
  throw new Error(`LLM request failed: ${(lastError as Error).message}`);
}

type Action = { action: string; thought?: string; [key: string]: unknown };

/** Strip <think> blocks and code fences, then parse the first JSON object in the reply. */
function parseAction(raw: string): Action | null {
  const text = raw.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").replace(/```(?:json)?/g, "");
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        const obj = JSON.parse(text.slice(start, i + 1));
        return obj && typeof obj.action === "string" ? (obj as Action) : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Turn a model action into browser CLI args, or explain what's wrong with it. */
function toCommand(a: Action): { command: string; args: string[] } | { error: string } {
  const n = a.n ?? a.element ?? a.id ?? a.index;
  const num = n === undefined ? NaN : Number(String(n).replace(/[^\d]/g, ""));
  const needN = () => (Number.isInteger(num) ? null : `"${a.action}" needs "n", the element number`);
  const str = (...keys: string[]) => {
    for (const k of keys) if (a[k] !== undefined && a[k] !== null) return String(a[k]);
    return undefined;
  };
  switch (a.action) {
    case "open": {
      const url = str("url", "path", "href");
      return url ? { command: "open", args: [url] } : { error: '"open" needs "url"' };
    }
    case "click":
    case "check":
    case "uncheck":
      return needN() ? { error: needN()! } : { command: a.action, args: [String(num)] };
    case "type": {
      const text = str("text", "value");
      if (needN()) return { error: needN()! };
      return text === undefined ? { error: '"type" needs "text"' } : { command: "type", args: [String(num), text] };
    }
    case "select": {
      const option = str("option", "value", "text");
      if (needN()) return { error: needN()! };
      return option === undefined ? { error: '"select" needs "option"' } : { command: "select", args: [String(num), option] };
    }
    case "press":
      return { command: "press", args: [str("key") ?? "Enter"] };
    case "back":
      return { command: "back", args: [] };
    default:
      return { error: `unknown action "${a.action}"` };
  }
}

// ---------- one agent ----------

type Stats = { agent: string; steps: number; records: number; questions: number; replies: number; resolved: number; invalid: number; outcome: string };

const seenObservations = new Set<string>();

function record(line: object) {
  appendFileSync(`${RUN_DIR}/trajectories.jsonl`, `${JSON.stringify(line)}\n`);
}

function storeObservation(obs: string): string {
  const h = hash(obs);
  if (!seenObservations.has(h)) {
    seenObservations.add(h);
    appendFileSync(`${RUN_DIR}/observations.jsonl`, `${JSON.stringify({ hash: h, text: obs })}\n`);
  }
  return h;
}

async function runAgent(browser: Agents, name: string, index: number): Promise<Stats> {
  const role = pick(ROLES);
  const quirk = QUIRKS[index % QUIRKS.length];
  const system = SYSTEM(name, role, quirk);
  const stats: Stats = { agent: name, steps: 0, records: 0, questions: 0, replies: 0, resolved: 0, invalid: 0, outcome: "out of steps" };
  const cards = Array.from({ length: RECORDS }, makeCard);
  const history: string[] = [];
  const log = (msg: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${name.padEnd(8)} ${msg}`);

  let obs = await browser.run(name, "open", [SITE]);
  let lastKey = "";
  let repeats = 0;
  let invalidStreak = 0;
  let nudge = "";
  let lastBoardCheck = -1; // step when the agent last looked at the board

  log(`starts (${role}, ${quirk})`);

  for (let step = 1; step <= MAX_STEPS; step++) {
    stats.steps = step;
    const card = cards[Math.min(stats.records, cards.length - 1)];
    const cardText = stats.records < RECORDS
      ? `Current customer card (record ${stats.records + 1} of ${RECORDS}):\n${Object.entries(card).map(([k, v]) => `  ${k}: ${v || "(none)"}`).join("\n")}`
      : "All customer records are saved. Help on the board, then finish with done.";
    if (!nudge && stats.records > 0 && step - lastBoardCheck > 12) {
      nudge = "It's been a while since you checked the board. Look at /board?filter=unanswered.";
    }

    const prompt = [
      `Today is ${TODAY}. Step ${step} of ${MAX_STEPS}.`,
      `Progress: ${stats.records}/${RECORDS} records saved, ${stats.questions} questions asked, ${stats.replies} replies posted.`,
      cardText,
      nudge && `Note: ${nudge}`,
      `Recent history:\n${history.slice(-HISTORY_LINES).join("\n") || "(nothing yet)"}`,
      `Current page:\n${obs}`,
      "Your next action (one JSON object):",
    ].filter(Boolean).join("\n\n");
    nudge = "";

    const obsHash = storeObservation(obs);
    const { content, promptTokens } = await chat([{ role: "system", content: system }, { role: "user", content: prompt }]);
    const action = parseAction(content);
    const base = { ts: new Date().toISOString(), agent: name, step, url: urlOf(obs), obs: obsHash, prompt_tokens: promptTokens, raw: content };

    if (!action) {
      stats.invalid++;
      record({ ...base, action: null, ok: false, result: "invalid reply" });
      if (++invalidStreak >= MAX_INVALID) {
        stats.outcome = "gave up: invalid replies";
        break;
      }
      nudge = 'Your last reply was not a valid action. Reply with exactly one JSON object like {"action": "click", "n": 5}.';
      continue;
    }
    invalidStreak = 0;

    if (action.action === "done") {
      if (stats.records < RECORDS) {
        nudge = `You're not done yet: ${stats.records} of ${RECORDS} records are saved.`;
        record({ ...base, action, ok: false, result: "done refused: records missing" });
        history.push(`#${step} done -> refused, records missing`);
        continue;
      }
      if (lastBoardCheck < 0) {
        nudge = "Before finishing, check the board's Unanswered filter once.";
        record({ ...base, action, ok: false, result: "done refused: board not checked" });
        history.push(`#${step} done -> refused, board not checked`);
        continue;
      }
      stats.outcome = "done";
      record({ ...base, action, ok: true, result: String(action.summary ?? "") });
      log(`done: ${String(action.summary ?? "").slice(0, 100)}`);
      break;
    }

    const cmd = toCommand(action);
    if ("error" in cmd) {
      stats.invalid++;
      record({ ...base, action, ok: false, result: cmd.error });
      history.push(`#${step} ${JSON.stringify(action)} -> invalid: ${cmd.error}`);
      if (++invalidStreak >= MAX_INVALID) {
        stats.outcome = "gave up: invalid replies";
        break;
      }
      nudge = `Your last action was invalid: ${cmd.error}.`;
      continue;
    }

    // What the agent clicked, as listed on the page it was looking at.
    const clicked = cmd.command === "click" ? new RegExp(`^\\[${cmd.args[0]}\\] (.*)$`, "m").exec(obs)?.[1] ?? "" : "";
    const before = obs;
    let ok = true;
    let result: string;
    await sleep(rand(PAUSE_MIN, PAUSE_MAX));
    try {
      obs = await browser.run(name, cmd.command, cmd.args);
      result = "ok";
    } catch (err) {
      ok = false;
      result = `error: ${(err as Error).message.split("\n")[0]}`;
      obs = (await browser.lookAt(name)) ?? obs;
    }

    // Track progress from what the page shows.
    const path = pathOf(urlOf(obs));
    const savedId = /Saved record #(\d+)/.exec(obs)?.[1];
    if (savedId && savedId !== /Saved record #(\d+)/.exec(before)?.[1]) {
      stats.records++;
      result = `saved record #${savedId}`;
      log(`saved record #${savedId} (${stats.records}/${RECORDS})`);
    } else if (/The record was not saved/.test(obs) && cmd.command === "click") {
      result = "form rejected";
    }
    if (clicked.includes('"Post question"') && /^\/board\/\d+/.test(path)) {
      stats.questions++;
      log(`asked a question: ${path}`);
    }
    if (clicked.includes('"Post reply"') && obs.includes("Your reply was posted.")) {
      stats.replies++;
      log(`replied on ${path.replace(/\?.*/, "")}`);
    }
    if (clicked.includes('"Mark as resolved"') && ok) {
      stats.resolved++;
      log(`resolved ${path}`);
    }
    if (path.startsWith("/board")) lastBoardCheck = step;

    const summary = `${cmd.command} ${cmd.args.join(" ")}`.trim();
    history.push(`#${step} ${summary}${clicked ? ` (${clicked.slice(0, 60)})` : ""} -> ${result} @ ${path}`);
    record({ ...base, action, command: summary, ok, result, next_url: urlOf(obs) });

    const key = `${summary}|${hash(obs)}`;
    repeats = key === lastKey ? repeats + 1 : 0;
    lastKey = key;
    if (repeats >= 1) nudge = "You repeated the same action and the page didn't change. Try something different.";

    await sleep(rand(PAUSE_MIN, PAUSE_MAX));
  }

  return stats;
}

// ---------- main ----------

async function main() {
  // Fail early if the site or the model server isn't up.
  const health = await fetch(`${SITE}/api/health`).catch(() => null);
  if (!health?.ok) throw new Error(`The site isn't answering at ${SITE}/api/health. Start it with npm run dev (and npm run db:up).`);
  const models = await fetch(`${LLM_BASE_URL}/models`).catch(() => null);
  if (!models?.ok) throw new Error(`No model server at ${LLM_BASE_URL}. Start Ollama (ollama serve) or set LLM_BASE_URL.`);

  mkdirSync(RUN_DIR, { recursive: true });
  const config = { site: SITE, llm: LLM_BASE_URL, model: MODEL, agents: AGENT_COUNT, records: RECORDS, maxSteps: MAX_STEPS, concurrency: CONCURRENCY, pauseMs: [PAUSE_MIN, PAUSE_MAX] };
  writeFileSync(`${RUN_DIR}/config.json`, JSON.stringify(config, null, 2));
  console.log(`Simulating ${AGENT_COUNT} agents × ${RECORDS} records with ${MODEL} (${CONCURRENCY} at once). Logs: ${RUN_DIR}/`);

  const raw = await launchBrowser();
  const browser = await createAgents({ browser: raw, allowedOrigin: SITE });
  const names = Array.from({ length: AGENT_COUNT }, (_, i) => `${opts.prefix}${i + 1}`);
  const results: Stats[] = [];
  let next = 0;

  async function worker(slot: number) {
    await sleep(slot * rand(1500, 4000)); // stagger the start
    while (next < names.length) {
      const i = next++;
      try {
        results.push(await runAgent(browser, names[i], i));
      } catch (err) {
        console.error(`${names[i]} crashed: ${(err as Error).message}`);
        results.push({ agent: names[i], steps: 0, records: 0, questions: 0, replies: 0, resolved: 0, invalid: 0, outcome: `crashed: ${(err as Error).message}` });
      }
      await browser.run(names[i], "close", []).catch(() => {});
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, names.length) }, (_, slot) => worker(slot)));
  await raw.close();

  results.sort((a, b) => a.agent.localeCompare(b.agent, undefined, { numeric: true }));
  writeFileSync(`${RUN_DIR}/summary.json`, JSON.stringify({ config, results }, null, 2));
  console.log("\nagent     steps  records  asked  replies  resolved  invalid  outcome");
  for (const r of results) {
    console.log(
      `${r.agent.padEnd(9)} ${String(r.steps).padStart(5)}  ${`${r.records}/${RECORDS}`.padStart(7)}  ${String(r.questions).padStart(5)}  ${String(r.replies).padStart(7)}  ${String(r.resolved).padStart(8)}  ${String(r.invalid).padStart(7)}  ${r.outcome}`,
    );
  }
  console.log(`\nTrajectories: ${RUN_DIR}/trajectories.jsonl`);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
