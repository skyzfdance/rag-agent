import { requireString, requireInt } from '@/shared/utils/env';

/** MySQL 数据库连接配置 */
export interface DatabaseConfig {
  /** 数据库主机地址 */
  host: string;
  /** 数据库端口号 */
  port: number;
  /** 数据库用户名 */
  user: string;
  /** 数据库密码 */
  password: string;
  /** 数据库名称 */
  name: string;
}

/**
 * 从环境变量读取 MySQL 配置
 *
 * 所有字段均为必填，缺失或格式错误时启动阶段直接报错（fail-fast）。
 *
 * @returns MySQL 数据库连接配置对象
 */
export function getDatabaseConfig(): DatabaseConfig {
  return {
    host: requireString('DB_HOST'),
    port: requireInt('DB_PORT', 3306),
    user: requireString('DB_USER'),
    password: requireString('DB_PASSWORD'),
    name: requireString('DB_NAME'),
  };
}
