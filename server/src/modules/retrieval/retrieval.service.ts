import { createAgent } from 'langchain';
import type { BaseMessage } from '@langchain/core/messages';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import type { LLMResult } from '@langchain/core/outputs';
import type { Serialized } from '@langchain/core/load/serializable';
import type { Callbacks } from '@langchain/core/callbacks/manager';
import { toUIMessageStream } from '@ai-sdk/langchain';
import { pipeUIMessageStreamToResponse } from 'ai';
import type { ServerResponse } from 'node:http';
import { getStreamingChatModel } from '@/providers/llm.provider';
import { getRetrievalConfig } from '@/config/retrieval';
import { knowledgeSearchTool } from './tools/knowledge-search';
import { webSearchTool } from './tools/web-search';
import { loadMemory, saveMessages, updatePromptTokens, ensureSession } from './memory.service';
import { appendAgentLog } from '@/shared/utils/agent-logger';
import type { SessionMemory } from './retrieval.types';

/**
 * Agent 最终状态类型
 *
 * toUIMessageStream 的 onFinish 回调会传入 LangGraph 最后一次 values 事件的 state，
 * 用于提取最终回复和 token 使用量。
 */
interface AgentFinalState {
  /** Agent 执行过程中的完整消息列表 */
  messages?: BaseMessage[];
}

/**
 * 系统 Prompt
 *
 * 只定义 Agent 角色和回答风格。
 * 不列举具体 tool——每个 tool 的 name + description 会被 Agent 自动注入到 LLM 上下文，
 * LLM 根据 tool 描述自主决策调用，新增 tool 无需修改此 prompt。
 */
const SYSTEM_PROMPT = `你是一个专业的课程学习助手。你的职责是帮助学生理解课程内容、解答疑问。

## 行为准则

- 根据用户问题判断是否需要使用工具，可以组合使用多个工具
- 对于闲聊、简单问候或不需要检索的问题，直接回答即可
- 如果工具返回的结果无法回答用户问题，请如实告知，不要编造内容

## 回答风格

- 使用中文回答
- 条理清晰，适当使用列表和分段
- 引用检索结果时，说明信息来源`;

/**
 * 将会话记忆拼装为 LangChain 消息数组
 *
 * 拼装顺序：系统 prompt → 摘要（如有）→ 历史消息 → 当前用户消息。
 * Agent 每轮调用时都重新拼装，保证上下文最新。
 *
 * @param memory - 从 SQLite 加载的会话记忆
 * @param userMessage - 当前用户输入
 * @returns LangChain BaseMessage 数组
 */
function buildAgentMessages(memory: SessionMemory, userMessage: string) {
  const messages: BaseMessage[] = [];

  // 1. 系统 prompt
  messages.push(new SystemMessage(SYSTEM_PROMPT));

  // 2. 压缩摘要（如果有，以 HumanMessage 注入而非 SystemMessage）
  // 摘要本质是旧对话内容，不应拥有 system 级优先级，否则旧对话里的"指令"可能跨轮污染后续行为
  if (memory.summary) {
    messages.push(
      new HumanMessage(`[对话背景信息，仅供参考]\n以下是之前对话的摘要：\n${memory.summary}`)
    );
  }

  // 3. 最近 N 轮对话原文
  for (const msg of memory.recentMessages) {
    if (msg.role === 'user') {
      messages.push(new HumanMessage(msg.content));
    } else if (msg.role === 'assistant') {
      messages.push(new AIMessage(msg.content));
    }
  }

  // 4. 当前用户消息
  messages.push(new HumanMessage(userMessage));

  return messages;
}

/**
 * 创建 LangChain 回调处理器，记录 LLM 原始交互到日志文件
 *
 * 通过 LangChain 的 callback 机制拦截 LLM 调用的各个阶段，
 * 将原始输入/输出（未经框架包装）写入 JSONL 日志文件，便于调试和审计。
 *
 * @param sessionId - 会话 ID，用于日志关联
 * @returns LangChain Callbacks 数组
 */
