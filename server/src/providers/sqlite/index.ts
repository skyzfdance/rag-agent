export { getDb, closeDb } from './client';
export { insertChatMessage } from './chat.repository';
export {
  insertChunks,
  rollbackChunksByVersion,
  rollbackChunksByIds,
  deleteChunks,
  listChunks,
  getChunkById,
  updateChunkMeta,
  deleteChunkById,
} from './chunk.repository';
export type { ChunkRow, ChunkListResult } from './chunk.repository';
export { listSessions, updateSessionTitle, deleteSession } from './session.repository';
export type { SessionListResult } from './session.repository';
export { getSessionMessages } from './message.repository';
export type { StoredSessionMessage, MessageListResult } from './message.repository';
