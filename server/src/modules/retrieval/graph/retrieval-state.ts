import { Annotation } from '@langchain/langgraph';
import type { MediaRef } from '@/shared/types/index';
import type {
  RetrievedChunk,
  RetrievedSource,
  RetrievedExercise,
  RetrievedWebResult,
  RetrievalResult,
} from '../retrieval.types';

// ──────────────────────────────────────────────
// 子类型定义
// ──────────────────────────────────────────────

/** 试题暴露策略 */
export type ExerciseExposure = 'find' | 'explain';

/** 检索意图分析结果 */
export interface RetrievalIntent {
  /** 是否需要课程检索 */
  needsCourseSearch: boolean;
  /** 是否需要文档检索 */
  needsDocumentSearch: boolean;
  /** 是否需要试题检索 */
  needsExerciseSearch: boolean;
  /** 是否可能需要联网兜底 */
  mayNeedWebFallback: boolean;
  /**
   * 试题暴露策略（仅 needsExerciseSearch 为 true 时有意义）
   *
   * - 'find': 用户要找题/练习 → llmContext 只给题干和选项，不暴露答案
   * - 'explain': 用户要讲解/解析 → llmContext 给完整答案与解析
   */
  exerciseExposure: ExerciseExposure;
}

/** 课程检索中间结果 */
export interface CoursesResult {
  /** 课程检索命中的 chunk 列表 */
  hits: RetrievedChunk[];
  /** 命中结果中出现的去重课程 ID */
  topCourseIds: number[];
  /** 命中结果中出现的去重课程+章节引用，供后续试题检索使用 */
  topChapterRefs: Array<{ courseId: number; chapterId: number }>;
}

/** 文档检索中间结果 */
export interface DocumentsResult {
  /** 文档检索命中的 chunk 列表 */
  hits: RetrievedChunk[];
}

/** 试题检索中间结果 */
export interface ExercisesResult {
  /** 检索命中的试题列表 */
  hits: RetrievedExercise[];
}

/** 充分性评估结果 */
export interface SufficiencyResult {
  /** 当前检索结果是否足以回答问题 */
  isEnough: boolean;
  /** 评估原因（调试用） */
  reason?: string;
}

/** 联网搜索中间结果 */
export interface WebResult {
  /** 联网搜索命中列表 */
  hits: RetrievedWebResult[];
}

/** 聚合后的检索结果（merge_filter_rank 节点输出） */
export interface AggregatedResult {
  /** 去重后的多媒体资源引用 */
  mediaRefs: MediaRef[];
  /** 去重后的来源信息 */
  sources: RetrievedSource[];
  /** 经裁剪后保留给 synthesize_context 的候选 chunk */
  filteredHits: RetrievedChunk[];
  /** 经裁剪后保留的试题 */
  filteredExercises: RetrievedExercise[];
}

/** 节点执行错误记录 */
export interface RetrievalError {
  /** 出错的节点名称 */
  node: string;
  /** 数据来源类型 */
  sourceType?: 'course' | 'document' | 'exercise' | 'web';
  /** 错误信息 */
  message: string;
}

// ──────────────────────────────────────────────
// Retrieval Graph 状态定义
// ──────────────────────────────────────────────

/**
 * Retrieval Graph 状态注解
 *
 * 使用 LangGraph Annotation.Root 定义状态结构。
 * 大部分字段使用"最后写入生效"语义，errors 使用累加 reducer。
 */
export const RetrievalStateAnnotation = Annotation.Root({
  /** 用户查询文本 */
  query: Annotation<string>,

  /** 检索意图分析结果 */
  intent: Annotation<RetrievalIntent>,

  /** 课程检索中间结果 */
  courses: Annotation<CoursesResult>,

  /** 文档检索中间结果 */
  documents: Annotation<DocumentsResult>,

  /** 试题检索中间结果 */
  exercises: Annotation<ExercisesResult>,

  /** 聚合裁剪后的检索结果 */
  aggregated: Annotation<AggregatedResult>,

  /** 充分性评估结果 */
  sufficiency: Annotation<SufficiencyResult>,

  /** 联网搜索中间结果 */
  web: Annotation<WebResult>,

  /** 最终收口结果，synthesize_context 节点输出 */
  result: Annotation<RetrievalResult | null>,

  /** 节点执行错误记录，多个节点可累加 */
  errors: Annotation<RetrievalError[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),
});

/** Retrieval Graph 状态类型 */
export type RetrievalState = typeof RetrievalStateAnnotation.State;

/** Retrieval Graph 状态更新类型 */
export type RetrievalStateUpdate = typeof RetrievalStateAnnotation.Update;
