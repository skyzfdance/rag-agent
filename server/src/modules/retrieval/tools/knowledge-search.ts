import { z } from 'zod';
import { tool } from 'langchain';
import { invokeRetrieval } from '../graph/retrieval-graph';
import type { OnNodeComplete } from '../graph/retrieval-graph';
import type { RetrievalResult } from '../retrieval.types';

/**
 * 检索结果回调类型
 *
 * Tool 执行后将完整 RetrievalResult 通过此回调传出，
 * 供上层（streamChat）将 frontendPayload 注入 SSE 流。
 */
export type OnRetrievalResult = (result: RetrievalResult) => void;

/** 工厂函数可选回调集合 */
export interface KnowledgeSearchCallbacks {
  /** 检索完成后传出完整 RetrievalResult */
  onResult?: OnRetrievalResult;
  /** Graph 节点完成时传出节点名称，用于写入 SSE 进度事件 */
  onNodeComplete?: OnNodeComplete;
}

/**
 * 创建知识库检索 Tool（工厂函数）
 *
 * 内部调用 Retrieval Graph 执行完整流程：
 * analyze_intent → retrieve_courses → merge_filter_rank → synthesize_context
 *
 * 通过 callbacks 将检索进度和最终结果传出：
 * - onNodeComplete: 每个节点完成时触发，上层可写入 SSE 进度事件
 * - onResult: 检索完成后传出完整 RetrievalResult，上层注入 SSE data-* 部分
 *
 * Tool 本身仍只向 Agent 返回 llmContext 文本。
 *
 * @param callbacks - 可选回调集合
 * @returns LangChain Tool 实例
 */
export function createKnowledgeSearchTool(callbacks?: KnowledgeSearchCallbacks) {
  return tool(
    async ({ query }) => {
      const result = await invokeRetrieval(query, callbacks?.onNodeComplete);
      callbacks?.onResult?.(result);
      return result.llmContext;
    },
    {
      name: 'knowledge_search',
      description: '搜索课程知识库，用于回答与课程内容相关的问题。传入语义化的检索查询语句。',
      schema: z.object({
        query: z.string().describe('语义化的检索查询语句'),
      }),
    }
  );
}
