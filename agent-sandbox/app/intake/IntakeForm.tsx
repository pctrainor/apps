"use client";

import Link from "next/link";
import { useActionState } from "react";
import { submitIntake, type IntakeState } from "@/lib/actions";
import { INTERESTS, PLANS, ROLES } from "@/lib/reference";

const initial: IntakeState = { attempt: 0, errors: {}, values: {} };

export default function IntakeForm() {
  const [state, formAction, pending] = useActionState(submitIntake, initial);
  const { errors } = state;
  const value = (key: string) => (typeof state.values[key] === "string" ? (state.values[key] as string) : "");
  const interests = Array.isArray(state.values.interests) ? state.values.interests : [];
  const errorCount = Object.keys(errors).length;

  const err = (key: string) =>
    errors[key] ? <span className="error" id={`${key}-error`}>{errors[key]}</span> : null;

  return (
    <>
      {state.savedId && (
        <p className="banner ok" role="status">
          Saved record #{state.savedId}. <Link href="/records">View records</Link> or add another below.
        </p>
      )}
      {errorCount > 0 && (
        <p className="banner err" role="alert">
          The record was not saved. Fix {errorCount === 1 ? "1 field" : `${errorCount} fields`} below and submit again.
        </p>
      )}

      {/* Remount on every attempt so inputs start from the values the server sent back. */}
      <form key={state.attempt} action={formAction} className="card stack" noValidate>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="full_name">Full name</label>
            <input id="full_name" name="full_name" type="text" defaultValue={value("full_name")} />
            {err("full_name")}
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" defaultValue={value("email")} />
            {err("email")}
          </div>
          <div className="field">
            <label htmlFor="company">Company</label>
            <input id="company" name="company" type="text" defaultValue={value("company")} />
            {err("company")}
          </div>
          <div className="field">
            <label htmlFor="role">Role</label>
            <select id="role" name="role" defaultValue={value("role")}>
              <option value="">Choose a role…</option>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {err("role")}
          </div>
          <div className="field">
            <label htmlFor="region_code">Region code</label>
            <input id="region_code" name="region_code" type="text" defaultValue={value("region_code")} />
            <span className="hint">A code from the Reference page, for example NA-E.</span>
            {err("region_code")}
          </div>
          <div className="field">
            <label htmlFor="team_size">Team size</label>
            <input id="team_size" name="team_size" type="number" min={1} max={10000} defaultValue={value("team_size")} />
            {err("team_size")}
          </div>
        </div>

        <fieldset>
          <legend>Plan</legend>
          <div className="options">
            {PLANS.map((p) => (
              <label key={p.id}>
                <input type="radio" name="plan" value={p.id} defaultChecked={value("plan") === p.id} /> {p.name}
              </label>
            ))}
          </div>
          {err("plan")}
        </fieldset>

        <fieldset>
          <legend>Interests</legend>
          <div className="options">
            {INTERESTS.map((i) => (
              <label key={i}>
                <input type="checkbox" name="interests" value={i} defaultChecked={interests.includes(i)} /> {i}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="start_date">Preferred start date</label>
            <input id="start_date" name="start_date" type="date" defaultValue={value("start_date")} />
            {err("start_date")}
          </div>
        </div>

        <div className="field">
          <label htmlFor="notes">Notes (optional)</label>
          <textarea id="notes" name="notes" defaultValue={value("notes")} />
          {err("notes")}
        </div>

        <div className="field">
          <label>
            <input type="checkbox" name="consent" value="yes" defaultChecked={value("consent") === "yes"} /> I confirm this
            record is fictional test data
          </label>
          {err("consent")}
        </div>

        <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save record"}</button>
      </form>
    </>
  );
}
