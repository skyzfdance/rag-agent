import { getDb } from '@/providers/sqlite';
import {
  ENSURE_SESSION_SQL,
  HAS_SESSION_SQL,
  TOUCH_SESSION_SQL,
  LOAD_COMPACT_STATUS_SQL,
  LOAD_SUMMARY_FOR_COMPACT_SQL,
  UPDATE_COMPACTED_SUMMARY_SQL,
  UPDATE_SESSION_TITLE_SQL,
  UPDATE_PROMPT_TOKENS_SQL,
  LOAD_LAST_PROMPT_TOKENS_SQL,
} from '../sql/memory.sql';
import type { SessionRow } from './types';

/**
 * 确保会话记录存在
 *
 * 使用 INSERT OR IGNORE 幂等写入，保证 chat_sessions 表中有对应行。
 *
 * @param sessionId - 会话 ID
 */
export function ensureSession(sessionId: string): void {
  getDb().prepare(ENSURE_SESSION_SQL).run(sessionId);
}

/**
 * 检查会话是否仍存在
 *
 * 删除会话后，后续异步写入必须跳过，避免重新写出孤儿消息或僵尸会话。
 *
 * @param sessionId - 会话 ID
 * @returns 会话是否存在
 */
export function hasSessionUnsafe(sessionId: string): boolean {
  const row = getDb().prepare(HAS_SESSION_SQL).get(sessionId) as { session_id: string } | undefined;

  return !!row;
}

/**
 * 更新会话活跃时间
 *
 * user 入库和 assistant 终态入库都应刷新 last_message_at，
 * 以保证列表按最近活跃时间排序。
 *
 * @param sessionId - 会话 ID
 */
export function touchSessionUnsafe(sessionId: string): void {
  getDb().prepare(TOUCH_SESSION_SQL).run(sessionId);
}

/**
 * 读取会话压缩状态
 *
 * @param sessionId - 会话 ID
 * @returns 会话压缩状态
 */
export function loadCompactStatus(
  sessionId: string
): Pick<SessionRow, 'last_compacted_message_id' | 'last_prompt_tokens'> | undefined {
  return getDb().prepare(LOAD_COMPACT_STATUS_SQL).get(sessionId) as
    | Pick<SessionRow, 'last_compacted_message_id' | 'last_prompt_tokens'>
    | undefined;
}

/**
 * 读取压缩所需的摘要状态
 *
 * @param sessionId - 会话 ID
 * @returns 摘要和水位线
 */
export function loadSummaryForCompact(
  sessionId: string
): Pick<SessionRow, 'summary' | 'last_compacted_message_id'> | undefined {
  return getDb().prepare(LOAD_SUMMARY_FOR_COMPACT_SQL).get(sessionId) as
    | Pick<SessionRow, 'summary' | 'last_compacted_message_id'>
    | undefined;
}

/**
 * 更新会话摘要和压缩水位线
 *
 * @param sessionId - 会话 ID
 * @param summary - 新摘要
 * @param lastCompactedMessageId - 新水位线
 */
export function updateCompactedSummary(
  sessionId: string,
  summary: string,
  lastCompactedMessageId: number
): void {
  getDb().prepare(UPDATE_COMPACTED_SUMMARY_SQL).run(summary, lastCompactedMessageId, sessionId);
}

/**
 * 更新会话标题
 *
 * @param sessionId - 会话 ID
 * @param title - 新标题
 */
export function updateSessionTitleUnsafe(sessionId: string, title: string): void {
  getDb().prepare(UPDATE_SESSION_TITLE_SQL).run(title, sessionId);
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
  if (!hasSessionUnsafe(sessionId)) {
    return;
  }

  getDb().prepare(UPDATE_PROMPT_TOKENS_SQL).run(promptTokens, sessionId);
}

/**
 * 读取上一轮的 prompt_tokens
 *
 * @param sessionId - 会话 ID
 * @returns 上一轮 prompt_tokens
 */
export function loadLastPromptTokens(sessionId: string): number {
  const session = getDb().prepare(LOAD_LAST_PROMPT_TOKENS_SQL).get(sessionId) as
    | { last_prompt_tokens: number | null }
    | undefined;

  return session?.last_prompt_tokens ?? 0;
}
