import type { RetrievalState, RetrievalStateUpdate } from '../retrieval-state';
import { searchExercises } from '../../services/exercise-retrieval.service';

/**
 * retrieve_exercises 节点
 *
 * 根据课程检索命中的 topChapterRefs，从 MySQL 查询关联试题。
 * 查询路径：fa_textbooks_chapter_resource（resource_type='test'）
 *          → fa_course_questions
 *
 * 失败时不中断 Graph，仅返回空结果并记录错误。
 *
 * @param state - Retrieval Graph 当前状态
 * @returns 状态更新：exercises 字段，失败时附带 errors
 */
export async function retrieveExercises(state: RetrievalState): Promise<RetrievalStateUpdate> {
  try {
    const chapterRefs = state.courses?.topChapterRefs ?? [];
    const hits = await searchExercises(chapterRefs);

    return {
      exercises: { hits },
    };
  } catch (err) {
    return {
      exercises: { hits: [] },
      errors: [
        {
          node: 'retrieve_exercises',
          sourceType: 'exercise',
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }
}