function createLoggingCallbacks(sessionId: string): Callbacks {
  return [
    {
      /**
       * LLM 调用开始：记录发送给模型的消息摘要
       */
      handleChatModelStart(_llm: Serialized, messages: BaseMessage[][]) {
        appendAgentLog({
          event: 'llm_start',
          sessionId,
          messageCount: messages[0]?.length ?? 0,
          // 记录每条消息的角色和内容长度，不记录完整内容避免日志膨胀
          messageSummary: messages[0]?.map((m) => ({
            role: m.type,
            contentLength:
              typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length,
          })),
        });
      },

      /**
       * LLM 调用结束：记录原始返回结果
       *
       * output 是 LangChain 未加工的 LLMResult，包含：
       * - generations: 模型生成的内容（含 tool_calls、additional_kwargs 等原始字段）
       * - llmOutput: 模型级别的元信息（token 用量等）
       */
      handleLLMEnd(output: LLMResult) {
        const generation = output.generations?.[0]?.[0];
        // 从 generation.message 中提取原始响应数据
        const msg =
          generation && 'message' in generation
            ? (generation as unknown as { message: Record<string, unknown> }).message
            : undefined;

        appendAgentLog({
          event: 'llm_end',
          sessionId,
          // LLM 原始输出文本
          text: generation?.text,
          // 模型级元信息（token 用量等）
          llmOutput: output.llmOutput,
          // 原始消息对象的关键字段：tool_calls、response_metadata、usage_metadata
          message: msg
            ? {
                additional_kwargs: (msg as Record<string, unknown>).additional_kwargs,
                response_metadata: (msg as Record<string, unknown>).response_metadata,
                usage_metadata: (msg as Record<string, unknown>).usage_metadata,
              }
            : undefined,
        });
      },

      /**
       * LLM 调用出错：记录错误详情
       */
      handleLLMError(error: Error) {
        appendAgentLog({
          event: 'llm_error',
          sessionId,
          error: error.message,
          stack: error.stack,
        });
      },

      /**
       * Tool 调用开始：记录工具名称和输入参数
       */
      handleToolStart(
        _tool: Serialized,
        input: string,
        _runId: string,
        _parentRunId?: string,
        _tags?: string[],
        _metadata?: Record<string, unknown>,
        name?: string
      ) {
        appendAgentLog({
          event: 'tool_start',
          sessionId,
          toolName: name,
          inputLength: input.length,
          // 截取前 500 字符作为预览，避免大段搜索结果撑爆日志
          inputPreview: input.length > 500 ? input.slice(0, 500) + '...' : input,
        });
      },

      /**
       * Tool 调用结束：记录输出摘要
       */
      handleToolEnd(output: string) {
        appendAgentLog({
          event: 'tool_end',
          sessionId,
          outputLength: output.length,
          // 截取前 500 字符作为预览
          outputPreview: output.length > 500 ? output.slice(0, 500) + '...' : output,
        });
      },
    },
  ];
}

/**
 * 创建 LangGraph ReAct Agent
 *
 * 使用 langchain 的 createAgent 初始化 Agent，注册所有可用 tools。
 * Agent 由 LLM 自主决策调用哪些 tool，不做固定路由。
 *
 * @returns ReactAgent 实例
 */
function buildAgent() {
  // 使用开启了 streamUsage 的模型，确保流式响应返回 token 计数
  const model = getStreamingChatModel();

  return createAgent({
    model,
    tools: [knowledgeSearchTool, webSearchTool],
    // 不在此处传 prompt，而是在 .stream() 时通过 messages 传入完整上下文
    // 这样每轮对话可以动态拼装记忆
  });
}

/** Agent 单例 */
let agentInstance: ReturnType<typeof buildAgent> | null = null;

/**
 * 获取 Agent 实例（单例模式）
 *
 * @returns ReactAgent 实例
 */
function getAgent() {
  if (!agentInstance) {
    agentInstance = buildAgent();
  }
  return agentInstance;
}

/**
 * 统计 Agent 本轮执行的循环次数
 *
 * Agent 每循环一次产生一条 AI 消息（可能含 tool_calls）。
 * 只统计 Agent 新产生的 AI 消息，排除输入上下文中的历史 AI 消息，
 * 避免把正常请求误判为 truncated。
 *
 * @param stateMessages - Agent 最终状态中的完整消息列表（含输入 + Agent 产生的）
 * @param inputMessageCount - 传入 Agent 的输入消息数量，用于排除历史消息
 * @returns Agent 本轮循环次数
 */
function countRecursions(stateMessages: BaseMessage[], inputMessageCount: number): number {
  // Agent 产生的消息 = 全部消息 - 输入消息
  return stateMessages.slice(inputMessageCount).filter((m) => AIMessage.isInstance(m)).length;
}

/**
 * 从 Agent 本轮产生的消息中提取最终回复文本
 *
 * 只扫描 Agent 新增的消息（inputMessageCount 之后），不回溯历史记忆，
 * 避免 Agent 未产生有效回复时误取上一轮的 assistant 消息。
 * 跳过 ToolMessage 和仅含 tool_calls（无文本）的 AI 消息。
 *
 * @param stateMessages - Agent 最终状态中的完整消息列表（含输入 + Agent 产生的）
 * @param inputMessageCount - 传入 Agent 的输入消息数量，用于限定扫描范围
 * @returns 最终回复文本，无有效回复时返回 null
 */
function extractFinalReply(stateMessages: BaseMessage[], inputMessageCount: number): string | null {
  // 从后往前扫描，但不越过输入消息的边界
  for (let i = stateMessages.length - 1; i >= inputMessageCount; i--) {
    const msg = stateMessages[i];
    if (!AIMessage.isInstance(msg)) continue;

    const text =
      typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((c) => ('text' in c ? (c as { text: string }).text : '')).join('')
          : '';

    // 有实际文本内容才算有效回复，跳过仅含 tool_calls 的空文本 AI 消息
    if (text.trim().length > 0) return text;
  }

  return null;
}

