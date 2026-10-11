// Minimal client for any OpenAI-compatible /v1/chat/completions server (Ollama, LM Studio, llama.cpp, vLLM),
// plus a scripted "mock" model for testing the plumbing without a model server.

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type LlmConfig = {
  baseUrl: string; // e.g. http://localhost:11434/v1
  apiKey?: string; // only for servers that need one
  model: string; // "mock" uses the scripted stand-in below
  jsonMode: "json_schema" | "json_object" | "none";
  maxTokens: number;
  timeoutMs: number;
};

export function llmConfigFromEnv(): LlmConfig {
  const jsonMode = process.env.LLM_JSON_MODE;
  return {
    baseUrl: (process.env.LLM_BASE_URL ?? "http://localhost:11434/v1").replace(/\/+$/, ""),
    apiKey: process.env.LLM_API_KEY || undefined,
    model: process.env.LLM_MODEL ?? "qwen2.5:7b-instruct",
    jsonMode: jsonMode === "json_object" || jsonMode === "none" ? jsonMode : "json_schema",
    maxTokens: Number(process.env.LLM_MAX_TOKENS ?? 1500),
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 180_000),
  };
}

/** Fails with a readable message when the model server isn't reachable or the model isn't installed. */
const authHeaders = (cfg: LlmConfig): Record<string, string> => (cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {});

export async function checkModelServer(cfg: LlmConfig): Promise<void> {
  if (cfg.model === "mock") return;
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/models`, { headers: authHeaders(cfg), signal: AbortSignal.timeout(5_000) });
  } catch {
    throw new Error(
      `Can't reach a model server at ${cfg.baseUrl}. Start Ollama (open the app, or run "ollama serve"), ` +
        `or set LLM_BASE_URL to your server.`,
    );
  }
  if (!res.ok) return; // some servers don't implement /models; the first chat call will tell
  const body = (await res.json().catch(() => null)) as { data?: { id: string }[] } | null;
  const ids = body?.data?.map((m) => m.id) ?? [];
  if (ids.length > 0 && !ids.some((id) => id === cfg.model || id === `${cfg.model}:latest`)) {
    throw new Error(`Model "${cfg.model}" isn't installed. Run: ollama pull ${cfg.model}   (installed: ${ids.join(", ")})`);
  }
}

/** Sends one chat request and returns the parsed JSON object from the reply. */
export async function chatJson(
  cfg: LlmConfig,
  messages: ChatMessage[],
  schema: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: 0.8,
    max_tokens: cfg.maxTokens,
    stream: false,
  };
  if (cfg.jsonMode === "json_schema") {
    body.response_format = { type: "json_schema", json_schema: { name: "turn", schema, strict: true } };
  } else if (cfg.jsonMode === "json_object") {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(cfg) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Servers that don't support structured output: fall back once to a weaker mode for the rest of the run.
    if (res.status === 400 && cfg.jsonMode !== "none" && /response_format|json_schema|schema/i.test(text)) {
      cfg.jsonMode = cfg.jsonMode === "json_schema" ? "json_object" : "none";
      console.warn(`Model server rejected structured output; switching LLM_JSON_MODE to ${cfg.jsonMode}.`);
      return chatJson(cfg, messages, schema);
    }
    throw new Error(`Model server returned ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
  const content = data.choices?.[0]?.message?.content ?? "";
  const parsed = extractJson(content);
  if (!parsed) throw new Error(`Reply wasn't JSON: ${content.slice(0, 200)}`);
  return parsed;
}

/** Pulls the first JSON object out of a reply that may contain <think> blocks, code fences or chatter. */
export function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  // Walk to the matching closing brace, respecting strings.
  let depth = 0;
  let inString = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        const value = JSON.parse(cleaned.slice(start, i + 1));
        return value && typeof value === "object" && !Array.isArray(value) ? value : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

// ---------- mock model ----------

const MOCK_LINES: Record<string, string[]> = {
  user1: ["Staying mostly in cash. {coin} looks shaky to me.", "Small {coin} nibble on this dip, nothing big.", "user2, that's a lot of risk for one coin."],
  user2: ["{coin} is moving! Getting in before it runs.", "Who else is riding {coin} right now?", "Momentum says {coin}. Adding."],
  user3: ["Everyone loves {coin} today, so I'm trimming it.", "user2, chasing green candles usually ends badly.", "Buying the {coin} nobody wants."],
  user4: ["Rebalancing so no coin is over 30% of my money.", "Topping up {coin} to keep the split even.", "Still about half cash, half coins."],
  user5: ["Quick in and out on {coin}.", "Took a small profit on {coin}, back to watching.", "{coin} chart looks jumpy, small size only."],
};

/** Scripted stand-in for a model: random but well-formed turns. Only for testing the plumbing. */
export function mockTurn(trader: string, coins: string[], cash: number, holdings: Record<string, number>) {
  const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
  const coin = pick(coins);
  const lines = MOCK_LINES[trader] ?? MOCK_LINES.user5;
  const held = Object.entries(holdings).filter(([, value]) => value > 1);
  const roll = Math.random();
  let action: "buy" | "sell" | "hold" = "hold";
  let target = coin;
  let usdAmount: number | null = null;
  if (roll < 0.45 && cash > 50) {
    action = "buy";
    usdAmount = Math.round(Math.min(cash, 200 + Math.random() * 2000));
  } else if (roll < 0.7 && held.length > 0) {
    const [heldCoin, value] = pick(held);
    action = "sell";
    target = heldCoin;
    usdAmount = Math.round(value * (0.3 + Math.random() * 0.7));
  }
  const notes = [`Watch ${target} after my last move.`, `Fees add up when I trade too often.`, `${target} swings hard; keep orders small.`];
  const tools = [
    { tool: "news", input: target },
    { tool: "coin", input: target },
    { tool: "sentiment", input: "" },
    { tool: "search", input: `${target} price outlook` },
  ];
  return {
    say: pick(lines).replaceAll("{coin}", target),
    action,
    coin: action === "hold" ? null : target,
    usd: usdAmount,
    reason: "mock model",
    remember: Math.random() < 0.3 ? pick(notes) : null,
    research: Math.random() < 0.3 ? pick(tools) : null,
  };
}

/** Scripted reflection for the mock model. */
export function mockReflection(trader: string) {
  return {
    memory: `${trader} (mock): I trade small, I keep some cash, and I check news before big buys.`,
    lessons: Math.random() < 0.5 ? ["Small orders keep fees and regret low."] : [],
  };
}
