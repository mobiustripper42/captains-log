const COLUMNS = [
  'status',
  'captain_chat_id',
  'captain_name',
  'boat_slug',
  'route_slug',
  'trip_date',
  'start_time',
  'end_time',
  'passenger_count',
  'safety_orientation_given',
  'first_mate_text',
  'first_mate_crew_id',
  'notes',
  'weather_summary',
  'parse_json',
  'passenger_count_xola',
  'weather_deviation_note',
  'xola_booking_id',
  'photo_urls',
  'sheet_synced_at',
  'confirmed_at',
];

const REQUIRED = ['status', 'captain_chat_id', 'captain_name', 'boat_slug', 'trip_date'];

export function create(db, fields) {
  for (const k of REQUIRED) {
    if (fields[k] === undefined || fields[k] === null) {
      throw new Error(`trips.create: missing required field ${k}`);
    }
  }
  const cols = COLUMNS.filter((c) => fields[c] !== undefined);
  const placeholders = cols.map(() => '?').join(', ');
  const values = cols.map((c) => fields[c]);
  const sql = `INSERT INTO trips (${cols.join(', ')}) VALUES (${placeholders})`;
  const { lastInsertRowid } = db.prepare(sql).run(...values);
  return { id: Number(lastInsertRowid) };
}

export function findById(db, id) {
  return db.prepare('SELECT * FROM trips WHERE id = ?').get(id) ?? null;
}

export function findActive(db, captainChatId) {
  const rows = db
    .prepare("SELECT * FROM trips WHERE captain_chat_id = ? AND status = 'open' ORDER BY id")
    .all(String(captainChatId));
  if (rows.length > 1) {
    throw new Error(
      `trips.findActive: ${rows.length} open trips for captain ${captainChatId}; multi-open arbitration is task 3.1b`,
    );
  }
  return rows[0] ?? null;
}

export function confirmOpen(db, id, patch = {}) {
  const fields = {
    ...patch,
    status: 'confirmed',
    confirmed_at: patch.confirmed_at ?? new Date().toISOString(),
  };
  return update(db, id, fields);
}

export function findUnsynced(db) {
  return db
    .prepare(
      "SELECT * FROM trips WHERE status = 'confirmed' AND sheet_synced_at IS NULL ORDER BY id",
    )
    .all();
}

export function markSynced(db, id, syncedAt = new Date().toISOString()) {
  const { changes } = db
    .prepare('UPDATE trips SET sheet_synced_at = ?, updated_at = ? WHERE id = ?')
    .run(syncedAt, new Date().toISOString(), id);
  return changes;
}

export function update(db, id, patch) {
  const cols = COLUMNS.filter((c) => Object.prototype.hasOwnProperty.call(patch, c));
  if (cols.length === 0) return 0;
  const sets = cols.map((c) => `${c} = ?`).join(', ');
  const values = cols.map((c) => patch[c]);
  const { changes } = db
    .prepare(`UPDATE trips SET ${sets}, updated_at = ? WHERE id = ?`)
    .run(...values, new Date().toISOString(), id);
  return changes;
}

export function remove(db, id) {
  const { changes } = db.prepare('DELETE FROM trips WHERE id = ?').run(id);
  return changes;
}
