import { DataType, IndexType, MetricType } from '@zilliz/milvus2-sdk-node';
import { getCachedMilvusConfig, getClient } from './client';

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
  const config = getCachedMilvusConfig();
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
