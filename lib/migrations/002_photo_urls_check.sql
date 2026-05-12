-- Add CHECK(json_valid) on trips.photo_urls. SQLite cannot ALTER ADD CONSTRAINT,
-- so rebuild the table per https://sqlite.org/lang_altertable.html section 7.
-- migrate.js disables foreign_keys around the whole batch and runs
-- foreign_key_check before COMMIT.

CREATE TABLE trips_new (
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
  photo_urls TEXT CHECK (photo_urls IS NULL OR json_valid(photo_urls)),
  first_mate_crew_id INTEGER,

  sheet_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT,

  FOREIGN KEY (first_mate_crew_id) REFERENCES crew(id)
);

INSERT INTO trips_new SELECT
  id, status, captain_chat_id, captain_name, boat_slug, route_slug,
  trip_date, start_time, end_time, passenger_count, safety_orientation_given,
  first_mate_text, notes, weather_summary, parse_json,
  passenger_count_xola, weather_deviation_note, xola_booking_id, photo_urls, first_mate_crew_id,
  sheet_synced_at, created_at, updated_at, confirmed_at
FROM trips;

DROP TABLE trips;
ALTER TABLE trips_new RENAME TO trips;

CREATE INDEX trips_status_date ON trips(status, trip_date);
CREATE INDEX trips_captain_status ON trips(captain_chat_id, status);
CREATE INDEX trips_sync_pending ON trips(sheet_synced_at) WHERE status = 'confirmed';
