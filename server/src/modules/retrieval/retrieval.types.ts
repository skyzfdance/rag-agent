/** 聊天消息 */
export interface ChatMessage {
  /** 消息自增 ID */
  id: number;
  /** 消息角色 */
  role: 'user' | 'assistant' | 'system';
  /** 消息内容 */
  content: string;
  /** 创建时间（unix 秒） */
  createdAt: number;
}

/** 会话记忆（加载后的结构） */
export interface SessionMemory {
  /** 压缩摘要，无摘要时为 null */
  summary: string | null;
  /** 最近 N 轮对话原文（正序） */
  recentMessages: ChatMessage[];
}

/** Token 使用情况 */
export interface TokenUsage {
  /** 当前会话可用 token 上限 */
  sessionAvailableTokens: number;
  /** 当前会话已用 token（上一轮 API 返回的 prompt_tokens） */
  sessionUsedTokens: number;
}
