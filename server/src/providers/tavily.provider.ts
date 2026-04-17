import { tavily } from '@tavily/core';
import { getTavilyConfig } from '@/config/tavily';

/** Tavily 搜索结果条目 */
export interface TavilySearchResult {
  /** 页面标题 */
  title: string;
  /** 页面 URL */
  url: string;
  /** 摘要片段 */
  content: string;
  /** 相关度评分 */
  score: number;
}

/**
 * 调用 Tavily Search API 进行联网搜索
 *
 * 使用官方 @tavily/core SDK，内部自动处理鉴权和请求。
 *
 * @param query - 搜索关键词
 * @param maxResults - 最大返回结果数
 * @returns 搜索结果数组
 */
export async function tavilySearch(
  query: string,
  maxResults: number
): Promise<TavilySearchResult[]> {
  const { apiKey } = getTavilyConfig();
  const client = tavily({ apiKey });

  const response = await client.search(query, {
    maxResults,
    searchDepth: 'basic',
  });

  return (response.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content,
    score: r.score,
  }));
}
