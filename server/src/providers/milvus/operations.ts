import type { RowData } from '@zilliz/milvus2-sdk-node';
import { getClient, getCollectionName, getScalarFields } from './client';

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
