import type { ServerResponse } from 'node:http';
import type { LanguageModel, StopCondition, ToolSet, ModelMessage } from 'ai';
import { streamText, createUIMessageStream, pipeUIMessageStreamToResponse } from 'ai';
import type { UIMessageStreamWriter } from 'ai';

/** 从 streamText 参数中提取 providerOptions 类型 */
type StreamTextProviderOptions = Parameters<typeof streamText>[0]['providerOptions'];
import { reportTokenUsage } from '@/providers/llm.provider';
import { appendAgentLog } from '@/shared/utils/agent-logger';
import { createChatSseDebugWriter } from '@/shared/utils/chat-sse-debugger';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 步骤开始信息 */
export interface StepStartInfo {
  /** 本步序号（从 0 开始） */
  stepNumber: number;
  /** 本步输入的消息数量 */
  messageCount: number;
  /** 输入消息摘要（每条消息的 role + 内容长度） */
  inputSummary: Array<{ role: string; contentLength: number }>;
}

/** streamText 单步完成的结果摘要，传给业务层回调 */
export interface StepFinishInfo {
  /** 本步序号（从 0 开始） */
  stepNumber: number;
  /** 模型给出的终止原因 */
  finishReason: string;
  /** 本步的 token 用量 */
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  /** 本步是否包含 tool 调用 */
  hasToolCalls: boolean;
  /** 本步是否包含 reasoning */
  hasReasoning: boolean;
  /** 本步 reasoning 文本（无 reasoning 时为 undefined） */
  reasoningText: string | undefined;
  /** provider 元数据（模型返回的额外信息） */
  providerMetadata: Record<string, unknown> | undefined;
  /** 发送给 provider 的原始 HTTP 请求体 */
  requestBody: unknown;
  /** 响应 ID */
  responseId: string;
  /** 响应使用的模型 ID */
  responseModelId: string;
  /** 响应时间戳 */
  responseTimestamp: Date;
}

/** Tool 调用开始信息 */
export interface ToolCallStartInfo {
  /** 步骤序号 */
  stepNumber: number | undefined;
  /** 工具名称 */
  toolName: string;
  /** 调用参数 */
  args: unknown;
}

/** Tool 调用结束信息 */
export interface ToolCallFinishInfo {
  /** 步骤序号 */
  stepNumber: number | undefined;
  /** 工具名称 */
  toolName: string;
  /** 调用参数 */
  args: unknown;
  /** 是否成功 */
  success: boolean;
  /** 执行耗时（毫秒） */
  durationMs: number;
  /** 工具返回值（成功时） */
  output?: unknown;
  /** 错误信息（失败时） */
  error?: unknown;
}

/** 流被中止时传给业务层的部分结果 */
export interface StreamAbortInfo {
  /** 中止前已累计的 reasoning 文本（chunk 级精度，含未完成步骤的增量） */
  reasoningText: string | undefined;
}

/** 流执行出错时传给业务层的错误信息 */
export interface StreamErrorInfo {
  /** 捕获的异常 */
  error: unknown;
  /** 出错前已累计的 reasoning 文本（chunk 级精度，含未完成步骤的增量） */
  reasoningText: string | undefined;
}

/** 流式执行结束后传给业务层的终态摘要 */
export interface StreamFinishResult {
  /** 模型最终输出的文本 */
  text: string;
  /** 全步累计的 reasoning 文本（chunk 级精度） */
  reasoningText: string | undefined;
  /** 总步数 */
  stepCount: number;
  /** 最后一步的 finishReason */
  lastFinishReason: string;
  /** 首步的 prompt token 数（用于压缩阈值判断） */
  firstPromptTokens: number | null;
  /** 累计 token 用量 */
  totalUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

/** pipeChatStream 的调用参数 */
export interface ChatStreamOptions {
  /** AI SDK LanguageModel 引用 */
  model: LanguageModel;
  /** 系统提示词 */
  system?: string;
  /** 拼装好的消息数组（history + user） */
  messages: ModelMessage[];
  /** AI SDK tool 对象（key 为工具名） */
  tools?: ToolSet;
  /** 步数控制条件（默认 stepCountIs(1)，即不循环） */
  stopWhen?: StopCondition<ToolSet>;
  /** 温度参数 */
  temperature?: number;
  /** provider 特有选项（如 dashscope.enable_thinking） */
  providerOptions?: StreamTextProviderOptions;
  /** 中止信号 */
  abortSignal?: AbortSignal;

