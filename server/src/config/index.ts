/**
 * 配置层统一导出
 *
 * 将 .env 环境变量收拢为类型安全的配置对象，
 * 按外部服务维度拆分：server / database / milvus / llm。
 * 所有必填项在首次读取时即校验，缺失或格式错误立即 throw（fail-fast）。
 */

export { getServerConfig, type ServerConfig } from './server';
export { getDatabaseConfig, type DatabaseConfig } from './database';
export { getMilvusConfig, type MilvusConfig } from './milvus';
export { getLLMConfig, type LLMConfig } from './llm';
export { getIngestConfig, type IngestConfig } from './ingest';
export { getSqliteConfig, type SqliteConfig } from './sqlite';
export {
  getRetrievalConfig,
  type RetrievalConfig,
  type ModelCapability,
  type TokenThreshold,
  type ToolSearchConfig,
} from './retrieval';
export { getTavilyConfig, type TavilyConfig } from './tavily';
