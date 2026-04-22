export const GET_COURSE_SQL = 'SELECT id, title, description FROM {表名} WHERE id = ?';

/**
 * 构建按附件 ID 批量查询章节资源的 SQL
 * @param placeholders - `IN (...)` 子句里的占位符片段
 * @returns 完整 SQL 字符串
 */
export function buildGetChapterResourcesSql(placeholders: string): string {
  return `SELECT id, curriculum_id, chapter_id, attach, resource
     FROM {表名}
     WHERE curriculum_id = ? AND chapter_id = ? AND attach IN (${placeholders})`;
}

export const GET_CHAPTER_SQL = `SELECT id, pid, title, content, mate_content
     FROM {表名}
     WHERE curriculum_id = ? AND id = ? AND status = ?`;

export const GET_CHAPTERS_SQL = `SELECT id, pid, title, content, mate_content
     FROM {表名}
     WHERE curriculum_id = ? 
     AND status = ?
     ORDER BY pid ASC, id ASC`;
