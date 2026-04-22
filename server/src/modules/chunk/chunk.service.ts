import { deleteChunkById, getChunkById, listChunks, updateChunkMeta } from '@/providers/sqlite';
import type { ChunkListResult, ChunkRow } from '@/providers/sqlite';
import { deleteById, getById, upsert } from '@/providers/milvus';
import { AppError } from '@/shared/errors/app-error';
import type { MediaRef } from '@/shared/types/index';

/**
 * 分页查询 chunk 列表，支持按 courseId / chapterId 筛选
 *
 * @param page - 页码，从 1 开始
 * @param pageSize - 每页数量
 * @param courseId - 可选，按课程筛选
 * @param chapterId - 可选，按章节筛选
 * @returns 分页结果
 */
export function listChunkPage(
  page: number,
  pageSize: number,
  courseId?: number,
  chapterId?: number
): ChunkListResult {
  return listChunks(page, pageSize, courseId, chapterId);
}

/**
 * 按 ID 查询单个 chunk
 *
 * @param id - chunk 主键
 * @returns chunk 行，不存在时返回 undefined
 */
export function getChunkDetail(id: string): ChunkRow {
  const chunk = getChunkById(id);
  if (!chunk) {
    throw new AppError('chunk 不存在', 404);
  }

  return chunk;
}

/**
 * 修改 chunk 元数据（tags / mediaRefs），SQLite + Milvus 双写
 *
 * 先写 Milvus 再写 SQLite：Milvus 失败直接报错不脏 SQLite，
 * SQLite 失败时 Milvus 已写入但下次 ingest 会覆盖，可接受。
 *
 * @param id - chunk 主键
 * @param input - 变更入参
 * @param input.tags - 可选，知识点标签
 * @param input.mediaRefs - 可选，多媒体引用
 */
export async function updateChunk(input: {
  id: string;
  tags?: string[];
  mediaRefs?: MediaRef[];
}): Promise<void> {
  const { id, tags, mediaRefs } = input;

  // 先确认 chunk 在 SQLite 中存在
  const existing = getChunkById(id);
  if (!existing) {
    throw new AppError('chunk 不存在', 404);
  }

  // ① 先更新 Milvus：读取完整记录 → 修改 → upsert
  const milvusRecord = await getById(id);
  if (!milvusRecord) {
    throw new AppError('chunk 在向量库中不存在，数据不一致', 500);
  }
  if (tags !== undefined) milvusRecord.tags = tags;
  if (mediaRefs !== undefined) milvusRecord.media_refs = mediaRefs;
  await upsert([milvusRecord]);

  // ② 再更新 SQLite
  const sqliteFields: { tags?: string; mediaRefs?: string } = {};
  if (tags !== undefined) sqliteFields.tags = JSON.stringify(tags);
  if (mediaRefs !== undefined) sqliteFields.mediaRefs = JSON.stringify(mediaRefs);
  updateChunkMeta(id, sqliteFields);
}

/**
 * 删除单个 chunk，先 Milvus 后 SQLite
 *
 * 先删 Milvus 再删 SQLite：Milvus 失败直接报错两边都不脏，
 * SQLite 失败时 Milvus 已删但 SQLite 还在，下次 ingest 会覆盖，可接受。
 *
 * @param id - chunk 主键
 */
export async function removeChunk(id: string): Promise<void> {
  // 先确认 SQLite 中存在
  const existing = getChunkById(id);
  if (!existing) {
    throw new AppError('chunk 不存在', 404);
  }

  // ① 先删 Milvus
  await deleteById(id);

  // ② 再删 SQLite
  deleteChunkById(id);
}
