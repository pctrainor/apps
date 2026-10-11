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

-- ---------- Trading floor (npm run market): paper money at real prices ----------

CREATE TABLE IF NOT EXISTS traders (
  name       TEXT PRIMARY KEY,
  persona    TEXT NOT NULL,
  model      TEXT NOT NULL,
  start_usd  NUMERIC(18, 2) NOT NULL,
  cash       NUMERIC(18, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holdings (
  trader TEXT NOT NULL REFERENCES traders(name) ON DELETE CASCADE,
  coin   TEXT NOT NULL,
  qty    NUMERIC(28, 10) NOT NULL DEFAULT 0,
  PRIMARY KEY (trader, coin)
);

CREATE TABLE IF NOT EXISTS trades (
  id         SERIAL PRIMARY KEY,
  trader     TEXT NOT NULL REFERENCES traders(name) ON DELETE CASCADE,
  side       TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  coin       TEXT NOT NULL,
  qty        NUMERIC(28, 10) NOT NULL,
  price      NUMERIC(18, 6) NOT NULL,
  usd        NUMERIC(18, 2) NOT NULL,
  fee        NUMERIC(18, 2) NOT NULL,
  reason     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What the traders say to each other, plus trade and rejection notices.
CREATE TABLE IF NOT EXISTS floor_messages (
  id         BIGSERIAL PRIMARY KEY,
  trader     TEXT NOT NULL,
  kind       TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prices (
  coin   TEXT NOT NULL,
  ts     TIMESTAMPTZ NOT NULL,
  price  NUMERIC(18, 6) NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (coin, ts)
);

-- Portfolio value over time per trader, plus the 'benchmark' series (equal split at the start, never traded).
CREATE TABLE IF NOT EXISTS value_history (
  series TEXT NOT NULL,
  ts     TIMESTAMPTZ NOT NULL,
  value  NUMERIC(18, 2) NOT NULL,
  PRIMARY KEY (series, ts)
);

CREATE TABLE IF NOT EXISTS market_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Floor message kinds. Dropped and re-added so databases created before research and consensus existed
-- accept the new kinds.
ALTER TABLE floor_messages DROP CONSTRAINT IF EXISTS floor_messages_kind_check;
ALTER TABLE floor_messages ADD CONSTRAINT floor_messages_kind_check
  CHECK (kind IN ('chat', 'trade', 'rejected', 'system', 'research', 'memory', 'consensus'));

-- Long-term memory per trader. Survives `npm run market -- --reset`; only `--forget` clears it.
CREATE TABLE IF NOT EXISTS trader_memories (
  id         BIGSERIAL PRIMARY KEY,
  trader     TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('note', 'lesson', 'reflection')),
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trader_memories_lookup ON trader_memories (trader, kind, id);

-- What traders looked up on the internet, and what came back.
CREATE TABLE IF NOT EXISTS research_log (
  id         BIGSERIAL PRIMARY KEY,
  trader     TEXT NOT NULL,
  tool       TEXT NOT NULL,
  input      TEXT NOT NULL DEFAULT '',
  ok         BOOLEAN NOT NULL,
  result     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Group consensus written by the floor lead (a higher-level model, or a Claude session for now).
CREATE TABLE IF NOT EXISTS consensus (
  id         BIGSERIAL PRIMARY KEY,
  author     TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
