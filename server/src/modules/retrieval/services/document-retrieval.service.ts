import { embedQuery } from '@/providers/embedding.provider';
import { search, getClient } from '@/providers/milvus.provider';
import { getMilvusConfig } from '@/config/milvus';
import { getRetrievalConfig } from '@/config/retrieval';
import type { MediaRef } from '@/shared/types/index';
import type { RetrievedChunk } from '../retrieval.types';

/**
 * Milvus 文档检索原始命中记录
 *
 * 与 documents_collection Schema 对应。
 * 文档 chunk 和课程 chunk schema 不同：没有 chapter_id / heading_path，
 * 但有 document_id / file_name / page / section_title。
 */
interface MilvusDocumentHit {
  /** chunk 主键 */
  id?: string;
  /** 关联课程 ID（可选，文档上传时指定） */
  course_id?: number | string;
  /** 文档 ID */
  document_id?: string;
  /** 原始文件名 */
  file_name?: string;
  /** 页码 */
  page?: number | string;
  /** 段落标题 */
  section_title?: string;
  /** 纯文本内容 */
  content?: string;
  /** 多媒体资源引用 */
  media_refs?: MediaRef[];
  /** 向量相似度分数 */
  score: number;
}

/**
 * 将 Milvus 文档命中记录转换为统一 RetrievedChunk
 *
 * 填充 sourceType='document' 和 documentMeta，
 * 将 course_id / page 等可能的字符串值归一为正确类型。
 *
 * @param hit - Milvus 文档原始命中记录
 * @returns 标准化的 RetrievedChunk
 */
function toRetrievedChunk(hit: MilvusDocumentHit): RetrievedChunk {
  return {
    sourceType: 'document',
    sourceId: hit.id ?? '',
    score: hit.score,
    courseId: hit.course_id != null ? Number(hit.course_id) : undefined,
    title: hit.section_title || hit.file_name,
    content: hit.content ?? '',
    mediaRefs: Array.isArray(hit.media_refs) ? hit.media_refs : [],
    documentMeta: {
      documentId: hit.document_id,
      fileName: hit.file_name,
      page: hit.page != null ? Number(hit.page) : undefined,
      sectionTitle: hit.section_title,
    },
  };
}

/**
 * 检查文档 Collection 是否存在且可用
 *
 * 文档 Collection 可能尚未创建（阶段四骨架期间），
 * 此时检索应安全返回空结果而非报错。
 *
 * @returns Collection 是否可用
 */
async function isDocumentsCollectionReady(): Promise<boolean> {
  try {
    const { documentsCollectionName } = getMilvusConfig();
    const milvus = getClient();
    const { value } = await milvus.hasCollection({
      collection_name: documentsCollectionName,
    });
    return !!value;
  } catch {
    return false;
  }
}

/**
 * 文档知识库语义检索
 *
 * 在 documents_collection 中检索与查询语义相近的文档 chunk。
 * 支持通过 courseIds 过滤关联课程的文档，缩小检索范围。
 *
 * Collection 不存在时安全返回空数组（骨架期间的正常行为）。
 *
 * @param query - 用户查询文本
 * @param courseIds - 可选，限定关联课程 ID 列表（来自课程检索结果）
 * @returns 文档检索命中的 chunk 列表
 */
export async function searchDocuments(
  query: string,
  courseIds?: number[]
): Promise<RetrievedChunk[]> {
  // Collection 不存在时安全降级
  const ready = await isDocumentsCollectionReady();
  if (!ready) {
    return [];
  }

  const { documentsCollectionName } = getMilvusConfig();
  const { toolSearch } = getRetrievalConfig();

  // 将查询文本转为向量
  const vector = await embedQuery(query);

  // 构建过滤条件：有 courseIds 时按关联课程过滤
  let filter: string | undefined;
  if (courseIds && courseIds.length > 0) {
    filter = `course_id in [${courseIds.join(',')}]`;
  }

  const result = await search(
    vector,
    toolSearch.documentSearchTopK,
    filter,
    undefined,
    documentsCollectionName
  );
  const hits = (result.results ?? []) as MilvusDocumentHit[];

  return hits.map(toRetrievedChunk);
}
