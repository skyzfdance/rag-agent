import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { getSqliteConfig } from '@/config/sqlite';
import type { MilvusRecord } from '@/modules/ingest/ingest.types';

/** SQLite 数据库单例 */
let db: Database.Database | null = null;

/**
 * 获取 SQLite 数据库实例（单例模式）
 *
 * 首次调用时自动创建数据库文件和表结构，后续调用复用同一实例。
 *
 * @returns SQLite 数据库实例
 */
export function getDb(): Database.Database {
  if (!db) {
    const { dbPath } = getSqliteConfig();
    // 确保目录存在
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    initSchema(db);
  }
  return db;
}

/**
 * 初始化数据库表结构
 *
 * 幂等操作，使用 CREATE TABLE IF NOT EXISTS，重复调用安全。
 *
 * @param database - SQLite 数据库实例
 */
function initSchema(database: Database.Database): void {
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

    CREATE INDEX IF NOT EXISTS idx_chunks_course    ON chunks(course_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_chapter   ON chunks(chapter_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_version   ON chunks(version);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT    NOT NULL,
      role       TEXT    NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content    TEXT    NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id);

    CREATE TABLE IF NOT EXISTS chat_sessions (
      session_id                TEXT    PRIMARY KEY,
      summary                   TEXT,
      last_compacted_message_id INTEGER,
      last_prompt_tokens        INTEGER,
      summary_updated_at        INTEGER
    );
  `);
}

/**
 * 批量写入 chunk 元数据（不含 embedding）
 *
 * 使用事务保证原子性，INSERT OR REPLACE 支持幂等写入。
 *
 * @param records - 待写入的 Milvus 记录数组（embedding 字段会被忽略）
 */
export function insertChunks(records: MilvusRecord[]): void {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT OR REPLACE INTO chunks
      (id, course_id, chapter_id, version, content_type, chunk_index,
       title, heading_path, content, tags, bubble_notes, media_refs)
    VALUES
      (@id, @course_id, @chapter_id, @version, @content_type, @chunk_index,
       @title, @heading_path, @content, @tags, @bubble_notes, @media_refs)
  `);

  const insertMany = database.transaction((rows: MilvusRecord[]) => {
    for (const r of rows) {
      stmt.run({
        id: r.id,
        course_id: r.course_id,
        chapter_id: r.chapter_id,
        version: r.version,
        content_type: r.content_type,
        chunk_index: r.chunk_index,
        title: r.title,
        heading_path: r.heading_path,
        content: r.content,
        tags: JSON.stringify(r.tags),
        bubble_notes: JSON.stringify(r.bubble_notes),
        media_refs: JSON.stringify(r.media_refs),
      });
    }
  });

  insertMany(records);
}

/**
 * 按 version 精确删除 chunk 记录（用于 Milvus 写入失败时的 SQLite 回滚）
 *
 * @param version - 需要回滚的版本号
 */
export function rollbackChunksByVersion(version: string): void {
  getDb().prepare('DELETE FROM chunks WHERE version = ?').run(version);
}

/**
 * 按 ID 列表精确删除 chunk 记录
 *
 * @param ids - 需要删除的 chunk ID 列表
 */
export function rollbackChunksByIds(ids: string[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  getDb()
    .prepare(`DELETE FROM chunks WHERE id IN (${placeholders})`)
    .run(...ids);
}

/**
 * 按条件删除 chunk 元数据
 *
 * 与 Milvus deleteByFilter 对应，保持双写一致性。
 * 支持两种场景：
 * - 课程级清理：删除 course_id 下所有旧版本
 * - 章节级清理：删除 course_id + chapter_id 下所有旧版本
 *
 * @param courseId - 课程 ID
 * @param version - 当前版本号，不等于此版本的记录将被删除
 * @param chapterId - 可选，传入时限定到章节级别
 */
export function deleteChunks(courseId: number, version: string, chapterId?: number): void {
  const database = getDb();
  if (chapterId !== undefined) {
    database
      .prepare('DELETE FROM chunks WHERE course_id = ? AND chapter_id = ? AND version != ?')
      .run(courseId, chapterId, version);
  } else {
    database
      .prepare('DELETE FROM chunks WHERE course_id = ? AND version != ?')
      .run(courseId, version);
  }
}

/**
 * 写入一条聊天消息
 *
 * @param sessionId - 会话 ID
 * @param role - 消息角色（user / assistant / system）
 * @param content - 消息内容
 */
export function insertChatMessage(
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string
): void {
  getDb()
    .prepare('INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)')
    .run(sessionId, role, content);
}

/**
 * 关闭 SQLite 数据库连接
 *
 * 在进程退出或测试清理时调用。
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
