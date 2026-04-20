import { Router, type Router as ExpressRouter } from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  listSessions,
  getSessionMessages,
  updateSessionTitle,
  deleteSession,
} from '@/providers/sqlite.provider';
import { sendSuccess } from '@/shared/utils/response';
import { AppError } from '@/shared/errors/app-error';
import { withSessionMutex } from '@/modules/retrieval/memory.service';

/** 会话管理路由 */
export const sessionRouter: ExpressRouter = Router();

/**
 * GET /
 * 分页查询会话列表，支持按标题模糊搜索
 *
 * Query:
 *   - page: 页码，默认 1
 *   - pageSize: 每页数量，默认 20
 *   - keyword: 标题搜索关键词（可选）
 */
sessionRouter.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize) || 20));
    const keyword = req.query.keyword ? String(req.query.keyword) : undefined;

    const result = listSessions(page, pageSize, keyword);
    sendSuccess(res, { ...result, page, pageSize });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /:sessionId/messages
 * 分页获取会话消息（倒序分页，最新消息优先加载）
 *
 * Query:
 *   - page: 页码，默认 1（第 1 页 = 最新消息）
 *   - pageSize: 每页数量，默认 40
 */
sessionRouter.get(
  '/:sessionId/messages',
  (req: Request<{ sessionId: string }>, res: Response, next: NextFunction) => {
    try {
      const { sessionId } = req.params;
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize) || 40));

      const result = getSessionMessages(sessionId, page, pageSize);
      sendSuccess(res, { ...result, page, pageSize });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /:sessionId
 * 修改会话标题
 *
 * Body: { title: string }
 */
sessionRouter.patch(
  '/:sessionId',
  (req: Request<{ sessionId: string }>, res: Response, next: NextFunction) => {
    try {
      const { sessionId } = req.params;
      const { title } = req.body as { title?: string };

      if (typeof title !== 'string' || title.trim().length === 0) {
        throw new AppError('title 不能为空', 400);
      }

      const updated = updateSessionTitle(sessionId, title.trim());
      if (!updated) {
        throw new AppError('会话不存在', 404);
      }

      sendSuccess(res, null);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /:sessionId
 * 删除会话及其关联消息
 *
 * 通过 withSessionMutex 串行化，避免与进行中的 chat 写入竞争
 */
sessionRouter.delete(
  '/:sessionId',
  async (req: Request<{ sessionId: string }>, res: Response, next: NextFunction) => {
    try {
      const { sessionId } = req.params;

      // 在 session mutex 内执行删除，防止与 saveMessagesUnsafe / updatePromptTokens 竞争
      const deleted = await withSessionMutex(sessionId, () => deleteSession(sessionId));
      if (!deleted) {
        throw new AppError('会话不存在', 404);
      }

      sendSuccess(res, null);
    } catch (err) {
      next(err);
    }
  }
);
