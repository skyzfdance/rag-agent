import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { embedQuery } from '@/providers/embedding.provider';
import { search } from '@/providers/milvus.provider';
import { getRetrievalConfig } from '@/config/retrieval';

/** Milvus 搜索结果中的单条记录 */
interface MilvusHit {
  title?: string;
  heading_path?: string;
  content?: string;
  score: number;
}

/**
 * 知识库检索 Tool
 *
 * Agent 通过此 tool 搜索课程知识库，查找与查询语句语义相近的内容。
 * 内部流程：query → embedding → Milvus 向量检索 → 格式化截断 → 返回文本。
 */
export const knowledgeSearchTool = tool(
  async ({ query }) => {
    const { toolSearch } = getRetrievalConfig();

    // 1. 将查询文本转为向量
    const vector = await embedQuery(query);

    // 2. Milvus 向量检索
    const result = await search(vector, toolSearch.knowledgeSearchTopK);
    const hits = (result.results ?? []) as MilvusHit[];

    if (hits.length === 0) {
      return '未找到相关知识库内容。';
    }

    // 3. 格式化（chunk 长度已由 chunker 在入库时控制，检索侧不做二次截断）
    const formatted = hits.map((hit, i) => {
      const title = hit.heading_path || hit.title || '未知标题';
      return `[${i + 1}] ${title}\n${hit.content ?? ''}`;
    });

    return formatted.join('\n\n');
  },
  {
    name: 'knowledge_search',
    description: '搜索课程知识库，用于回答与课程内容相关的问题。传入语义化的检索查询语句。',
    schema: z.object({
      query: z.string().describe('语义化的检索查询语句'),
    }),
  }
);