  // ---- 业务回调 ----

  /**
   * 流 writer 就绪后调用，业务层通过 writer 注入 data-* 自定义事件。
   * writer 在流结束前可用，结束后调用无效。
   */
  onStreamReady?: (writer: UIMessageStreamWriter) => void;

  /**
   * 每步开始时调用（experimental）。
   */
  onStepStart?: (info: StepStartInfo) => void;

  /**
   * 每步结束时调用，用于审计日志。
   */
  onStepFinish?: (info: StepFinishInfo) => void;

  /**
   * Tool 开始执行时调用（experimental）。
   */
  onToolCallStart?: (info: ToolCallStartInfo) => void;

  /**
   * Tool 执行完成时调用（experimental）。
   */
  onToolCallFinish?: (info: ToolCallFinishInfo) => void;

  /**
   * 流正常结束后调用，业务层在此做持久化。
   * 在此回调抛出的异常会被捕获并记录，不会影响 SSE 流本身。
   */
  onFinish?: (result: StreamFinishResult) => Promise<void> | void;

  /**
   * 流被中止时调用，携带中止前已累计的部分结果。
   */
  onAbort?: (info: StreamAbortInfo) => Promise<void> | void;

  /**
   * 流执行出错时调用，携带出错前已累计的部分结果。
   */
  onError?: (info: StreamErrorInfo) => Promise<void> | void;

  /**
   * 流终止后必定调用（无论成功/中止/异常），用于释放活跃运行等必须执行的清理。
   * 即使 onFinish/onAbort/onError 抛错，此回调仍会执行。
   */
  onTerminate?: () => Promise<void> | void;

  // ---- 调试 ----

