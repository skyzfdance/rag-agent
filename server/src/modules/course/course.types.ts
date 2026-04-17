import type { RowDataPacket } from 'mysql2/promise';

/** 课程基本信息 */
export interface Course {
  /** 课程 ID */
  id: number;
  /** 课程标题 */
  title: string;
  /** 课程简介（可能为空） */
  description: string;
}

/** 章节数据 */
export interface Chapter {
  /** 章节 ID */
  id: number;
  /** 上级章节 ID，0 表示顶级章节 */
  pid: number;
  /** 章节标题 */
  title: string;
  /** 章节 HTML 正文（富文本编辑器产出） */
  content: string;
  /** 去除 HTML 标签后的纯文本内容 */
  mate_content: string;
}

/** MySQL 查询行类型：课程 */
export interface CourseRow extends Course, RowDataPacket {}

/** MySQL 查询行类型：章节 */
export interface ChapterRow extends Chapter, RowDataPacket {}

/** 章节扩展资源（fa_textbooks_chapter_resource 表） */
export interface ChapterResource {
  /** 资源 ID */
  id: number;
  /** 课程 ID */
  curriculum_id: number;
  /** 章节 ID */
  chapter_id: number;
  /** 关联标识，对应 HTML 中 expand 节点的 id 属性 */
  attach: string;
  /** 资源正文内容（HTML 富文本） */
  resource: string;
}

/** MySQL 查询行类型：章节资源 */
export interface ChapterResourceRow extends ChapterResource, RowDataPacket {}
