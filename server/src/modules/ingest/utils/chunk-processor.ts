import pLimit from 'p-limit';
import { embedDocuments } from '@/providers/embedding.provider';
import { AppError } from '@/shared/errors/app-error';
import { getIngestConfig } from '@/config/ingest';
import { extractTags } from '@/modules/ingest/tag-extractor';
import type { Chunk, OnProgress } from '@/modules/ingest/ingest.types';

/**
 * 对指定章节的 chunks 执行 tags 提取 + embedding，通过 p-limit 控制并发
 *
 * 每个 chunk 内部串行（tags → embedding），多个 chunk 之间并发执行。
 * 每一步完成后通过 onProgress 推送进度事件。
 *
 * @param chunks - 分块后的 chunk 列表
 * @param chapterId - 章节 ID
 * @param signal - 可选的中止信号
 * @param onProgress - 可选的进度回调
 * @returns 每个 chunk 对应的 { tags, embedding } 数组
 */
export async function processChunks(
  chunks: Chunk[],
  chapterId: number,
  signal?: AbortSignal,
  onProgress?: OnProgress
): Promise<{ tags: string[]; embedding: number[] }[]> {
  const { concurrency } = getIngestConfig();
  const limit = pLimit(concurrency);

  const tasks = chunks.map((chunk, i) =>
    limit(async () => {
      // 队列中等到执行时，先检查是否已中止，避免浪费 API 调用
      if (signal?.aborted) return null;

      const tags = await extractTags(chunk.content, signal);
      onProgress?.({
        type: 'chunk:tags',
        data: { chapterId, chunkIndex: i, chunkTotal: chunks.length, tags },
      });

      const [embedding] = await embedDocuments([chunk.content], signal);
      onProgress?.({
        type: 'chunk:embed',
        data: { chapterId, chunkIndex: i, chunkTotal: chunks.length, dimension: embedding.length },
      });

      return { tags, embedding };
    })
  );

  const results = await Promise.all(tasks);

  // 过滤掉被中止而跳过的 null 结果
  // 如果有任何 chunk 因中止被跳过，说明 signal 已 aborted，抛出中止错误
  if (results.some((r) => r === null)) {
    throw new AppError('客户端已断开连接，入库中止', 499);
  }

  return results as { tags: string[]; embedding: number[] }[];
}
