import pLimit from 'p-limit';
import { ContentType } from '@/shared/types/index';
import {
  getCourse,
  getChapter,
  getChapters,
  getChapterResources,
} from '@/modules/course/course.service';
import { embedDocuments } from '@/providers/embedding.provider';
import { insert, deleteByFilter } from '@/providers/milvus.provider';
import { insertChunks, deleteChunks, rollbackChunksByVersion } from '@/providers/sqlite.provider';
import { AppError } from '@/shared/errors/app-error';
import { getIngestConfig } from '@/config/ingest';
import { cleanHtml, cleanResourceHtml } from './html-cleaner';
import { chunkSections } from './chunker';
import { extractTags } from './tag-extractor';
import type { MilvusRecord, OnProgress, Chunk, CleanedSection } from './ingest.types';
import type { Chapter } from '@/modules/course/course.types';

/** 需要跳过的章节标题关键词 */
const SKIP_TITLE_KEYWORDS = ['思考练习', '课程实践'];

/** prepareChapter 的返回结果 */
type PrepareResult = { status: 'ready'; chunks: Chunk[] } | { status: 'skipped'; reason: string };

/**
 * 预处理单个章节：skip 检查 → HTML 清洗 → 扩展阅读回查 → 分块
 *
 * 不涉及 LLM/Embedding API 调用，可快速完成。
 *
 * @param courseId - 课程 ID
 * @param chapter - 章节数据
 * @returns 分块结果或跳过原因
 */
