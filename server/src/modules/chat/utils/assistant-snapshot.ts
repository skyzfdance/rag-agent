import type { MediaRef } from '@/shared/types/index';
import type {
  AssistantStatus,
  PersistedAssistantPart,
  RetrievedExercisePreview,
  RetrievedSource,
} from '@/modules/retrieval/retrieval.types';
import type { StreamFinishResult } from '@/shared/streaming/chat-stream';

/**
 * 按复合键去重媒体引用
 *
 * @param refs - 可能含重复的媒体引用数组
 * @returns 去重后的数组
 */
export function dedupeMediaRefs(refs: MediaRef[]): MediaRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.type}:${ref.src}:${ref.title ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 按复合键去重检索来源
 *
 * @param sources - 可能含重复的来源数组
 * @returns 去重后的数组
 */
export function dedupeSources(sources: RetrievedSource[]): RetrievedSource[] {
  const seen = new Set<string>();
  return sources.filter((src) => {
    const parts = [
      src.type,
      src.label ?? '',
      String(src.courseId ?? ''),
      String(src.chapterId ?? ''),
      src.url ?? '',
    ];
    if (src.documentMeta) {
      parts.push(
        src.documentMeta.fileName ?? '',
        String(src.documentMeta.page ?? ''),
        src.documentMeta.sectionTitle ?? ''
      );
    }
    const key = parts.join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// 持久化限制常量
// ---------------------------------------------------------------------------

/** 持久化的媒体引用上限 */
export const MAX_PERSISTED_MEDIA_REFS = 20;
/** 持久化的来源引用上限 */
export const MAX_PERSISTED_SOURCES = 20;
/** 持久化的试题预览上限 */
export const MAX_PERSISTED_EXERCISE_PREVIEWS = 10;
/** parts_json 的最大字节数 */
const MAX_PERSISTED_PARTS_JSON_BYTES = 64 * 1024;

/**
 * 截取数组到指定长度
 *
 * @param items - 原始数组
 * @param max - 最大条数
 * @returns 截取后的数组
 */
export function limitSnapshotItems<T>(items: T[], max: number): T[] {
  return items.slice(0, max);
}

/**
 * 裁剪 parts 数组使序列化后的字节数不超限
 *
 * 对 data-media-refs / data-sources / data-exercise-preview 类型的 part，
 * 逐条添加直到总字节数即将超限为止。text / reasoning 类型不裁剪。
 *
 * @param parts - 原始 parts 数组
 * @param maxBytes - 最大字节数
 * @returns 裁剪后的 parts 数组
 */
function trimAssistantPartsToByteLimit(
  parts: PersistedAssistantPart[],
  maxBytes: number
): PersistedAssistantPart[] {
  const result: PersistedAssistantPart[] = [];

  for (const part of parts) {
    if (part.type === 'text' || part.type === 'reasoning') {
      result.push(part);
      continue;
    }

    // 对数组类 data part，逐条尝试
    const dataArray = (part as { data: unknown[] }).data;
    const accepted: unknown[] = [];

    for (const item of dataArray) {
      const trial = [...result, { ...part, data: [...accepted, item] }];
      if (Buffer.byteLength(JSON.stringify(trial), 'utf-8') > maxBytes) {
        break;
      }
      accepted.push(item);
    }

    if (accepted.length > 0) {
      result.push({ ...part, data: accepted } as PersistedAssistantPart);
    }
  }

  return result;
}

/**
 * 构建 assistant 终态快照的 parts 数组
 *
 * 包含：text → reasoning（如开启）→ media-refs → sources → exercise-preview
 * 每类 data part 经过去重、截取、字节裁剪。
 *
 * @param input - 构建快照所需的各项数据
 * @returns 可序列化的 PersistedAssistantPart 数组
 */
export function buildAssistantPartsSnapshot(input: {
  content: string;
  reasoning: string;
  mediaRefs: MediaRef[];
  sources: RetrievedSource[];
  exercisePreviews: RetrievedExercisePreview[];
  showReasoning: boolean;
}): PersistedAssistantPart[] {
  const parts: PersistedAssistantPart[] = [];

  // text part
  if (input.content) {
    parts.push({ type: 'text', text: input.content });
  }

  // reasoning part（仅当 showReasoning 开启且有内容时才持久化）
  if (input.showReasoning && input.reasoning) {
    parts.push({ type: 'reasoning', text: input.reasoning });
  }

  // data parts（去重 + 截取后添加）
  const mediaRefs = limitSnapshotItems(dedupeMediaRefs(input.mediaRefs), MAX_PERSISTED_MEDIA_REFS);
  if (mediaRefs.length > 0) {
    parts.push({ type: 'data-media-refs', data: mediaRefs });
  }

  const sources = limitSnapshotItems(dedupeSources(input.sources), MAX_PERSISTED_SOURCES);
  if (sources.length > 0) {
    parts.push({ type: 'data-sources', data: sources });
  }

  const exercises = limitSnapshotItems(input.exercisePreviews, MAX_PERSISTED_EXERCISE_PREVIEWS);
  if (exercises.length > 0) {
    parts.push({ type: 'data-exercise-preview', data: exercises });
  }

  return trimAssistantPartsToByteLimit(parts, MAX_PERSISTED_PARTS_JSON_BYTES);
}

// ---------------------------------------------------------------------------
// Graph 节点 → 前端展示标签映射
// ---------------------------------------------------------------------------

export const NODE_STEP_LABELS: Record<string, string> = {
  analyze_intent: '分析检索意图',
  retrieve_courses: '检索课程知识库',
  retrieve_documents: '检索文档知识库',
  retrieve_exercises: '检索相关试题',
  merge_filter_rank: '整理检索结果',
  assess_sufficiency: '评估结果充分性',
  maybe_web_fallback: '联网搜索补充',
  synthesize_context: '生成回答上下文',
};

// ---------------------------------------------------------------------------
// 终态映射
// ---------------------------------------------------------------------------

/**
 * 将 AI SDK streamText 的终态信息映射到业务状态
 *
 * 映射规则：
 * - finishReason=stop + 有文本 → completed
 * - finishReason=stop + 无文本 → no_reply
 * - finishReason=length → truncated（模型输出截断）
 * - finishReason=tool-calls → truncated（tool 循环被 stopWhen 截断）
 * - finishReason=error → error
 * - finishReason=content-filter → error（provider 内容过滤）
 * - finishReason=other / unknown → error
 *
 * @param result - 流式结束后的终态摘要
 * @returns 业务 AssistantStatus
 */
export function mapFinishStatus(result: StreamFinishResult): AssistantStatus {
  const hasText = result.text.trim().length > 0;

  switch (result.lastFinishReason) {
    case 'stop':
      return hasText ? 'completed' : 'no_reply';
    case 'length':
    case 'tool-calls':
      return 'truncated';
    case 'error':
    case 'content-filter':
    case 'other':
    case 'unknown':
      return 'error';
    default:
      return 'error';
  }
}
