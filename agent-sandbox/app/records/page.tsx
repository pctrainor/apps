import Link from "next/link";
import { currentAgent } from "@/lib/agent";
import { pool } from "@/lib/db";
import { timeAgo } from "@/lib/format";

type Row = {
  id: number; agent: string; full_name: string; company: string; role: string; region_code: string;
  plan: string; team_size: number; interests: string[]; start_date: string; created_at: Date;
};

export default async function RecordsPage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const mine = (await searchParams).mine === "1";
  const agent = await currentAgent();
  const { rows } = await pool.query<Row>(
    `SELECT id, agent, full_name, company, role, region_code, plan, team_size, interests,
            to_char(start_date, 'YYYY-MM-DD') AS start_date, created_at
     FROM submissions WHERE ($1::text IS NULL OR agent = $1) ORDER BY id DESC LIMIT 500`,
    [mine ? agent ?? "" : null],
  );

  return (
    <>
      <h1>Records</h1>
      <p className="lede">Every record saved through the intake form, newest first.</p>
      <div className="tabs">
        <Link href="/records" aria-current={!mine ? "page" : undefined}>All records</Link>
        <Link href="/records?mine=1" aria-current={mine ? "page" : undefined}>My records</Link>
      </div>
      {rows.length === 0 ? (
        <p className="card">No records yet. <Link href="/intake">Add one</Link>.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>#</th><th>Saved by</th><th>Name</th><th>Company</th><th>Role</th><th>Region</th><th>Plan</th><th>Team</th><th>Interests</th><th>Start</th><th>Saved</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td><td>{r.agent}</td><td>{r.full_name}</td><td>{r.company}</td><td>{r.role}</td>
                  <td>{r.region_code}</td><td>{r.plan}</td><td>{r.team_size}</td><td>{r.interests.join(", ")}</td>
                  <td>{r.start_date}</td><td>{timeAgo(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
