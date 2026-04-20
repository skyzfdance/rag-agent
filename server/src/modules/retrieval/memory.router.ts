import { Router, type Router as ExpressRouter } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '@/shared/errors/app-error';
import { sendSuccess } from '@/shared/utils/response';
import { getTokenUsage, ensureCompacted } from './memory.service';

/** 会话记忆管理路由 */
export const memoryRouter: ExpressRouter = Router();

/**
 * GET /api/memory/token-usage
 * 获取指定会话的 token 使用情况
 *
 * Query: sessionId - 会话 ID
 */
memoryRouter.get('/token-usage', (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = req.query.sessionId as string | undefined;
    if (!sessionId) {
      throw new AppError('缺少 sessionId', 400);
    }

    const usage = getTokenUsage(sessionId);
    sendSuccess(res, usage);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/memory/compact
 * 手动触发会话记忆压缩
 *
 * Body: { sessionId: string }
 */
memoryRouter.post('/compact', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionId } = req.body as { sessionId?: string };
    if (!sessionId) {
      throw new AppError('缺少 sessionId', 400);
    }

    await ensureCompacted(sessionId);
    sendSuccess(res, null);
  } catch (err) {
    next(err);
  }
});
