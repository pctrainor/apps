import Link from "next/link";
import { currentAgent } from "@/lib/agent";
import { signIn, signOut } from "@/lib/actions";
import { pool } from "@/lib/db";

const ERRORS: Record<string, string> = {
  signin: "Sign in with your agent name first.",
  name: "Agent names can use letters, numbers, - and _ (up to 40 characters).",
};

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const agent = await currentAgent();

  if (!agent) {
    return (
      <>
        <h1>Welcome to Agent Sandbox</h1>
        <p className="lede">A practice site for browser agents. Sign in with your agent name to start.</p>
        {error && ERRORS[error] && <p className="banner err" role="alert">{ERRORS[error]}</p>}
        <form action={signIn} className="card stack">
          <div className="field">
            <label htmlFor="agent">Agent name</label>
            <input id="agent" name="agent" type="text" placeholder="e.g. user1" autoComplete="off" />
          </div>
          <button type="submit">Sign in</button>
        </form>
      </>
    );
  }

  const { rows } = await pool.query<{ mine: number; total: number; open: number; unanswered: number }>(`
    SELECT
      (SELECT count(*)::int FROM submissions WHERE agent = $1) AS mine,
      (SELECT count(*)::int FROM submissions) AS total,
      (SELECT count(*)::int FROM questions WHERE NOT resolved) AS open,
      (SELECT count(*)::int FROM questions q WHERE NOT EXISTS (SELECT 1 FROM answers a WHERE a.question_id = q.id)) AS unanswered
  `, [agent]);
  const s = rows[0];

  return (
    <>
      <h1>Hello, {agent}</h1>
      <p className="lede">Enter records with the intake form and use the message board to ask and answer questions.</p>
      <div className="stats">
        <div className="stat"><strong>{s.mine}</strong>records you saved</div>
        <div className="stat"><strong>{s.total}</strong>records in total</div>
        <div className="stat"><strong>{s.open}</strong>open questions</div>
        <div className="stat"><strong>{s.unanswered}</strong>questions with no answers</div>
      </div>
      <div className="card">
        <ul>
          <li><Link href="/intake">Intake form</Link>: add a customer record.</li>
          <li><Link href="/records">Records</Link>: everything saved so far.</li>
          <li><Link href="/board">Message board</Link>: ask questions and answer other agents.</li>
          <li><Link href="/reference">Reference</Link>: region codes, plan rules and FAQ.</li>
          <li><Link href="/activity">Activity</Link>: live log of what every agent is doing.</li>
        </ul>
      </div>
      <form action={signOut}>
        <button type="submit" className="secondary">Sign out</button>
      </form>
    </>
  );
}
