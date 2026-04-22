import { ContentType } from '@/shared/types/index';
import { extractTags } from '@/modules/ingest/tag-extractor';
import type { Chunk } from '@/modules/ingest/ingest.types';

/**
 * 对 chunks 列表逐个调用 LLM 提取 tags，支持中止
 * @param chunks - 分块后的 chunk 列表
 * @param signal - 可选的中止信号
 * @returns 每个 chunk 的详细信息，包含提取出的 tags
 */
export async function extractTagsForChunks(
  chunks: Chunk[],
  signal?: AbortSignal
): Promise<
  {
    index: number;
    contentType: ContentType;
    headingPath: string;
    contentLength: number;
    contentPreview: string;
    tags: string[];
  }[]
> {
  const results: {
    index: number;
    contentType: ContentType;
    headingPath: string;
    contentLength: number;
    contentPreview: string;
    tags: string[];
  }[] = [];

  for (let i = 0; i < chunks.length; i++) {
    // 每个 chunk 调 LLM 前检查是否已中止
    if (signal?.aborted) {
      console.log(`[dev/tags] 第 ${i + 1}/${chunks.length} 个 chunk 前检测到中止`);
      break;
    }

    const chunk = chunks[i];
    console.log(
      `[dev/tags] 正在提取第 ${i + 1}/${chunks.length} 个 chunk 的 tags（${chunk.content.length} 字）...`
    );
    const tags = await extractTags(chunk.content, signal);

    results.push({
      index: i,
      contentType: chunk.contentType,
      headingPath: chunk.headingPath,
      contentLength: chunk.content.length,
      contentPreview: chunk.content.slice(0, 300),
      tags,
    });
  }

  return results;
}
