import { getRetrievalConfig } from '@/config/retrieval';
import { chat } from '@/providers/llm.provider';
import { appendAgentLog } from '@/shared/utils/agent-logger';
import { withSessionMutex } from './utils/session-mutex';
import type {
  AssistantStatus,
  PersistedAssistantPart,
  SessionMemory,
  StoredMessageMetadata,
  TokenUsage,
} from '@/modules/retrieval/retrieval.types';
import { STRUCTURED_MESSAGE_SCHEMA_VERSION } from '@/modules/retrieval/retrieval.types';
import { COMPACT_SYSTEM_PROMPT } from './prompts/compact-memory.prompt';
import {
  countUncompactedMessages,
  ensureSession,
  loadAllMessagesForCompact,
  loadCompactStatus,
  loadLastPromptTokens,
  loadMemory,
  loadSummaryForCompact,
  saveAssistantMessageUnsafe as saveAssistantMessageRecordUnsafe,
  saveUserMessageUnsafe as saveUserMessageRecordUnsafe,
  updateCompactedSummary,
  updatePromptTokens as updatePromptTokensRecord,
} from './memory.repository';
import type { MessageRow } from './memory.repository';

/**
 * 检查是否需要压缩
 *
 * 两个条件满足其一即需要压缩：
 * 1. 消息数溢出：水位线后的未压缩消息数 > keepCount，防止语义断档
 * 2. Token 高水位：last_prompt_tokens / effectiveMaxInput >= hardPercent%，防止上下文溢出
 *
 * @param sessionId - 会话 ID
 * @returns 是否需要压缩
 */
function shouldCompact(sessionId: string): boolean {
  const { memoryRecentRounds, model, answerMaxOutputTokens, threshold } = getRetrievalConfig();
  const keepCount = memoryRecentRounds * 2;

  const session = loadCompactStatus(sessionId);

  const compactedId = session?.last_compacted_message_id ?? 0;

  // 条件 1：消息数溢出
  if (countUncompactedMessages(sessionId, compactedId) > keepCount) return true;

  // 条件 2：Token 高水位
  const lastPromptTokens = session?.last_prompt_tokens ?? 0;
  if (lastPromptTokens > 0) {
    const effectiveMaxInput = Math.min(
      model.maxInputTokens,
      model.contextWindowTokens - answerMaxOutputTokens
    );
    const usagePercent = (lastPromptTokens / effectiveMaxInput) * 100;
    if (usagePercent >= threshold.hardPercent) return true;
  }

  return false;
}

/**
 * 将消息列表格式化为可读的对话文本
 *
 * @param messages - 消息列表
 * @returns 格式化后的对话文本
 */
