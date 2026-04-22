import { ContentType } from '@/shared/types/index';
import { getChapterResources } from '@/modules/course/course.service';
import { cleanResourceHtml } from '@/modules/ingest/html-cleaner';
import type { CleanedSection, ExpandRef } from '@/modules/ingest/ingest.types';

/**
 * 回查 expand 扩展阅读内容，将结果追加到 sections 列表中
 * @param courseId - 课程 ID
 * @param chapterId - 章节 ID
 * @param sections - 已清洗的 sections（会被原地修改）
 * @param expandRefs - 需要回查的 expand 引用
 */
export async function resolveExpands(
  courseId: number,
  chapterId: number,
  sections: CleanedSection[],
  expandRefs: ExpandRef[]
): Promise<void> {
  if (expandRefs.length === 0) return;
  const resources = await getChapterResources(
    courseId,
    chapterId,
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
      });
    }
  }
}
