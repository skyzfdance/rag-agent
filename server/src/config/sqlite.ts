import { optionalString } from '@/shared/utils/env';
import path from 'path';

/** SQLite 配置 */
export interface SqliteConfig {
  /** SQLite 数据库文件路径 */
  dbPath: string;
}

/**
 * 从环境变量读取 SQLite 配置
 *
 * SQLITE_PATH 未设置时默认存放在 process.cwd()/data/rag.db。
 * pnpm --filter server 启动时 cwd 为 server/，即 server/data/rag.db。
 *
 * @returns SQLite 配置对象
 */
export function getSqliteConfig(): SqliteConfig {
  return {
    dbPath: optionalString('SQLITE_PATH', path.resolve(process.cwd(), 'data/rag.db')),
  };
}
