import { Router, type Router as ExpressRouter } from 'express';
import type { Request, Response } from 'express';
import { getSignal } from '@/middleware/abort-on-disconnect';
import { AppError } from '@/shared/errors/app-error';
import { streamChat } from './retrieval.service';

const router: ExpressRouter = Router();

/**
 * POST /api/chat
 *
 * 主聊天接口，接收用户消息并返回流式响应。
 * 输出协议：Vercel AI SDK 标准 data stream（SSE），不使用统一 JSON 包装。
 *
 * 请求体：
 * - sessionId: string — 会话 ID
 * - message: string — 用户消息内容
 */
router.post('/', async (req: Request, res: Response) => {
  const { sessionId, message } = req.body as { sessionId: string; message: string };

  if (!sessionId || !message) {
    throw new AppError('缺少 sessionId 或 message', 400);
  }

  const signal = getSignal(req);
  await streamChat(sessionId, message, res, signal);
});

export default router;
