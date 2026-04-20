import { StateGraph, START, END } from '@langchain/langgraph';
import { RetrievalStateAnnotation } from './retrieval-state';
import type { RetrievalState } from './retrieval-state';
import type { RetrievalResult } from '../retrieval.types';
import { analyzeIntent } from './nodes/analyze-intent';
import { retrieveCourses } from './nodes/retrieve-courses';
import { retrieveDocuments } from './nodes/retrieve-documents';
import { retrieveExercises } from './nodes/retrieve-exercises';
import { mergeFilterRank } from './nodes/merge-filter-rank';
import { assessSufficiency } from './nodes/assess-sufficiency';
import { maybeWebFallback } from './nodes/maybe-web-fallback';
import { synthesizeContext } from './nodes/synthesize-context';

/**
 * analyze_intent 后的条件路由
 *
 * 需要课程检索时先走 retrieve_courses，否则直接跳到聚合。
 *
 * @param state - 当前 Graph 状态（已包含 intent）
 * @returns 下一个节点名
 */
function routeAfterIntent(state: RetrievalState): string {
  if (state.intent.needsCourseSearch) {
    return 'retrieve_courses';
  }
  return 'merge_filter_rank';
}

/**
 * retrieve_courses 后的条件路由
 *
 * 课程检索完成后，按优先级依次判断：
 * 文档检索 → 试题检索 → 直接聚合。
 *
 * @param state - 当前 Graph 状态（已包含 intent 和 courses）
 * @returns 下一个节点名
 */
function routeAfterCourses(state: RetrievalState): string {
  if (state.intent.needsDocumentSearch) {
    return 'retrieve_documents';
  }
  if (state.intent.needsExerciseSearch) {
    return 'retrieve_exercises';
  }
  return 'merge_filter_rank';
}

/**
 * retrieve_documents 后的条件路由
 *
 * 文档检索完成后，如果意图需要试题检索则走 retrieve_exercises，
 * 否则直接进入聚合节点。
 *
 * @param state - 当前 Graph 状态
 * @returns 下一个节点名
 */
function routeAfterDocuments(state: RetrievalState): string {
  if (state.intent.needsExerciseSearch) {
    return 'retrieve_exercises';
  }
  return 'merge_filter_rank';
}

/**
 * assess_sufficiency 后的条件路由
 *
 * 检索结果不充分且意图允许联网时，走 maybe_web_fallback；
 * 否则直接进入 synthesize_context。
 *
 * @param state - 当前 Graph 状态（已包含 sufficiency）
 * @returns 下一个节点名
 */
function routeAfterSufficiency(state: RetrievalState): string {
  if (!state.sufficiency?.isEnough && state.intent?.mayNeedWebFallback) {
    return 'maybe_web_fallback';
  }
  return 'synthesize_context';
}

/**
 * 构建 Retrieval Graph
 *
 * 节点编排：
 *   START → analyze_intent
 *         ─→ retrieve_courses
 *              ─→ retrieve_documents
 *                   ─→ retrieve_exercises → merge_filter_rank
 *                   ─→ merge_filter_rank
 *              ─→ retrieve_exercises → merge_filter_rank
 *              ─→ merge_filter_rank
 *         ─→ merge_filter_rank（跳过所有检索）
 *   merge_filter_rank → assess_sufficiency
 *         ─→ maybe_web_fallback → synthesize_context → END
 *         ─→ synthesize_context → END
 *
 * @returns 已编译的 Retrieval Graph 实例
 */
function buildRetrievalGraph() {
  return (
    new StateGraph(RetrievalStateAnnotation)
      .addNode('analyze_intent', analyzeIntent)
      .addNode('retrieve_courses', retrieveCourses) // 课程向量检索
      .addNode('retrieve_documents', retrieveDocuments) // 文档向量库检索
      .addNode('retrieve_exercises', retrieveExercises) // 试题检索
      .addNode('merge_filter_rank', mergeFilterRank) // 合并结果去重
      .addNode('assess_sufficiency', assessSufficiency) // 评估结果
      .addNode('maybe_web_fallback', maybeWebFallback) // 网络web检索
      .addNode('synthesize_context', synthesizeContext) // 格式化输出
      // START → 意图分析
      .addEdge(START, 'analyze_intent')
      // 意图分析后条件路由
      .addConditionalEdges('analyze_intent', routeAfterIntent, [
        'retrieve_courses',
        'merge_filter_rank',
      ])
      // 课程检索后条件路由
      .addConditionalEdges('retrieve_courses', routeAfterCourses, [
        'retrieve_documents',
        'retrieve_exercises',
        'merge_filter_rank',
      ])
      // 文档检索后条件路由
      .addConditionalEdges('retrieve_documents', routeAfterDocuments, [
        'retrieve_exercises',
        'merge_filter_rank',
      ])
      // 试题检索完成 → 聚合
      .addEdge('retrieve_exercises', 'merge_filter_rank')
      // 聚合 → 充分性评估
      .addEdge('merge_filter_rank', 'assess_sufficiency')
      // 充分性评估后条件路由
      .addConditionalEdges('assess_sufficiency', routeAfterSufficiency, [
        'maybe_web_fallback',
        'synthesize_context',
      ])
      // 联网兜底 → 合成
      .addEdge('maybe_web_fallback', 'synthesize_context')
      // 合成 → END
      .addEdge('synthesize_context', END)
      .compile()
  );
}

/** 编译后的 Retrieval Graph 单例 */
let graphInstance: ReturnType<typeof buildRetrievalGraph> | null = null;

/**
 * 获取 Retrieval Graph 实例（单例）
 *
 * Graph 本身无状态（状态通过 invoke 传入），可以安全复用。
 *
 * @returns 已编译的 Retrieval Graph
 */
function getRetrievalGraph() {
  if (!graphInstance) {
    graphInstance = buildRetrievalGraph();
  }
  return graphInstance;
}

/**
 * 节点完成回调类型
 *
 * 每个 Graph 节点执行完成后触发，上层可用于写入 SSE 进度事件。
 */
export type OnNodeComplete = (node: string) => void;

/**
 * 执行检索 Graph 并返回 RetrievalResult
 *
 * 使用 graph.stream() 替代 graph.invoke()，
 * 每个节点完成时通过 onNodeComplete 回调通知上层，
 * 上层可据此向前端发送 data-retrieval-status 进度事件。
 *
 * @param query - 用户查询文本
 * @param onNodeComplete - 可选回调，节点完成时传出节点名称
 * @returns RetrievalResult，包含 llmContext 和 frontendPayload
 */
export async function invokeRetrieval(
  query: string,
  onNodeComplete?: OnNodeComplete
): Promise<RetrievalResult> {
  const graph = getRetrievalGraph();

  let result: RetrievalResult | null = null;

  // streamMode: 'updates' — 每个节点完成后产出 { nodeName: nodeOutput }
  const stream = await graph.stream({ query }, { streamMode: 'updates' });

  for await (const chunk of stream) {
    for (const [nodeName, update] of Object.entries(chunk)) {
      onNodeComplete?.(nodeName);

      // 从 synthesize_context 节点的输出中提取最终结果
      const typed = update as Record<string, unknown>;
      if (typed.result) {
        result = typed.result as RetrievalResult;
      }
    }
  }

  return result!;
}