async function prepareChapter(courseId: number, chapter: Chapter): Promise<PrepareResult> {
  if (!chapter.mate_content?.trim()) return { status: 'skipped', reason: '无内容' };
  if (SKIP_TITLE_KEYWORDS.some((kw) => chapter.title.includes(kw))) {
    return { status: 'skipped', reason: '思考练习/课程实践' };
  }

  const { sections, expandRefs } = cleanHtml(chapter.content, chapter.title);

  // 回查 expand 扩展阅读内容，补入 sections
  if (expandRefs.length > 0) {
    const resources = await getChapterResources(
      courseId,
      chapter.id,
      expandRefs.map((r) => r.id)
    );
    const resourceMap = new Map(resources.map((r) => [r.attach, r.resource]));
    for (const ref of expandRefs) {
      const html = resourceMap.get(ref.id);
      if (!html) continue;
      const paragraphs = cleanResourceHtml(html);
      if (paragraphs.length > 0) {
        sections.push({
          contentType: ContentType.EXTENDED_READING,
          headingPath: ref.headingPath,
          paragraphs,
          bubbleNotes: {},
          mediaRefs: [],
          exerciseIds: [],
        } satisfies CleanedSection);
      }
    }
  }

  const chunks = chunkSections(sections);
  if (chunks.length === 0) return { status: 'skipped', reason: '清洗后无有效内容' };

  return { status: 'ready', chunks };
}

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
async function processChunks(
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

/**
 * 对单个课程执行完整入库 Pipeline
 *
 * 流程：查课程 → 查章节 → 清洗 → 分块 → 打标 → 向量化 → 批量写入 → 删旧版本
 *
 * 所有 records 累积完毕后一次性批量写入，保证版本切换的原子性：
 * 要么全部成功（新版本完整），要么全部回滚（保留旧版本）。
 *
 * @param courseId - 课程 ID
 * @param signal - 可选的中止信号，客户端断连时自动终止 Pipeline
 * @param onProgress - 可选的进度回调，传入时推送 SSE 事件
 * @returns 写入的 chunk 总数
 */
export async function ingestCourse(
  courseId: number,
  signal?: AbortSignal,
  onProgress?: OnProgress
): Promise<number> {
  const course = await getCourse(courseId);
  if (!course) throw new AppError(`课程 ${courseId} 不存在`, 404);

  const chapters = await getChapters(courseId);
  const version = Date.now().toString();
  const records: MilvusRecord[] = [];

  // 是否有课程简介需要作为独立 chunk
  const hasIntro = !!course.description?.trim();

  // 预处理所有章节：清洗 + 分块（不涉及 API 调用，可快速完成）
  // 同时收集需要跳过的章节信息，等 pipeline:start 之后再统一推送
  const chapterDataList: { chapter: (typeof chapters)[0]; chunks: Chunk[] }[] = [];
  const skippedChapters: { chapterId: number; title: string; reason: string }[] = [];

  for (const chapter of chapters) {
    if (signal?.aborted) throw new AppError('客户端已断开连接，入库中止', 499);

    const result = await prepareChapter(courseId, chapter);
    if (result.status === 'skipped') {
      skippedChapters.push({ chapterId: chapter.id, title: chapter.title, reason: result.reason });
      continue;
    }
    chapterDataList.push({ chapter, chunks: result.chunks });
  }

  // 计算总 chunk 数（课程简介算 1 条）
  const chapterChunks = chapterDataList.reduce((sum, d) => sum + d.chunks.length, 0);
  const totalChunks = chapterChunks + (hasIntro ? 1 : 0);

  // 推送 pipeline:start（必须在所有 chapter:skip 之前，作为前端初始化边界）
  onProgress?.({
    type: 'pipeline:start',
    data: {
      courseName: course.title,
      totalChapters: chapters.length,
      validChapters: chapterDataList.length,
      totalChunks,
    },
  });

  // pipeline:start 之后再推送跳过事件
  for (const skipped of skippedChapters) {
    onProgress?.({ type: 'chapter:skip', data: skipped });
  }

  // 课程简介作为独立 chunk（在 pipeline:start 之后处理）
  if (hasIntro) {
    if (signal?.aborted) throw new AppError('客户端已断开连接，入库中止', 499);

    const [embedding] = await embedDocuments([course.description!], signal);
    records.push({
      id: `${courseId}_0_${version}_0`,
      course_id: courseId,
      chapter_id: 0,
      version,
      content_type: ContentType.INTRO,
      chunk_index: 0,
      title: course.title,
      heading_path: course.title,
      content: course.description!,
      tags: [],
      bubble_notes: {},
      media_refs: [],
      embedding,
    });
  }

  // 逐章节处理：tags + embedding（通过 p-limit 控制并发）
  for (const { chapter, chunks } of chapterDataList) {
    if (signal?.aborted) throw new AppError('客户端已断开连接，入库中止', 499);

    onProgress?.({
      type: 'chapter:start',
      data: { chapterId: chapter.id, title: chapter.title, chunkCount: chunks.length },
    });

    const results = await processChunks(chunks, chapter.id, signal, onProgress);

    chunks.forEach((chunk, i) => {
      records.push({
        id: `${courseId}_${chapter.id}_${version}_${i}`,
        course_id: courseId,
        chapter_id: chapter.id,
        version,
        content_type: chunk.contentType,
        chunk_index: i,
        title: chapter.title,
        heading_path: chunk.headingPath,
        content: chunk.content,
        tags: results[i].tags,
        bubble_notes: chunk.bubbleNotes,
        media_refs: chunk.mediaRefs,
        embedding: results[i].embedding,
      });
    });

    onProgress?.({
      type: 'chapter:done',
      data: { chapterId: chapter.id, title: chapter.title, recordCount: chunks.length },
    });
  }

  // 批量写入：先 SQLite 再 Milvus，保证整批原子性
  // Milvus 失败时双向补偿：回滚 SQLite + 清除 Milvus 可能的残数据
  if (records.length > 0) {
    insertChunks(records);
    try {
      await insert(records as unknown as import('@zilliz/milvus2-sdk-node').RowData[]);
    } catch (err) {
      rollbackChunksByVersion(version);
      // Milvus 批量 insert 可能部分成功，补偿删除残留数据
      await deleteByFilter(`course_id == ${courseId} && version == "${version}"`).catch((e) => {
        console.error('[双写补偿] Milvus 残数据清理失败，可能存在孤立记录', e);
      });
      throw err;
    }
  }
  onProgress?.({
    type: 'pipeline:write',
    data: { recordCount: records.length },
  });

  // 删除同 course_id 下所有旧版本记录
  // 先删 Milvus，再删 SQLite：SQLite 未删时下次重跑 INSERT OR REPLACE 会覆盖，最终一致
  const deletedFilter = `course_id == ${courseId} && version != "${version}"`;
  await deleteByFilter(deletedFilter);
  deleteChunks(courseId, version);
  onProgress?.({
    type: 'pipeline:cleanup',
    data: { deletedFilter },
  });

  return records.length;
}

/**
 * 对单个章节执行入库 Pipeline
 *
 * 流程与全量入库一致，范围缩到单个章节：
 * 查课程/章节 → HTML 清洗 → 分块 → 打标 → 向量化 → 写入 Milvus → 删旧版本
 *
 * 无论章节是否被跳过，都会删除该章节下的旧版本记录，保证 Milvus 数据与源数据一致。
 *
 * @param courseId - 课程 ID
 * @param chapterId - 章节 ID
 * @param signal - 可选的中止信号
 * @param onProgress - 可选的进度回调
 * @returns 写入的 chunk 总数
 */
export async function ingestChapter(
  courseId: number,
  chapterId: number,
  signal?: AbortSignal,
  onProgress?: OnProgress
): Promise<number> {
  const course = await getCourse(courseId);
  if (!course) throw new AppError(`课程 ${courseId} 不存在`, 404);

  const chapter = await getChapter(courseId, chapterId);
  if (!chapter) throw new AppError(`章节 ${chapterId} 不存在`, 404);

  const version = Date.now().toString();
  // 章节级删除 filter，无论是否有新数据都会执行
  const deletedFilter = `course_id == ${courseId} && chapter_id == ${chapterId} && version != "${version}"`;

  const prepResult = await prepareChapter(courseId, chapter);

  if (prepResult.status === 'skipped') {
    onProgress?.({
      type: 'pipeline:start',
      data: { courseName: course.title, totalChapters: 1, validChapters: 0, totalChunks: 0 },
    });
    onProgress?.({
      type: 'chapter:skip',
      data: { chapterId: chapter.id, title: chapter.title, reason: prepResult.reason },
    });

    // 章节被跳过时仍需清除旧数据（如章节内容被清空或改为思考练习）
    await deleteByFilter(deletedFilter);
    deleteChunks(courseId, version, chapterId);
    onProgress?.({ type: 'pipeline:cleanup', data: { deletedFilter } });

    return 0;
  }

  const { chunks } = prepResult;

  onProgress?.({
    type: 'pipeline:start',
    data: {
      courseName: course.title,
      totalChapters: 1,
      validChapters: 1,
      totalChunks: chunks.length,
    },
  });

  onProgress?.({
    type: 'chapter:start',
    data: { chapterId: chapter.id, title: chapter.title, chunkCount: chunks.length },
  });

  const results = await processChunks(chunks, chapter.id, signal, onProgress);

  const records: MilvusRecord[] = chunks.map((chunk, i) => ({
    id: `${courseId}_${chapter.id}_${version}_${i}`,
    course_id: courseId,
    chapter_id: chapter.id,
    version,
    content_type: chunk.contentType,
    chunk_index: i,
    title: chapter.title,
    heading_path: chunk.headingPath,
    content: chunk.content,
    tags: results[i].tags,
    bubble_notes: chunk.bubbleNotes,
    media_refs: chunk.mediaRefs,
    embedding: results[i].embedding,
  }));

  onProgress?.({
    type: 'chapter:done',
    data: { chapterId: chapter.id, title: chapter.title, recordCount: records.length },
  });

  // 先写 SQLite，再写 Milvus；Milvus 失败时双向补偿
  insertChunks(records);
  try {
    await insert(records as unknown as import('@zilliz/milvus2-sdk-node').RowData[]);
  } catch (err) {
    rollbackChunksByVersion(version);
    await deleteByFilter(
      `course_id == ${courseId} && chapter_id == ${chapterId} && version == "${version}"`
    ).catch((e) => {
      console.error('[双写补偿] Milvus 残数据清理失败，可能存在孤立记录', e);
    });
    throw err;
  }
  onProgress?.({ type: 'pipeline:write', data: { recordCount: records.length } });

  // 先删 Milvus，再删 SQLite：SQLite 未删时下次重跑 INSERT OR REPLACE 会覆盖，最终一致
  await deleteByFilter(deletedFilter);
  deleteChunks(courseId, version, chapterId);
  onProgress?.({ type: 'pipeline:cleanup', data: { deletedFilter } });

  return records.length;
}
