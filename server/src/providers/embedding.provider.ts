import OpenAI from 'openai';
import { getLLMConfig, getMilvusConfig } from '@/config/index';

/**
 * 阿里云百炼 Embedding 接口单次最大输入数量
 *
 * 超过此数量需要分批请求，否则会报 400 InvalidParameter。
 */
const BATCH_SIZE = 10;

/** OpenAI 兼容客户端单例 */
let client: OpenAI | null = null;

/**
 * 获取 OpenAI 兼容客户端实例（单例模式）
 *
 * 直接使用 openai SDK 而非 LangChain 的 OpenAIEmbeddings，
 * 因为 LangChain 的 Embeddings 接口不支持 AbortSignal，
 * 无法在客户端断连时真正取消 HTTP 请求。
 *
 * @returns OpenAI 客户端实例
 */
function getClient(): OpenAI {
  if (!client) {
    const config = getLLMConfig();
    client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }
  return client;
}

/**
 * 调用 Embedding API 的底层方法
 *
 * 单次调用，input 数量不得超过 BATCH_SIZE。
 *
 * @param input - 文本或文本数组
 * @param signal - 可选的中止信号
 * @returns 按 index 排序的向量数组
 */
async function createEmbeddings(
  input: string | string[],
  signal?: AbortSignal
): Promise<number[][]> {
  const milvusConfig = getMilvusConfig();
  const llmConfig = getLLMConfig();

  const response = await getClient().embeddings.create(
    {
      model: llmConfig.embeddingsModelName,
      input,
      dimensions: milvusConfig.embeddingDimension,
    },
    { signal }
  );

  return response.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
}

/**
 * 为单段文本生成 Embedding 向量
 *
 * 用于检索时将用户 query 转换为向量。
 *
 * @param text - 待向量化的文本
 * @param signal - 可选的中止信号，客户端断连时真正取消 HTTP 请求
 * @returns 向量数组（维度由配置决定，默认 1024）
 */
export async function embedQuery(text: string, signal?: AbortSignal): Promise<number[]> {
  const [embedding] = await createEmbeddings(text, signal);
  return embedding;
}

/**
 * 为多段文本批量生成 Embedding 向量
 *
 * 自动按 BATCH_SIZE 分批请求，每批之间检查 signal 是否已被中止。
 * 用于入库时批量将 chunk 文本转换为向量。
 *
 * @param texts - 待向量化的文本数组
 * @param signal - 可选的中止信号，客户端断连时真正取消 HTTP 请求
 * @returns 向量数组的数组，顺序与输入一致
 */
export async function embedDocuments(texts: string[], signal?: AbortSignal): Promise<number[][]> {
  if (texts.length === 0) return [];

  const results: number[][] = [];

  // 按 BATCH_SIZE 分批，每批之间检查 signal 避免断连后继续请求
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const batch = texts.slice(i, i + BATCH_SIZE);
    const embeddings = await createEmbeddings(batch, signal);
    results.push(...embeddings);
  }

  return results;
}
