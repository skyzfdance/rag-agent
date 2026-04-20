import type { RowDataPacket } from 'mysql2/promise';
import { query } from '@/providers/mysql.provider';
import { getRetrievalConfig } from '@/config/retrieval';
import type { RetrievedExercise, ExerciseType } from '../retrieval.types';

/** MySQL fa_course_questions 行类型 */
interface QuestionRow extends RowDataPacket {
  /** 试题 ID */
  id: number;
  /** 题目类型 */
  type: ExerciseType;
  /** 题干 */
  title: string;
  /** 选项 A */
  option_A: string | null;
  /** 选项 B */
  option_B: string | null;
  /** 选项 C */
  option_C: string | null;
  /** 选项 D */
  option_D: string | null;
  /** 选项 E */
  option_E: string | null;
  /** 选项 F */
  option_F: string | null;
  /** 正确答案 */
  right_key: string;
  /** 答案解析 */
  analysis: string | null;
}

/** MySQL fa_textbooks_chapter_resource 行类型 */
interface ResourceRow extends RowDataPacket {
  /** 课程 ID */
  curriculum_id: number;
  /** 章节 ID */
  chapter_id: number;
  /** 逗号分隔的试题 ID 列表 */
  resource: string;
}

/** 课程章节引用 */
interface ChapterRef {
  /** 课程 ID */
  courseId: number;
  /** 章节 ID */
  chapterId: number;
}

/**
 * 将选项字段聚合为数组
 *
 * 跳过 null/空值，只保留有实际内容的选项。
 * 选择题（single/multiple）和判断题（judge）可能有选项，
 * 填空题（fill）和问答题（answer）通常无选项。
 *
 * @param row - MySQL 行数据
 * @returns 选项数组，无选项时返回 undefined
 */
function collectOptions(row: QuestionRow): string[] | undefined {
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
  const fields = [
    row.option_A,
    row.option_B,
    row.option_C,
    row.option_D,
    row.option_E,
    row.option_F,
  ];

  const options: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const val = fields[i];
    if (val != null && val.trim().length > 0) {
      options.push(`${labels[i]}. ${val}`);
    }
  }

  return options.length > 0 ? options : undefined;
}

/**
 * 将 MySQL 行数据映射为 RetrievedExercise
 *
 * @param row - MySQL 查询结果行
 * @param courseId - 关联课程 ID（来自 chapter_resource）
 * @param chapterId - 关联章节 ID（来自 chapter_resource）
 * @returns 标准化的 RetrievedExercise
 */
function toRetrievedExercise(
  row: QuestionRow,
  courseId: number,
  chapterId: number
): RetrievedExercise {
  return {
    id: row.id,
    courseId,
    chapterId,
    type: row.type,
    stem: row.title,
    options: collectOptions(row),
    answer: row.right_key,
    explanation: row.analysis ?? undefined,
  };
}

/**
 * 按课程章节引用检索试题
 *
 * 两步查询：
 * 1. 从 fa_textbooks_chapter_resource 获取 resource_type='test' 的资源行，
 *    解析逗号分隔的试题 ID
 * 2. 批量查询 fa_course_questions 获取试题详情
 *
 * 试题数量受 maxExercises 配置限制。
 *
 * @param chapterRefs - 课程+章节引用列表（通常来自课程检索的 topChapterRefs）
 * @returns 试题列表
 */
export async function searchExercises(chapterRefs: ChapterRef[]): Promise<RetrievedExercise[]> {
  if (chapterRefs.length === 0) return [];

  const { retrievalBudget } = getRetrievalConfig();

  // ① 查询章节关联的试题资源
  const conditions = chapterRefs.map(() => '(curriculum_id = ? AND chapter_id = ?)').join(' OR ');
  const params = chapterRefs.flatMap((ref) => [ref.courseId, ref.chapterId]);

  const resources = await query<ResourceRow>(
    `SELECT curriculum_id, chapter_id, resource
     FROM {表名}
     WHERE resource_type = 'test' AND (${conditions})`,
    params
  );

  // ② 解析试题 ID 并记录章节归属
  const questionChapterMap = new Map<number, ChapterRef>();
  for (const row of resources) {
    const ids = row.resource
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));

    for (const id of ids) {
      // 同一试题出现在多个章节时，保留首次遇到的归属
      if (!questionChapterMap.has(id)) {
        questionChapterMap.set(id, {
          courseId: row.curriculum_id,
          chapterId: row.chapter_id,
        });
      }
    }
  }

  if (questionChapterMap.size === 0) return [];

  // ③ 批量查询试题详情
  const questionIds = [...questionChapterMap.keys()];
  const placeholders = questionIds.map(() => '?').join(', ');

  const questions = await query<QuestionRow>(
    `SELECT id, type, title, option_A, option_B, option_C, option_D, option_E, option_F,
            right_key, analysis
     FROM {表名}
     WHERE id IN (${placeholders}) AND status = 'normal'`,
    questionIds
  );

  // ④ 映射并限制数量
  const exercises = questions.map((q) => {
    const ref = questionChapterMap.get(q.id)!;
    return toRetrievedExercise(q, ref.courseId, ref.chapterId);
  });

  return exercises.slice(0, retrievalBudget.maxExercises);
}
