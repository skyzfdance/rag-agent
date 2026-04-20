import type { RetrievalState, RetrievalStateUpdate } from '../retrieval-state';

/**
 * assess_sufficiency 节点
 *
 * 评估当前检索结果是否足以回答用户问题。
 * 不足时，后续 maybe_web_fallback 节点会触发联网搜索兜底。
 *
 * V1 规则（保守策略）：
 * - 有任意 chunk 或试题命中 → 充分
 * - 全部为空 → 不充分
 *
 * 后续可升级为规则 + LLM 混合判断。
 *
 * @param state - Retrieval Graph 当前状态
 * @returns 状态更新：sufficiency 字段
 */
export function assessSufficiency(state: RetrievalState): RetrievalStateUpdate {
  const hitCount = state.aggregated?.filteredHits?.length ?? 0;
  const exerciseCount = state.aggregated?.filteredExercises?.length ?? 0;
  const totalResults = hitCount + exerciseCount;

  if (totalResults > 0) {
    return {
      sufficiency: { isEnough: true },
    };
  }

  return {
    sufficiency: {
      isEnough: false,
      reason: '课程、文档、试题检索均无命中结果',
    },
  };
}
