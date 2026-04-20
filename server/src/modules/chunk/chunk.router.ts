import { Router, type Router as ExpressRouter } from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  listChunks,
  getChunkById,
  updateChunkMeta,
  deleteChunkById,
} from '@/providers/sqlite.provider';
import { getById, upsert, deleteById } from '@/providers/milvus.provider';
import { sendSuccess } from '@/shared/utils/response';
import { AppError } from '@/shared/errors/app-error';
import type { MediaRef } from '@/shared/types/index';

/** Chunk 管理路由 */
export const chunkRouter: ExpressRouter = Router();

/**
 * 解析可选的数字查询参数，非法值返回 400
 *
 * @param raw - query string 原始值
 * @param name - 参数名（用于错误提示）
 * @returns 合法数字或 undefined
 */
function parseOptionalInt(raw: unknown, name: string): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new AppError(`${name} 必须为合法数字`, 400);
  }
  return n;
}

/**
 * GET /
 * 分页查询 chunk 列表，支持按 courseId / chapterId 筛选
 *
 * Query:
 *   - page: 页码，默认 1
 *   - pageSize: 每页数量，默认 20
 *   - courseId: 可选，按课程筛选
 *   - chapterId: 可选，按章节筛选
 */
chunkRouter.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize) || 20));
    const courseId = parseOptionalInt(req.query.courseId, 'courseId');
    const chapterId = parseOptionalInt(req.query.chapterId, 'chapterId');

    const result = listChunks(page, pageSize, courseId, chapterId);
    sendSuccess(res, { ...result, page, pageSize });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /:id
 * 查询单个 chunk 详情
 */
chunkRouter.get('/:id', (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    const chunk = getChunkById(req.params.id);
    if (!chunk) {
      throw new AppError('chunk 不存在', 404);
    }

    sendSuccess(res, chunk);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /:id
 * 修改 chunk 元数据（tags / mediaRefs），SQLite + Milvus 双写
 *
 * 先写 Milvus 再写 SQLite：Milvus 失败直接报错不脏 SQLite，
 * SQLite 失败时 Milvus 已写入但下次 ingest 会覆盖，可接受。
 *
 * Body: { tags?: string[], mediaRefs?: MediaRef[] }
 */
chunkRouter.patch(
  '/:id',
  async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { tags, mediaRefs } = req.body as {
        tags?: string[];
        mediaRefs?: MediaRef[];
      };

      if (tags === undefined && mediaRefs === undefined) {
        throw new AppError('至少传入 tags 或 mediaRefs', 400);
      }

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

      sendSuccess(res, null);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /:id
 * 删除单个 chunk，先 Milvus 后 SQLite
 *
 * 先删 Milvus 再删 SQLite：Milvus 失败直接报错两边都不脏，
 * SQLite 失败时 Milvus 已删但 SQLite 还在，下次 ingest 会覆盖，可接受。
 */
chunkRouter.delete(
  '/:id',
  async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      // 先确认 SQLite 中存在
      const existing = getChunkById(id);
      if (!existing) {
        throw new AppError('chunk 不存在', 404);
      }

      // ① 先删 Milvus
      await deleteById(id);

      // ② 再删 SQLite
      deleteChunkById(id);

      sendSuccess(res, null);
    } catch (err) {
      next(err);
    }
  }
);
