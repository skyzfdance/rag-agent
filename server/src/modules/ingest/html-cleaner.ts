import * as cheerio from 'cheerio';
import { ContentType, MediaType, type MediaRef } from '@/shared/types/index';
import type { CleanedSection, CleanResult, ExpandRef } from './ingest.types';

/** 解码常见 HTML 实体并压缩空白 */
function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 标题层级 → headingStack 深度（h1=1, h2=2, h3=3, h4=4） */
const HEADING_DEPTH: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4 };

/** data-title → ContentType 映射 */
const TEMPLATE_TYPE: Record<string, ContentType> = {
  课程导入: ContentType.INTRO_CASE,
  案例分享: ContentType.CASE_STUDY,
  拓展阅读: ContentType.EXTENDED_READING,
};

/**
 * 将章节 HTML 清洗为结构化内容段列表
 *
 * 使用 cheerio 解析 DOM，按文档顺序遍历所有直接子节点：
 * - data-type="h1/h2/h3/h4" → 更新 headingStack
 * - data-type="p"（模板框）→ 独立 CleanedSection，打 content_type 标签
 * - data-type="image/video" → media_refs
 * - data-type="test" → exercise_ids
 * - data-type="expand" → expandRefs（回查 MySQL）
 * - 普通 <p> → 正文段落，bubble 提取为 bubble_notes
 *
 * headingStack 初始为空，chapterTitle 仅在无任何标题时作为兜底。
 *
 * @param html - 章节原始 HTML
 * @param chapterTitle - 章节标题，无 HTML 标题时作为路径兜底
 * @returns 清洗结果：结构化内容段 + 需要回查的 expand 引用
 */
export function cleanHtml(html: string, chapterTitle: string): CleanResult {
  const $ = cheerio.load(html);

  const sections: CleanedSection[] = [];
  const expandRefs: ExpandRef[] = [];

  // headingStack 初始为空；chapterTitle 仅在路径为空时兜底
  const headingStack: string[] = [];
  let bodySection: CleanedSection | null = null;

  /**
   * 读取当前标题路径
   * @returns 当前节点所属的标题路径；尚未出现标题时回退到章节标题
   */
  function currentPath(): string {
    return headingStack.length > 0 ? headingStack.join(' > ') : chapterTitle;
  }

  /**
   * 获取当前正文 section
   * @returns 当前可写入正文、媒体和试题引用的 section
   */
  function getBody(): CleanedSection {
    if (!bodySection) {
      // 正文 section 采用惰性创建，这样纯标题章节不会生成空 section 污染后续分块结果。
      bodySection = {
        contentType: ContentType.BODY,
        headingPath: currentPath(),
        paragraphs: [],
        bubbleNotes: {},
        mediaRefs: [],
        exerciseIds: [],
      };
      sections.push(bodySection);
    }
    return bodySection;
  }

  // 遍历 body 下所有顶层节点（cheerio.load 会包裹 html/head/body）
  $('body')
    .children()
    .each((_, el) => {
      const node = $(el);
      const dataType = (node.attr('data-type') ?? '').toLowerCase();

      // ── 标题节点 ──
      if (dataType in HEADING_DEPTH) {
        const depth = HEADING_DEPTH[dataType];
        // splice(depth-1) 保留比当前标题更高层级的部分，再 push 当前标题
        // 例：连续两个 h3(depth=3) → splice(2) 截断到 [h1?, h2?]，再 push 新 h3
        headingStack.splice(depth - 1);
        headingStack.push(clean(node.text()));
        bodySection = null;
        return;
      }

      // ── 模板框 data-type="p" ──
      if (dataType === 'p') {
        const dataTitle = node.attr('data-title') ?? '';
        const contentType = TEMPLATE_TYPE[dataTitle] ?? ContentType.BODY;
        const text = clean(node.text());
        if (text) {
          sections.push({
            contentType,
            headingPath: currentPath(),
            paragraphs: [text],
            bubbleNotes: {},
            mediaRefs: [],
            exerciseIds: [],
          });
        }
        return;
      }

      // ── 图片 / 视频 ──
      if (dataType === 'image' || dataType === 'video') {
        const ref: MediaRef = {
          type: dataType === 'image' ? MediaType.IMAGE : MediaType.VIDEO,
          // image: 取子节点 <img> 的 src；video: 取节点自身的 data-src
          src:
            dataType === 'image'
              ? (node.find('img').attr('src') ?? '')
              : (node.attr('data-src') ?? ''),
          title: node.attr('data-title') ?? '',
        };
        getBody().mediaRefs.push(ref);
        return;
      }

      // ── 练习题 ──
      if (dataType === 'test') {
        const list = node.attr('data-list') ?? '';
        const ids = list
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n));
        getBody().exerciseIds.push(...ids);
        return;
      }

      // ── 扩展阅读（回查 MySQL） ──
      if (dataType === 'expand') {
        const id = node.attr('id') ?? '';
        if (id) expandRefs.push({ id, headingPath: currentPath() });
        return;
      }

      // ── 普通 <p> 段落 ──
      if (el.tagName === 'p') {
        // 提取 bubble 标注
        node.find('a.bubble').each((_, a) => {
          const keyword = clean($(a).text());
          const note = clean($(a).attr('data-text') ?? '');
          if (keyword && note) getBody().bubbleNotes[keyword] = note;
        });
        const text = clean(node.text());
        if (text) getBody().paragraphs.push(text);
      }
    });

  return {
    sections: sections.filter((s) => s.paragraphs.length > 0),
    expandRefs,
  };
}

/**
 * 将 resource 表中的 HTML 富文本清洗为纯文本段落列表
 *
 * resource 字段是普通富文本（无 data-type 结构），直接提取 <p> 段落文本。
 *
 * @param html - resource 字段的 HTML 内容
 * @returns 纯文本段落列表
 */
export function cleanResourceHtml(html: string): string[] {
  const $ = cheerio.load(html);
  const paragraphs: string[] = [];
  $('p').each((_, el) => {
    const text = clean($(el).text());
    if (text) paragraphs.push(text);
  });
  return paragraphs;
}
