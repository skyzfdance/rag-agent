import { Router, type Router as ExpressRouter, type Request, type Response } from 'express';
import { ingestCourse, ingestChapter } from './ingest.service';
import { AppError } from '@/shared/errors/app-error';
import { getSignal } from '@/middleware/abort-on-disconnect';
import { sendSuccess } from '@/shared/utils/response';
import type { OnProgress } from './ingest.types';

const router: ExpressRouter = Router();

/**
 * SSE 模式统一处理器
 *
 * 设置 SSE 响应头、桥接 onProgress 回调、统一处理断连和业务错误。
 *
 * @param res - Express 响应对象
 * @param signal - 可选的中止信号
 * @param label - 日志标识，用于区分不同路由的日志
 * @param runPipeline - 实际执行 Pipeline 的函数，接收 onProgress 回调
 */
async function handleSse(
  res: Response,
  signal: AbortSignal | undefined,
  label: string,
  runPipeline: (onProgress: OnProgress) => Promise<number>
): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const startTime = Date.now();

  /** 将进度事件桥接为 SSE 推送 */
  const onProgress: OnProgress = (event) => {
    if (res.writableEnded) return;
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
  };

  try {
    const totalChunks = await runPipeline(onProgress);
    onProgress({
      type: 'pipeline:done',
      data: { elapsed: `${Date.now() - startTime}ms`, totalChunks },
    });
  } catch (err) {
    const elapsed = `${Date.now() - startTime}ms`;

    // 客户端主动断连导致的中止，记录日志后静默结束
    if (signal?.aborted) {
      console.log(`[ingest/sse] 客户端断连，入库中止 (${label}, elapsed=${elapsed})`);
      res.end();
      return;
    }

    const message = err instanceof Error ? err.message : '未知错误';
    console.error(`[ingest/sse] Pipeline 出错 (${label}, elapsed=${elapsed}):`, message);
    if (!res.writableEnded) {
      res.write(`event: pipeline:error\ndata: ${JSON.stringify({ message })}\n\n`);
    }
  }

  res.end();
}

/**
 * POST /api/ingest/course/:id
 *
 * 对指定课程执行完整入库 Pipeline：
 * 查课程/章节 → HTML 清洗 → 分块 → LLM 打标 → 向量化 → 写入 Milvus
 *
 * 通过 query param 切换两种模式：
 * - POST /api/ingest/course/:id       → JSON 响应
 * - POST /api/ingest/course/:id?stream → SSE 响应（实时推送进度）
 */
router.post('/course/:id', async (req: Request<{ id: string }>, res: Response) => {
  const courseId = parseInt(req.params.id, 10);
  if (isNaN(courseId)) throw new AppError('课程 ID 无效', 400);

  const signal = getSignal(req);

  if (req.query.stream !== undefined) {
    await handleSse(res, signal, `courseId=${courseId}`, (onProgress) =>
      ingestCourse(courseId, signal, onProgress)
    );
  } else {
    const count = await ingestCourse(courseId, signal);
    sendSuccess(res, { courseId, chunkCount: count }, `课程 ${courseId} 入库完成`);
  }
});

/**
 * POST /api/ingest/course/:courseId/chapter/:chapterId
 *
 * 对指定课程的单个章节执行入库 Pipeline：
 * 查课程/章节 → HTML 清洗 → 分块 → LLM 打标 → 向量化 → 写入 Milvus
 *
 * 仅删除该章节下的旧版本记录（course_id + chapter_id 维度），不影响其他章节。
 *
 * 通过 query param 切换两种模式：
 * - POST /api/ingest/course/:courseId/chapter/:chapterId       → JSON 响应
 * - POST /api/ingest/course/:courseId/chapter/:chapterId?stream → SSE 响应
 */
router.post(
  '/course/:courseId/chapter/:chapterId',
  async (req: Request<{ courseId: string; chapterId: string }>, res: Response) => {
    const courseId = parseInt(req.params.courseId, 10);
    if (isNaN(courseId)) throw new AppError('课程 ID 无效', 400);

    const chapterId = parseInt(req.params.chapterId, 10);
    if (isNaN(chapterId)) throw new AppError('章节 ID 无效', 400);

    const signal = getSignal(req);

    if (req.query.stream !== undefined) {
      await handleSse(res, signal, `courseId=${courseId}, chapterId=${chapterId}`, (onProgress) =>
        ingestChapter(courseId, chapterId, signal, onProgress)
      );
    } else {
      const count = await ingestChapter(courseId, chapterId, signal);
      sendSuccess(res, { courseId, chapterId, chunkCount: count }, `章节 ${chapterId} 入库完成`);
    }
  }
);

export default router;
