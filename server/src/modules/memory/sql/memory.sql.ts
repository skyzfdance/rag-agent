export const ENSURE_SESSION_SQL =
  'INSERT OR IGNORE INTO chat_sessions (session_id, created_at, updated_at, last_message_at) VALUES (?, unixepoch(), unixepoch(), unixepoch())';

export const HAS_SESSION_SQL = 'SELECT session_id FROM chat_sessions WHERE session_id = ?';

export const TOUCH_SESSION_SQL =
  'UPDATE chat_sessions SET updated_at = unixepoch(), last_message_at = unixepoch() WHERE session_id = ?';

export const LOAD_MEMORY_SESSION_SQL =
  'SELECT summary, last_compacted_message_id, last_prompt_tokens FROM chat_sessions WHERE session_id = ?';

export const LOAD_RECENT_MEMORY_MESSAGES_SQL =
  'SELECT id, role, content, created_at FROM chat_messages WHERE session_id = ? AND id > ? AND memory_eligible = 1 ORDER BY id DESC LIMIT ?';

export const LOAD_COMPACT_STATUS_SQL =
  'SELECT last_compacted_message_id, last_prompt_tokens FROM chat_sessions WHERE session_id = ?';

export const COUNT_UNCOMPACTED_MESSAGES_SQL =
  'SELECT COUNT(*) as count FROM chat_messages WHERE session_id = ? AND id > ? AND memory_eligible = 1';

export const LOAD_SUMMARY_FOR_COMPACT_SQL =
  'SELECT summary, last_compacted_message_id FROM chat_sessions WHERE session_id = ?';

export const LOAD_ALL_MESSAGES_FOR_COMPACT_SQL =
  'SELECT id, role, content, created_at FROM chat_messages WHERE session_id = ? AND id > ? AND memory_eligible = 1 ORDER BY id ASC';

export const UPDATE_COMPACTED_SUMMARY_SQL = `UPDATE chat_sessions
     SET summary = ?, last_compacted_message_id = ?, summary_updated_at = unixepoch()
     WHERE session_id = ?`;

export const COUNT_SESSION_MESSAGES_SQL =
  'SELECT COUNT(*) AS cnt FROM chat_messages WHERE session_id = ?';

export const UPDATE_SESSION_TITLE_SQL = 'UPDATE chat_sessions SET title = ? WHERE session_id = ?';

export const INSERT_USER_MESSAGE_SQL =
  'INSERT INTO chat_messages (session_id, turn_id, role, content, memory_eligible) VALUES (?, ?, ?, ?, 0)';

export const INSERT_ASSISTANT_MESSAGE_SQL =
  'INSERT INTO chat_messages (session_id, turn_id, role, content, parts_json, meta_json, memory_eligible) VALUES (?, ?, ?, ?, ?, ?, ?)';

export const UPDATE_TURN_MEMORY_ELIGIBLE_SQL =
  'UPDATE chat_messages SET memory_eligible = ? WHERE session_id = ? AND turn_id = ?';

export const UPDATE_PROMPT_TOKENS_SQL =
  'UPDATE chat_sessions SET last_prompt_tokens = ? WHERE session_id = ?';

export const LOAD_LAST_PROMPT_TOKENS_SQL =
  'SELECT last_prompt_tokens FROM chat_sessions WHERE session_id = ?';