/**
 * 流式聊天主入口
 *
 * 完整流程：
 * 1. 加载会话记忆（摘要 + 近期消息）
 * 2. 拼装 Agent 输入消息
 * 3. 启动 Agent 流式执行（支持客户端断连中止）
 * 4. 通过 @ai-sdk/langchain 桥接，将 LangGraph stream 转为 Vercel AI SDK 标准 data stream
 * 5. 通过 pipeUIMessageStreamToResponse 输出到 HTTP Response
 * 6. 流结束后保存消息 + 更新 prompt_tokens + 记录调试日志
 *
 * @param sessionId - 会话 ID
 * @param message - 用户消息
 * @param response - Node.js ServerResponse（Express res 兼容）
 * @param signal - 可选的中止信号，客户端断连时自动取消 Agent 执行
 */
export async function streamChat(
  sessionId: string,
  message: string,
  response: ServerResponse,
  signal?: AbortSignal
): Promise<void> {
  const { agentRecursionLimit } = getRetrievalConfig();

  // ⓪ 确保会话记录存在（统一初始化，避免创建时机分散在不同路径）
  ensureSession(sessionId);

  // ① 加载会话记忆
  const memory = loadMemory(sessionId);

  // ② 拼装消息
  const messages = buildAgentMessages(memory, message);

  // 记录流开始事件
  appendAgentLog({
    event: 'stream_start',
    sessionId,
    userMessage: message,
    memoryInfo: {
      hasSummary: !!memory.summary,
      recentMessageCount: memory.recentMessages.length,
    },
    totalInputMessages: messages.length,
  });

  // 记录输入消息数量，供 onFinish 中排除历史消息统计 recursion
  const inputMessageCount = messages.length;

  // ③ Agent 流式执行（streamMode: values + messages 供 @ai-sdk/langchain 桥接）
  const agentStream = await getAgent().stream(
    { messages },
    {
      streamMode: ['values', 'messages'],
      recursionLimit: agentRecursionLimit,
      signal,
      // 注入日志回调，拦截 LLM 和 Tool 的原始输入输出
      callbacks: createLoggingCallbacks(sessionId),
    }
  );

  // ④ LangGraph stream → Vercel AI SDK UIMessageStream
  const uiStream = toUIMessageStream<AgentFinalState>(agentStream, {
    onFinish: async (finalState) => {
      // ⑤ 流结束后：提取最终回复 + 保存消息 + 记录日志
      try {
        const stateMessages = finalState?.messages;
        if (!stateMessages || stateMessages.length === 0) {
          appendAgentLog({
            event: 'stream_end',
            sessionId,
            status: 'empty_state',
          });
          return;
        }

        // 统计本轮 Agent 循环次数（排除输入上下文中的历史 AI 消息）
        const recursions = countRecursions(stateMessages, inputMessageCount);
        const isTruncated = recursions >= agentRecursionLimit;

        // 反向查找最后一条有文本内容的 AI 消息作为最终回复
        // 避免 Agent 被截断时把空回复或 tool 中间结果写入记忆
        const assistantContent = extractFinalReply(stateMessages, inputMessageCount);
        const status =
          assistantContent === null ? 'no_reply' : isTruncated ? 'truncated' : 'completed';

        // 只有提取到有效回复才保存，防止空回复或半成品污染记忆
        if (assistantContent !== null) {
          saveMessages(sessionId, message, assistantContent);
        }

        // 从最后一条 AI 消息提取 usage（token 计数）
        // 逆序找最后一条 AI 消息，不一定是有文本的那条
        const lastAiMsg = [...stateMessages].reverse().find((m) => AIMessage.isInstance(m));
        const usage = lastAiMsg
          ? ((lastAiMsg as unknown as Record<string, unknown>).usage_metadata as
              | { input_tokens?: number }
              | undefined)
          : undefined;

        appendAgentLog({
          event: 'stream_end',
          sessionId,
          status,
          recursions,
          recursionLimit: agentRecursionLimit,
          promptTokens: usage?.input_tokens ?? null,
          assistantContentLength: assistantContent?.length ?? 0,
        });

        if (usage?.input_tokens) {
          updatePromptTokens(sessionId, usage.input_tokens);
        }
      } catch (err) {
        // 保存失败不影响流式输出（已完成），仅记录日志
        appendAgentLog({
          event: 'stream_end',
          sessionId,
          status: 'save_error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    onAbort: () => {
      appendAgentLog({
        event: 'stream_end',
        sessionId,
        status: 'aborted',
      });
    },
    onError: (error) => {
      appendAgentLog({
        event: 'stream_end',
        sessionId,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });

  // ⑥ 通过 SSE 输出到 HTTP Response
  pipeUIMessageStreamToResponse({ response, stream: uiStream });
}
