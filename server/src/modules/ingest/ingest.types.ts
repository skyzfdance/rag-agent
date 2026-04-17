import type { ContentType, MediaRef, BubbleNotes } from '@/shared/types/index';

/** 扩展阅读引用（HTML 中的 data-type="expand" 节点） */
export interface ExpandRef {
  /** expand 节点的 id 属性，如 "expand92136441744782217319"，对应 resource 表的 attach 字段 */
  id: string;
  /** 该 expand 出现时的标题路径，用于标记补全后的 section 归属 */
  headingPath: string;
}

/** cleanHtml 的完整返回结果 */
export interface CleanResult {
  /** 结构化内容段列表 */
  sections: CleanedSection[];
  /** 需要回查 MySQL 的扩展阅读引用 */
  expandRefs: ExpandRef[];
}

/** 清洗后的结构化内容段 */
export interface CleanedSection {
  /** 内容类型 */
  contentType: ContentType;
  /** 标题路径，如 "第二章 > 第一节 > 一、概述" */
  headingPath: string;
  /** 纯文本段落列表 */
  paragraphs: string[];
  /** 气泡标注 */
  bubbleNotes: BubbleNotes;
  /** 多媒体资源引用 */
  mediaRefs: MediaRef[];
  /** 练习题 ID 列表（不入向量库，仅作 metadata） */
  exerciseIds: number[];
}

/** 分块后的 chunk */
export interface Chunk {
  /** 内容类型 */
  contentType: ContentType;
  /** 标题路径 */
  headingPath: string;
  /** 纯文本内容 */
  content: string;
  /** 气泡标注 */
  bubbleNotes: BubbleNotes;
  /** 多媒体资源引用 */
  mediaRefs: MediaRef[];
  /** 练习题 ID 列表 */
  exerciseIds: number[];
}

/** SSE 进度事件 */
export interface ProgressEvent {
  /** 事件类型，如 'pipeline:start'、'chunk:tags' 等 */
  type: string;
  /** 事件数据 */
  data: Record<string, unknown>;
}

/** 进度回调函数，服务层每完成一步调用一次 */
export type OnProgress = (event: ProgressEvent) => void;

/** 待写入 Milvus 的记录 */
export interface MilvusRecord {
  /** 主键，格式：{courseId}_{chapterId}_{version}_{chunkIndex} */
  id: string;
  /** 课程 ID */
  course_id: number;
  /** 章节 ID */
  chapter_id: number;
  /** 入库版本号（时间戳） */
  version: string;
  /** 内容类型 */
  content_type: ContentType;
  /** 该章节下的分块序号 */
  chunk_index: number;
  /** 章节标题 */
  title: string;
  /** 标题路径 */
  heading_path: string;
  /** 纯文本内容 */
  content: string;
  /** LLM 提取的知识点标签 */
  tags: string[];
  /** 气泡标注 */
  bubble_notes: BubbleNotes;
  /** 多媒体资源引用 */
  media_refs: MediaRef[];
  /** 向量 */
  embedding: number[];
}
