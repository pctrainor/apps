// Browser CLI for agents. One background server keeps a Chromium running, with a separate
// browser context (own cookies and tab) per agent name, so each command picks up where the
// last one left off. The browser itself lives in scripts/browser.ts.
//
//   npm run -s browse -- <agent> <command> [args]
//
// Every command prints the page afterwards: URL, visible text and numbered interactive elements.
// Use those numbers with click / type / select / check.

import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { COMMANDS_HELP, createAgents, launchBrowser } from "./browser";

try {
  process.loadEnvFile(".env");
} catch {}

const PORT = Number(process.env.BROWSE_PORT ?? 3999);
const BASE = `http://127.0.0.1:${PORT}`;

const HELP = `Usage: npm run -s browse -- <agent> <command> [args]

${COMMANDS_HELP}
  stop                   Shut down the browser server for all agents`;

// ---------- server ----------

async function serve() {
  const browser = await launchBrowser();
  const agents = await createAgents({ browser, allowedOrigin: process.env.BROWSE_ALLOWED_ORIGIN || undefined });

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
      res.end(JSON.stringify({ ok: true, output: await agents.run(agent, command, args) }));
    } catch (err) {
      const page = await agents.lookAt(agent);
      const state = page ? `\n\n${page}` : "";
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
