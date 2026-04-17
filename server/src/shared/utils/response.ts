import type { Response } from 'express';

/** 统一响应结构 */
export interface ApiResponse<T = unknown> {
  /** 状态码：0 表示成功，非 0 为 HTTP 错误状态码 */
  code: number;
  /** 响应数据 */
  data: T;
  /** 提示信息 */
  msg: string;
}

/**
 * 发送统一成功响应
 *
 * @param res - Express 响应对象
 * @param data - 响应数据
 * @param msg - 提示信息，默认 'success'
 * @param statusCode - HTTP 状态码，默认 200
 */
export function sendSuccess<T>(res: Response, data: T, msg = 'success', statusCode = 200): void {
  res.status(statusCode).json({ code: 0, data, msg } satisfies ApiResponse<T>);
}
