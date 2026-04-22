import { getDb } from '@/providers/sqlite';
import type { SaveAssistantMessageRecordInput } from './types';
import {
  COUNT_SESSION_MESSAGES_SQL,
  INSERT_USER_MESSAGE_SQL,
  INSERT_ASSISTANT_MESSAGE_SQL,
  UPDATE_TURN_MEMORY_ELIGIBLE_SQL,
} from '../sql/memory.sql';
import {
  hasSessionUnsafe,
  touchSessionUnsafe,
  updateSessionTitleUnsafe,
} from './session-state.repository';

/**
 * 统计会话消息数量
 *
 * @param sessionId - 会话 ID
 * @returns 会话消息总数
 */
export function countSessionMessages(sessionId: string): number {
  const row = getDb().prepare(COUNT_SESSION_MESSAGES_SQL).get(sessionId) as { cnt: number };
  return row.cnt;
}

/**
 * 保存用户消息和 AI 回复（Unsafe：必须在 withSessionMutex 内调用）
 *
 * Agent 中间的 tool 调用不存，只存最终的 user + assistant 消息。
 * 使用事务保证两条消息原子写入，避免只写入一半导致记忆脏数据。
 *
 * @param sessionId - 会话 ID
 * @param userContent - 用户消息内容
 * @param assistantContent - AI 回复内容
 */
export function saveUserMessageUnsafe(
  sessionId: string,
  turnId: string,
  userContent: string
): boolean {
  const db = getDb();
  let saved = false;

  db.transaction(() => {
    if (!hasSessionUnsafe(sessionId)) {
      return;
    }

    const msgCount = countSessionMessages(sessionId);
    if (msgCount === 0) {
      const title = userContent.slice(0, 30);
      updateSessionTitleUnsafe(sessionId, title);
    }

    db.prepare(INSERT_USER_MESSAGE_SQL).run(sessionId, turnId, 'user', userContent);

    touchSessionUnsafe(sessionId);
    saved = true;
  })();

  return saved;
}

/**
 * 保存 assistant 终态快照（Unsafe：必须在 withSessionMutex 内调用）
 *
 * user 已在请求开始后单独入库，这里只负责 assistant 终态快照，
 * 并按轮次统一更新 memory_eligible，保证失败轮次整体不进入记忆链路。
 *
 * @param input - assistant 终态落库入参
 */
export function saveAssistantMessageUnsafe(input: SaveAssistantMessageRecordInput): boolean {
  const { sessionId, turnId, content, parts, metadata, memoryEligible } = input;
  const db = getDb();
  let saved = false;

  db.transaction(() => {
    if (!hasSessionUnsafe(sessionId)) {
      return;
    }

    db.prepare(INSERT_ASSISTANT_MESSAGE_SQL).run(
      sessionId,
      turnId,
      'assistant',
      content,
      JSON.stringify(parts),
      JSON.stringify(metadata),
      memoryEligible ? 1 : 0
    );

    db.prepare(UPDATE_TURN_MEMORY_ELIGIBLE_SQL).run(memoryEligible ? 1 : 0, sessionId, turnId);

    touchSessionUnsafe(sessionId);
    saved = true;
  })();

  return saved;
}
