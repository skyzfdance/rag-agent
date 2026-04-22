// ──────────────────────────────────────────────
// Session 级互斥锁
// ──────────────────────────────────────────────

/** 每个 session 的队列尾部 Promise，实现串行化 */
const sessionMutexes = new Map<string, Promise<void>>();

/**
 * 对同一 sessionId 的操作串行执行
 *
 * 基于 Promise 链实现：每次调用将新任务追加到当前 session 的队列尾部，
 * 不同 sessionId 互不阻塞。try/finally 保证异常时也释放锁。
 *
 * @param sessionId - 会话 ID
 * @param fn - 需要在互斥区内执行的函数
 * @returns fn 的返回值
 */
export async function withSessionMutex<T>(sessionId: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = sessionMutexes.get(sessionId) ?? Promise.resolve();

  let release: () => void;
  const lock = new Promise<void>((r) => {
    release = r;
  });
  sessionMutexes.set(sessionId, lock);

  await prev;
  try {
    return await fn();
  } finally {
    release!();
    // 队列中没有后续任务时清理，避免 Map 无限增长
    if (sessionMutexes.get(sessionId) === lock) {
      sessionMutexes.delete(sessionId);
    }
  }
}