  /** 会话 ID，用于日志关联 */
  sessionId: string;
  /** 用户消息，用于 SSE debug */
  userMessage: string;
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/**
 * 判断错误是否属于中止类错误
 *
 * @param error - 捕获的异常
 * @param signal - 关联的 AbortSignal
 * @returns 是否为中止引起
 */
function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  return false;
}

// ---------------------------------------------------------------------------
// 核心函数
// ---------------------------------------------------------------------------

/**
 * 通用流式聊天基础设施
 *
 * 封装了 AI SDK streamText → createUIMessageStream → pipeUIMessageStreamToResponse
 * 的完整管道，业务侧只需提供 model/messages/tools/callbacks。
 *
 * 职责：
 * - 调用 streamText 并管理 tool 循环
 * - 创建 UIMessageStream，把 streamText 输出合并到 writer
 * - 处理 abort / error 的统一收口
 * - 上报 token 用量到 TPM 限流器
 * - SSE debug 日志
 * - chunk 级 reasoning 文本累计（中止场景也不丢失已流式输出的 reasoning）
 *
 * 不负责：
 * - 会话记忆加载
 * - 消息持久化（通过 onFinish 回调交给业务层）
 * - data-* 自定义事件写入（通过 onStreamReady 回调交给业务层）
 *
 * @param options - 流式配置
 * @param res - Node.js ServerResponse
 */
export function pipeChatStream(options: ChatStreamOptions, res: ServerResponse): void {
  const {
    model,
    system,
    messages,
    tools,
    stopWhen,
    temperature,
    providerOptions,
    abortSignal,
    onStreamReady,
    onStepStart,
    onStepFinish,
    onToolCallStart,
    onToolCallFinish,
    onFinish,
    onAbort,
    onError,
    onTerminate,
    sessionId,
    userMessage,
  } = options;

  const sseDebugWriter = createChatSseDebugWriter({ sessionId, message: userMessage });

  // 跨步骤累计的状态
  let firstPromptTokens: number | null = null;
  const totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  // chunk 级累计，中止时也包含未完成步骤已流出的 reasoning
  let accumulatedReasoningText = '';

  const uiStream = createUIMessageStream({
    execute: async ({ writer }) => {
      // 通知业务层 writer 已就绪
      onStreamReady?.(writer);

      try {
        const result = streamText({
          model,
          system,
          messages,
          tools,
          stopWhen,
          temperature,
          providerOptions,
          abortSignal,

          // chunk 级 reasoning 累计：每个 reasoning-delta 立即记录
          onChunk: ({ chunk }) => {
            if (chunk.type === 'reasoning-delta') {
              accumulatedReasoningText += chunk.text;
            }
          },

          experimental_onStepStart: (event) => {
            onStepStart?.({
              stepNumber: event.stepNumber,
              messageCount: event.messages.length,
              inputSummary: event.messages.map((m) => ({
                role: m.role,
                contentLength:
                  typeof m.content === 'string'
                    ? m.content.length
                    : JSON.stringify(m.content).length,
              })),
            });
          },

          onStepFinish: (event) => {
            // 累计 usage
            const u = event.usage;
            totalUsage.inputTokens += u.inputTokens ?? 0;
            totalUsage.outputTokens += u.outputTokens ?? 0;
            totalUsage.totalTokens += u.totalTokens ?? 0;

            // 采集首步 prompt tokens
            if (firstPromptTokens === null) {
              firstPromptTokens = u.inputTokens ?? null;
            }

            // 上报 token 到 TPM 限流器
            if (u.totalTokens) {
              reportTokenUsage(u.totalTokens);
            }

            // 审计日志回调
            onStepFinish?.({
              stepNumber: event.stepNumber,
              finishReason: event.finishReason,
              usage: {
                inputTokens: u.inputTokens ?? 0,
                outputTokens: u.outputTokens ?? 0,
                totalTokens: u.totalTokens ?? 0,
              },
              hasToolCalls: event.toolCalls.length > 0,
              hasReasoning: event.reasoning.length > 0,
              reasoningText: event.reasoningText,
              providerMetadata: event.providerMetadata as Record<string, unknown> | undefined,
              requestBody: event.request.body,
              responseId: event.response.id,
              responseModelId: event.response.modelId,
              responseTimestamp: event.response.timestamp,
            });
          },

          experimental_onToolCallStart: (event) => {
            onToolCallStart?.({
              stepNumber: event.stepNumber,
              toolName: event.toolCall.toolName,
              args: event.toolCall.input,
            });
          },

          experimental_onToolCallFinish: (event) => {
            if (event.success) {
              onToolCallFinish?.({
                stepNumber: event.stepNumber,
                toolName: event.toolCall.toolName,
                args: event.toolCall.input,
                success: true,
                durationMs: event.durationMs,
                output: event.output,
              });
            } else {
              onToolCallFinish?.({
                stepNumber: event.stepNumber,
                toolName: event.toolCall.toolName,
                args: event.toolCall.input,
                success: false,
                durationMs: event.durationMs,
                error: event.error,
              });
            }
          },
        });

        // 将 streamText 产出的 UI 流合并到 writer
        writer.merge(result.toUIMessageStream());

        // 等待流完全结束，拿到终态
        const text = await result.text;
        const steps = await result.steps;

        const lastStep = steps[steps.length - 1];
        const lastFinishReason = lastStep?.finishReason ?? 'unknown';

        // 业务层持久化回调
        try {
          await onFinish?.({
            text,
            reasoningText: accumulatedReasoningText || undefined,
            stepCount: steps.length,
            lastFinishReason,
            firstPromptTokens,
            totalUsage: { ...totalUsage },
          });
        } catch (persistErr) {
          appendAgentLog({
            event: 'stream_persist_error',
            sessionId,
            error: persistErr instanceof Error ? persistErr.message : String(persistErr),
          });
        }
      } catch (error) {
        // 流中止时 writer 会自动关闭，这里只需处理业务回调
        if (isAbortError(error, abortSignal)) {
          try {
            await onAbort?.({
              reasoningText: accumulatedReasoningText || undefined,
            });
          } catch (abortErr) {
            appendAgentLog({
              event: 'stream_abort_error',
              sessionId,
              error: abortErr instanceof Error ? abortErr.message : String(abortErr),
            });
          }
          return;
        }

        // 非中止错误
        try {
          await onError?.({
            error,
            reasoningText: accumulatedReasoningText || undefined,
          });
        } catch (errCbErr) {
          appendAgentLog({
            event: 'stream_error_callback_error',
            sessionId,
            error: errCbErr instanceof Error ? errCbErr.message : String(errCbErr),
          });
        }
        throw error;
      } finally {
        // 无论成功/中止/异常，保证清理回调执行
        try {
          await onTerminate?.();
        } catch (terminateErr) {
          appendAgentLog({
            event: 'stream_terminate_error',
            sessionId,
            error: terminateErr instanceof Error ? terminateErr.message : String(terminateErr),
          });
        }
      }
    },
  });

  // 输出到 HTTP Response
  pipeUIMessageStreamToResponse({
    response: res,
    stream: uiStream,
    consumeSseStream: ({ stream }) => {
      sseDebugWriter.consumeSseStream({ stream });
    },
  });
}
