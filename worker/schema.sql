CREATE TABLE IF NOT EXISTS markets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  name_de TEXT, name_en TEXT, loc TEXT, url TEXT, type TEXT,
  lat REAL, lng REAL, start TEXT, end TEXT,
  dates TEXT, days_of_week TEXT, closed TEXT, special_open TEXT,
  tbc INTEGER NOT NULL DEFAULT 0,
  image TEXT, image_credit TEXT, image_source TEXT
);
CREATE TABLE IF NOT EXISTS market_info (
  market_id INTEGER NOT NULL REFERENCES markets(id),
  field TEXT NOT NULL CHECK (field IN ('entrance','gluehwein_price','fun_fact','description')),
  value TEXT NOT NULL,
  approved_at TEXT NOT NULL DEFAULT (datetime('now')),
  suggestion_id INTEGER,
  PRIMARY KEY (market_id, field)
);
CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id INTEGER NOT NULL REFERENCES markets(id),
  field TEXT NOT NULL CHECK (field IN ('entrance','gluehwein_price','fun_fact','description')),
  value TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  distance_m INTEGER
);
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions(status, created_at);

-- Photo columns were added to existing databases with (SQLite has no ADD COLUMN IF NOT EXISTS):
--   ALTER TABLE markets ADD COLUMN image TEXT;
--   ALTER TABLE markets ADD COLUMN image_credit TEXT;
--   ALTER TABLE markets ADD COLUMN image_source TEXT;
