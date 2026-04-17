import { getDb } from '@/providers/sqlite.provider';
import { getRetrievalConfig } from '@/config/retrieval';
import type { ChatMessage, SessionMemory, TokenUsage } from './retrieval.types';

/** chat_sessions 表查询结果行 */
interface SessionRow {
  summary: string | null;
  /** 最后一条已被摘要覆盖的消息 ID，查询时用 id > 此值过滤 */
  last_compacted_message_id: number | null;
  last_prompt_tokens: number | null;
}

/** chat_messages 表查询结果行 */
interface MessageRow {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: number;
}

/**
 * 确保会话记录存在
 *
 * 请求开始时调用，保证 chat_sessions 表中有对应行。
 * 使用 INSERT OR IGNORE 幂等写入，避免创建时机分散在不同路径。
 *
 * @param sessionId - 会话 ID
 */
export function ensureSession(sessionId: string): void {
  getDb().prepare('INSERT OR IGNORE INTO chat_sessions (session_id) VALUES (?)').run(sessionId);
}

/**
 * 加载会话记忆
 *
 * 从 SQLite 读取压缩摘要 + 最近 N 轮对话原文，
 * 作为 Agent 上下文的一部分。
 *
 * @param sessionId - 会话 ID
 * @returns 会话记忆（摘要 + 近期消息）
 */
export function loadMemory(sessionId: string): SessionMemory {
  const db = getDb();
  const { memoryRecentRounds } = getRetrievalConfig();

  // 读取会话级摘要
  const session = db
    .prepare(
      'SELECT summary, last_compacted_message_id, last_prompt_tokens FROM chat_sessions WHERE session_id = ?'
    )
    .get(sessionId) as SessionRow | undefined;

  // 压缩水位线：只读取该 ID 之后的消息，避免与摘要重复
  const compactedId = session?.last_compacted_message_id ?? 0;

  // 读取最近 N 轮消息（1 轮 = user + assistant，所以取 2N 条）
  const rows = db
    .prepare(
      'SELECT id, role, content, created_at FROM chat_messages WHERE session_id = ? AND id > ? ORDER BY id DESC LIMIT ?'
    )
    .all(sessionId, compactedId, memoryRecentRounds * 2) as MessageRow[];

  // 倒序取出后反转为正序
  const recentMessages: ChatMessage[] = rows.reverse().map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  }));

  return {
    summary: session?.summary ?? null,
    recentMessages,
  };
}

/**
 * 保存用户消息和 AI 回复（事务）
 *
 * Agent 中间的 tool 调用不存，只存最终的 user + assistant 消息。
 * 使用事务保证两条消息原子写入，避免只写入一半导致记忆脏数据。
 *
 * @param sessionId - 会话 ID
 * @param userContent - 用户消息内容
 * @param assistantContent - AI 回复内容
 */
export function saveMessages(
  sessionId: string,
  userContent: string,
  assistantContent: string
): void {
  const db = getDb();
  const stmt = db.prepare('INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)');

  // 事务保证两条消息原子写入
  db.transaction(() => {
    stmt.run(sessionId, 'user', userContent);
    stmt.run(sessionId, 'assistant', assistantContent);
  })();
}

/**
 * 更新会话的 prompt_tokens
 *
 * 每轮对话结束后，将 API 返回的 usage.prompt_tokens 写入 chat_sessions，
 * 用于下一轮的阈值判断和前端展示。
 *
 * @param sessionId - 会话 ID
 * @param promptTokens - API 返回的 prompt_tokens
 */
export function updatePromptTokens(sessionId: string, promptTokens: number): void {
  getDb()
    .prepare(
      `INSERT INTO chat_sessions (session_id, last_prompt_tokens)
       VALUES (?, ?)
       ON CONFLICT(session_id) DO UPDATE SET last_prompt_tokens = excluded.last_prompt_tokens`
    )
    .run(sessionId, promptTokens);
}

/**
 * 获取会话的 Token 使用情况
 *
 * sessionUsedTokens 取自上一轮 API 返回的 prompt_tokens（精确值），
 * sessionAvailableTokens 根据模型配置计算。
 *
 * @param sessionId - 会话 ID
 * @returns Token 使用情况
 */
export function getTokenUsage(sessionId: string): TokenUsage {
  const db = getDb();
  const { model, answerMaxOutputTokens } = getRetrievalConfig();

  // 读取上一轮的 prompt_tokens
  const session = db
    .prepare('SELECT last_prompt_tokens FROM chat_sessions WHERE session_id = ?')
    .get(sessionId) as { last_prompt_tokens: number | null } | undefined;

  const lastPromptTokens = session?.last_prompt_tokens ?? 0;

  // 计算可用 token 上限：扣除回复预留
  const effectiveMaxInput = Math.min(
    model.maxInputTokens,
    model.contextWindowTokens - answerMaxOutputTokens
  );

  return {
    sessionAvailableTokens: effectiveMaxInput,
    sessionUsedTokens: lastPromptTokens,
  };
}
