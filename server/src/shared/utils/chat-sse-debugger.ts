import fs from 'fs';
import path from 'path';

/** SSE 调试日志目录：项目根目录/log/chat-sse */
const LOG_DIR = path.resolve(process.cwd(), 'log', 'chat-sse');

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
 * 创建一次 chat 请求对应的 SSE 调试日志写入器
 *
 * 仅在开发环境启用，避免生产环境持续落盘原始流内容。
 *
 * @param options - 调试上下文
 * @returns 调试日志控制器
 */
export function createChatSseDebugWriter(options: { sessionId: string; message: string }): {
  filePath: string | null;
  appendMarker: (marker: string, extra?: Record<string, unknown>) => void;
  consumeSseStream: (payload: { stream: ReadableStream<string> }) => void;
} {
  if (process.env.NODE_ENV !== 'development') {
    return {
      filePath: null,
      /** 开发日志关闭时返回空实现，避免调用方额外分支判断。 */
      appendMarker() {},
      /** 开发日志关闭时返回空实现，避免影响正常聊天流程。 */
      consumeSseStream() {},
    };
  }

  ensureDir();

  const fileName = `${formatFileTimestamp(new Date())}__${sanitizeFileSegment(options.sessionId)}.sse.log`;
  const filePath = path.join(LOG_DIR, fileName);
  const output = fs.createWriteStream(filePath, {
    flags: 'a',
    encoding: 'utf8',
  });

  let isClosed = false;

  /**
   * 追加一行原始调试文本
   * @param text - 需要写入文件的文本
   * @returns 无返回值
   */
  function writeLine(text: string): void {
    if (isClosed) return;
    output.write(text);
  }

  /**
   * 关闭底层文件写入流
   * @returns 无返回值
   */
  function close(): void {
    if (isClosed) return;
    isClosed = true;
    output.end();
  }

  writeLine(
    [
      '# chat sse debug log',
      `timestamp: ${new Date().toISOString()}`,
      `sessionId: ${options.sessionId}`,
      `message: ${options.message}`,
      '',
    ].join('\n')
  );

  return {
    filePath,
    /**
     * 追加一条结构化调试标记
     * @param marker - 标记名称
     * @param extra - 附加调试字段
     * @returns 无返回值
     */
    appendMarker(marker, extra = {}) {
      writeLine(
        `${JSON.stringify({
          type: 'debug-marker',
          timestamp: new Date().toISOString(),
          marker,
          ...extra,
        })}\n`
      );

      if (marker === 'stream_closed') {
        close();
      }
    },
    /**
     * 消费 SSE 文本流并完整写入调试文件
     * @param payload - 只包含 stream 的包装对象
     * @returns 无返回值
     */
    consumeSseStream({ stream }) {
      void (async () => {
        const reader = stream.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              break;
            }

            writeLine(value);
          }

          writeLine('\n');
          close();
        } catch (error) {
          writeLine(
            `${JSON.stringify({
              type: 'debug-marker',
              timestamp: new Date().toISOString(),
              marker: 'consume_error',
              error: error instanceof Error ? error.message : String(error),
            })}\n`
          );
          close();
        } finally {
          reader.releaseLock();
        }
      })();
    },
  };
}

/**
 * 格式化日志文件时间戳
 * @param date - 当前时间
 * @returns 适合文件名的时间字符串
 */
function formatFileTimestamp(date: Date): string {
  return date.toISOString().replaceAll(':', '-');
}

/**
 * 清洗文件名片段
 * @param value - 原始值
 * @returns 安全文件名片段
 */
function sanitizeFileSegment(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_-]/g, '_');
}
