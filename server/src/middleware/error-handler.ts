import type { Request, Response, NextFunction } from 'express';
import { AppError } from '@/shared/errors/app-error';

/**
 * 全局错误处理中间件
 *
 * - 业务错误（AppError, isOperational=true）：返回对应 statusCode + message
 * - 系统错误（未知异常或 isOperational=false）：返回 500 + 通用提示，打印完整堆栈
 *
 * 注意：SSE 流式响应的错误在路由层自行处理（headers 已发送后无法再设置状态码），
 * 不走全局中间件。
 *
 * @param err - 捕获到的错误
 * @param _req - Express 请求对象（未使用）
 * @param res - Express 响应对象
 * @param _next - 下一个中间件（签名必须保留以被 Express 识别为错误处理中间件）
 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    // 业务错误：按 isOperational 区分日志级别
    if (err.isOperational) {
      console.warn(`[业务错误] ${err.statusCode} - ${err.message}`);
    } else {
      console.error(`[系统错误] ${err.statusCode} - ${err.message}\n`, err.stack);
    }

    res.status(err.statusCode).json({
      code: err.statusCode,
      data: null,
      msg: err.isOperational ? err.message : '服务器内部错误，请稍后重试',
    });
    return;
  }

  // 未知错误：一律当作系统错误处理
  console.error('[未知错误]', err.stack ?? err);

  res.status(500).json({
    code: 500,
    data: null,
    msg: '服务器内部错误，请稍后重试',
  });
}
