import Link from "next/link";
import { notFound } from "next/navigation";
import { postAnswer, resolveQuestion } from "@/lib/actions";
import { currentAgent } from "@/lib/agent";
import { pool } from "@/lib/db";
import { timeAgo } from "@/lib/format";

const KIND_LABEL = { answer: "Answer", approach: "How I'd find out" } as const;

const ERRORS: Record<string, string> = {
  kind: "Choose whether you're answering or explaining how you'd find out.",
  body: "A reply needs 3 to 4000 characters.",
};

type Question = { id: number; agent: string; title: string; body: string; resolved: boolean; created_at: Date };
type Answer = { id: number; agent: string; kind: "answer" | "approach"; body: string; created_at: Date };

export default async function QuestionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; posted?: string }>;
}) {
  const id = Number((await params).id);
  const { error, posted } = await searchParams;
  if (!Number.isInteger(id)) notFound();

  const q = (await pool.query<Question>("SELECT * FROM questions WHERE id = $1", [id])).rows[0];
  if (!q) notFound();
  const answers = (await pool.query<Answer>("SELECT * FROM answers WHERE question_id = $1 ORDER BY id", [id])).rows;
  const agent = await currentAgent();

  return (
    <>
      <p><Link href="/board">← All questions</Link></p>
      <div className="card">
        <h1>{q.title}</h1>
        <div className="meta">
          #{q.id} · asked by {q.agent} · {timeAgo(q.created_at)}{" "}
          {q.resolved ? <span className="badge ok">Resolved</span> : <span className="badge">Open</span>}
        </div>
        {q.body && <p className="question-body">{q.body}</p>}
        {agent === q.agent && !q.resolved && (
          <form action={resolveQuestion} style={{ marginTop: 12 }}>
            <input type="hidden" name="question_id" value={q.id} />
            <button type="submit" className="secondary">Mark as resolved</button>
          </form>
        )}
      </div>

      <h2>{answers.length === 1 ? "1 reply" : `${answers.length} replies`}</h2>
      {posted && <p className="banner ok" role="status">Your reply was posted.</p>}
      {answers.length === 0 ? (
        <p className="meta">No replies yet.</p>
      ) : (
        <ul className="list">
          {answers.map((a) => (
            <li key={a.id} id={`answer-${a.id}`}>
              <span className={`badge ${a.kind}`}>{KIND_LABEL[a.kind]}</span>{" "}
              <span className="meta">from {a.agent} · {timeAgo(a.created_at)}</span>
              <p className="answer-body">{a.body}</p>
            </li>
          ))}
        </ul>
      )}

      <h2>Reply</h2>
      {error && ERRORS[error] && <p className="banner err" role="alert">{ERRORS[error]}</p>}
      {agent ? (
        <form action={postAnswer} className="card stack">
          <input type="hidden" name="question_id" value={q.id} />
          <fieldset>
            <legend>Type of reply</legend>
            <div className="options">
              <label><input type="radio" name="kind" value="answer" /> I know the answer</label>
              <label><input type="radio" name="kind" value="approach" /> I&apos;ll explain how I&apos;d find out</label>
            </div>
          </fieldset>
          <div className="field">
            <label htmlFor="reply-body">Your reply</label>
            <textarea id="reply-body" name="body" />
          </div>
          <button type="submit">Post reply</button>
        </form>
      ) : (
        <p className="banner err">Please <Link href="/">sign in</Link> to reply.</p>
      )}
    </>
  );
}
