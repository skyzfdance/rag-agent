import { getRetrievalConfig } from '@/config/retrieval';
import type {
  RetrievedChunk,
  RetrievedExercise,
  RetrievedExercisePreview,
  RetrievedWebResult,
  RetrievedSource,
} from '../../retrieval.types';
import type { RetrievalState, RetrievalStateUpdate, ExerciseExposure } from '../retrieval-state';

/** 题目类型中文映射 */
const EXERCISE_TYPE_LABELS: Record<string, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  answer: '问答题',
  fill: '填空题',
};

/**
 * synthesize_context 节点
 *
 * Retrieval Graph 的最终收口节点。
 * 将聚合后的检索结果格式化为 RetrievalResult：
 * - llmContext: 给 LLM 的格式化上下文文本（受 maxChars 预算约束）
 * - frontendPayload: 给前端的结构化数据（mediaRefs、sources、exercisePreview）
 * - errors: 检索过程中累积的错误记录
 *
 * 试题上下文策略：
 * - 用户意图需要试题（needsExerciseSearch）时才将试题写入 llmContext
 * - 前端 exercisePreview 始终输出（不含答案与解析）
 *
 * 联网搜索结果：
 * - web 兜底结果在 llmContext 末尾追加
 * - web 来源信息写入 sources
 *
 * @param state - Retrieval Graph 当前状态
 * @returns 状态更新：result 字段
 */
export function synthesizeContext(state: RetrievalState): RetrievalStateUpdate {
  const { aggregated, errors, intent, web } = state;
  const filteredHits = aggregated?.filteredHits ?? [];
  const filteredExercises = aggregated?.filteredExercises ?? [];
  const webHits = web?.hits ?? [];
  const hasErrors = errors.length > 0;

  // 构建 llmContext
  const exerciseExposure = intent?.exerciseExposure ?? 'find';
  const llmContext = buildLlmContext(
    filteredHits,
    filteredExercises,
    webHits,
    intent?.needsExerciseSearch ?? false,
    exerciseExposure,
    hasErrors
  );

  // 构建 exercisePreview（始终输出，不含答案与解析）
  const exercisePreview = filteredExercises.map(toExercisePreview);

  // 合并 sources：chunk 来源 + web 来源
  const sources = [...(aggregated?.sources ?? []), ...collectWebSources(webHits)];

  return {
    result: {
      llmContext,
      frontendPayload: {
        mediaRefs: aggregated?.mediaRefs ?? [],
        sources,
        exercisePreview,
      },
      errors,
    },
  };
}

/**
 * 构建完整的 LLM 上下文文本
 *
 * 拼接顺序：课程/文档 chunk → 试题（仅在意图需要时） → 联网搜索结果
 * 受 maxChars 预算约束，超出时截断后续片段。
 *
 * @param hits - 经裁剪后的候选 chunk 列表
 * @param exercises - 经裁剪后的试题列表
 * @param webHits - 联网搜索结果
 * @param includeExercises - 是否将试题写入上下文
 * @param exerciseExposure - 试题暴露策略：'find' 只给题干选项，'explain' 给完整答案解析
 * @param hasErrors - 检索过程中是否有错误
 * @returns 格式化后的 LLM 上下文文本
 */
function buildLlmContext(
  hits: RetrievedChunk[],
  exercises: RetrievedExercise[],
  webHits: RetrievedWebResult[],
  includeExercises: boolean,
  exerciseExposure: ExerciseExposure,
  hasErrors: boolean
): string {
  const totalResults = hits.length + (includeExercises ? exercises.length : 0) + webHits.length;

  if (totalResults === 0) {
    return hasErrors ? '检索服务异常，无法获取知识库内容。' : '未找到相关知识库内容。';
  }

  const { retrievalBudget } = getRetrievalConfig();
  const fragments: string[] = [];
  let totalLength = 0;

  // ① 课程/文档 chunk
  for (let i = 0; i < hits.length; i++) {
    const text = formatChunkFragment(hits[i], i);

    // 首个片段始终保留，不受预算截断
    if (i > 0 && totalLength + text.length > retrievalBudget.maxChars) {
      break;
    }

    fragments.push(text);
    totalLength += text.length;
  }

  // ② 试题（仅在意图需要时加入 llmContext）
  if (includeExercises && exercises.length > 0) {
    for (let i = 0; i < exercises.length; i++) {
      const text = formatExerciseFragment(exercises[i], i, exerciseExposure);

      if (fragments.length > 0 && totalLength + text.length > retrievalBudget.maxChars) {
        break;
      }

      fragments.push(text);
      totalLength += text.length;
    }
  }

  // ③ 联网搜索兜底结果
  if (webHits.length > 0) {
    const { toolSearch } = getRetrievalConfig();

    for (let i = 0; i < webHits.length; i++) {
      const text = formatWebFragment(webHits[i], i, toolSearch.webSearchMaxChars);

      if (fragments.length > 0 && totalLength + text.length > retrievalBudget.maxChars) {
        break;
      }

      fragments.push(text);
      totalLength += text.length;
    }
  }

  return fragments.join('\n\n');
}

