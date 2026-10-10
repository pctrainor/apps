// Browser CLI for agents. One background server keeps a Chromium running, with a separate
// browser context (own cookies and tab) per agent name, so each command picks up where the
// last one left off.
//
//   npm run -s browse -- <agent> <command> [args]
//
// Every command prints the page afterwards: URL, visible text and numbered interactive elements.
// Use those numbers with click / type / select / check.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";

try {
  process.loadEnvFile(".env");
} catch {}

const PORT = Number(process.env.BROWSE_PORT ?? 3999);
const BASE = `http://127.0.0.1:${PORT}`;
// Claude Code cloud containers ship a Chromium here that may not match Playwright's expected build.
const FALLBACK_CHROMIUM = "/opt/pw-browsers/chromium";

const HELP = `Usage: npm run -s browse -- <agent> <command> [args]

Commands:
  open <url>             Go to a URL
  look                   Show the current page again
  click <n>              Click element [n]
  type <n> <text...>     Replace the text in field [n] (dates as YYYY-MM-DD)
  select <n> <option>    Pick an option in dropdown [n] by its label or value
  check <n>              Tick checkbox or radio button [n]
  uncheck <n>            Untick checkbox [n]
  press <key>            Press a key, e.g. Enter, Tab, Escape
  back                   Go back one page
  screenshot [file]      Save a full-page PNG (default: screenshots/<agent>-<time>.png)
  close                  Close this agent's browser
  stop                   Shut down the browser server for all agents`;

// ---------- page script: number the interactive elements ----------

function observe(): { elements: string[]; text: string } {
  const clean = (s: string | null | undefined, max = 80) => {
    const t = (s ?? "").replace(/\s+/g, " ").trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  };
  const nameOf = (el: HTMLElement): string => {
    const aria = el.getAttribute("aria-label");
    if (aria) return clean(aria);
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length > 0) return clean(labels[0].innerText);
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return clean(placeholder);
    return clean(el.innerText || el.getAttribute("title") || el.getAttribute("name") || (el as HTMLInputElement).value);
  };

  document.querySelectorAll("[data-agent-id]").forEach((el) => el.removeAttribute("data-agent-id"));
  const selector = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"]';
  const elements: string[] = [];
  let n = 0;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if ((box.width === 0 && box.height === 0) || style.visibility === "hidden" || style.display === "none") continue;
    el.setAttribute("data-agent-id", String(++n));

    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    let line: string;
    if (tag === "a") line = `link "${nameOf(el)}" -> ${el.getAttribute("href")}`;
    else if (tag === "select") {
      const select = el as HTMLSelectElement;
      const options = Array.from(select.options).map((o) => clean(o.text, 40));
      line = `dropdown "${nameOf(el)}" selected="${clean(select.selectedOptions[0]?.text ?? "")}" options: ${options.join(" | ")}`;
    } else if (tag === "textarea") line = `textarea "${nameOf(el)}" value="${clean((el as HTMLTextAreaElement).value, 120)}"`;
    else if (tag === "input" && (type === "checkbox" || type === "radio")) {
      const input = el as HTMLInputElement;
      line = `${type} "${nameOf(el)}" (${input.name}=${input.value}) ${input.checked ? "[x]" : "[ ]"}`;
    } else if (tag === "button" || el.getAttribute("role") === "button" || ["submit", "button", "reset"].includes(type)) {
      line = `button "${nameOf(el)}"`;
    } else line = `input:${type} "${nameOf(el)}" value="${clean((el as HTMLInputElement).value, 120)}"`;
    if ((el as HTMLButtonElement).disabled) line += " (disabled)";
    elements.push(`[${n}] ${line}`);
  }

  const text = document.body.innerText.replace(/\n{3,}/g, "\n\n").trim();
  return { elements, text: text.length > 5000 ? `${text.slice(0, 5000)}\n…(truncated)` : text };
}

// ---------- server ----------

async function launchBrowser(): Promise<Browser> {
  const headless = process.env.HEADLESS !== "false";
  const explicit = process.env.BROWSER_EXECUTABLE;
  try {
    return await chromium.launch({ headless, executablePath: explicit || undefined });
  } catch (err) {
    if (explicit || !existsSync(FALLBACK_CHROMIUM)) throw err;
    return chromium.launch({ headless, executablePath: FALLBACK_CHROMIUM });
  }
}

