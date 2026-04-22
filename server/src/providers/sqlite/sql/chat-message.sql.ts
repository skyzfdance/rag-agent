export const INSERT_CHAT_MESSAGE_SQL =
  'INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)';

export const GET_SESSION_MESSAGES_TOTAL_SQL =
  'SELECT COUNT(*) AS cnt FROM chat_messages WHERE session_id = ?';

export const GET_SESSION_MESSAGES_SQL =
  'SELECT id, role, content, parts_json, meta_json, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?';
