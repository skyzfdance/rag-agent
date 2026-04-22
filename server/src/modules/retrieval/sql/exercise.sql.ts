/**
 * 构建按课程/章节条件检索题目资源映射的 SQL
 * @param conditions - 课程章节过滤条件片段
 * @returns 完整 SQL 字符串
 */
export function buildSearchExerciseResourcesSql(conditions: string): string {
  return `SELECT curriculum_id, chapter_id, resource
     FROM {表名}
     WHERE resource_type = 'test' AND (${conditions})`;
}

/**
 * 构建按题目 ID 批量查询题库详情的 SQL
 * @param placeholders - `IN (...)` 子句里的占位符片段
 * @returns 完整 SQL 字符串
 */
export function buildSearchQuestionsSql(placeholders: string): string {
  return `SELECT id, type, title, option_A, option_B, option_C, option_D, option_E, option_F,
            right_key, analysis
     FROM {表名}
     WHERE id IN (${placeholders}) AND status = 'normal'`;
}
