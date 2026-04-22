import type { MediaRef } from '@/shared/types/index';
import type {
  AssistantStatus,
  RetrievedExercisePreview,
  RetrievedSource,
} from '@/modules/retrieval/retrieval.types';

/** stream-chat 运行期可变状态 */
export interface StreamChatState {
  /** user 消息是否已成功入库 */
  userMessageSaved: boolean;
  /** assistant 终态是否已持久化 */
  persistedFinalStatus: boolean;
  /** 已累计的 reasoning 文本 */
  persistedReasoning: string;
  /** 已累计的媒体引用 */
  persistedMediaRefs: MediaRef[];
  /** 已累计的来源 */
  persistedSources: RetrievedSource[];
  /** 已累计的试题预览 */
  persistedExercisePreviews: RetrievedExercisePreview[];
}

/** assistant 终态持久化函数 */
export type FinalizeAssistantSnapshot = (
  status: AssistantStatus,
  assistantContent: string | null
) => Promise<{ thinkingDurationMs: number; persisted: boolean }>;
