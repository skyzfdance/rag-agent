import { stepCountIs } from 'ai';
import type { UIMessageStreamWriter } from 'ai';
import { getModel, LLM_PROVIDER_NAME } from '@/providers/llm.provider';
import { createKnowledgeSearchTool } from '@/modules/retrieval/tools/knowledge-search';
import { webSearchTool } from '../tools/web-search';
import { appendAgentLog } from '@/shared/utils/agent-logger';
import type { RetrievalResult } from '@/modules/retrieval/retrieval.types';
import type { ChatStreamOptions } from '@/shared/streaming/chat-stream';
import { SYSTEM_PROMPT } from '../prompts/chat-system.prompt';
import {
  dedupeMediaRefs,
  dedupeSources,
  MAX_PERSISTED_MEDIA_REFS,
  MAX_PERSISTED_SOURCES,
  MAX_PERSISTED_EXERCISE_PREVIEWS,
  limitSnapshotItems,
  NODE_STEP_LABELS,
  mapFinishStatus,
} from '../utils/assistant-snapshot';
import { truncateForLog } from '../utils/log-preview';
import { updatePromptTokens } from '@/modules/memory/memory.service';
import { isCurrentRun, type createActiveChatRun } from '../utils/chat-run-manager';
import type { FinalizeAssistantSnapshot, StreamChatState } from './stream-chat.types';

/**
 * 创建 pipeChatStream 所需的完整配置
 *
 * 将 knowledgeSearch tool 和所有流回调集中在一个地方，
 * 让主流程文件只保留编排。
 */
