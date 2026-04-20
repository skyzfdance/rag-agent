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
      title                     TEXT    NOT NULL DEFAULT '',
      summary                   TEXT,
      last_compacted_message_id INTEGER,
      last_prompt_tokens        INTEGER,
      summary_updated_at        INTEGER,
      created_at                INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  // 兼容已有数据库：若 title / created_at 列不存在则补建，忽略 duplicate column 错误
  // 注意：ALTER TABLE ADD COLUMN 只接受常量默认值，不能用 (unixepoch())
  const migrations = [
    `ALTER TABLE chat_sessions ADD COLUMN title TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE chat_sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0`,
  ];
  for (const sql of migrations) {
    try {
      database.exec(sql);
    } catch {
      // 列已存在，忽略
    }
  }
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

/* ─────────────── 会话管理 CRUD ─────────────── */

/** 会话列表查询结果行 */
interface SessionRow {
  /** 会话 ID */
  session_id: string;
  /** 会话标题 */
  title: string;
  /** 创建时间（unix 秒） */
  created_at: number;
}

/** 分页查询会话列表的返回结构 */
export interface SessionListResult {
  /** 当前页的会话列表 */
  list: SessionRow[];
  /** 符合条件的总数 */
  total: number;
}

/**
 * 分页查询会话列表，支持按标题模糊搜索
 *
 * @param page - 页码，从 1 开始
 * @param pageSize - 每页数量
 * @param keyword - 可选，标题模糊搜索关键词
 * @returns 分页结果，包含列表和总数
 */
