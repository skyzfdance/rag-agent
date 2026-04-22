import type { StoredMessageMetadata } from '@/modules/retrieval/retrieval.types';
import { STRUCTURED_MESSAGE_SCHEMA_VERSION } from '@/modules/retrieval/retrieval.types';
import { logStructuredMessageFallback } from './fallback-logger';
import { isObject } from './shared';

/**
 * 反序列化并校验 assistant 消息的 meta_json
 *
 * 从 JSON 中提取 schemaVersion / thinkingDurationMs / assistantStatus /
 * isIncomplete / turnId / memoryEligible 六个字段，逐字段类型校验。
 * assistantStatus 按白名单校验，isIncomplete 和 memoryEligible 在显式值
 * 缺失时从 assistantStatus 推导。解析失败时返回 undefined。
 *
 * @param metaJson - 数据库中的 meta_json 原始字符串，null 表示无元数据
 * @param context - 日志上下文（会话 ID + 消息 ID）
 * @returns 校验后的元数据，解析失败或为 null 时返回 undefined
 */
export function normalizeMetadata(
  metaJson: string | null,
  context: { sessionId: string; messageId: number }
): StoredMessageMetadata | undefined {
  if (!metaJson) return undefined;

  try {
    const parsed = JSON.parse(metaJson) as unknown;
    if (!isObject(parsed)) {
      throw new Error('meta_json is not an object');
    }

    const validStatuses = ['completed', 'truncated', 'aborted', 'error', 'no_reply'];
    const assistantStatus = validStatuses.includes(parsed.assistantStatus as string)
      ? (parsed.assistantStatus as StoredMessageMetadata['assistantStatus'])
      : undefined;

    return {
      schemaVersion:
        typeof parsed.schemaVersion === 'number'
          ? parsed.schemaVersion
          : STRUCTURED_MESSAGE_SCHEMA_VERSION,
      thinkingDurationMs:
        typeof parsed.thinkingDurationMs === 'number' ? parsed.thinkingDurationMs : undefined,
      assistantStatus,
      isIncomplete:
        typeof parsed.isIncomplete === 'boolean'
          ? parsed.isIncomplete
          : assistantStatus === 'completed'
            ? false
            : assistantStatus !== undefined,
      turnId: typeof parsed.turnId === 'string' ? parsed.turnId : undefined,
      memoryEligible:
        typeof parsed.memoryEligible === 'boolean'
          ? parsed.memoryEligible
          : assistantStatus === 'completed'
            ? true
            : assistantStatus !== undefined
              ? false
              : undefined,
    };
  } catch (error) {
    logStructuredMessageFallback({
      sessionId: context.sessionId,
      messageId: context.messageId,
      field: 'meta_json',
      error,
    });
    return undefined;
  }
}
