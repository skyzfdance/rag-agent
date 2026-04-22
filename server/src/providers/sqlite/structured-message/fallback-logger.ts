import { appendAgentLog } from '@/shared/utils/agent-logger';

/**
 * 记录结构化消息字段解析降级日志
 *
 * 当 parts_json 或 meta_json 解析失败回退到纯文本时调用，
 * 便于排查数据一致性问题。
 *
 * @param options - 日志参数
 * @param options.sessionId - 会话 ID
 * @param options.messageId - 消息自增 ID
 * @param options.field - 出错的字段名
 * @param options.error - 原始异常
 */
export function logStructuredMessageFallback(options: {
  sessionId: string;
  messageId: number;
  field: 'parts_json' | 'meta_json';
  error: unknown;
}): void {
  appendAgentLog({
    event: 'structured_message_fallback',
    sessionId: options.sessionId,
    messageId: options.messageId,
    field: options.field,
    error: options.error instanceof Error ? options.error.message : String(options.error),
  });
}