export function listSessions(page: number, pageSize: number, keyword?: string): SessionListResult {
  const database = getDb();
  const offset = (page - 1) * pageSize;

  // 有关键词时走 LIKE 模糊匹配
  if (keyword) {
    const pattern = `%${keyword}%`;
    const total = database
      .prepare('SELECT COUNT(*) AS cnt FROM chat_sessions WHERE title LIKE ?')
      .get(pattern) as { cnt: number };
    const list = database
      .prepare(
        'SELECT session_id, title, created_at FROM chat_sessions WHERE title LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      )
      .all(pattern, pageSize, offset) as SessionRow[];
    return { list, total: total.cnt };
  }

  const total = database.prepare('SELECT COUNT(*) AS cnt FROM chat_sessions').get() as {
    cnt: number;
  };
  const list = database
    .prepare(
      'SELECT session_id, title, created_at FROM chat_sessions ORDER BY created_at DESC LIMIT ? OFFSET ?'
    )
    .all(pageSize, offset) as SessionRow[];
  return { list, total: total.cnt };
}

/** 消息详情查询结果行 */
interface MessageRow {
  /** 消息自增 ID */
  id: number;
  /** 消息角色 */
  role: string;
  /** 消息内容 */
  content: string;
  /** 创建时间（unix 秒） */
  created_at: number;
}

/** 消息分页查询的返回结构 */
export interface MessageListResult {
  /** 当前页的消息列表（按 created_at DESC, id DESC 倒序） */
  list: MessageRow[];
  /** 该会话的消息总数 */
  total: number;
}

/**
 * 分页查询指定会话的消息，倒序返回
 *
 * 按 created_at DESC, id DESC 排列，第 1 页即最新消息。
 * 双字段排序保证同秒消息（如同事务写入的 user/assistant）顺序稳定。
 * 前端首次加载拿到最新一页，向上滚动时加载更早的页。
 *
 * @param sessionId - 会话 ID
 * @param page - 页码，从 1 开始（第 1 页 = 最新的一批消息）
 * @param pageSize - 每页数量
 * @returns 分页结果，list 按 created_at, id 正序排列，结果再次反转
 */
export function getSessionMessages(
  sessionId: string,
  page: number,
  pageSize: number
): MessageListResult {
  const database = getDb();
  const offset = (page - 1) * pageSize;

  const total = database
    .prepare('SELECT COUNT(*) AS cnt FROM chat_messages WHERE session_id = ?')
    .get(sessionId) as { cnt: number };

  const rows = database
    .prepare(
      'SELECT id, role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?'
    )
    .all(sessionId, pageSize, offset) as MessageRow[];

  return { list: rows.reverse(), total: total.cnt };
}

/**
 * 修改会话标题
 *
 * @param sessionId - 会话 ID
 * @param title - 新标题
 * @returns 是否实际更新了记录
 */
export function updateSessionTitle(sessionId: string, title: string): boolean {
  const result = getDb()
    .prepare('UPDATE chat_sessions SET title = ? WHERE session_id = ?')
    .run(title, sessionId);
  return result.changes > 0;
}

/**
 * 删除会话及其关联消息
 *
 * 使用事务保证原子性，先删消息再删会话。
 *
 * @param sessionId - 会话 ID
 * @returns 是否实际删除了会话记录
 */
export function deleteSession(sessionId: string): boolean {
  const database = getDb();
  let deleted = false;

  const deleteTx = database.transaction(() => {
    database.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(sessionId);
    const result = database
      .prepare('DELETE FROM chat_sessions WHERE session_id = ?')
      .run(sessionId);
    deleted = result.changes > 0;
  });

  deleteTx();
  return deleted;
}

/* ─────────────── Chunk 管理 CRUD ─────────────── */

/** chunks 表查询结果行 */
export interface ChunkRow {
  /** 主键，格式：{courseId}_{chapterId}_{version}_{chunkIndex} */
  id: string;
  /** 课程 ID */
  course_id: number;
  /** 章节 ID */
  chapter_id: number;
  /** 入库版本号 */
  version: string;
  /** 内容类型 */
  content_type: string;
  /** 分块序号 */
  chunk_index: number;
  /** 章节标题 */
  title: string;
  /** 标题路径 */
  heading_path: string;
  /** 纯文本内容 */
  content: string;
  /** 知识点标签 JSON 字符串 */
  tags: string;
  /** 气泡标注 JSON 字符串 */
  bubble_notes: string;
  /** 多媒体引用 JSON 字符串 */
  media_refs: string;
}

/** chunk 分页查询的返回结构 */
export interface ChunkListResult {
  /** 当前页的 chunk 列表 */
  list: ChunkRow[];
  /** 符合条件的总数 */
  total: number;
}

/**
 * 分页查询 chunk 列表，支持按 courseId / chapterId 筛选
 *
 * @param page - 页码，从 1 开始
 * @param pageSize - 每页数量
 * @param courseId - 可选，按课程筛选
 * @param chapterId - 可选，按章节筛选
 * @returns 分页结果
 */
export function listChunks(
  page: number,
  pageSize: number,
  courseId?: number,
  chapterId?: number
): ChunkListResult {
  const database = getDb();
  const offset = (page - 1) * pageSize;

  // 动态拼接 WHERE 条件
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (courseId !== undefined) {
    conditions.push('course_id = ?');
    params.push(courseId);
  }
  if (chapterId !== undefined) {
    conditions.push('chapter_id = ?');
    params.push(chapterId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = database.prepare(`SELECT COUNT(*) AS cnt FROM chunks ${where}`).get(...params) as {
    cnt: number;
  };

  const list = database
    .prepare(
      `SELECT * FROM chunks ${where} ORDER BY course_id, chapter_id, chunk_index LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset) as ChunkRow[];

  return { list, total: total.cnt };
}

/**
 * 按 ID 查询单个 chunk
 *
 * @param id - chunk 主键
 * @returns chunk 行，不存在时返回 undefined
 */
export function getChunkById(id: string): ChunkRow | undefined {
  return getDb().prepare('SELECT * FROM chunks WHERE id = ?').get(id) as ChunkRow | undefined;
}

/**
 * 更新 chunk 的元数据字段（tags / media_refs）
 *
 * 仅更新 SQLite 侧，Milvus 侧由调用方负责同步。
 *
 * @param id - chunk 主键
 * @param fields - 要更新的字段，传哪个改哪个
 * @returns 是否实际更新了记录
 */
export function updateChunkMeta(
  id: string,
  fields: { tags?: string; mediaRefs?: string }
): boolean {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (fields.tags !== undefined) {
    sets.push('tags = ?');
    params.push(fields.tags);
  }
  if (fields.mediaRefs !== undefined) {
    sets.push('media_refs = ?');
    params.push(fields.mediaRefs);
  }

  if (sets.length === 0) return false;

  params.push(id);
  const result = getDb()
    .prepare(`UPDATE chunks SET ${sets.join(', ')} WHERE id = ?`)
    .run(...params);
  return result.changes > 0;
}

/**
 * 删除单个 chunk（仅 SQLite 侧）
 *
 * Milvus 侧由调用方负责同步删除。
 *
 * @param id - chunk 主键
 * @returns 是否实际删除了记录
 */
export function deleteChunkById(id: string): boolean {
  const result = getDb().prepare('DELETE FROM chunks WHERE id = ?').run(id);
  return result.changes > 0;
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
