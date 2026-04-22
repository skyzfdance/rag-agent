import { Router, type Router as ExpressRouter } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '@/shared/utils/response';
import { AppError } from '@/shared/errors/app-error';
import type { MediaRef } from '@/shared/types/index';
import { getChunkDetail, listChunkPage, removeChunk, updateChunk } from './chunk.service';

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

    const result = listChunkPage(page, pageSize, courseId, chapterId);
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
    const chunk = getChunkDetail(req.params.id);

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

      await updateChunk({ id, tags, mediaRefs });

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

      await removeChunk(id);

      sendSuccess(res, null);
    } catch (err) {
      next(err);
    }
  }
);
