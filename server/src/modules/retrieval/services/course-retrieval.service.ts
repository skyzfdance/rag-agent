import { embedQuery } from '@/providers/embedding.provider';
import { search } from '@/providers/milvus.provider';
import { getRetrievalConfig } from '@/config/retrieval';
import type { MediaRef } from '@/shared/types/index';
import type { RetrievedChunk, RetrievedSource, RetrievalResult } from '../retrieval.types';

/**
 * Milvus 课程检索原始命中记录
 *
 * 与 Milvus Schema 对应，用于接收 search 返回的原始数据，
 * 再转换为上层 RetrievedChunk DTO。
 */
interface MilvusCourseHit {
  /** chunk 主键 */
  id?: string;
  /** 课程 ID（Milvus 可能返回字符串，toRetrievedChunk 负责归一为 number） */
  course_id?: number | string;
  /** 章节 ID（同上） */
  chapter_id?: number | string;
  /** 章节标题 */
  title?: string;
  /** 标题路径 */
  heading_path?: string;
  /** 纯文本内容 */
  content?: string;
  /** 知识点标签（JSON 数组） */
  tags?: string[];
  /** 多媒体资源引用（JSON 数组） */
  media_refs?: MediaRef[];
  /** 向量相似度分数 */
  score: number;
}

/**
 * 将 Milvus 原始命中记录转换为上层 RetrievedChunk
 *
 * 完成 snake_case → camelCase 映射，并填充 sourceType。
 * Milvus 返回的 course_id / chapter_id 可能是字符串，统一转为 number。
 *
 * @param hit - Milvus 原始命中记录
 * @returns 标准化的 RetrievedChunk
 */
function toRetrievedChunk(hit: MilvusCourseHit): RetrievedChunk {
  return {
    sourceType: 'course',
    sourceId: hit.id ?? '',
    score: hit.score,
    courseId: hit.course_id != null ? Number(hit.course_id) : undefined,
    chapterId: hit.chapter_id != null ? Number(hit.chapter_id) : undefined,
    title: hit.title,
    headingPath: hit.heading_path,
    content: hit.content ?? '',
    mediaRefs: Array.isArray(hit.media_refs) ? hit.media_refs : [],
  };
}

/**
 * 课程知识库语义检索
 *
 * 将查询文本转为向量，在 courses collection 中检索 topK 条结果，
 * 返回结构化的 RetrievedChunk 数组。
 *
 * @param query - 用户查询文本
 * @returns 课程检索命中的 chunk 列表
 */
export async function searchCourses(query: string): Promise<RetrievedChunk[]> {
  const { toolSearch } = getRetrievalConfig();

  // 将查询文本转为向量
  const vector = await embedQuery(query);

  // Milvus 向量检索
  const result = await search(vector, toolSearch.knowledgeSearchTopK);
  const hits = (result.results ?? []) as MilvusCourseHit[];

  return hits.map(toRetrievedChunk);
}

/**
 * 将课程检索结果格式化为 LLM 上下文文本
 *
 * 格式化时保留来源信息与媒体提示，让 LLM 可以在回答中引用。
 * media_refs 以"附件"形式附在每个片段末尾，LLM 可自然提及。
 *
 * @param hits - 课程检索命中的 chunk 列表
 * @returns 格式化后的 LLM 上下文文本，无命中时返回固定提示
 */
export function formatCourseHitsForLlm(hits: RetrievedChunk[]): string {
  if (hits.length === 0) {
    return '未找到相关知识库内容。';
  }

  const formatted = hits.map((hit, i) => {
    const title = hit.headingPath || hit.title || '未知标题';
    let text = `[课程片段 ${i + 1}]\n标题：${title}\n内容：${hit.content}`;

    // 有 media_refs 时附加提示，让 LLM 知道该片段关联了哪些多媒体资源
    if (hit.mediaRefs.length > 0) {
      const mediaList = hit.mediaRefs
        .map((ref) => `${ref.type === 'image' ? '图片' : '视频'}《${ref.title}》`)
        .join('、');
      text += `\n附件：${mediaList}`;
    }

    return text;
  });

  return formatted.join('\n\n');
}

/**
 * 从课程检索结果中提取去重的 mediaRefs
 *
 * 以 src 为唯一标识去重，避免同一资源在多个 chunk 中重复出现。
 *
 * @param hits - 课程检索命中的 chunk 列表
 * @returns 去重后的 mediaRefs 数组
 */
export function collectMediaRefs(hits: RetrievedChunk[]): MediaRef[] {
  const seen = new Set<string>();
  const result: MediaRef[] = [];

  for (const hit of hits) {
    for (const ref of hit.mediaRefs) {
      if (!seen.has(ref.src)) {
        seen.add(ref.src);
        result.push(ref);
      }
    }
  }

  return result;
}

/**
 * 从课程检索结果中提取去重的来源信息
 *
 * 以 courseId + chapterId + label 为唯一标识去重。
 *
 * @param hits - 课程检索命中的 chunk 列表
 * @returns 去重后的来源信息数组
 */
export function collectSources(hits: RetrievedChunk[]): RetrievedSource[] {
  const seen = new Set<string>();
  const result: RetrievedSource[] = [];

  for (const hit of hits) {
    const label = hit.headingPath || hit.title || '未知来源';
    const key = `${hit.courseId ?? ''}_${hit.chapterId ?? ''}_${label}`;

    if (!seen.has(key)) {
      seen.add(key);
      result.push({
        type: 'course',
        label,
        courseId: hit.courseId,
        chapterId: hit.chapterId,
      });
    }
  }

  return result;
}

/**
 * 执行课程检索并生成完整的 RetrievalResult
 *
 * 这是阶段一的核心入口，封装了检索 → 结构化 → 格式化的完整流程。
 * 后续阶段会将此逻辑迁移到 Retrieval Graph 的节点中。
 *
 * @param query - 用户查询文本
 * @returns RetrievalResult，包含 llmContext 和 frontendPayload
 */
export async function retrieveCourseKnowledge(query: string): Promise<RetrievalResult> {
  const hits = await searchCourses(query);

  return {
    llmContext: formatCourseHitsForLlm(hits),
    frontendPayload: {
      mediaRefs: collectMediaRefs(hits),
      sources: collectSources(hits),
      exercisePreview: [],
    },
    errors: [],
  };
}
