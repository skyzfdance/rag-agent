import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import type { LanguageModel } from 'ai';
import { getLLMConfig } from '@/config/index';
import { getRetrievalConfig } from '@/config/retrieval';
import { LLMRateLimiter } from '@/shared/utils/rate-limiter';

/** RPM + TPM 双维度速率限制器单例 */
let rateLimiter: LLMRateLimiter | null = null;

/**
 * 获取速率限制器（单例模式）
 *
 * 使用 retrieval config 中的 MODEL_RPM / MODEL_TPM 初始化。
 * 所有模型调用共享同一个限制器，防止多路并发超限被 429。
 *
 * @returns LLMRateLimiter 实例
 */
function getRateLimiter(): LLMRateLimiter {
  if (!rateLimiter) {
    const { model } = getRetrievalConfig();
    rateLimiter = new LLMRateLimiter(model.rpm, model.tpm);
  }
  return rateLimiter;
}

/**
 * 创建经过速率限制的 fetch 函数
 *
 * 在每次 HTTP 请求前检查 RPM 和 TPM 两个维度，
 * 任一超限则阻塞等待。注入到 provider 的 fetch 选项，
 * 对上层调用透明。
 *
 * @returns 包装后的 fetch 函数
 */
function createRateLimitedFetch(): typeof globalThis.fetch {
  return async (input, init) => {
    await getRateLimiter().acquire();
    return globalThis.fetch(input, init);
  };
}

/**
 * 上报本次 LLM 调用的实际 token 用量
 *
 * 调用方在 LLM 返回结果后调用此函数，将实际 token 消耗
 * 扣减到 TPM 令牌桶。如果累计用量超限，后续调用会被自动阻塞。
 *
 * @param tokens - 本次调用实际消耗的 token 数（prompt + completion）
 */
export function reportTokenUsage(tokens: number): void {
  getRateLimiter().reportUsage(tokens);
}

/** provider 名称，用作 providerOptions 的 key */
export const LLM_PROVIDER_NAME = 'dashscope';

/** AI SDK provider 单例 */
let provider: ReturnType<typeof createOpenAICompatible> | null = null;

/**
 * 获取 DashScope AI SDK Provider（单例模式）
 *
 * 通过 @ai-sdk/openai-compatible 创建 OpenAI 兼容 provider，
 * 注入限流 fetch 和 includeUsage 配置。
 * provider 实例本身不锁定模型参数，temperature / enable_thinking 等
 * 参数在每次 streamText / generateText 调用时按需传入。
 *
 * @returns AI SDK provider 实例
 */
export function getProvider() {
  if (!provider) {
    const config = getLLMConfig();

    provider = createOpenAICompatible({
      name: LLM_PROVIDER_NAME,
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
      /** 一定显示 usage，用来做 token 统计 */
      includeUsage: true,
      fetch: createRateLimitedFetch(),
    });
  }

  return provider;
}

/**
 * 获取指定模型的 AI SDK LanguageModel 引用
 *
 * 返回的是模型引用，不携带调用参数。
 * temperature / providerOptions 等参数在 streamText / generateText 调用时传入。
 *
 * @param modelName - 模型名称，默认使用环境变量配置的 CHAT_MODEL_NAME
 * @returns AI SDK LanguageModel 实例
 */
export function getModel(modelName?: string): LanguageModel {
  const config = getLLMConfig();
  return getProvider()(modelName ?? config.chatModelName);
}

/** chat 函数的可选配置 */
export interface ChatOptions {
  /** 中止信号 */
  signal?: AbortSignal;
  /** 温度参数，默认 0 */
  temperature?: number;
  /** 是否需要思维链 */
  reasoning?: boolean;
}

/**
 * 发送单轮对话请求
 *
 * 简化的封装，接收 system prompt 和 user message，返回模型的文本回复。
 * 适用于 tags 提取、意图判断等结构化输出场景。
 *
 * @param systemPrompt - 系统提示词，定义模型角色和输出格式
 * @param userMessage - 用户输入内容
 * @param options - 可选配置
 * @returns 模型回复的文本内容
 */
export async function chat(
  systemPrompt: string,
  userMessage: string,
  options?: ChatOptions
): Promise<string> {
  const result = await generateText({
    model: getModel(),
    system: systemPrompt,
    prompt: userMessage,
    temperature: options?.temperature ?? 0,
    abortSignal: options?.signal,
    providerOptions: {
      [LLM_PROVIDER_NAME]: { enable_thinking: options?.reasoning ?? false },
    },
  });

  // 上报实际 token 用量到 TPM 限流器
  if (result.usage.totalTokens) {
    reportTokenUsage(result.usage.totalTokens);
  }

  return result.text;
}
