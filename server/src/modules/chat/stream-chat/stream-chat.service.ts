import type { ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AppError } from '@/shared/errors/app-error';
import { prepareMemoryForRequest, saveUserMessageUnsafe } from '@/modules/memory/memory.service';
import { withSessionMutex } from '@/modules/memory/utils/session-mutex';
import { appendAgentLog } from '@/shared/utils/agent-logger';
import { pipeChatStream } from '@/shared/streaming/chat-stream';
import {
  createActiveChatRun,
  finishActiveChatRun,
  assertCurrentRun,
  isAbortLikeError,
  ChatRunSupersededError,
  ChatRunAbortedError,
} from '../utils/chat-run-manager';
import { buildAgentMessages } from '../utils/message-builder';
import { getRetrievalConfig } from '@/config/retrieval';
import { createFinalizeAssistantSnapshot } from './create-finalize-assistant-snapshot';
import { createChatStreamOptions } from './create-chat-stream-options';
import type { StreamChatState } from './stream-chat.types';

/**
 * 流式聊天主入口
 *
 * 完整流程：
 * 1. 加载会话记忆（摘要 + 近期消息）
 * 2. 拼装消息数组
 * 3. 创建每请求的 knowledgeSearchTool（带 frontendPayload 回调）
 * 4. 调用 pipeChatStream 启动流式执行
 * 5. 在 onFinish 回调中保存消息 + 更新 prompt_tokens + 触发压缩
 *
 * @param sessionId - 会话 ID
 * @param message - 用户消息
 * @param response - Node.js ServerResponse（Express res 兼容）
 * @param options - 可选配置
 */
export async function streamChat(
  sessionId: string,
  message: string,
  response: ServerResponse,
  options: { signal?: AbortSignal; showReasoning?: boolean } = {}
): Promise<void> {
  const { signal, showReasoning = false } = options;
  const { agentRecursionLimit } = getRetrievalConfig();
  const { model: modelConfig } = getRetrievalConfig();
  const turnId = randomUUID();
  const activeRun = createActiveChatRun(sessionId);
  const assistantStartedAt = Date.now();
  let streamStarted = false;
  let activeRunFinished = false;
  const state: StreamChatState = {
    userMessageSaved: false,
    persistedFinalStatus: false,
    persistedReasoning: '',
    persistedMediaRefs: [],
    persistedSources: [],
    persistedExercisePreviews: [],
  };

  /**
   * 只完成一次当前运行的收尾标记
   *
   * @returns 无返回值
   */
  function finishRunOnce(): void {
    if (activeRunFinished) return;
    activeRunFinished = true;
    // onFinish、异常兜底和中止路径都可能来到这里，必须保证运行态只清理一次。
    finishActiveChatRun(sessionId, activeRun);
  }

  const finalizeAssistantSnapshot = createFinalizeAssistantSnapshot({
    sessionId,
    turnId,
    assistantStartedAt,
    showReasoning,
    activeRun,
    state,
  });

  // 关联外部 abort signal
  if (signal) {
    if (signal.aborted) {
      activeRun.controller.abort();
    } else {
      signal.addEventListener('abort', () => activeRun.controller.abort(), { once: true });
    }
  }

  try {
    // ① 准备会话记忆
    const memory = await prepareMemoryForRequest(sessionId);
    assertCurrentRun(sessionId, activeRun);

    // ② 保存用户消息
    state.userMessageSaved = await withSessionMutex(sessionId, () => {
      assertCurrentRun(sessionId, activeRun);
      return saveUserMessageUnsafe(sessionId, turnId, message);
    });
    assertCurrentRun(sessionId, activeRun);

    // ③ 拼装消息
    const messages = buildAgentMessages(memory, message);

    // ④ 日志
    appendAgentLog({
      event: 'stream_start',
      sessionId,
      turnId,
      userMessageSaved: state.userMessageSaved,
      userMessage: message,
      memoryInfo: {
        hasSummary: !!memory.summary,
        recentMessageCount: memory.recentMessages.length,
      },
      totalInputMessages: messages.length + 1, // +1 for system prompt
    });

    // ⑦ 调用流式基础设施
    streamStarted = true;
    const chatStreamOptions = createChatStreamOptions({
      sessionId,
      turnId,
      message,
      messages,
      showReasoning,
      agentRecursionLimit,
      modelConfig,
      activeRun,
      finishRunOnce,
      finalizeAssistantSnapshot,
      state,
    });
    pipeChatStream(chatStreamOptions, response);
  } catch (error) {
    const aborted = isAbortLikeError(error, activeRun.controller.signal);

    if (state.userMessageSaved && !streamStarted) {
      try {
        const { thinkingDurationMs, persisted } = await finalizeAssistantSnapshot(
          aborted ? 'aborted' : 'error',
          null
        );
        appendAgentLog({
          event: 'stream_end',
          sessionId,
          turnId,
          status: aborted ? 'aborted' : 'error',
          persisted,
          error: aborted || !(error instanceof Error) ? undefined : error.message,
          thinkingDurationMs,
        });
      } catch (persistErr) {
        appendAgentLog({
          event: 'stream_end',
          sessionId,
          turnId,
          status: aborted ? 'aborted_save_error' : 'error_save_error',
          error: persistErr instanceof Error ? persistErr.message : String(persistErr),
        });
      }
    }

    finishRunOnce();
    if (!streamStarted && error instanceof ChatRunSupersededError) {
      throw new AppError('当前请求已被新的请求抢占', 409);
    }
    if (!streamStarted && error instanceof ChatRunAbortedError) {
      throw error;
    }
    throw error;
  }
}
