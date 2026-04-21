import { chat } from '@/providers/llm.provider';

const SYSTEM_PROMPT = `你是一个知识点提取助手。从给定的课程文本中提取 3-8 个核心知识点标签。
要求：
- 标签为名词短语，2-8 个字
- 只输出 JSON 数组，不要其他内容
- 示例：["光合作用", "叶绿体", "光反应"]`;

/**
 * 调用 LLM 为单个 chunk 提取知识点标签
 * @param content - chunk 纯文本内容
 * @param signal - 可选的中止信号，客户端断连时自动取消请求
 * @returns 知识点标签数组
 */
export async function extractTags(content: string, signal?: AbortSignal): Promise<string[]> {
  const raw = await chat(SYSTEM_PROMPT, content, { signal });
  try {
    const tags = JSON.parse(raw.trim());
    if (Array.isArray(tags)) return tags.filter((t) => typeof t === 'string');
    console.warn('[tag-extractor] LLM 返回非数组:', raw.slice(0, 100));
  } catch {
    console.warn('[tag-extractor] JSON 解析失败，原始输出:', raw.slice(0, 100));
  }
  return [];
}
