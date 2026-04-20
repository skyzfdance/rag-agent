import {
  MilvusClient,
  DataType,
  IndexType,
  MetricType,
  type RowData,
} from '@zilliz/milvus2-sdk-node';
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
 * 确保 Collection 存在并已加载，不存在时自动创建 schema，始终检查索引完整性
 *
 * 启动时调用一次即可。流程：
 * 1. 检查 Collection 是否存在，不存在则创建 schema
 * 2. 检查 5 个索引是否齐全，缺失的自动补建
 * 3. 确保 Collection 已加载到内存
 *
 * 这样即使上次启动建表后索引创建中途崩溃，下次启动也能自动补全。
 */
export async function ensureCollection(): Promise<void> {
  const milvus = getClient();
  // 等待连接建立完成，避免后续操作在未连接状态下执行
  await milvus.connectPromise;
  const config = cachedConfig!;
  const name = config.collectionName;

  // ── 第一步：确保 Collection 存在 ──
  const { value: exists } = await milvus.hasCollection({ collection_name: name });
  if (exists) {
    console.log(`[milvus] Collection「${name}」已存在，跳过创建`);
  } else {
    console.log(`[milvus] Collection「${name}」不存在，开始创建...`);
    await milvus.createCollection({
      collection_name: name,
      fields: [
        {
          name: 'id',
          data_type: DataType.VarChar,
          is_primary_key: true,
          max_length: 128,
          description: '主键，格式：{courseId}_{chapterId}_{version}_{chunkIndex}',
        },
        {
          name: 'course_id',
          data_type: DataType.Int64,
          description: '课程 ID，用于检索时按课程过滤',
        },
        {
          name: 'chapter_id',
          data_type: DataType.Int64,
          description: '章节 ID，用于更新时按章节批量删除',
        },
        {
          name: 'version',
          data_type: DataType.VarChar,
          max_length: 32,
          description: '入库批次版本号（时间戳），用于安全更新',
        },
        {
          name: 'content_type',
          data_type: DataType.VarChar,
          max_length: 32,
          description: '内容类型标识（intro / body / case_study 等）',
        },
        {
          name: 'chunk_index',
          data_type: DataType.Int16,
          description: '该章节下的分块序号',
        },
        {
          name: 'title',
          data_type: DataType.VarChar,
          max_length: 512,
          description: '章节标题',
        },
        {
          name: 'heading_path',
          data_type: DataType.VarChar,
          max_length: 1024,
          description: '标题路径，如 "第二章 > 第一节 > 一、概述"',
        },
        {
          name: 'content',
          data_type: DataType.VarChar,
          max_length: 8192,
          description: '清洗后的纯文本内容',
        },
        {
          name: 'tags',
          data_type: DataType.JSON,
          description: 'LLM 提取的知识点标签 JSON 数组',
        },
        {
          name: 'bubble_notes',
          data_type: DataType.JSON,
          description: '气泡标注 JSON 对象',
        },
        {
          name: 'media_refs',
          data_type: DataType.JSON,
          description: '关联多媒体元信息 JSON 数组',
        },
        {
          name: 'embedding',
          data_type: DataType.FloatVector,
          dim: config.embeddingDimension,
          description: `${config.embeddingDimension} 维向量`,
        },
      ],
    });
    console.log(`[milvus] Collection「${name}」创建成功`);
  }

  // ── 第二步：确保索引完整 ──
  // 查询当前已有的索引，避免重复创建
  const indexResp = await milvus.describeIndex({ collection_name: name });
  const existingIndexNames = new Set(
    (indexResp.index_descriptions ?? []).map((desc) => desc.index_name)
  );

  /** 需要创建的索引定义 */
  const requiredIndexes = [
    // 4 个标量索引：加速过滤查询
    { field: 'course_id', name: 'idx_course_id', type: IndexType.AUTOINDEX },
    { field: 'chapter_id', name: 'idx_chapter_id', type: IndexType.AUTOINDEX },
    { field: 'version', name: 'idx_version', type: IndexType.AUTOINDEX },
    { field: 'content_type', name: 'idx_content_type', type: IndexType.AUTOINDEX },
    // 向量索引
    {
      field: 'embedding',
      name: 'idx_embedding',
      type: IndexType.AUTOINDEX,
      metric: MetricType.COSINE,
    },
  ];

  for (const idx of requiredIndexes) {
    if (existingIndexNames.has(idx.name)) continue;

    console.log(`[milvus] 索引「${idx.name}」不存在，创建中...`);
    await milvus.createIndex({
      collection_name: name,
      field_name: idx.field,
      index_name: idx.name,
      index_type: idx.type,
      ...(idx.metric ? { metric_type: idx.metric } : {}),
    });
    console.log(`[milvus] 索引「${idx.name}」创建成功`);
  }

  // ── 第三步：加载 Collection 到内存 ──
  await milvus.loadCollectionSync({ collection_name: name });
  console.log(`[milvus] Collection「${name}」已加载到内存，初始化完成 ✅`);
}

