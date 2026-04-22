import type {
  PersistedAssistantPart,
  StoredMessageMetadata,
} from '@/modules/retrieval/retrieval.types';

/** chat_sessions 表查询结果行 */
export interface SessionRow {
  /** 历史摘要正文，无摘要时为 null */
  summary: string | null;
  /** 最后一条已被摘要覆盖的消息 ID，查询时用 id > 此值过滤 */
  last_compacted_message_id: number | null;
  /** 最近一轮请求的 prompt token 数，用于估算当前会话占用 */
  last_prompt_tokens: number | null;
}

/** chat_messages 表查询结果行 */
export interface MessageRow {
  /** 消息自增 ID */
  id: number;
  /** 消息角色 */
  role: 'user' | 'assistant' | 'system';
  /** 持久化的消息正文 */
  content: string;
  /** 创建时间（unix 秒） */
  created_at: number;
}

/** assistant 终态落库入参 */
export interface SaveAssistantMessageRecordInput {
  /** 会话 ID */
  sessionId: string;
  /** 轮次 ID */
  turnId: string;
  /** 助手正文 */
  content: string;
  /** 最终归档 parts */
  parts: PersistedAssistantPart[];
  /** 历史元数据 */
  metadata: StoredMessageMetadata;
  /** 是否进入记忆 */
  memoryEligible: boolean;
}
