export const INSERT_CHUNKS_SQL = `
  INSERT OR REPLACE INTO chunks
    (id, course_id, chapter_id, version, content_type, chunk_index,
     title, heading_path, content, tags, bubble_notes, media_refs)
  VALUES
    (@id, @course_id, @chapter_id, @version, @content_type, @chunk_index,
     @title, @heading_path, @content, @tags, @bubble_notes, @media_refs)
`;

export const DELETE_CHUNKS_BY_VERSION_SQL = 'DELETE FROM chunks WHERE version = ?';

/**
 * 构建按主键批量删除 chunk 的 SQL
 * @param placeholders - `IN (...)` 子句里的占位符片段
 * @returns 完整 SQL 字符串
 */
export function buildDeleteChunksByIdsSql(placeholders: string): string {
  return `DELETE FROM chunks WHERE id IN (${placeholders})`;
}

export const DELETE_CHUNKS_BY_COURSE_AND_CHAPTER_SQL =
  'DELETE FROM chunks WHERE course_id = ? AND chapter_id = ? AND version != ?';

export const DELETE_CHUNKS_BY_COURSE_SQL =
  'DELETE FROM chunks WHERE course_id = ? AND version != ?';

/**
 * 构建 chunk 总数统计 SQL
 * @param where - 可选的 WHERE 子句片段
 * @returns 完整 SQL 字符串
 */
export function buildCountChunksSql(where: string): string {
  return `SELECT COUNT(*) AS cnt FROM chunks ${where}`;
}

/**
 * 构建 chunk 列表查询 SQL
 * @param where - 可选的 WHERE 子句片段
 * @returns 完整 SQL 字符串
 */
export function buildListChunksSql(where: string): string {
  return `SELECT * FROM chunks ${where} ORDER BY course_id, chapter_id, chunk_index LIMIT ? OFFSET ?`;
}

export const GET_CHUNK_BY_ID_SQL = 'SELECT * FROM chunks WHERE id = ?';

/**
 * 构建 chunk 元数据更新 SQL
 * @param sets - 需要更新的字段赋值片段
 * @returns 完整 SQL 字符串
 */
export function buildUpdateChunkMetaSql(sets: string[]): string {
  return `UPDATE chunks SET ${sets.join(', ')} WHERE id = ?`;
}

export const DELETE_CHUNK_BY_ID_SQL = 'DELETE FROM chunks WHERE id = ?';
