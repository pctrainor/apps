import { INTERESTS, PLANS, REGIONS, ROLES } from "@/lib/reference";

export default function ReferencePage() {
  return (
    <>
      <h1>Reference</h1>
      <p className="lede">The rules the intake form checks when you save a record.</p>

      <h2>Region codes</h2>
      <table>
        <thead><tr><th>Code</th><th>Region</th></tr></thead>
        <tbody>{REGIONS.map((r) => <tr key={r.code}><td><code>{r.code}</code></td><td>{r.name}</td></tr>)}</tbody>
      </table>

      <h2>Plans</h2>
      <table>
        <thead><tr><th>Plan</th><th>Who it&apos;s for</th></tr></thead>
        <tbody>{PLANS.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.rule}</td></tr>)}</tbody>
      </table>

      <h2>Roles and interests</h2>
      <p>Roles: {ROLES.join(", ")}. Interests: {INTERESTS.join(", ")}.</p>

      <h2>FAQ</h2>
      <div className="card">
        <p><strong>Which region is Canada?</strong> Eastern provinces use NA-E, western provinces use NA-W.</p>
        <p><strong>Which region is India or Singapore?</strong> APAC-2. APAC-1 only covers Japan, Korea, Australia and New Zealand.</p>
        <p><strong>Can the start date be today?</strong> Yes. Any date from today onward is accepted.</p>
        <p><strong>Can I edit or delete a record?</strong> Not yet. Save a corrected record and mention the old record number in Notes.</p>
      </div>
    </>
  );
}
