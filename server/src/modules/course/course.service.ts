import { query } from '@/providers/mysql.provider';
import type {
  Course,
  Chapter,
  CourseRow,
  ChapterRow,
  ChapterResource,
  ChapterResourceRow,
} from './course.types';

/**
 * 查询课程基本信息
 * @param courseId - 课程 ID
 * @returns 课程信息，不存在时返回 null
 */
export async function getCourse(courseId: number): Promise<Course | null> {
  const rows = await query<CourseRow>('SELECT id, title, description FROM {表名} WHERE id = ?', [
    courseId,
  ]);
  return rows[0] ?? null;
}

/**
 * 批量查询章节的扩展资源
 *
 * 根据 attach 字段（对应 HTML 中 expand 节点的 id）批量查询。
 *
 * @param courseId - 课程 ID
 * @param chapterId - 章节 ID
 * @param attachIds - expand 节点 id 列表
 * @returns 资源列表
 */
export async function getChapterResources(
  courseId: number,
  chapterId: number,
  attachIds: string[]
): Promise<ChapterResource[]> {
  if (attachIds.length === 0) return [];
  const placeholders = attachIds.map(() => '?').join(', ');
  return query<ChapterResourceRow>(
    `SELECT id, curriculum_id, chapter_id, attach, resource
     FROM {表名}
     WHERE curriculum_id = ? AND chapter_id = ? AND attach IN (${placeholders})`,
    [courseId, chapterId, ...attachIds]
  );
}

/**
 * 查询单个章节
 * @param courseId - 课程 ID
 * @param chapterId - 章节 ID
 * @param status - 章节状态，默认 3（上架）
 * @returns 章节信息，不存在时返回 null
 */
export async function getChapter(
  courseId: number,
  chapterId: number,
  status = 3
): Promise<Chapter | null> {
  const rows = await query<ChapterRow>(
    `SELECT id, pid, title, content, mate_content
     FROM {表名}
     WHERE curriculum_id = ? AND id = ? AND status = ?`,
    [courseId, chapterId, status]
  );
  return rows[0] ?? null;
}

/**
 * 返回结果按 pid 升序、id 升序排列，保证顶级章节在前、子章节紧随其后。
 * @param courseId - 课程 ID
 * @param status  - 章节状态 状态0=编辑完成未上架 1=审核中 2=拒绝 3=上架 4=删除 5=编辑中
 * @returns 章节列表
 */
export async function getChapters(courseId: number, status = 3): Promise<Chapter[]> {
  return query<ChapterRow>(
    `SELECT id, pid, title, content, mate_content
     FROM {表名}
     WHERE curriculum_id = ? 
     AND status = ?
     ORDER BY pid ASC, id ASC`,
    [courseId, status]
  );
}
