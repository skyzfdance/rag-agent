import type {
  PersistedAssistantPart,
  StoredMessageMetadata,
} from '@/modules/retrieval/retrieval.types';
import { getDb } from './client';
import { GET_SESSION_MESSAGES_SQL, GET_SESSION_MESSAGES_TOTAL_SQL } from './sql/chat-message.sql';
import { normalizeAssistantParts, normalizeMetadata } from './structured-message';

/** 消息详情查询结果行 */
interface MessageRow {
  /** 消息自增 ID */
  id: number;
  /** 消息角色 */
  role: string;
  /** 消息内容 */
  content: string;
  /** 结构化 parts JSON */
  parts_json: string | null;
  /** 元数据 JSON */
  meta_json: string | null;
  /** 创建时间（unix 秒） */
  created_at: number;
}

/** 历史消息 DTO */
export interface StoredSessionMessage {
  /** 消息自增 ID */
  id: number;
  /** 消息角色 */
  role: string;
  /** 文本内容 */
  content: string;
  /** 结构化 parts */
  parts: PersistedAssistantPart[] | Array<{ type: 'text'; text: string }>;
  /** 历史元数据 */
  metadata?: StoredMessageMetadata;
  /** 创建时间 */
  created_at: number;
}

/** 消息分页查询的返回结构 */
export interface MessageListResult {
  /** 当前页的消息列表（按 created_at DESC, id DESC 倒序） */
  list: StoredSessionMessage[];
  /** 该会话的消息总数 */
  total: number;
}

/**
 * 将数据库行映射为前端可用的 StoredSessionMessage
 *
 * user 消息直接包装为纯 text part，assistant 消息走结构化反序列化。
 * 元数据仅对 assistant 消息解析。
 *
 * @param row - 数据库原始行
 * @param sessionId - 会话 ID（用于日志上下文）
 * @returns 结构化的 StoredSessionMessage
 */
function toStoredSessionMessage(row: MessageRow, sessionId: string): StoredSessionMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    parts:
      row.role === 'assistant'
        ? normalizeAssistantParts(row.parts_json, row.content, {
            sessionId,
            messageId: row.id,
          })
        : [
            {
              type: 'text',
              text: row.content,
            },
          ],
    metadata:
      row.role === 'assistant'
        ? normalizeMetadata(row.meta_json, {
            sessionId,
            messageId: row.id,
          })
        : undefined,
    created_at: row.created_at,
  };
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
export function getSessionMessages(
  sessionId: string,
  page: number,
  pageSize: number
): MessageListResult {
  const database = getDb();
  const offset = (page - 1) * pageSize;

  const total = database.prepare(GET_SESSION_MESSAGES_TOTAL_SQL).get(sessionId) as { cnt: number };

  const rows = database
    .prepare(GET_SESSION_MESSAGES_SQL)
    .all(sessionId, pageSize, offset) as MessageRow[];

  return {
    list: rows.reverse().map((row) => toStoredSessionMessage(row, sessionId)),
    total: total.cnt,
  };
}
