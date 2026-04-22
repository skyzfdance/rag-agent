import { getDb } from './client';
import { INSERT_CHAT_MESSAGE_SQL } from './sql/chat-message.sql';

/**
 * 写入一条聊天消息
 *
 * @param sessionId - 会话 ID
 * @param role - 消息角色（user / assistant / system）
 * @param content - 消息内容
 */
export function insertChatMessage(
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string
): void {
  getDb().prepare(INSERT_CHAT_MESSAGE_SQL).run(sessionId, role, content);
}
