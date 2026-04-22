import {
  deleteSession,
  getSessionMessages,
  listSessions,
  updateSessionTitle,
} from '@/providers/sqlite';
import type { MessageListResult, SessionListResult } from '@/providers/sqlite';
import { withSessionMutex } from '@/modules/memory/utils/session-mutex';

/**
 * 分页查询会话列表，支持按标题模糊搜索
 *
 * @param page - 页码，从 1 开始
 * @param pageSize - 每页数量
 * @param keyword - 可选，标题模糊搜索关键词
 * @returns 分页结果，包含列表和总数
 */
export function listSessionPage(
  page: number,
  pageSize: number,
  keyword?: string
): SessionListResult {
  return listSessions(page, pageSize, keyword);
}

/**
 * 分页查询指定会话的消息，倒序返回
 *
 * 按 created_at DESC, id DESC 排列，第 1 页即最新消息。
 * 双字段排序保证同秒消息（如同事务写入的 user/assistant）顺序稳定。
 * 前端首次加载拿到最新一页，向上滚动时加载更早的页。
 *
 * @param sessionId - 会话 ID
 * @param page - 页码，从 1 开始（第 1 页 = 最新的一批消息）
 * @param pageSize - 每页数量
 * @returns 分页结果，list 按 created_at, id 正序排列，结果再次反转
 */
export function getSessionMessagePage(
  sessionId: string,
  page: number,
  pageSize: number
): MessageListResult {
  return getSessionMessages(sessionId, page, pageSize);
}

/**
 * 修改会话标题
 *
 * @param sessionId - 会话 ID
 * @param title - 新标题
 * @returns 是否实际更新了记录
 */
export function renameSession(sessionId: string, title: string): boolean {
  return updateSessionTitle(sessionId, title);
}

/**
 * 删除会话及其关联消息
 *
 * 通过 withSessionMutex 串行化，避免与进行中的 chat 写入竞争
 */
export async function removeSession(sessionId: string): Promise<boolean> {
  return withSessionMutex(sessionId, () => deleteSession(sessionId));
}
