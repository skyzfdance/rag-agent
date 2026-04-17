import fs from 'fs';
import path from 'path';

/** 日志文件路径：项目根目录/log/agent.jsonl */
const LOG_DIR = path.resolve(process.cwd(), 'log');
const LOG_FILE = path.join(LOG_DIR, 'agent.jsonl');

/** 是否已确保日志目录存在 */
let dirEnsured = false;

/**
 * 确保日志目录存在（仅首次写入时创建）
 */
function ensureDir(): void {
  if (dirEnsured) return;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  dirEnsured = true;
}

/**
 * 追加一条 Agent 日志到 log/agent.jsonl
 *
 * 每条日志为一行 JSON（JSONL 格式），方便按行读取和 grep 过滤。
 * 所有字段均为可选，按实际场景传入。
 *
 * @param entry - 日志条目
 */
export function appendAgentLog(entry: Record<string, unknown>): void {
  ensureDir();

  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...entry,
  });

  // 异步追加，不阻塞主流程；写入失败仅打印到 stderr
  fs.appendFile(LOG_FILE, line + '\n', (err) => {
    if (err) {
      console.error('[agent-logger] 日志写入失败:', err);
    }
  });
}
