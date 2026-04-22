import { ContentType } from '@/shared/types/index';
import { getCourse, getChapter, getChapters } from '@/modules/course/course.service';
import { embedDocuments } from '@/providers/embedding.provider';
import { insert, deleteByFilter } from '@/providers/milvus';
import { insertChunks, deleteChunks, rollbackChunksByVersion } from '@/providers/sqlite';
import { AppError } from '@/shared/errors/app-error';
import type { MilvusRecord, OnProgress, Chunk } from './ingest.types';
import { prepareChapter } from './utils/chapter-preparer';
import { processChunks } from './utils/chunk-processor';

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
