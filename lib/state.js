export function load(db, chatId) {
  const row = db
    .prepare('SELECT body FROM conversation_state WHERE chat_id = ?')
    .get(String(chatId));
  return row ? JSON.parse(row.body) : {};
}

export function save(db, chatId, data) {
  db.prepare(
    `INSERT INTO conversation_state (chat_id, body, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(chat_id) DO UPDATE SET
       body = excluded.body,
       updated_at = excluded.updated_at`,
  ).run(String(chatId), JSON.stringify(data));
}

export function clear(db, chatId) {
  save(db, chatId, { status: 'idle' });
}