/**
 * 获取默认 Collection 名称
 * @returns 配置中的 Collection 名称
 */
export function getCollectionName(): string {
  if (!cachedConfig) {
    cachedConfig = getMilvusConfig();
  }
  return cachedConfig.collectionName;
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
 * 向 Milvus Collection 批量插入数据
 *
 * @param data - 行数据数组，每行包含 schema 中定义的所有字段
 * @param collectionName - 目标 Collection 名称，默认使用配置中的名称
 * @returns 插入结果，包含成功/失败索引
 */
export async function insert(data: RowData[], collectionName?: string) {
  const milvus = getClient();
  return milvus.insert({
    collection_name: collectionName || getCollectionName(),
    data,
  });
}

/**
 * 批量更新数据（upsert 语义）
 *
 * 按主键匹配：存在则覆盖，不存在则插入。
 * 适用于需要原地更新已有记录的场景。
 *
 * 注意：项目的主要更新策略是「写新版本 → 删旧版本」（见设计文档 06），
 * 通过 insert + deleteByFilter 配合 version 字段实现安全更新。
 * upsert 作为补充手段，用于简单的单条/少量记录更新场景。
 *
 * @param data - 行数据数组，必须包含主键字段
 * @param collectionName - 目标 Collection 名称，默认使用配置中的名称
 * @returns 更新结果，包含成功/失败索引
 */
export async function upsert(data: RowData[], collectionName?: string) {
  const milvus = getClient();
  return milvus.upsert({
    collection_name: collectionName || getCollectionName(),
    data,
  });
}

/**
 * 向量检索
 *
 * 根据向量在指定 Collection 中检索最相似的记录。
 * 支持标量过滤（如按 course_id 过滤）。
 * 默认返回除向量字段外的所有标量字段（通过 describeCollection 自动推导）。
 *
 * @param vector - 查询向量
 * @param topK - 返回结果数量
 * @param filter - 标量过滤表达式，如 `course_id == 816`
 * @param outputFields - 需要返回的字段列表，不传则自动返回全部标量字段
 * @param collectionName - 目标 Collection 名称，默认使用配置中的名称
 * @returns 检索结果
 */
export async function search(
  vector: number[],
  topK: number,
  filter?: string,
  outputFields?: string[],
  collectionName?: string
) {
  const name = collectionName || getCollectionName();
  const milvus = getClient();

  // 未指定 outputFields 时，自动获取全部标量字段
  const fields = outputFields || (await getScalarFields(name));

  return milvus.search({
    collection_name: name,
    data: [vector],
    limit: topK,
    filter: filter || undefined,
    output_fields: fields,
  });
}

/**
 * 按过滤条件批量删除记录
 *
 * 用于更新策略中「删除旧版本数据」的步骤。
 *
 * @param filter - 过滤表达式，如 `chapter_id == 1048 && version != "20240101"`
 * @param collectionName - 目标 Collection 名称，默认使用配置中的名称
 * @returns 删除结果
 */
export async function deleteByFilter(filter: string, collectionName?: string) {
  const milvus = getClient();
  return milvus.delete({
    collection_name: collectionName || getCollectionName(),
    filter,
  });
}

/**
 * 按主键 ID 查询单条记录（含全部字段）
 *
 * 用于需要读取完整记录后再 upsert 更新的场景。
 *
 * @param id - chunk 主键
 * @param collectionName - 目标 Collection 名称，默认使用配置中的名称
 * @returns 匹配的记录，不存在时返回 undefined
 */
export async function getById(id: string, collectionName?: string): Promise<RowData | undefined> {
  const name = collectionName || getCollectionName();
  const milvus = getClient();

  const result = await milvus.query({
    collection_name: name,
    filter: `id == "${id}"`,
    output_fields: ['*'],
    limit: 1,
  });

  return result.data[0];
}

/**
 * 按主键 ID 删除单条记录
 *
 * @param id - chunk 主键
 * @param collectionName - 目标 Collection 名称，默认使用配置中的名称
 * @returns 删除结果
 */
export async function deleteById(id: string, collectionName?: string) {
  const milvus = getClient();
  return milvus.delete({
    collection_name: collectionName || getCollectionName(),
    ids: [id],
  });
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
