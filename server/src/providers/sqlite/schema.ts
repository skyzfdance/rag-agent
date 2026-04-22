import type Database from 'better-sqlite3';

/**
 * 初始化数据库表结构
 *
 * 幂等操作，使用 CREATE TABLE IF NOT EXISTS，重复调用安全。
 *
 * @param database - SQLite 数据库实例
 */
export function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id           TEXT    PRIMARY KEY,
      course_id    INTEGER NOT NULL,
      chapter_id   INTEGER NOT NULL,
      version      TEXT    NOT NULL,
      content_type TEXT    NOT NULL,
      chunk_index  INTEGER NOT NULL,
      title        TEXT    NOT NULL,
      heading_path TEXT    NOT NULL,
      content      TEXT    NOT NULL,
      tags         TEXT    NOT NULL DEFAULT '[]',
      bubble_notes TEXT    NOT NULL DEFAULT '{}',
      media_refs   TEXT    NOT NULL DEFAULT '[]'
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_course  ON chunks(course_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_chapter ON chunks(chapter_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_version ON chunks(version);

    CREATE TABLE IF NOT EXISTS chat_sessions (
      session_id                TEXT    PRIMARY KEY,
      title                     TEXT    NOT NULL DEFAULT '',
      summary                   TEXT,
      last_compacted_message_id INTEGER,
      last_prompt_tokens        INTEGER,
      summary_updated_at        INTEGER,
      updated_at                INTEGER NOT NULL DEFAULT (unixepoch()),
      last_message_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      created_at                INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      TEXT    NOT NULL,
      turn_id         TEXT,
      role            TEXT    NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content         TEXT    NOT NULL,
      parts_json      TEXT,
      meta_json       TEXT,
      memory_eligible INTEGER NOT NULL DEFAULT 1,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_chat_session      ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_session_turn ON chat_messages(session_id, turn_id);
  `);
}
