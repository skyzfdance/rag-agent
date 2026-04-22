export const COUNT_SESSIONS_BY_TITLE_SQL =
  'SELECT COUNT(*) AS cnt FROM chat_sessions WHERE title LIKE ?';

export const LIST_SESSIONS_BY_TITLE_SQL =
  'SELECT session_id, title, created_at, last_message_at FROM chat_sessions WHERE title LIKE ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?';

export const COUNT_SESSIONS_SQL = 'SELECT COUNT(*) AS cnt FROM chat_sessions';

export const LIST_SESSIONS_SQL =
  'SELECT session_id, title, created_at, last_message_at FROM chat_sessions ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?';

export const UPDATE_SESSION_TITLE_SQL = 'UPDATE chat_sessions SET title = ? WHERE session_id = ?';

export const DELETE_SESSION_MESSAGES_SQL = 'DELETE FROM chat_messages WHERE session_id = ?';

export const DELETE_SESSION_SQL = 'DELETE FROM chat_sessions WHERE session_id = ?';
