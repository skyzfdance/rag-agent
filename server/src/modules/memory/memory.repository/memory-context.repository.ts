import { getDb } from '@/providers/sqlite';
import type { ChatMessage, SessionMemory } from '@/modules/retrieval/retrieval.types';
import {
  LOAD_MEMORY_SESSION_SQL,
  LOAD_RECENT_MEMORY_MESSAGES_SQL,
  COUNT_UNCOMPACTED_MESSAGES_SQL,
  LOAD_ALL_MESSAGES_FOR_COMPACT_SQL,
} from '../sql/memory.sql';
import type { MessageRow, SessionRow } from './types';

/**
 * 加载会话记忆
 *
 * 从 SQLite 读取压缩摘要 + 最近 N 轮对话原文，
 * 作为 Agent 上下文的一部分。
 *
 * @param sessionId - 会话 ID
 * @param memoryRecentRounds - 最近保留轮数
 * @returns 会话记忆（摘要 + 近期消息）
 */
export function loadMemory(sessionId: string, memoryRecentRounds: number): SessionMemory {
  const db = getDb();

  // 读取会话级摘要
  const session = db.prepare(LOAD_MEMORY_SESSION_SQL).get(sessionId) as SessionRow | undefined;

  // 压缩水位线：只读取该 ID 之后的消息，避免与摘要重复
  const compactedId = session?.last_compacted_message_id ?? 0;

  // 读取最近 N 轮消息（1 轮 = user + assistant，所以取 2N 条）
  const rows = db
    .prepare(LOAD_RECENT_MEMORY_MESSAGES_SQL)
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
 * 统计未压缩消息数量
 *
 * @param sessionId - 会话 ID
 * @param compactedId - 当前压缩水位线
 * @returns 未压缩消息数量
 */
export function countUncompactedMessages(sessionId: string, compactedId: number): number {
  const row = getDb().prepare(COUNT_UNCOMPACTED_MESSAGES_SQL).get(sessionId, compactedId) as {
    count: number;
  };

  return row.count;
}

/**
 * 加载水位线之后的所有消息（正序）
 *
 * @param sessionId - 会话 ID
 * @param compactedId - 当前压缩水位线
 * @returns 水位线后的所有消息
 */
export function loadAllMessagesForCompact(sessionId: string, compactedId: number): MessageRow[] {
  return getDb()
    .prepare(LOAD_ALL_MESSAGES_FOR_COMPACT_SQL)
    .all(sessionId, compactedId) as MessageRow[];
}
