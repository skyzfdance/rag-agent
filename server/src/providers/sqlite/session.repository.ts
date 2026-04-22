import { getDb } from './client';
import {
  COUNT_SESSIONS_BY_TITLE_SQL,
  LIST_SESSIONS_BY_TITLE_SQL,
  COUNT_SESSIONS_SQL,
  LIST_SESSIONS_SQL,
  UPDATE_SESSION_TITLE_SQL,
  DELETE_SESSION_MESSAGES_SQL,
  DELETE_SESSION_SQL,
} from './sql/session.sql';

/** 会话列表查询结果行 */
interface SessionRow {
  /** 会话 ID */
  session_id: string;
  /** 会话标题 */
  title: string;
  /** 创建时间（unix 秒） */
  created_at: number;
  /** 最后活跃时间（unix 秒） */
  last_message_at: number;
}

/** 分页查询会话列表的返回结构 */
export interface SessionListResult {
  /** 当前页的会话列表 */
  list: SessionRow[];
  /** 符合条件的总数 */
  total: number;
}

/**
 * 分页查询会话列表，支持按标题模糊搜索
 *
 * @param page - 页码，从 1 开始
 * @param pageSize - 每页数量
 * @param keyword - 可选，标题模糊搜索关键词
 * @returns 分页结果，包含列表和总数
 */
export function listSessions(page: number, pageSize: number, keyword?: string): SessionListResult {
  const database = getDb();
  const offset = (page - 1) * pageSize;

  // 有关键词时走 LIKE 模糊匹配
  if (keyword) {
    const pattern = `%${keyword}%`;
    const total = database.prepare(COUNT_SESSIONS_BY_TITLE_SQL).get(pattern) as { cnt: number };
    const list = database
      .prepare(LIST_SESSIONS_BY_TITLE_SQL)
      .all(pattern, pageSize, offset) as SessionRow[];
    return { list, total: total.cnt };
  }

  const total = database.prepare(COUNT_SESSIONS_SQL).get() as {
    cnt: number;
  };
  const list = database.prepare(LIST_SESSIONS_SQL).all(pageSize, offset) as SessionRow[];
  return { list, total: total.cnt };
}

/**
 * 修改会话标题
 *
 * @param sessionId - 会话 ID
 * @param title - 新标题
 * @returns 是否实际更新了记录
 */
export function updateSessionTitle(sessionId: string, title: string): boolean {
  const result = getDb().prepare(UPDATE_SESSION_TITLE_SQL).run(title, sessionId);
  return result.changes > 0;
}

/**
 * 删除会话及其关联消息
 *
 * 使用事务保证原子性，先删消息再删会话。
 *
 * @param sessionId - 会话 ID
 * @returns 是否实际删除了会话记录
 */
export function deleteSession(sessionId: string): boolean {
  const database = getDb();
  let deleted = false;

  const deleteTx = database.transaction(() => {
    database.prepare(DELETE_SESSION_MESSAGES_SQL).run(sessionId);
    const result = database.prepare(DELETE_SESSION_SQL).run(sessionId);
    deleted = result.changes > 0;
  });

  deleteTx();
  return deleted;
}
