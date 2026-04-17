import { requireInt } from '@/shared/utils/env';

/** 模型能力参数 */
export interface ModelCapability {
  /** 上下文窗口总 token 数 */
  contextWindowTokens: number;
  /** 最大输入 token 数 */
  maxInputTokens: number;
  /** 最大输出 token 数 */
  maxOutputTokens: number;
  /** 每分钟请求数限制 */
  rpm: number;
  /** 每分钟 token 数限制 */
  tpm: number;
  /** 思考模式最大输入 token 数 */
  maxInputTokensThinking: number;
  /** 思考模式最大输出 token 数 */
  maxOutputTokensThinking: number;
  /** 最大思维链 token 数 */
  maxCotTokens: number;
}

/** Token 压缩阈值配置 */
export interface TokenThreshold {
  /** 预警阈值百分比（前端可提示用户） */
  warnPercent: number;
  /** 强制压缩触发百分比 */
  hardPercent: number;
  /** 压缩后回落目标百分比 */
  compactTargetPercent: number;
}

/** Tool 检索配置 */
export interface ToolSearchConfig {
  /** 知识库检索返回条数 */
  knowledgeSearchTopK: number;
  /** 联网搜索最大返回条数 */
  webSearchMaxResults: number;
  /** 联网搜索单条结果最大字符数 */
  webSearchMaxChars: number;
}

/** 检索 Pipeline 配置 */
export interface RetrievalConfig {
  /** 模型能力参数 */
  model: ModelCapability;
  /** 回答最大输出 token 预算 */
  answerMaxOutputTokens: number;
  /** Token 压缩阈值 */
  threshold: TokenThreshold;
  /** Agent 单轮最大循环次数 */
  agentRecursionLimit: number;
  /** 记忆保留的最近对话轮数（1 轮 = user + assistant 各一条） */
  memoryRecentRounds: number;
  /** Tool 检索配置 */
  toolSearch: ToolSearchConfig;
}

/**
 * 从环境变量读取检索 Pipeline 配置
 *
 * 所有字段均有默认值，未配置时使用推荐值。
 *
 * @returns 检索 Pipeline 配置对象
 */
export function getRetrievalConfig(): RetrievalConfig {
  return {
    model: {
      contextWindowTokens: requireInt('MODEL_CONTEXT_WINDOW_TOKENS', 1000000),
      maxInputTokens: requireInt('MODEL_MAX_INPUT_TOKENS', 991000),
      maxOutputTokens: requireInt('MODEL_MAX_OUTPUT_TOKENS', 65536),
      rpm: requireInt('MODEL_RPM', 30000),
      tpm: requireInt('MODEL_TPM', 5000000),
      maxInputTokensThinking: requireInt('MODEL_MAX_INPUT_TOKENS_THINKING', 983000),
      maxOutputTokensThinking: requireInt('MODEL_MAX_OUTPUT_TOKENS_THINKING', 65536),
      maxCotTokens: requireInt('MODEL_MAX_COT_TOKENS', 81920),
    },
    answerMaxOutputTokens: requireInt('ANSWER_MAX_OUTPUT_TOKENS', 8192),
    threshold: {
      warnPercent: requireInt('TOKEN_WARN_THRESHOLD_PERCENT', 70),
      hardPercent: requireInt('TOKEN_HARD_THRESHOLD_PERCENT', 85),
      compactTargetPercent: requireInt('TOKEN_COMPACT_TARGET_PERCENT', 55),
    },
    agentRecursionLimit: requireInt('AGENT_RECURSION_LIMIT', 20),
    memoryRecentRounds: requireInt('MEMORY_RECENT_ROUNDS', 10),
    toolSearch: {
      knowledgeSearchTopK: requireInt('KNOWLEDGE_SEARCH_TOP_K', 5),
      webSearchMaxResults: requireInt('WEB_SEARCH_MAX_RESULTS', 3),
      webSearchMaxChars: requireInt('WEB_SEARCH_MAX_CHARS', 500),
    },
  };
}