async function serve() {
  const browser = await launchBrowser();
  const pages = new Map<string, Page>();

  async function pageFor(agent: string): Promise<Page> {
    const existing = pages.get(agent);
    if (existing && !existing.isClosed()) return existing;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // Follow links that open a new tab.
    context.on("page", (p) => {
      trackNetwork(p);
      pages.set(agent, p);
    });
    const page = await context.newPage();
    trackNetwork(page);
    pages.set(agent, page);
    return page;
  }

  // Playwright's "networkidle" resolves at once when no new document loads, which is the case for
  // form actions and client-side navigation. Count in-flight requests ourselves instead.
  const network = new WeakMap<Page, { inflight: number; changed: number }>();
  function trackNetwork(page: Page) {
    const state = { inflight: 0, changed: Date.now() };
    network.set(page, state);
    page.setDefaultTimeout(10_000);
    page.on("request", () => {
      state.inflight++;
      state.changed = Date.now();
    });
    const done = () => {
      state.inflight = Math.max(0, state.inflight - 1);
      state.changed = Date.now();
    };
    page.on("requestfinished", done);
    page.on("requestfailed", done);
  }

  async function settle(page: Page) {
    await page.waitForTimeout(200);
    const state = network.get(page);
    const deadline = Date.now() + 15_000;
    while (state && Date.now() < deadline && (state.inflight > 0 || Date.now() - state.changed < 500)) {
      await page.waitForTimeout(100);
    }
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  async function look(page: Page): Promise<string> {
    if (page.url() === "about:blank") return "No page open yet. Use: open <url>";
    // tsx compiles named functions with an __name() helper that doesn't exist in the page, so stub it.
    const { elements, text } = (await page.evaluate(
      `(() => { const __name = (fn) => fn; return (${observe.toString()})(); })()`,
    )) as ReturnType<typeof observe>;
    return [
      `URL: ${page.url()}`,
      `Title: ${await page.title()}`,
      "",
      "--- Page text ---",
      text,
      "",
      "--- Interactive elements ---",
      elements.join("\n") || "(none)",
    ].join("\n");
  }

  async function run(agent: string, command: string, args: string[]): Promise<string> {
    const page = await pageFor(agent);
    const target = () => {
      const n = Number(args[0]);
      if (!Number.isInteger(n)) throw new Error(`"${command}" needs an element number, e.g. ${command} 3`);
      return page.locator(`[data-agent-id="${n}"]`);
    };

    switch (command) {
      case "open": {
        if (!args[0]) throw new Error("open needs a URL");
        const url = /^https?:\/\//.test(args[0]) ? args[0] : `http://${args[0]}`;
        await page.goto(url);
        break;
      }
      case "look":
        break;
      case "click":
        await target().click();
        break;
      case "type":
        await target().fill(args.slice(1).join(" "));
        break;
      case "select": {
        const option = args.slice(1).join(" ");
        await target().selectOption({ label: option }).catch(() => target().selectOption(option));
        break;
      }
      case "check":
        await target().check();
        break;
      case "uncheck":
        await target().uncheck();
        break;
      case "press":
        await page.keyboard.press(args[0] ?? "Enter");
        break;
      case "back":
        await page.goBack();
        break;
      case "screenshot": {
        const file = args[0] ?? `screenshots/${agent}-${Date.now()}.png`;
        mkdirSync(file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : ".", { recursive: true });
        await page.screenshot({ path: file, fullPage: true });
        return `Saved ${file}`;
      }
      case "close":
        await page.context().close();
        pages.delete(agent);
        return `Closed the browser for ${agent}.`;
      default:
        throw new Error(`Unknown command "${command}".\n\n${HELP}`);
    }
    await settle(page);
    return look(page);
  }

  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") return void res.end("ok");
    if (req.method !== "POST" || req.url !== "/run") return void res.writeHead(404).end();
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const { agent, command, args } = JSON.parse(raw) as { agent: string; command: string; args: string[] };
    console.log(`${new Date().toISOString()} ${agent} ${command} ${args.join(" ")}`);

    if (command === "stop") {
      res.end(JSON.stringify({ ok: true, output: "Browser server stopped." }));
      await browser.close();
      process.exit(0);
    }
    try {
      res.end(JSON.stringify({ ok: true, output: await run(agent, command, args) }));
    } catch (err) {
      const page = pages.get(agent);
      const state = page && !page.isClosed() ? `\n\n${await look(page).catch(() => "")}` : "";
      res.end(JSON.stringify({ ok: false, output: `Error: ${(err as Error).message.split("\n")[0]}${state}` }));
    }
  });
  server.listen(PORT, "127.0.0.1", () => console.log(`browse server on ${BASE}`));
}

// ---------- client ----------

async function serverUp(): Promise<boolean> {
  try {
    return (await fetch(`${BASE}/health`)).ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await serverUp()) return;
  const log = openSync(".browse.log", "a");
  spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), "__serve"], {
    detached: true,
    stdio: ["ignore", log, log],
  }).unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await serverUp()) return;
  }
  throw new Error("The browser server didn't start. See .browse.log");
}

async function main() {
  const [agent, command, ...args] = process.argv.slice(2);
  if (agent === "__serve") return serve();
  if (!agent || !command || agent === "help" || agent === "--help") {
    console.log(HELP);
    return;
  }
  if (command === "stop" && !(await serverUp())) {
    console.log("Browser server isn't running.");
    return;
  }
  await ensureServer();
  const res = await fetch(`${BASE}/run`, { method: "POST", body: JSON.stringify({ agent, command, args }) });
  const { ok, output } = (await res.json()) as { ok: boolean; output: string };
  console.log(output);
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
