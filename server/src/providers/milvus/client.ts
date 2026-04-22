import { MilvusClient, DataType } from '@zilliz/milvus2-sdk-node';
import { getMilvusConfig, type MilvusConfig } from '@/config/index';

/** Milvus 客户端单例 */
let client: MilvusClient | null = null;

/** 缓存的 Milvus 配置，避免重复读取 */
let cachedConfig: MilvusConfig | null = null;

/**
 * 向量类型的 DataType 值集合
 *
 * 用于 describeCollection 后过滤掉向量字段，
 * 自动推导出需要返回的标量字段列表。
 */
const VECTOR_DATA_TYPES: ReadonlySet<DataType> = new Set([
  DataType.BinaryVector,
  DataType.FloatVector,
  DataType.Float16Vector,
  DataType.BFloat16Vector,
  DataType.SparseFloatVector,
]);

/** 每个 Collection 的非向量字段名缓存（Collection 名 → 字段名列表） */
const scalarFieldsCache = new Map<string, string[]>();

/**
 * 获取 Milvus 客户端（单例模式）
 *
 * 首次调用时根据配置创建客户端连接，后续调用复用同一实例。
 *
 * @returns Milvus 客户端实例
 */
export function getClient(): MilvusClient {
  if (!client) {
    const config = getMilvusConfig();
    cachedConfig = config;

    client = new MilvusClient({
      address: config.address,
      username: config.username || undefined,
      password: config.password || undefined,
    });
  }

  return client;
}

/**
 * 获取缓存中的 Milvus 配置
 *
 * @returns Milvus 配置
 */
export function getCachedMilvusConfig(): MilvusConfig {
  if (!cachedConfig) {
    cachedConfig = getMilvusConfig();
  }
  return cachedConfig;
}

/**
 * 获取默认 Collection 名称
 * @returns 配置中的 Collection 名称
 */
export function getCollectionName(): string {
  return getCachedMilvusConfig().collectionName;
}

/**
 * 获取 Collection 中除向量字段外的所有标量字段名
 *
 * 首次调用时通过 describeCollection 查询 schema 并缓存，
 * 后续调用直接返回缓存结果。这样 search 时不需要硬编码字段名，
 * schema 变更后只需重启服务即可自动适配。
 *
 * @param collectionName - Collection 名称，默认使用配置中的名称
 * @returns 非向量字段的字段名数组
 */
export async function getScalarFields(collectionName?: string): Promise<string[]> {
  const name = collectionName || getCollectionName();

  // 命中缓存直接返回
  const cached = scalarFieldsCache.get(name);
  if (cached) {
    return cached;
  }

  const milvus = getClient();
  const desc = await milvus.describeCollection({ collection_name: name });

  // 过滤掉向量类型字段，只保留标量字段
  const fields = desc.schema.fields
    .filter((f) => !VECTOR_DATA_TYPES.has(f.dataType))
    .map((f) => f.name);

  scalarFieldsCache.set(name, fields);
  return fields;
}

/**
 * 关闭 Milvus 客户端连接
 *
 * 在进程退出或测试清理时调用。
 */
export async function closeClient(): Promise<void> {
  if (client) {
    await client.closeConnection();
    client = null;
    cachedConfig = null;
    scalarFieldsCache.clear();
  }
}
