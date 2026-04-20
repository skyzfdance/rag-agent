import { getRetrievalConfig } from '@/config/retrieval';
import type { MediaRef } from '@/shared/types/index';
import type { RetrievedChunk, RetrievedSource, RetrievedExercise } from '../../retrieval.types';
import type { RetrievalState, RetrievalStateUpdate } from '../retrieval-state';

/**
 * merge_filter_rank 节点
 *
 * 合并多路检索结果，做去重、分数过滤、数量裁剪，
 * 构建给 synthesize_context 的候选集。
 *
 * 课程/文档 chunk 走分数过滤和数量裁剪，
 * 试题走独立的数量裁剪（无向量分数，按结构化查询获取）。
 *
 * 裁剪规则（按设计文档 9.4 节）：
 * 1. chunk: 先按 minScore 过滤低分 → 按 maxSnippets 限制数量
 * 2. 试题: 按 maxExercises 限制数量
 * 3. 去重 mediaRefs（以 src 为唯一标识）
 * 4. 去重 sources（按来源类型分别去重）
 *
 * @param state - Retrieval Graph 当前状态
 * @returns 状态更新：aggregated 字段
 */
export function mergeFilterRank(state: RetrievalState): RetrievalStateUpdate {
  const { retrievalBudget } = getRetrievalConfig();

  // 收集所有来源的 hits（课程 + 文档）
  const allHits = [...(state.courses?.hits ?? []), ...(state.documents?.hits ?? [])];

  // ① 按 minScore 过滤
  const aboveThreshold = allHits.filter((hit) => hit.score >= retrievalBudget.minScore);

  // ② 按分数降序排列，截取 maxSnippets
  aboveThreshold.sort((a, b) => b.score - a.score);
  const filteredHits = aboveThreshold.slice(0, retrievalBudget.maxSnippets);

  // ③ 去重 mediaRefs
  const mediaRefs = deduplicateMediaRefs(filteredHits);

  // ④ 试题裁剪（试题无向量分数，直接按数量限制）
  const allExercises = state.exercises?.hits ?? [];
  const filteredExercises = allExercises.slice(0, retrievalBudget.maxExercises);

  // ⑤ 去重 sources（合并 chunk 来源 + 试题来源）
  const sources = deduplicateSources(filteredHits, filteredExercises);

  return {
    aggregated: {
      mediaRefs,
      sources,
      filteredHits,
      filteredExercises,
    },
  };
}

/**
 * 从 chunk 列表中提取去重的 mediaRefs
 *
 * @param hits - 检索命中的 chunk 列表
 * @returns 以 src 为唯一标识去重后的 mediaRefs
 */
function deduplicateMediaRefs(hits: RetrievedChunk[]): MediaRef[] {
  const seen = new Set<string>();
  const result: MediaRef[] = [];

  for (const hit of hits) {
    for (const ref of hit.mediaRefs) {
      if (!seen.has(ref.src)) {
        seen.add(ref.src);
        result.push(ref);
      }
    }
  }

  return result;
}

/**
 * 从 chunk 和试题列表中提取去重的来源信息
 *
 * 课程来源以 courseId+chapterId+label 去重，
 * 文档来源以 documentId+page+label 去重，
 * 试题来源以 courseId+chapterId 去重（同一章节的试题合并为一条来源）。
 *
 * @param hits - 检索命中的 chunk 列表
 * @param exercises - 检索命中的试题列表
 * @returns 去重后的来源信息
 */
function deduplicateSources(
  hits: RetrievedChunk[],
  exercises: RetrievedExercise[]
): RetrievedSource[] {
  const seen = new Set<string>();
  const result: RetrievedSource[] = [];

  for (const hit of hits) {
    if (hit.sourceType === 'document') {
      const meta = hit.documentMeta;
      const label = meta?.sectionTitle || meta?.fileName || '未知文档';
      const key = `doc_${meta?.documentId ?? ''}_${meta?.page ?? ''}_${label}`;

      if (!seen.has(key)) {
        seen.add(key);
        result.push({
          type: 'document',
          label,
          courseId: hit.courseId,
          documentMeta: meta,
        });
      }
    } else {
      const label = hit.headingPath || hit.title || '未知来源';
      const key = `course_${hit.courseId ?? ''}_${hit.chapterId ?? ''}_${label}`;

      if (!seen.has(key)) {
        seen.add(key);
        result.push({
          type: 'course',
          label,
          courseId: hit.courseId,
          chapterId: hit.chapterId,
        });
      }
    }
  }

  // 试题来源：同一章节的试题合并为一条
  for (const ex of exercises) {
    const key = `exercise_${ex.courseId}_${ex.chapterId}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({
        type: 'exercise',
        label: `相关试题（${exercises.filter((e) => e.courseId === ex.courseId && e.chapterId === ex.chapterId).length} 题）`,
        courseId: ex.courseId,
        chapterId: ex.chapterId,
      });
    }
  }

  return result;
}
