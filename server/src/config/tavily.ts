import { requireString } from '@/shared/utils/env';

/** Tavily 配置 */
export interface TavilyConfig {
  /** Tavily API Key */
  apiKey: string;
}

/**
 * 从环境变量读取 Tavily 配置
 *
 * @returns Tavily 配置对象
 */
export function getTavilyConfig(): TavilyConfig {
  return {
    apiKey: requireString('TAVILY_API_KEY'),
  };
}
