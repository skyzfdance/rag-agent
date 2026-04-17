import type { CleanedSection, Chunk } from './ingest.types';

const MAX_CHARS = 2000;
const MIN_CHARS = 100;
const OVERLAP_PARAGRAPHS = 2;

/** 统计字符数（中英文均按 1 计） */
function charCount(text: string): number {
  return text.length;
}

/**
 * 将段落列表按字符上限切分，相邻块之间保留 overlap
 * @param paragraphs - 段落列表
 * @returns 切分后的文本块列表
 */
function splitByParagraphs(paragraphs: string[]): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const para of paragraphs) {
    const paraLen = charCount(para);
    if (currentLen + paraLen > MAX_CHARS && current.length > 0) {
      chunks.push(current.join('\n'));
      // overlap：保留最后 N 段带入下一块
      current = current.slice(-OVERLAP_PARAGRAPHS);
      currentLen = current.reduce((s, p) => s + charCount(p), 0);
    }
    current.push(para);
    currentLen += paraLen;
  }

  if (current.length > 0) chunks.push(current.join('\n'));
  return chunks;
}

/**
 * 判断两个 chunk 是否可以合并
 *
 * 只有 headingPath 和 contentType 都相同时才允许合并，
 * 避免跨标题上下文的内容被混在一起导致结构标签失真。
 *
 * @param a - chunk A
 * @param b - chunk B
 * @returns 是否可合并
 */
function canMerge(a: Chunk, b: Chunk): boolean {
  return a.contentType === b.contentType && a.headingPath === b.headingPath;
}

/**
 * 将 source 的内容追加到 target 末尾（原地修改 target）
 * @param target - 被追加的目标 chunk
 * @param source - 要合并进去的 chunk
 */
function mergeAppend(target: Chunk, source: Chunk): void {
  target.content += '\n' + source.content;
  Object.assign(target.bubbleNotes, source.bubbleNotes);
  target.mediaRefs.push(...source.mediaRefs);
  target.exerciseIds.push(...source.exerciseIds);
}

/**
 * 将 source 的内容前插到 target 开头（原地修改 target）
 * @param target - 被前插的目标 chunk
 * @param source - 要合并进去的 chunk
 */
function mergePrepend(target: Chunk, source: Chunk): void {
  target.content = source.content + '\n' + target.content;
  // bubbleNotes: source 的优先级低于 target 已有的
  target.bubbleNotes = { ...source.bubbleNotes, ...target.bubbleNotes };
  target.mediaRefs.unshift(...source.mediaRefs);
  target.exerciseIds.unshift(...source.exerciseIds);
}

/**
 * 将清洗后的内容段列表分块
 *
 * 两阶段处理：
 * 1. 第一遍：按 section 生成原始 chunk（超长的按段落切分）
 * 2. 第二遍：合并短 chunk（< 100 字符），只在同 headingPath + 同 contentType 内合并
 *    - 优先向后合并（合并到前一个 chunk）
 *    - 无法向后时尝试向前合并（合并到后一个 chunk）
 *    - 都不行则保留原样（宁可短也不错标）
 *
 * @param sections - cleanHtml 输出的结构化内容段
 * @returns 分块后的 chunk 列表
 */
export function chunkSections(sections: CleanedSection[]): Chunk[] {
  // ── 第一阶段：生成原始 chunks ──
  const raw: Chunk[] = [];

  for (const section of sections) {
    const fullText = section.paragraphs.join('\n');
    if (!fullText.trim()) continue;

    const base: Omit<Chunk, 'content'> = {
      contentType: section.contentType,
      headingPath: section.headingPath,
      bubbleNotes: section.bubbleNotes,
      mediaRefs: section.mediaRefs,
      exerciseIds: section.exerciseIds,
    };

    if (charCount(fullText) <= MAX_CHARS) {
      raw.push({ ...base, content: fullText });
    } else {
      const parts = splitByParagraphs(section.paragraphs);
      for (const part of parts) {
        raw.push({ ...base, content: part });
      }
    }
  }

  // ── 第二阶段：合并短 chunks ──
  const merged: Chunk[] = [];

  for (let i = 0; i < raw.length; i++) {
    const chunk = raw[i];

    if (charCount(chunk.content) < MIN_CHARS) {
      // 尝试向后合并：追加到已产出的前一个 chunk
      const prev = merged.length > 0 ? merged[merged.length - 1] : null;
      if (prev && canMerge(prev, chunk)) {
        mergeAppend(prev, chunk);
        continue;
      }

      // 尝试向前合并：前插到下一个原始 chunk
      const next = i + 1 < raw.length ? raw[i + 1] : null;
      if (next && canMerge(chunk, next)) {
        mergePrepend(next, chunk);
        continue;
      }

      // 都不行，保留原样（宁可短也不错标）
    }

    merged.push(chunk);
  }

  return merged;
}
