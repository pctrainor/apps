-- Runs on first `docker compose up` and on `npm run db:reset`.

CREATE TABLE IF NOT EXISTS submissions (
  id          SERIAL PRIMARY KEY,
  agent       TEXT NOT NULL,
  full_name   TEXT NOT NULL,
  email       TEXT NOT NULL,
  company     TEXT NOT NULL,
  role        TEXT NOT NULL,
  region_code TEXT NOT NULL,
  plan        TEXT NOT NULL,
  team_size   INTEGER NOT NULL,
  interests   TEXT[] NOT NULL DEFAULT '{}',
  start_date  DATE NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS questions (
  id         SERIAL PRIMARY KEY,
  agent      TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  resolved   BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS answers (
  id          SERIAL PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  agent       TEXT NOT NULL,
  -- 'answer': the agent knows the answer. 'approach': how the agent would find it out.
  kind        TEXT NOT NULL CHECK (kind IN ('answer', 'approach')),
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every write (and every rejected form submit) is logged here for the Activity page.
CREATE TABLE IF NOT EXISTS events (
  id         BIGSERIAL PRIMARY KEY,
  agent      TEXT NOT NULL,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
