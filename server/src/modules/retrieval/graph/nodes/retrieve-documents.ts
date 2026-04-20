import type { RetrievalState, RetrievalStateUpdate } from '../retrieval-state';
import { searchDocuments } from '../../services/document-retrieval.service';

/**
 * retrieve_documents 节点
 *
 * 在 documents_collection 中做语义检索，返回文档命中 chunk。
 * 支持根据 courses 节点提取的 topCourseIds 过滤关联课程的文档，缩小检索范围。
 *
 * Collection 尚未创建时 searchDocuments 安全返回空数组，不会报错。
 * 节点失败时不中断 Graph，仅返回空结果并记录错误。
 *
 * @param state - Retrieval Graph 当前状态
 * @returns 状态更新：documents 字段，失败时附带 errors
 */
export async function retrieveDocuments(state: RetrievalState): Promise<RetrievalStateUpdate> {
  try {
    // 利用课程检索命中的 courseIds 缩小文档检索范围
    const courseIds = state.courses?.topCourseIds;
    const hits = await searchDocuments(state.query, courseIds);

    return {
      documents: { hits },
    };
  } catch (err) {
    return {
      documents: { hits: [] },
      errors: [
        {
          node: 'retrieve_documents',
          sourceType: 'document',
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }
}
