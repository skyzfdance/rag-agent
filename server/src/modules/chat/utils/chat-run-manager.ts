import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 活跃聊天运行状态 */
interface ActiveChatRun {
  /** 唯一运行 ID */
  runId: string;
  /** 中止控制器 */
  controller: AbortController;
  /** 运行完成的 Promise（abortActiveChat 等待用） */
  completion: Promise<void>;
  /** 触发完成 Promise 的 resolve */
  resolveCompletion: () => void;
}

/** 中止聊天的返回结果 */
interface AbortActiveChatResult {
  /** 是否成功发出中止信号 */
  aborted: boolean;
  /** 等待期间运行是否已完成 */
  completed: boolean;
}

/** 按 sessionId 追踪活跃运行 */
const activeChatRuns = new Map<string, ActiveChatRun>();

/** 运行被新请求抢占时抛出 */
export class ChatRunSupersededError extends Error {
  constructor() {
    super('当前运行已被新请求抢占');
    this.name = 'ChatRunSupersededError';
  }
}

/** 用户主动中止时抛出 */
export class ChatRunAbortedError extends Error {
  constructor() {
    super('用户中止了当前运行');
    this.name = 'AbortError';
  }
}

// ---------------------------------------------------------------------------
// 活跃运行管理
// ---------------------------------------------------------------------------

/**
 * 创建并注册一个新的活跃聊天运行
 *
 * 如果同一 session 已有活跃运行，先中止它。
 * 保证单 session 同时只有一个运行。
 *
 * @param sessionId - 会话 ID
 * @returns 新的 ActiveChatRun
 */
export function createActiveChatRun(sessionId: string): ActiveChatRun {
  const existing = activeChatRuns.get(sessionId);
  if (existing) {
    existing.controller.abort();
  }

  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });

  const run: ActiveChatRun = {
    runId: randomUUID(),
    controller: new AbortController(),
    completion,
    resolveCompletion,
  };

  activeChatRuns.set(sessionId, run);
  return run;
}

/**
 * 清理活跃运行并触发完成信号
 *
 * @param sessionId - 会话 ID
 * @param run - 要清理的运行
 */
export function finishActiveChatRun(sessionId: string, run: ActiveChatRun): void {
  if (activeChatRuns.get(sessionId)?.runId === run.runId) {
    activeChatRuns.delete(sessionId);
  }
  run.resolveCompletion();
}

/** 检查运行是否仍为当前活跃运行 */
export function isCurrentRun(sessionId: string, run: ActiveChatRun): boolean {
  return activeChatRuns.get(sessionId)?.runId === run.runId;
}

/** 断言运行仍为当前活跃运行，否则抛异常 */
export function assertCurrentRun(sessionId: string, run: ActiveChatRun): void {
  if (!isCurrentRun(sessionId, run)) {
    throw new ChatRunSupersededError();
  }
  if (run.controller.signal.aborted) {
    throw new ChatRunAbortedError();
  }
}

/** 判断错误是否为中止类错误 */
export function isAbortLikeError(error: unknown, signal?: AbortSignal): boolean {
  if (error instanceof ChatRunSupersededError) return true;
  if (signal?.aborted) return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  return false;
}

/**
 * 外部接口：中止指定 session 的活跃聊天
 *
 * 发出中止信号后最多等待 5 秒完成收口。
 *
 * @param sessionId - 会话 ID
 * @returns 中止结果
 */
export async function abortActiveChat(sessionId: string): Promise<AbortActiveChatResult> {
  const run = activeChatRuns.get(sessionId);
  if (!run) {
    return { aborted: false, completed: false };
  }

  run.controller.abort();

  const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5000));
  const raceResult = await Promise.race([run.completion.then(() => 'done' as const), timeout]);

  return {
    aborted: true,
    completed: raceResult !== 'timeout',
  };
}
