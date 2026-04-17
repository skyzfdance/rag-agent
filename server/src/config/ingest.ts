import { requireInt } from '@/shared/utils/env';

/** 入库 Pipeline 配置 */
export interface IngestConfig {
  /** 最大并发 chunk 处理数（即最大同时 API 请求数） */
  concurrency: number;
}

/**
 * 从环境变量读取入库配置
 *
 * INGEST_CONCURRENCY 默认 3，控制 p-limit 同时处理的 chunk 数。
 * 必须为正整数（≥ 1），否则启动阶段直接报错。
 *
 * @returns 入库配置对象
 */
export function getIngestConfig(): IngestConfig {
  const concurrency = requireInt('INGEST_CONCURRENCY', 3);

  if (concurrency < 1) {
    throw new Error(`INGEST_CONCURRENCY 必须 ≥ 1，当前值: ${concurrency}`);
  }

  return { concurrency };
}
