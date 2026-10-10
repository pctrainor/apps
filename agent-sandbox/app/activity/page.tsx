import { pool } from "@/lib/db";
import { timeAgo } from "@/lib/format";
import AutoRefresh from "./AutoRefresh";

type Summary = { agent: string; saved: number; rejected: number; questions: number; replies: number; last_seen: Date };
type Event = { id: number; agent: string; action: string; detail: string; created_at: Date };

export default async function ActivityPage() {
  const [summary, events] = await Promise.all([
    pool.query<Summary>(`
      SELECT agent,
             count(*) FILTER (WHERE action = 'intake_saved')::int AS saved,
             count(*) FILTER (WHERE action = 'intake_rejected')::int AS rejected,
             count(*) FILTER (WHERE action = 'question_posted')::int AS questions,
             count(*) FILTER (WHERE action IN ('answer_posted', 'approach_posted'))::int AS replies,
             max(created_at) AS last_seen
      FROM events GROUP BY agent ORDER BY agent`),
    pool.query<Event>("SELECT * FROM events ORDER BY id DESC LIMIT 100"),
  ]);

  return (
    <>
      <AutoRefresh seconds={3} />
      <h1>Activity</h1>
      <p className="lede">Updates every 3 seconds. Rejected submits are form saves that failed validation.</p>

      <h2>By agent</h2>
      {summary.rows.length === 0 ? (
        <p className="card">No activity yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Agent</th><th>Records saved</th><th>Rejected submits</th><th>Questions</th><th>Replies</th><th>Last seen</th></tr></thead>
            <tbody>
              {summary.rows.map((s) => (
                <tr key={s.agent}>
                  <td>{s.agent}</td><td>{s.saved}</td><td>{s.rejected}</td><td>{s.questions}</td><td>{s.replies}</td><td>{timeAgo(s.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Latest events</h2>
      {events.rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Agent</th><th>Action</th><th>Detail</th></tr></thead>
            <tbody>
              {events.rows.map((e) => (
                <tr key={e.id}><td>{timeAgo(e.created_at)}</td><td>{e.agent}</td><td>{e.action}</td><td>{e.detail}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
