-- ============================================================
-- V1 tables (written by V1 code)
-- ============================================================

CREATE TABLE conversation_state (
  chat_id TEXT PRIMARY KEY,
  body TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(body)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE trips (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('open','awaiting_confirmation','confirmed','cancelled')),

  captain_chat_id TEXT NOT NULL,
  captain_name TEXT NOT NULL,
  boat_slug TEXT NOT NULL,
  route_slug TEXT,

  trip_date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,

  passenger_count INTEGER,
  safety_orientation_given INTEGER NOT NULL DEFAULT 1,

  first_mate_text TEXT,
  notes TEXT,
  weather_summary TEXT,

  parse_json TEXT CHECK (parse_json IS NULL OR json_valid(parse_json)),

  passenger_count_xola INTEGER,
  weather_deviation_note TEXT,
  xola_booking_id TEXT,
  photo_urls TEXT,
  first_mate_crew_id INTEGER,

  sheet_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT,

  FOREIGN KEY (first_mate_crew_id) REFERENCES crew(id)
);

CREATE INDEX trips_status_date ON trips(status, trip_date);
CREATE INDEX trips_captain_status ON trips(captain_chat_id, status);
CREATE INDEX trips_sync_pending ON trips(sheet_synced_at) WHERE status = 'confirmed';

CREATE TABLE drills (
  id INTEGER PRIMARY KEY,
  drill_date TEXT NOT NULL,
  drill_type TEXT NOT NULL CHECK (drill_type IN ('abandon_ship','mob','fire','crew_emergency')),
  boat_slug TEXT NOT NULL,
  captain_chat_id TEXT NOT NULL,
  crew_present_text TEXT,
  notes TEXT,
  parse_json TEXT CHECK (parse_json IS NULL OR json_valid(parse_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX drills_type_boat_date ON drills(drill_type, boat_slug, drill_date);

CREATE TABLE feedback (
  id INTEGER PRIMARY KEY,
  submitted_by_chat_id TEXT NOT NULL,
  body TEXT NOT NULL,
  drafted_issue_body TEXT,
  github_issue_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','filed','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- V2-baked tables (live in migration; not written by V1 code)
-- ============================================================

CREATE TABLE crew (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  full_name TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE trip_crew (
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  crew_id INTEGER NOT NULL REFERENCES crew(id),
  role TEXT,
  PRIMARY KEY (trip_id, crew_id)
);

CREATE TABLE drill_crew (
  drill_id INTEGER NOT NULL REFERENCES drills(id) ON DELETE CASCADE,
  crew_id INTEGER NOT NULL REFERENCES crew(id),
  PRIMARY KEY (drill_id, crew_id)
);

CREATE TABLE handoffs (
  id INTEGER PRIMARY KEY,
  boat_slug TEXT NOT NULL,
  outgoing_captain_chat_id TEXT NOT NULL,
  incoming_captain_chat_id TEXT NOT NULL,
  handoff_at TEXT NOT NULL,
  fuel_state TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
