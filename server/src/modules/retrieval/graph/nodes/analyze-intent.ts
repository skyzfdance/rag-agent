import type { RetrievalState, RetrievalStateUpdate } from '../retrieval-state';

/** 试题查找类关键词（用户要找题/练习/做题） */
const EXERCISE_FIND_KEYWORDS = [
  '试题',
  '题目',
  '练习',
  '做题',
  '考试',
  '习题',
  '选择题',
  '判断题',
  '填空题',
  '问答题',
  '考题',
  '测试题',
  '练习题',
  '出题',
  '模拟题',
  '真题',
  '题库',
];

/** 试题讲解类关键词（用户要解析/讲解/看答案） */
const EXERCISE_EXPLAIN_KEYWORDS = ['解析', '讲解', '答案', '解答', '解题', '题解'];

/**
 * analyze_intent 节点
 *
 * 分析用户查询意图，判断需要走哪些检索数据源。
 * 使用规则 + 关键词启发式实现，不引入额外 LLM 调用。
 *
 * 当前策略：
 * - 课程检索：始终启用（核心数据源）
 * - 文档检索：始终启用（补充数据源）
 * - 试题检索：查询包含试题相关关键词时启用
 * - 联网兜底：始终允许（由 assess_sufficiency 决定是否实际触发）
 *
 * 试题暴露策略：
 * - 命中讲解类关键词 → 'explain'（暴露答案与解析）
 * - 仅命中查找类关键词 → 'find'（只给题干和选项，避免剧透）
 *
 * 后续若误判率较高，可升级为规则 + LLM 混合判断。
 *
 * @param state - Retrieval Graph 当前状态
 * @returns 状态更新：intent 字段
 */
export function analyzeIntent(state: RetrievalState): RetrievalStateUpdate {
  const query = state.query;

  // 讲解类优先判断（更具体的意图）
  const wantsExplain = EXERCISE_EXPLAIN_KEYWORDS.some((kw) => query.includes(kw));
  const wantsFind = EXERCISE_FIND_KEYWORDS.some((kw) => query.includes(kw));
  const needsExerciseSearch = wantsExplain || wantsFind;

  return {
    intent: {
      needsCourseSearch: true,
      needsDocumentSearch: true,
      needsExerciseSearch,
      mayNeedWebFallback: true,
      // 命中讲解类关键词时完整暴露，否则仅给题干选项
      exerciseExposure: wantsExplain ? 'explain' : 'find',
    },
  };
}
