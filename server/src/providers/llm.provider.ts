import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { getLLMConfig } from '@/config/index';

/** LLM 模型单例 */
let chatModel: ChatOpenAI | null = null;

/** 流式模型单例（开启 stream_options.include_usage） */
let streamingChatModel: ChatOpenAI | null = null;

/**
 * 获取 Chat 模型实例（单例模式）
 *
 * 使用 LangChain 的 ChatOpenAI 封装，通过阿里云百炼的 OpenAI 兼容接口
 * 调用 Qwen 3.6 Plus 模型。
 *
 * @returns ChatOpenAI 实例
 */
export function getChatModel(): ChatOpenAI {
  if (!chatModel) {
    const config = getLLMConfig();

    chatModel = new ChatOpenAI({
      model: config.chatModelName,
      apiKey: config.apiKey,
      /**
       * 温度设为 0，确保输出稳定可复现
       * 入库场景（tags 提取）需要确定性输出；
       * 检索场景可在调用时通过 bind({ temperature }) 覆盖
       */
      temperature: 0,
      configuration: {
        baseURL: config.baseUrl,
      },
    });
  }

  return chatModel;
}

/**
 * 获取流式 Chat 模型实例（单例模式）
 *
 * 在基础模型配置上额外开启 streamUsage，让流式响应的最后一个 chunk
 * 返回 usage（prompt_tokens 等）。
 * Qwen 兼容接口要求显式设置 stream_options.include_usage = true 才返回 token 计数。
 *
 * 仅供需要流式 + token 计数的场景使用（如 Agent 对话）。
 *
 * @returns 开启了 streamUsage 的 ChatOpenAI 实例
 */
export function getStreamingChatModel(): ChatOpenAI {
  if (!streamingChatModel) {
    const config = getLLMConfig();

    streamingChatModel = new ChatOpenAI({
      model: config.chatModelName,
      apiKey: config.apiKey,
      temperature: 0,
      /**
       * 对应 OpenAI 接口的 stream_options.include_usage = true
       * 流式模式下在最后一个 chunk 携带 usage 字段
       */
      streamUsage: true,
      configuration: {
        baseURL: config.baseUrl,
      },
    });
  }

  return streamingChatModel;
}

/**
 * 发送单轮对话请求
 *
 * 简化的封装，接收 system prompt 和 user message，返回模型的文本回复。
 * 适用于 tags 提取、意图判断等结构化输出场景。
 *
 * @param systemPrompt - 系统提示词，定义模型角色和输出格式
 * @param userMessage - 用户输入内容
 * @param signal - 可选的中止信号，客户端断连时自动取消请求
 * @returns 模型回复的文本内容
 */
export async function chat(
  systemPrompt: string,
  userMessage: string,
  signal?: AbortSignal
): Promise<string> {
  const model = getChatModel();

  const response = await model.invoke(
    [new SystemMessage(systemPrompt), new HumanMessage(userMessage)],
    { signal }
  );

  // response.content 可能是 string 或 MessageContentComplex[]，这里取文本
  return typeof response.content === 'string'
    ? response.content
    : response.content.map((c) => ('text' in c ? c.text : '')).join('');
}
