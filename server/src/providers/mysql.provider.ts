import mysql, {
  type Pool,
  type PoolOptions,
  type RowDataPacket,
  type ExecuteValues,
} from 'mysql2/promise';
import { getDatabaseConfig } from '@/config/index';

/** MySQL 连接池单例 */
let pool: Pool | null = null;

/**
 * 获取 MySQL 连接池（单例模式）
 *
 * 首次调用时根据配置创建连接池，后续调用复用同一实例。
 * 项目对 MySQL 为只读访问，不做写入操作。
 *
 * @returns MySQL 连接池实例
 */
export function getPool(): Pool {
  if (!pool) {
    const dbConfig = getDatabaseConfig();

    const poolOptions: PoolOptions = {
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.name,
      /** 最大连接数 */
      connectionLimit: 10,
      /** 最大空闲连接数 */
      maxIdle: 10,
      /** 空闲连接超时时间（毫秒） */
      idleTimeout: 60000,
      /** 连接池满时是否排队等待 */
      waitForConnections: true,
      /** 队列最大长度，0 表示不限制 */
      queueLimit: 0,
    };

    pool = mysql.createPool(poolOptions);
  }

  return pool;
}

/**
 * 执行 SQL 查询并返回结果行
 *
 * 通用查询方法，接收 SQL 和参数化占位符，防止 SQL 注入。
 * 使用泛型约束返回类型，调用方需自行定义行类型。
 *
 * @param sql - SQL 查询语句，支持 `?` 占位符
 * @param params - 占位符对应的参数值
 * @returns 查询结果行数组
 *
 * @example
 * ```ts
 * interface CourseRow { id: number; title: string; }
 * const rows = await query<CourseRow>('SELECT id, title FROM courses WHERE id = ?', [816]);
 * ```
 */
export async function query<T extends RowDataPacket>(
  sql: string,
  params: ExecuteValues = []
): Promise<T[]> {
  const [rows] = await getPool().execute<T[]>(sql, params);
  return rows;
}

/**
 * 关闭 MySQL 连接池
 *
 * 在进程退出或测试清理时调用，释放所有数据库连接。
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