/**
 * 格式化单个 chunk 片段
 *
 * @param hit - 候选 chunk
 * @param index - 片段序号（从 0 开始）
 * @returns 格式化后的文本
 */
function formatChunkFragment(hit: RetrievedChunk, index: number): string {
  const sourceLabel = hit.sourceType === 'document' ? '文档片段' : '课程片段';
  const title = hit.headingPath || hit.title || '未知标题';
  let text = `[${sourceLabel} ${index + 1}]\n标题：${title}\n内容：${hit.content}`;

  if (hit.mediaRefs.length > 0) {
    const mediaList = hit.mediaRefs
      .map((ref) => `${ref.type === 'image' ? '图片' : '视频'}《${ref.title}》`)
      .join('、');
    text += `\n附件：${mediaList}`;
  }

  return text;
}

/**
 * 格式化单个试题片段
 *
 * 根据 exerciseExposure 策略控制暴露程度：
 * - 'find': 只给题干和选项，避免模型剧透答案
 * - 'explain': 给完整答案与解析，供模型讲解
 *
 * @param exercise - 试题数据
 * @param index - 序号（从 0 开始）
 * @param exposure - 暴露策略
 * @returns 格式化后的文本
 */
function formatExerciseFragment(
  exercise: RetrievedExercise,
  index: number,
  exposure: ExerciseExposure
): string {
  const typeLabel = EXERCISE_TYPE_LABELS[exercise.type] ?? exercise.type;
  let text = `[试题 ${index + 1}]\n题型：${typeLabel}\n题目：${exercise.stem}`;

  if (exercise.options && exercise.options.length > 0) {
    text += `\n选项：${exercise.options.join(' | ')}`;
  }

  // 仅在 'explain' 策略下暴露答案与解析
  if (exposure === 'explain') {
    text += `\n答案：${exercise.answer}`;
    if (exercise.explanation) {
      text += `\n解析：${exercise.explanation}`;
    }
  }

  return text;
}

/**
 * 格式化单个联网搜索片段
 *
 * @param hit - 联网搜索结果
 * @param index - 序号（从 0 开始）
 * @param maxChars - 单条内容最大字符数
 * @returns 格式化后的文本
 */
function formatWebFragment(hit: RetrievedWebResult, index: number, maxChars: number): string {
  const snippet =
    hit.snippet.length > maxChars ? hit.snippet.slice(0, maxChars) + '...' : hit.snippet;

  return `[网络搜索 ${index + 1}]\n标题：${hit.title}\n来源：${hit.url}\n内容：${snippet}`;
}

/**
 * 将试题转换为前端预览格式
 *
 * 不含答案与解析，避免泄漏。
 *
 * @param exercise - 试题数据
 * @returns 前端预览结构
 */
function toExercisePreview(exercise: RetrievedExercise): RetrievedExercisePreview {
  return {
    id: exercise.id,
    courseId: exercise.courseId,
    chapterId: exercise.chapterId,
    stem: exercise.stem,
    type: exercise.type,
  };
}

/**
 * 从联网搜索结果中提取来源信息
 *
 * @param webHits - 联网搜索结果
 * @returns 来源信息数组
 */
function collectWebSources(webHits: RetrievedWebResult[]): RetrievedSource[] {
  return webHits.map((hit) => ({
    type: 'web' as const,
    label: hit.title,
    url: hit.url,
  }));
}
