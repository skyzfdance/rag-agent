import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { getSqliteConfig } from '@/config/sqlite';
import { initSchema } from './schema';

/** SQLite 数据库单例 */
let db: Database.Database | null = null;

/**
 * 获取 SQLite 数据库实例（单例模式）
 *
 * 首次调用时自动创建数据库文件和表结构，后续调用复用同一实例。
 *
 * @returns SQLite 数据库实例
 */
export function getDb(): Database.Database {
  if (!db) {
    const { dbPath } = getSqliteConfig();
    // 确保目录存在
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    initSchema(db);
  }
  return db;
}

/**
 * 关闭 SQLite 数据库连接
 *
 * 在进程退出或测试清理时调用。
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
