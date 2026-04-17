import morgan from 'morgan';

/**
 * 请求日志中间件
 *
 * 使用 morgan 打印每个请求的 method、url、状态码和耗时，
 * 格式示例：GET /api/ingest 200 12.345 ms
 */
export const requestLogger = morgan('dev');
