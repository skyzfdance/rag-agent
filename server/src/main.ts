import 'dotenv-flow/config';
import app from '@/app';
import { getServerConfig } from '@/config/index';
import { ensureCollection } from '@/providers/milvus.provider';
import { getDb } from '@/providers/sqlite.provider';

const { port } = getServerConfig();

/**
 * 启动服务：先确保 Milvus Collection 就绪，再监听端口
 */
async function bootstrap(): Promise<void> {
  // Milvus Collection 不存在时自动创建 schema + 索引
  await ensureCollection();

  // 初始化 SQLite：创建数据库文件和表结构
  getDb();

  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`\n🚀 服务已启动: http://localhost:${port}\n`);
  });

  // Node.js 18+ 默认 requestTimeout = 300s（5 分钟），会强制断开长连接。
  // SSE 入库进度推送可能跑超 5 分钟，需要禁用此限制。
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.timeout = 0;
}

bootstrap().catch((err) => {
  console.error('❌ 启动失败:', err);
  process.exit(1);
});
