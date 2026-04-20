import type { RetrievalState, RetrievalStateUpdate } from '../retrieval-state';
import { tavilySearch } from '@/providers/tavily.provider';
import { getRetrievalConfig } from '@/config/retrieval';

/**
 * maybe_web_fallback 节点
 *
 * 仅在 sufficiency.isEnough === false 时执行。
 * 调用 Tavily 联网搜索获取补充信息，复用现有 web-search 底层逻辑。
 *
 * 失败时不中断 Graph，仅返回空结果并记录错误。
 *
 * @param state - Retrieval Graph 当前状态
 * @returns 状态更新：web 字段，失败时附带 errors
 */
export async function maybeWebFallback(state: RetrievalState): Promise<RetrievalStateUpdate> {
  try {
    const { toolSearch } = getRetrievalConfig();
    const results = await tavilySearch(state.query, toolSearch.webSearchMaxResults);

    return {
      web: {
        hits: results.map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.content,
          score: r.score,
        })),
      },
    };
  } catch (err) {
    return {
      web: { hits: [] },
      errors: [
        {
          node: 'maybe_web_fallback',
          sourceType: 'web',
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }
}
