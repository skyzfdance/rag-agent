import { cleanHtml } from '@/modules/ingest/html-cleaner';
import { chunkSections } from '@/modules/ingest/chunker';
import type { Chunk } from '@/modules/ingest/ingest.types';
import type { Chapter } from '@/modules/course/course.types';
import { resolveExpands } from './expand-resolver';

/** 需要跳过的章节标题关键词 */
const SKIP_TITLE_KEYWORDS = ['思考练习', '课程实践'];

/** prepareChapter 的返回结果 */
export type PrepareResult =
  | {
      /** 预处理状态，`ready` 表示当前章节已成功分块 */
      status: 'ready';
      /** 清洗并分块后的 chunk 列表 */
      chunks: Chunk[];
    }
  | {
      /** 预处理状态，`skipped` 表示当前章节被跳过 */
      status: 'skipped';
      /** 跳过原因 */
      reason: string;
    };

/**
 * 预处理单个章节：skip 检查 → HTML 清洗 → 扩展阅读回查 → 分块
 *
 * 不涉及 LLM/Embedding API 调用，可快速完成。
 *
 * @param courseId - 课程 ID
 * @param chapter - 章节数据
 * @returns 分块结果或跳过原因
 */
export async function prepareChapter(courseId: number, chapter: Chapter): Promise<PrepareResult> {
  if (!chapter.mate_content?.trim()) return { status: 'skipped', reason: '无内容' };
  if (SKIP_TITLE_KEYWORDS.some((kw) => chapter.title.includes(kw))) {
    return { status: 'skipped', reason: '思考练习/课程实践' };
  }

  const { sections, expandRefs } = cleanHtml(chapter.content, chapter.title);
  await resolveExpands(courseId, chapter.id, sections, expandRefs);

  const chunks = chunkSections(sections);
  if (chunks.length === 0) return { status: 'skipped', reason: '清洗后无有效内容' };

  return { status: 'ready', chunks };
}
