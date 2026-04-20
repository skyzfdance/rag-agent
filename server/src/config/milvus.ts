import { requireString, optionalString, requireEnum } from '@/shared/utils/env';

/** Milvus 向量数据库配置 */
export interface MilvusConfig {
  /** Milvus 服务地址（host:port） */
  address: string;
  /** Milvus 用户名（可选） */
  username: string;
  /** Milvus 密码（可选） */
  password: string;
  /** 课程知识库 Collection 名称 */
  collectionName: string;
  /** 文档知识库 Collection 名称 */
  documentsCollectionName: string;
  /** Embedding 向量维度，默认 1024 */
  embeddingDimension: number;
}

/** 支持的 Embedding 维度列表 */
const VALID_DIMENSIONS = [64, 128, 256, 512, 768, 1024, 1536, 2048] as const;

/** 默认 Embedding 维度 */
const DEFAULT_DIMENSION = 1024;

/**
 * 从环境变量读取 Milvus 配置
 *
 * address 和 collectionName 为必填，缺失时启动阶段直接报错。
 * username / password 为可选（Milvus 可不开启鉴权）。
 * EMBEDDING_DIMENSION 必须为合法维度值，格式错误或不在范围内时报错。
 *
 * @returns Milvus 连接与 Collection 配置对象
 */
export function getMilvusConfig(): MilvusConfig {
  return {
    address: requireString('MILVUS_ADDRESS'),
    username: optionalString('MILVUS_USERNAME'),
    password: optionalString('MILVUS_PASSWORD'),
    collectionName: optionalString('MILVUS_COLLECTION_NAME', 'course_knowledge'),
    documentsCollectionName: optionalString('MILVUS_DOCUMENTS_COLLECTION_NAME', 'documents'),
    embeddingDimension: requireEnum('EMBEDDING_DIMENSION', VALID_DIMENSIONS, DEFAULT_DIMENSION),
  };
}
