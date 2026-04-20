import type { RetrievalState, RetrievalStateUpdate } from '../retrieval-state';
import { searchCourses } from '../../services/course-retrieval.service';

/**
 * retrieve_courses 节点
 *
 * 在 courses_collection 中做语义检索，返回课程命中 chunk，
 * 并提取候选 courseId / chapterId 供后续节点使用。
 *
 * 失败时不中断 Graph，仅返回空结果并记录错误。
 *
 * @param state - Retrieval Graph 当前状态
 * @returns 状态更新：courses 字段，失败时附带 errors
 */
export async function retrieveCourses(state: RetrievalState): Promise<RetrievalStateUpdate> {
  try {
    const hits = await searchCourses(state.query);

    // 提取去重的 courseId
    const courseIdSet = new Set<number>();
    for (const hit of hits) {
      if (hit.courseId != null) courseIdSet.add(hit.courseId);
    }

    // 提取去重的 courseId + chapterId 组合
    const chapterRefSet = new Set<string>();
    const topChapterRefs: Array<{ courseId: number; chapterId: number }> = [];
    for (const hit of hits) {
      if (hit.courseId != null && hit.chapterId != null) {
        const key = `${hit.courseId}_${hit.chapterId}`;
        if (!chapterRefSet.has(key)) {
          chapterRefSet.add(key);
          topChapterRefs.push({ courseId: hit.courseId, chapterId: hit.chapterId });
        }
      }
    }

    return {
      courses: {
        hits,
        topCourseIds: [...courseIdSet],
        topChapterRefs,
      },
    };
  } catch (err) {
    return {
      courses: {
        hits: [],
        topCourseIds: [],
        topChapterRefs: [],
      },
      errors: [
        {
          node: 'retrieve_courses',
          sourceType: 'course',
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }
}