function formatMessagesForSummary(messages: MessageRow[]): string {
  return messages.map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`).join('\n\n');
}

/**
 * 压缩会话记忆（Unsafe：只能在 mutex 内调用）
 *
 * 将水位线之后、最近 N 轮之前的消息与已有摘要合并，
 * 调用 LLM 生成新摘要，更新水位线。
 *
 * @param sessionId - 会话 ID
 */
async function compactMemoryUnsafe(sessionId: string): Promise<void> {
  const { memoryRecentRounds } = getRetrievalConfig();

  // ① 读取当前会话的摘要和水位线
  const session = loadSummaryForCompact(sessionId);

  const compactedId = session?.last_compacted_message_id ?? 0;
  const existingSummary = session?.summary ?? null;

  // ② 加载水位线之后的所有消息（正序）
  const allMessages = loadAllMessagesForCompact(sessionId, compactedId);

  // 保留最近 N 轮（2N 条消息），其余进入压缩
  const keepCount = memoryRecentRounds * 2;

  if (allMessages.length <= keepCount) {
    // 消息全在"最近 N 轮"范围内，没有可压缩的内容
    appendAgentLog({
      event: 'compact_skip',
      sessionId,
      reason: 'not_enough_messages',
      totalMessages: allMessages.length,
      keepCount,
    });
    return;
  }

  // 要压缩的消息（较早的部分）
  const messagesToCompress = allMessages.slice(0, allMessages.length - keepCount);
  // 新水位线 = 被压缩的最后一条消息 ID
  const newWatermark = messagesToCompress[messagesToCompress.length - 1].id;

  appendAgentLog({
    event: 'compact_start',
    sessionId,
    messagesToCompress: messagesToCompress.length,
    keepMessages: keepCount,
    newWatermark,
    hasExistingSummary: !!existingSummary,
  });

  // ③ 构建用户消息，调 LLM 生成新摘要
  const conversationText = formatMessagesForSummary(messagesToCompress);

  const userMessage = existingSummary
    ? `以下是之前对话的摘要：\n${existingSummary}\n\n以下是新的对话内容，请将其与已有摘要合并，生成一份更新后的完整摘要：\n${conversationText}`
    : `请为以下对话内容生成摘要：\n${conversationText}`;

  const newSummary = await chat(COMPACT_SYSTEM_PROMPT, userMessage);

  // ④ 更新数据库
  updateCompactedSummary(sessionId, newSummary, newWatermark);

  appendAgentLog({
    event: 'compact_end',
    sessionId,
    compressedMessages: messagesToCompress.length,
    newWatermark,
    summaryLength: newSummary.length,
  });
}

// ──────────────────────────────────────────────
// 公开 API（外部入口）
// ──────────────────────────────────────────────

/**
 * 请求开始前准备会话记忆
 *
 * 在 session mutex 内依次执行：
 * 1. 确保会话记录存在
 * 2. 检查未压缩消息数，必要时先压缩
 * 3. 加载 summary + 最近 N 轮消息
 *
 * 保证"判断 → 压缩 → 读取"之间不会被同 session 的其他写入穿插。
 *
 * @param sessionId - 会话 ID
 * @returns 会话记忆
 */
export async function prepareMemoryForRequest(sessionId: string): Promise<SessionMemory> {
  return withSessionMutex(sessionId, async () => {
    const { memoryRecentRounds } = getRetrievalConfig();
    ensureSession(sessionId);
    if (shouldCompact(sessionId)) {
      await compactMemoryUnsafe(sessionId);
    }
    return loadMemory(sessionId, memoryRecentRounds);
  });
}

/**
 * 保存用户消息和 AI 回复（Unsafe：必须在 withSessionMutex 内调用）
 *
 * Agent 中间的 tool 调用不存，只存最终的 user + assistant 消息。
 * 使用事务保证两条消息原子写入，避免只写入一半导致记忆脏数据。
 *
 * @param sessionId - 会话 ID
 * @param userContent - 用户消息内容
 * @param assistantContent - AI 回复内容
 */
export function saveUserMessageUnsafe(
  sessionId: string,
  turnId: string,
  userContent: string
): boolean {
  return saveUserMessageRecordUnsafe(sessionId, turnId, userContent);
}

/** assistant 终态落库入参 */
export interface SaveAssistantMessageInput {
  /** 会话 ID */
  sessionId: string;
  /** 轮次 ID */
  turnId: string;
  /** 助手正文 */
  content: string;
  /** 最终归档 parts */
  parts: PersistedAssistantPart[];
  /** assistant 终态 */
  status: AssistantStatus;
  /** 思考/处理总耗时 */
  thinkingDurationMs: number;
}

/**
 * 保存 assistant 终态快照（Unsafe：必须在 withSessionMutex 内调用）
 *
 * user 已在请求开始后单独入库，这里只负责 assistant 终态快照，
 * 并按轮次统一更新 memory_eligible，保证失败轮次整体不进入记忆链路。
 *
 * @param input - assistant 终态落库入参
 */
export function saveAssistantMessageUnsafe(input: SaveAssistantMessageInput): boolean {
  const { sessionId, turnId, content, parts, status, thinkingDurationMs } = input;
  const memoryEligible = status === 'completed';
  const metadata: StoredMessageMetadata = {
    schemaVersion: STRUCTURED_MESSAGE_SCHEMA_VERSION,
    thinkingDurationMs,
    assistantStatus: status,
    isIncomplete: status !== 'completed',
    turnId,
    memoryEligible,
  };

  return saveAssistantMessageRecordUnsafe({
    sessionId,
    turnId,
    content,
    parts,
    metadata,
    memoryEligible,
  });
}

/**
 * 更新会话的 prompt_tokens
 *
 * 每轮对话结束后，将 API 返回的 usage.prompt_tokens 写入 chat_sessions，
 * 用于下一轮的阈值判断和前端展示。
 *
 * @param sessionId - 会话 ID
 * @param promptTokens - API 返回的 prompt_tokens
 */
export function updatePromptTokens(sessionId: string, promptTokens: number): void {
  updatePromptTokensRecord(sessionId, promptTokens);
}

/**
 * 获取会话的 Token 使用情况
 *
 * sessionUsedTokens 取自上一轮 API 返回的 prompt_tokens（精确值），
 * sessionAvailableTokens 根据模型配置计算。
 *
 * @param sessionId - 会话 ID
 * @returns Token 使用情况
 */
export function getTokenUsage(sessionId: string): TokenUsage {
  const { model, answerMaxOutputTokens } = getRetrievalConfig();

  // 读取上一轮的 prompt_tokens
  const lastPromptTokens = loadLastPromptTokens(sessionId);

  // 计算可用 token 上限：扣除回复预留
  const effectiveMaxInput = Math.min(
    model.maxInputTokens,
    model.contextWindowTokens - answerMaxOutputTokens
  );

  return {
    sessionAvailableTokens: effectiveMaxInput,
    sessionUsedTokens: lastPromptTokens,
  };
}

/**
 * 确保会话记忆已压缩（去重入口）
 *
 * 在 session mutex 内检查是否需要压缩，需要则执行。
 * 前置同步路径和后置异步路径统一走此入口，
 * mutex 保证同 session 不会并发压缩。
 *
 * @param sessionId - 会话 ID
 */
export function ensureCompacted(sessionId: string): Promise<void> {
  return withSessionMutex(sessionId, async () => {
    if (shouldCompact(sessionId)) {
      await compactMemoryUnsafe(sessionId);
    }
  });
}
