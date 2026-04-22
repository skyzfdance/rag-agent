/** 日志字段最大字符数 */
const LOG_PREVIEW_MAX_CHARS = 500;

/**
 * 截断值用于审计日志，避免超大 payload 撑爆日志存储
 *
 * @param value - 任意值
 * @param maxChars - 最大字符数
 * @returns 截断后的字符串
 */
export function truncateForLog(value: unknown, maxChars = LOG_PREVIEW_MAX_CHARS): string {
  const str = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
  if (str.length <= maxChars) return str;
  return str.slice(0, maxChars) + '…[truncated]';
}