export function createChatStreamOptions(options: {
  sessionId: string;
  turnId: string;
  message: string;
  messages: ChatStreamOptions['messages'];
  showReasoning: boolean;
  agentRecursionLimit: number;
  modelConfig: { maxCotTokens: number };
  activeRun: ReturnType<typeof createActiveChatRun>;
  finishRunOnce: () => void;
  finalizeAssistantSnapshot: FinalizeAssistantSnapshot;
  state: StreamChatState;
}): ChatStreamOptions {
  const {
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
  } = options;

  // ⑤ 创建 writer 引用，供 Tool 回调写入 data-* 事件
  let streamWriter: UIMessageStreamWriter | null = null;

  // ⑥ 创建每请求的 knowledgeSearchTool
  const knowledgeSearch = createKnowledgeSearchTool({
    onNodeComplete: (node: string) => {
      if (!streamWriter) return;
      const label = NODE_STEP_LABELS[node];
      if (label) {
        streamWriter.write({
          type: 'data-retrieval-status',
          data: { step: node, label },
        } as never);
      }
    },
    onResult: (result: RetrievalResult) => {
      if (result.errors.length > 0) {
        appendAgentLog({
          event: 'retrieval_errors',
          sessionId,
          errors: result.errors,
        });
      }

      const { mediaRefs, sources, exercisePreview } = result.frontendPayload;
      state.persistedMediaRefs = limitSnapshotItems(
        dedupeMediaRefs([...state.persistedMediaRefs, ...mediaRefs]),
        MAX_PERSISTED_MEDIA_REFS
      );
      state.persistedSources = limitSnapshotItems(
        dedupeSources([...state.persistedSources, ...sources]),
        MAX_PERSISTED_SOURCES
      );
      state.persistedExercisePreviews = limitSnapshotItems(
        [...state.persistedExercisePreviews, ...exercisePreview],
        MAX_PERSISTED_EXERCISE_PREVIEWS
      );

      if (!streamWriter) return;
      if (mediaRefs.length > 0) {
        streamWriter.write({ type: 'data-media-refs', data: mediaRefs } as never);
      }
      if (sources.length > 0) {
        streamWriter.write({ type: 'data-sources', data: sources } as never);
      }
      if (exercisePreview.length > 0) {
        streamWriter.write({ type: 'data-exercise-preview', data: exercisePreview } as never);
      }
    },
  });

  return {
    model: getModel(),
    system: SYSTEM_PROMPT,
    temperature: 0,
    messages,
    tools: { knowledge_search: knowledgeSearch, web_search: webSearchTool },
    stopWhen: stepCountIs(agentRecursionLimit),
    providerOptions: {
      [LLM_PROVIDER_NAME]: showReasoning
        ? { enable_thinking: true, thinking_budget: modelConfig.maxCotTokens }
        : { enable_thinking: false },
    },
    abortSignal: activeRun.controller.signal,
    sessionId,
    userMessage: message,

    onStreamReady: (writer) => {
      streamWriter = writer;
    },

    onStepStart: (info) => {
      appendAgentLog({
        event: 'llm_step_start',
        sessionId,
        stepNumber: info.stepNumber,
        messageCount: info.messageCount,
        inputSummary: info.inputSummary,
      });
    },

    onStepFinish: (info) => {
      appendAgentLog({
        event: 'llm_step_end',
        sessionId,
        stepNumber: info.stepNumber,
        finishReason: info.finishReason,
        usage: info.usage,
        hasToolCalls: info.hasToolCalls,
        hasReasoning: info.hasReasoning,
        reasoningPreview: info.reasoningText ? truncateForLog(info.reasoningText) : undefined,
        providerMetadata: info.providerMetadata,
        requestBody: info.requestBody,
        responseId: info.responseId,
        responseModelId: info.responseModelId,
        responseTimestamp: info.responseTimestamp,
      });
    },

    onToolCallStart: (info) => {
      appendAgentLog({
        event: 'tool_start',
        sessionId,
        stepNumber: info.stepNumber,
        toolName: info.toolName,
        argsPreview: truncateForLog(info.args),
      });
    },

    onToolCallFinish: (info) => {
      appendAgentLog({
        event: 'tool_end',
        sessionId,
        stepNumber: info.stepNumber,
        toolName: info.toolName,
        success: info.success,
        durationMs: info.durationMs,
        outputPreview: info.success ? truncateForLog(info.output) : undefined,
        error: info.success
          ? undefined
          : info.error instanceof Error
            ? { message: info.error.message, stack: info.error.stack }
            : String(info.error),
      });
    },

    onFinish: async (result) => {
      streamWriter = null;

      // reasoning 由基础设施层 chunk 级累计，直接使用
      state.persistedReasoning = result.reasoningText ?? '';

      const status = mapFinishStatus(result);
      const assistantContent = result.text.trim().length > 0 ? result.text : null;

      const { thinkingDurationMs, persisted } = await finalizeAssistantSnapshot(
        status,
        assistantContent
      );

      // 更新 prompt tokens
      if (persisted && isCurrentRun(sessionId, activeRun) && result.firstPromptTokens !== null) {
        updatePromptTokens(sessionId, result.firstPromptTokens);
      }

      appendAgentLog({
        event: 'stream_end',
        sessionId,
        turnId,
        status,
        persisted,
        stepCount: result.stepCount,
        lastFinishReason: result.lastFinishReason,
        promptTokens: result.firstPromptTokens,
        thinkingDurationMs,
        assistantContentLength: assistantContent?.length ?? 0,
      });
    },

    onAbort: async (info) => {
      streamWriter = null;

      // chunk 级累计的 reasoning，包含未完成步骤已流出的增量
      state.persistedReasoning = info.reasoningText ?? '';

      const { thinkingDurationMs, persisted } = await finalizeAssistantSnapshot('aborted', null);
      appendAgentLog({
        event: 'stream_end',
        sessionId,
        turnId,
        status: 'aborted',
        persisted,
        thinkingDurationMs,
      });
    },

    onError: async (info) => {
      streamWriter = null;

      // 出错前已流出的 reasoning 也需要持久化，避免历史回放丢失
      state.persistedReasoning = info.reasoningText ?? '';

      const { thinkingDurationMs, persisted } = await finalizeAssistantSnapshot('error', null);
      appendAgentLog({
        event: 'stream_end',
        sessionId,
        turnId,
        status: 'error',
        persisted,
        error:
          info.error instanceof Error
            ? { message: info.error.message, stack: info.error.stack }
            : String(info.error),
        thinkingDurationMs,
      });
    },

    onTerminate: () => {
      finishRunOnce();
    },
  };
}
