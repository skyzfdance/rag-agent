import type {
  PersistedAssistantPart,
  RetrievedExercisePreview,
  RetrievedSource,
} from '@/modules/retrieval/retrieval.types';
import type { MediaRef } from '@/shared/types/index';
import { logStructuredMessageFallback } from './fallback-logger';
import { isObject } from './shared';

/**
 * 从 JSON 解析结果中提取并校验 text 类型的 part
 *
 * @param value - parts_json 数组中的单个元素
 * @returns 合法的 text part，校验失败返回 null
 */
function normalizeTextPart(value: unknown): PersistedAssistantPart | null {
  if (!isObject(value) || value.type !== 'text' || typeof value.text !== 'string') {
    return null;
  }

  return {
    type: 'text',
    text: value.text,
  };
}

/**
 * 从 JSON 解析结果中提取并校验 reasoning 类型的 part
 *
 * @param value - parts_json 数组中的单个元素
 * @returns 合法的 reasoning part，校验失败返回 null
 */
function normalizeReasoningPart(value: unknown): PersistedAssistantPart | null {
  if (!isObject(value) || value.type !== 'reasoning' || typeof value.text !== 'string') {
    return null;
  }

  return {
    type: 'reasoning',
    text: value.text,
  };
}

/**
 * 从 JSON 解析结果中提取并校验多媒体引用数组
 *
 * 逐条验证 type（image/video）、src、title 三个必填字段，
 * 不合法的条目静默丢弃。
 *
 * @param value - parts_json 中 data-media-refs 的 data 字段
 * @returns 校验通过的 MediaRef 数组
 */
function normalizeMediaRefs(value: unknown): MediaRef[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (
      !isObject(item) ||
      (item.type !== 'image' && item.type !== 'video') ||
      typeof item.src !== 'string' ||
      typeof item.title !== 'string'
    ) {
      return [];
    }

    return [
      {
        type: item.type,
        src: item.src,
        title: item.title,
      } as MediaRef,
    ];
  });
}

/**
 * 从 JSON 解析结果中提取并校验检索来源数组
 *
 * 逐条验证 type（course/document/exercise/web）和 label 必填字段，
 * 可选字段（courseId / chapterId / documentMeta / url）按类型校验后保留。
 * 不合法的条目静默丢弃。
 *
 * @param value - parts_json 中 data-sources 的 data 字段
 * @returns 校验通过的 RetrievedSource 数组
 */
function normalizeSources(value: unknown): RetrievedSource[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (
      !isObject(item) ||
      (item.type !== 'course' &&
        item.type !== 'document' &&
        item.type !== 'exercise' &&
        item.type !== 'web') ||
      typeof item.label !== 'string'
    ) {
      return [];
    }

    return [
      {
        type: item.type,
        label: item.label,
        courseId: typeof item.courseId === 'number' ? item.courseId : undefined,
        chapterId: typeof item.chapterId === 'number' ? item.chapterId : undefined,
        documentMeta: isObject(item.documentMeta)
          ? {
              documentId:
                typeof item.documentMeta.documentId === 'string'
                  ? item.documentMeta.documentId
                  : undefined,
              fileName:
                typeof item.documentMeta.fileName === 'string'
                  ? item.documentMeta.fileName
                  : undefined,
              page: typeof item.documentMeta.page === 'number' ? item.documentMeta.page : undefined,
              sectionTitle:
                typeof item.documentMeta.sectionTitle === 'string'
                  ? item.documentMeta.sectionTitle
                  : undefined,
            }
          : undefined,
        url: typeof item.url === 'string' ? item.url : undefined,
      },
    ];
  });
}

/**
 * 从 JSON 解析结果中提取并校验试题预览数组
 *
 * 逐条验证 id / courseId / chapterId（number）和 stem / type（string）必填字段，
 * type 按白名单校验。不合法的条目静默丢弃。
 *
 * @param value - parts_json 中 data-exercise-preview 的 data 字段
 * @returns 校验通过的 RetrievedExercisePreview 数组
 */
function normalizeExercisePreviews(value: unknown): RetrievedExercisePreview[] {
  if (!Array.isArray(value)) return [];

  const validTypes = ['single', 'multiple', 'judge', 'answer', 'fill'];

  return value.flatMap((item) => {
    if (
      !isObject(item) ||
      typeof item.id !== 'number' ||
      typeof item.courseId !== 'number' ||
      typeof item.chapterId !== 'number' ||
      typeof item.stem !== 'string' ||
      !validTypes.includes(item.type as string)
    ) {
      return [];
    }

    return [
      {
        id: item.id,
        courseId: item.courseId,
        chapterId: item.chapterId,
        stem: item.stem,
        type: item.type,
      } as RetrievedExercisePreview,
    ];
  });
}

/**
 * 反序列化并校验 assistant 消息的 parts_json
 *
 * 解析 JSON 后按白名单逐条校验（text / reasoning / data-media-refs / data-sources），
 * 不合法的条目静默跳过。解析失败或结果为空时回退到 fallbackContent 包装为纯 text part。
 *
 * @param partsJson - 数据库中的 parts_json 原始字符串，null 表示无结构化数据
 * @param fallbackContent - 降级用的纯文本内容（通常为 content 字段）
 * @param context - 日志上下文（会话 ID + 消息 ID）
 * @returns 校验后的 PersistedAssistantPart 数组
 */
export function normalizeAssistantParts(
  partsJson: string | null,
  fallbackContent: string,
  context: { sessionId: string; messageId: number }
): PersistedAssistantPart[] {
  if (!partsJson) {
    if (fallbackContent.length === 0) {
      return [];
    }

    return [
      {
        type: 'text',
        text: fallbackContent,
      },
    ];
  }

  try {
    const parsed = JSON.parse(partsJson) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('parts_json is not an array');
    }

    const normalized: PersistedAssistantPart[] = [];
    for (const item of parsed) {
      const textPart = normalizeTextPart(item);
      if (textPart) {
        normalized.push(textPart);
        continue;
      }

      const reasoningPart = normalizeReasoningPart(item);
      if (reasoningPart) {
        normalized.push(reasoningPart);
        continue;
      }

      if (isObject(item) && item.type === 'data-media-refs') {
        const data = normalizeMediaRefs(item.data);
        if (data.length > 0) {
          normalized.push({
            type: 'data-media-refs',
            data,
          });
        }
        continue;
      }

      if (isObject(item) && item.type === 'data-sources') {
        const data = normalizeSources(item.data);
        if (data.length > 0) {
          normalized.push({
            type: 'data-sources',
            data,
          });
        }
        continue;
      }

      if (isObject(item) && item.type === 'data-exercise-preview') {
        const data = normalizeExercisePreviews(item.data);
        if (data.length > 0) {
          normalized.push({
            type: 'data-exercise-preview',
            data,
          });
        }
      }
    }

    if (normalized.length > 0) {
      return normalized;
    }
  } catch (error) {
    logStructuredMessageFallback({
      sessionId: context.sessionId,
      messageId: context.messageId,
      field: 'parts_json',
      error,
    });
  }

  if (fallbackContent.length === 0) {
    return [];
  }

  return [
    {
      type: 'text',
      text: fallbackContent,
    },
  ];
}
