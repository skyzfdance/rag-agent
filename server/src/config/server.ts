import { requireInt } from '@/shared/utils/env';

/** HTTP 服务配置 */
export interface ServerConfig {
  /** 服务监听端口 */
  port: number;
}

/**
 * 从环境变量读取服务配置
 *
 * PORT 缺失时使用默认值 7300，格式错误时直接报错。
 *
 * @returns HTTP 服务配置对象
 */
export function getServerConfig(): ServerConfig {
  return {
    port: requireInt('PORT', 7300),
  };
}
