import { requireString } from '@/shared/utils/env';

/** LLM 与 Embedding 模型配置 */
export interface LLMConfig {
  /** OpenAI 兼容 API Key（阿里云百炼） */
  apiKey: string;
  /** OpenAI 兼容 API Base URL */
  baseUrl: string;
  /** 对话模型名称（用于意图判断、tags 提取、回答生成） */
  chatModelName: string;
  /** Embedding 模型名称 */
  embeddingsModelName: string;
}

/**
 * 从环境变量读取 LLM / Embedding 模型配置
 *
 * 四项均为必填，缺失时启动阶段直接报错（fail-fast）。
 *
 * @returns LLM 配置对象
 */
export function getLLMConfig(): LLMConfig {
  return {
    apiKey: requireString('OPENAI_API_KEY'),
    baseUrl: requireString('OPENAI_BASE_URL'),
    chatModelName: requireString('CHAT_MODEL_NAME'),
    embeddingsModelName: requireString('EMBEDDINGS_MODEL_NAME'),
  };
}
