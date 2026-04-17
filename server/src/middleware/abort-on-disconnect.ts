import type { Request, Response, NextFunction } from 'express';

/** 存储 signal 的 key，用 Symbol 避免与其他属性冲突 */
const SIGNAL_KEY = Symbol('abortSignal');

/**
 * 客户端断连自动中止中间件
 *
 * 为每个请求创建 AbortController，监听客户端断开连接事件（req.close）。
 * 当客户端主动断开（如取消请求、关闭浏览器）时，自动触发 abort()，
 * 使下游正在进行的 LLM / Embedding 等异步调用能够及时终止，避免资源浪费。
 *
 * 下游通过 getSignal(req) 获取 signal。
 */
export function abortOnDisconnect(req: Request, _res: Response, next: NextFunction): void {
  const controller = new AbortController();

  // 用 Symbol 将 signal 挂到 req 上，类型安全且无命名冲突
  (req as unknown as Record<symbol, unknown>)[SIGNAL_KEY] = controller.signal;

  // 监听客户端断开连接：当请求的底层 socket 关闭时触发
  req.on('close', () => {
    // 只有在响应尚未结束时才算「客户端主动断开」
    // 如果响应已正常完成（res.end()），close 事件也会触发，此时不应 abort
    if (!_res.writableFinished) {
      console.log(`[abort-on-disconnect] 客户端断开连接: ${req.method} ${req.originalUrl}`);
      controller.abort();
    }
  });

  next();
}

/**
 * 从 Express 请求对象中获取 AbortSignal
 *
 * 必须在 abortOnDisconnect 中间件之后使用，否则返回 undefined。
 *
 * @param req - Express 请求对象
 * @returns AbortSignal（如果中间件已注入）或 undefined
 */
export function getSignal(req: Request): AbortSignal | undefined {
  return (req as unknown as Record<symbol, unknown>)[SIGNAL_KEY] as AbortSignal | undefined;
}
