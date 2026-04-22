import type { MilvusRecord } from '@/modules/ingest/ingest.types';
import { getDb } from './client';
import {
  INSERT_CHUNKS_SQL,
  DELETE_CHUNKS_BY_VERSION_SQL,
  buildDeleteChunksByIdsSql,
  DELETE_CHUNKS_BY_COURSE_AND_CHAPTER_SQL,
  DELETE_CHUNKS_BY_COURSE_SQL,
  buildCountChunksSql,
  buildListChunksSql,
  GET_CHUNK_BY_ID_SQL,
  buildUpdateChunkMetaSql,
  DELETE_CHUNK_BY_ID_SQL,
} from './sql/chunk.sql';

/**
 * 批量写入 chunk 元数据（不含 embedding）
 *
 * 使用事务保证原子性，INSERT OR REPLACE 支持幂等写入。
 *
 * @param records - 待写入的 Milvus 记录数组（embedding 字段会被忽略）
 */
export function insertChunks(records: MilvusRecord[]): void {
  const database = getDb();
  const stmt = database.prepare(INSERT_CHUNKS_SQL);

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
  getDb().prepare(DELETE_CHUNKS_BY_VERSION_SQL).run(version);
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
    .prepare(buildDeleteChunksByIdsSql(placeholders))
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
    database.prepare(DELETE_CHUNKS_BY_COURSE_AND_CHAPTER_SQL).run(courseId, chapterId, version);
  } else {
    database.prepare(DELETE_CHUNKS_BY_COURSE_SQL).run(courseId, version);
  }
}

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

  const total = database.prepare(buildCountChunksSql(where)).get(...params) as {
    cnt: number;
  };

  const list = database
    .prepare(buildListChunksSql(where))
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
  return getDb().prepare(GET_CHUNK_BY_ID_SQL).get(id) as ChunkRow | undefined;
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
    .prepare(buildUpdateChunkMetaSql(sets))
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
  const result = getDb().prepare(DELETE_CHUNK_BY_ID_SQL).run(id);
  return result.changes > 0;
}
