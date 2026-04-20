import express, { type Application } from 'express';
import cors from 'cors';
import { abortOnDisconnect } from '@/middleware/abort-on-disconnect';
import { requestLogger } from '@/middleware/request-logger';
import { errorHandler } from '@/middleware/error-handler';
import ingestRouter from '@/modules/ingest/ingest.router';
import retrievalRouter from '@/modules/retrieval/retrieval.router';
import { sessionRouter } from '@/modules/session/session.router';
import { memoryRouter } from '@/modules/retrieval/memory.router';
import { chunkRouter } from '@/modules/chunk/chunk.router';

/**
 * 创建并配置 Express 应用实例
 * @returns 配置好中间件的 Express 应用
 */
function createApp(): Application {
  const app = express();

  // 请求日志：打印 method + url + status + 耗时
  app.use(requestLogger);

  // 解析 application/x-www-form-urlencoded 格式的请求体
  app.use(express.urlencoded({ extended: true }));
  // 解析 application/json 格式的请求体
  app.use(express.json());
  // 跨域处理
  app.use(cors());
  // 客户端断连自动中止：为每个请求注入 AbortSignal，断连时自动取消下游 LLM/Embedding 调用
  app.use(abortOnDisconnect);

  // 健康检查接口，用于验证服务是否正常运行
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // 业务路由
  app.use('/api/ingest', ingestRouter);
  app.use('/api/chat', retrievalRouter);
  app.use('/api/sessions', sessionRouter);
  app.use('/api/memory', memoryRouter);
  app.use('/api/chunks', chunkRouter);

  // 全局错误处理（必须注册在所有路由之后）
  app.use(errorHandler);

  return app;
}

export default createApp();
