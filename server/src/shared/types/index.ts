/**
 * 全局共享类型定义
 *
 * 包含跨模块使用的枚举、类型等
 */

/**
 * 内容类型枚举
 *
 * 对应 Milvus Schema 中的 content_type 字段，
 * 标识 chunk 的内容来源类型
 */
export enum ContentType {
  /** 课程/章节简介 */
  INTRO = 'intro',
  /** 正文内容 */
  BODY = 'body',
  /** 课程导入案例（data-title="课程导入"） */
  INTRO_CASE = 'intro_case',
  /** 案例分享（data-title="案例分享"） */
  CASE_STUDY = 'case_study',
  /** 拓展阅读（data-title="拓展阅读"） */
  EXTENDED_READING = 'extended_reading',
}

/** 多媒体资源类型 */
export enum MediaType {
  /** 图片资源 */
  IMAGE = 'image',
  /** 视频资源 */
  VIDEO = 'video',
}

/** 多媒体资源引用 */
export interface MediaRef {
  /** 资源类型 */
  type: MediaType;
  /** 资源地址 */
  src: string;
  /** 资源标题/描述 */
  title: string;
}

/** 气泡标注映射（关键词 → 标注说明） */
export type BubbleNotes = Record<string, string>;
