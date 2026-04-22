import { z } from 'zod';
import { tool } from 'ai';
import { tavilySearch } from '@/providers/tavily.provider';
import { getRetrievalConfig } from '@/config/retrieval';

/**
 * 联网搜索 Tool
 *
 * Agent 通过此 tool 搜索互联网，获取最新信息或知识库中没有的内容。
 * 内部流程：query → Tavily API → 格式化截断 → 返回文本。
 */
export const webSearchTool = tool({
  description: '搜索互联网获取最新信息，用于回答需要实时数据或知识库中没有的问题。传入搜索关键词。',
  inputSchema: z.object({
    query: z.string().describe('搜索关键词'),
  }),
  execute: async ({ query }) => {
    const { toolSearch } = getRetrievalConfig();

    const results = await tavilySearch(query, toolSearch.webSearchMaxResults);

    if (results.length === 0) {
      return '未找到相关搜索结果。';
    }

    const formatted = results.map((item, i) => {
      const content = truncate(item.content, toolSearch.webSearchMaxChars);
      return `[${i + 1}] ${item.title}\n来源: ${item.url}\n${content}`;
    });

    return formatted.join('\n\n');
  },
});

/**
 * 截断文本到指定字符数
 *
 * @param text - 原始文本
 * @param maxChars - 最大字符数
 * @returns 截断后的文本
 */
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '...';
}
