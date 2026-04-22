import { saveAssistantMessageUnsafe, ensureCompacted } from '@/modules/memory/memory.service';
import { withSessionMutex } from '@/modules/memory/utils/session-mutex';
import { appendAgentLog } from '@/shared/utils/agent-logger';
import { buildAssistantPartsSnapshot } from '../utils/assistant-snapshot';
import { isCurrentRun, type createActiveChatRun } from '../utils/chat-run-manager';
import type { FinalizeAssistantSnapshot, StreamChatState } from './stream-chat.types';

/**
 * 创建 assistant 终态快照持久化函数
 *
 * 将原本位于 streamChat 内部的终态持久化逻辑抽出，
 * 让主流程只保留编排。
 */
export function createFinalizeAssistantSnapshot(options: {
  sessionId: string;
  turnId: string;
  assistantStartedAt: number;
  showReasoning: boolean;
  activeRun: ReturnType<typeof createActiveChatRun>;
  state: StreamChatState;
}): FinalizeAssistantSnapshot {
  const { sessionId, turnId, assistantStartedAt, showReasoning, activeRun, state } = options;

  /**
   * 持久化 assistant 终态快照
   *
   * 幂等：多次调用只有首次生效。
   */
  return async (
    status: Parameters<FinalizeAssistantSnapshot>[0],
    assistantContent: Parameters<FinalizeAssistantSnapshot>[1]
  ): Promise<{ thinkingDurationMs: number; persisted: boolean }> => {
    if (state.persistedFinalStatus) {
      return {
        thinkingDurationMs: Math.max(0, Date.now() - assistantStartedAt),
        persisted: false,
      };
    }

    state.persistedFinalStatus = true;
    const thinkingDurationMs = Math.max(0, Date.now() - assistantStartedAt);

    if (!state.userMessageSaved) {
      return { thinkingDurationMs, persisted: false };
    }

    const content = assistantContent ?? '';
    const parts = buildAssistantPartsSnapshot({
      content,
      reasoning: state.persistedReasoning,
      mediaRefs: state.persistedMediaRefs,
      sources: state.persistedSources,
      exercisePreviews: state.persistedExercisePreviews,
      showReasoning,
    });

    const assistantSaved = await withSessionMutex(sessionId, () => {
      return saveAssistantMessageUnsafe({
        sessionId,
        turnId,
        content,
        parts,
        status,
        thinkingDurationMs,
      });
    });

    if (assistantSaved && isCurrentRun(sessionId, activeRun)) {
      ensureCompacted(sessionId).catch((err) => {
        appendAgentLog({
          event: 'compact_error',
          sessionId,
          turnId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    return { thinkingDurationMs, persisted: assistantSaved };
  };
}
