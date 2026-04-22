import type { MediaRef } from '@/shared/types/index';

/** 聊天消息 */
export interface ChatMessage {
  /** 消息自增 ID */
  id: number;
  /** 消息角色 */
  role: 'user' | 'assistant' | 'system';
  /** 消息内容 */
  content: string;
  /** 创建时间（unix 秒） */
  createdAt: number;
}

/** 会话记忆（加载后的结构） */
export interface SessionMemory {
  /** 压缩摘要，无摘要时为 null */
  summary: string | null;
  /** 最近 N 轮对话原文（正序） */
  recentMessages: ChatMessage[];
}

/** Token 使用情况 */
export interface TokenUsage {
  /** 当前会话可用 token 上限 */
  sessionAvailableTokens: number;
  /** 当前会话已用 token（上一轮 API 返回的 prompt_tokens） */
  sessionUsedTokens: number;
}

/** assistant 终态状态 */
export type AssistantStatus = 'completed' | 'truncated' | 'aborted' | 'error' | 'no_reply';

/** 结构化持久化 schema 版本 */
export const STRUCTURED_MESSAGE_SCHEMA_VERSION = 1;

// ──────────────────────────────────────────────
// 检索领域模型
// ──────────────────────────────────────────────

/**
 * 统一检索命中 chunk
 *
 * 屏蔽底层 Collection 差异，课程 chunk 和文档 chunk 共用同一结构。
 */
export interface RetrievedChunk {
  /** 数据来源类型 */
  sourceType: 'course' | 'document';
  /** chunk 主键（Milvus 中的 id） */
  sourceId: string;
  /** 向量相似度分数 */
  score: number;

  /** 课程 ID */
  courseId?: number;
  /** 章节 ID */
  chapterId?: number;

  /** 章节标题 */
  title?: string;
  /** 标题路径，如 "第二章 > 第一节 > 一、概述" */
  headingPath?: string;
  /** 纯文本内容 */
  content: string;

  /** 多媒体资源引用 */
  mediaRefs: MediaRef[];

  /** 文档元数据（阶段四启用） */
  documentMeta?: {
    /** 文档 ID */
    documentId?: string;
    /** 文件名 */
    fileName?: string;
    /** 页码 */
    page?: number;
    /** 段落标题 */
    sectionTitle?: string;
  };
}

/**
 * 检索来源信息
 *
 * 用于前端展示"回答来自哪里"。
 */
export interface RetrievedSource {
  /** 来源类型 */
  type: 'course' | 'document' | 'exercise' | 'web';
  /** 展示标签（如标题路径、文件名等） */
  label: string;
  /** 课程 ID */
  courseId?: number;
  /** 章节 ID */
  chapterId?: number;
  /** 文档来源元数据（仅 type='document' 时填充） */
  documentMeta?: {
    /** 文档 ID */
    documentId?: string;
    /** 原始文件名 */
    fileName?: string;
    /** 页码 */
    page?: number;
    /** 段落标题 */
    sectionTitle?: string;
  };
  /** 网页 URL（仅 type='web' 时填充） */
  url?: string;
}

/** 允许持久化的 assistant part */
export type PersistedAssistantPart =
  | {
      /** part 类型，表示普通正文文本 */
      type: 'text';
      /** 正文内容 */
      text: string;
    }
  | {
      /** part 类型，表示 reasoning 文本 */
      type: 'reasoning';
      /** 思考内容 */
      text: string;
    }
  | {
      /** part 类型，表示媒体引用集合 */
      type: 'data-media-refs';
      /** 媒体引用数据 */
      data: MediaRef[];
    }
  | {
      /** part 类型，表示来源引用集合 */
      type: 'data-sources';
      /** 来源引用数据 */
      data: RetrievedSource[];
    }
  | {
      /** part 类型，表示题目预览集合 */
      type: 'data-exercise-preview';
      /** 题目预览数据 */
      data: RetrievedExercisePreview[];
    };

/** assistant 历史回放元数据 */
export interface StoredMessageMetadata {
  /** 结构版本 */
  schemaVersion: number;
  /** 本轮思考/处理总耗时 */
  thinkingDurationMs?: number;
  /** assistant 终态 */
  assistantStatus?: AssistantStatus;
  /** 是否为未正常完成的异常轮次 */
  isIncomplete?: boolean;
  /** 轮次 ID */
  turnId?: string;
  /** 是否允许进入后续模型记忆 */
  memoryEligible?: boolean;
}

// ──────────────────────────────────────────────
// 试题领域模型
// ──────────────────────────────────────────────

/** 试题题目类型 */
export type ExerciseType = 'single' | 'multiple' | 'judge' | 'answer' | 'fill';

/**
 * 检索命中的试题
 */
export interface RetrievedExercise {
  /** 试题 ID */
  id: number;
  /** 课程 ID（来自 chapter_resource 关联） */
  courseId: number;
  /** 章节 ID（来自 chapter_resource 关联） */
  chapterId: number;
  /** 题目类型 */
  type: ExerciseType;
  /** 题干 */
  stem: string;
  /** 选项列表（选择题/判断题有值） */
  options?: string[];
  /** 正确答案 */
  answer: string;
  /** 答案解析 */
  explanation?: string;
}

/**
 * 试题前端预览
 *
 * 给前端的轻量结构，不包含答案与解析，避免泄漏。
 */
export interface RetrievedExercisePreview {
  /** 试题 ID */
  id: number;
  /** 课程 ID */
  courseId: number;
  /** 章节 ID */
  chapterId: number;
  /** 题干 */
  stem: string;
  /** 题目类型 */
  type: ExerciseType;
}

// ──────────────────────────────────────────────
// 联网搜索结果
// ──────────────────────────────────────────────

/**
 * 联网搜索命中结果
 *
 * 来自 Tavily API，用于知识库检索不足时的兜底。
 */
export interface RetrievedWebResult {
  /** 页面标题 */
  title: string;
  /** 页面 URL */
  url: string;
  /** 摘要片段 */
  snippet: string;
  /** 相关度评分 */
  score: number;
}

/**
 * Retrieval 最终结果
 *
 * 对外暴露的收口结构，主 Agent 只依赖此对象。
 */
export interface RetrievalResult {
  /** 给 LLM 的格式化上下文文本 */
  llmContext: string;
  /** 给前端的结构化数据 */
  frontendPayload: {
    /** 多媒体资源引用 */
    mediaRefs: MediaRef[];
    /** 来源信息 */
    sources: RetrievedSource[];
    /** 试题预览（不含答案与解析） */
    exercisePreview: RetrievedExercisePreview[];
  };
  /** 检索过程中的错误记录，无错误时为空数组 */
  errors: Array<{
    /** 出错的节点名称 */
    node: string;
    /** 数据来源类型 */
    sourceType?: string;
    /** 错误信息 */
    message: string;
  }>;
}
