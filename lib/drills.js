const COLUMNS = [
  'drill_date',
  'drill_type',
  'boat_slug',
  'captain_chat_id',
  'crew_present_text',
  'notes',
  'parse_json',
];

const REQUIRED = ['drill_date', 'drill_type', 'boat_slug', 'captain_chat_id'];

export const DRILL_TYPES = ['abandon_ship', 'mob', 'fire', 'crew_emergency'];

export function create(db, fields) {
  for (const k of REQUIRED) {
    if (fields[k] === undefined || fields[k] === null) {
      throw new Error(`drills.create: missing required field ${k}`);
    }
  }
  const cols = COLUMNS.filter((c) => fields[c] !== undefined);
  const placeholders = cols.map(() => '?').join(', ');
  const values = cols.map((c) => fields[c]);
  const sql = `INSERT INTO drills (${cols.join(', ')}) VALUES (${placeholders})`;
  const { lastInsertRowid } = db.prepare(sql).run(...values);
  return { id: Number(lastInsertRowid) };
}

export function findById(db, id) {
  return db.prepare('SELECT * FROM drills WHERE id = ?').get(id) ?? null;
}
