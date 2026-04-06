const Redis = require('ioredis');
const config = require('../config');

const isTLS = config.redis.url.startsWith('rediss://');

const redis = new Redis(config.redis.url, {
  retryStrategy(times) {
    return Math.min(times * 100, 3000);
  },
  maxRetriesPerRequest: 3,
  ...(isTLS && { tls: {} }),
});

redis.on('error', (err) => console.error('[Redis] Error:', err.message));
redis.on('connect', () => console.log('[Redis] Connected'));

const FILE_TTL = 86400; // 24h safety net

const EXPIRY_SECONDS = { '1h': 3600, '4h': 14400, '24h': 86400 };

async function createFile(fileId, metadata) {
  const key = `file:${fileId}`;
  const expiryMode = metadata.expiryMode || 'presence';
  const expiresAt = EXPIRY_SECONDS[expiryMode]
    ? new Date(Date.now() + EXPIRY_SECONDS[expiryMode] * 1000).toISOString()
    : '';

  await redis.hset(key, {
    fileName: metadata.fileName,
    fileSize: String(metadata.fileSize),
    mimeType: metadata.mimeType,
    storageKey: metadata.storageKey,
    sessionId: metadata.sessionId,
    uploadedAt: new Date().toISOString(),
    status: 'uploading',
    expiryMode,
    expiresAt,
  });
  const ttl = EXPIRY_SECONDS[expiryMode] || FILE_TTL;
  await redis.expire(key, ttl + 300); // small buffer over the actual expiry
}

async function getFile(fileId) {
  const data = await redis.hgetall(`file:${fileId}`);
  if (!data || !data.fileName) return null;
  return { ...data, fileSize: parseInt(data.fileSize, 10) };
}

async function updateFileStatus(fileId, status) {
  await redis.hset(`file:${fileId}`, 'status', status);
}

async function deleteFile(fileId) {
  await redis.del(`file:${fileId}`);
}

async function createSession(sessionId) {
  const key = `session:${sessionId}`;
  await redis.hset(key, {
    connectedTabs: '0',
    fileIds: '[]',
    createdAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
  });
}

async function getSession(sessionId) {
  const data = await redis.hgetall(`session:${sessionId}`);
  if (!data || !data.createdAt) return null;
  return {
    ...data,
    connectedTabs: parseInt(data.connectedTabs || '0', 10),
    fileIds: JSON.parse(data.fileIds || '[]'),
  };
}

async function addFileToSession(sessionId, fileId) {
  const session = await getSession(sessionId);
  if (!session) return;
  const fileIds = session.fileIds;
  if (!fileIds.includes(fileId)) {
    fileIds.push(fileId);
  }
  await redis.hset(`session:${sessionId}`, 'fileIds', JSON.stringify(fileIds));
}

async function incrementTabs(sessionId) {
  const key = `session:${sessionId}`;
  const count = await redis.hincrby(key, 'connectedTabs', 1);
  await redis.hset(key, 'lastSeen', new Date().toISOString());
  return count;
}

async function decrementTabs(sessionId) {
  const key = `session:${sessionId}`;
  const count = await redis.hincrby(key, 'connectedTabs', -1);
  if (count < 0) {
    await redis.hset(key, 'connectedTabs', '0');
    return 0;
  }
  return count;
}

async function updateLastSeen(sessionId) {
  await redis.hset(`session:${sessionId}`, 'lastSeen', new Date().toISOString());
}

async function setSessionExpiry(sessionId, seconds) {
  await redis.expire(`session:${sessionId}`, seconds);
}

async function removeSessionExpiry(sessionId) {
  await redis.persist(`session:${sessionId}`);
}

async function deleteSession(sessionId) {
  await redis.del(`session:${sessionId}`);
}

async function createActiveDownload(fileId, downloadId) {
  const key = `download:${fileId}:${downloadId}`;
  await redis.set(key, 'active', 'EX', 90);
}

async function getActiveDownloads(fileId) {
  const pattern = `download:${fileId}:*`;
  const keys = await redis.keys(pattern);
  return keys;
}

async function clearActiveDownload(fileId, downloadId) {
  await redis.del(`download:${fileId}:${downloadId}`);
}

async function scanOrphanedSessions() {
  const keys = await redis.keys('session:*');
  const sessions = [];
  for (const key of keys) {
    const sessionId = key.replace('session:', '');
    const data = await getSession(sessionId);
    if (data && data.connectedTabs === 0) {
      const lastSeen = new Date(data.lastSeen);
      const age = (Date.now() - lastSeen.getTime()) / 1000;
      if (age > 60) {
        sessions.push(sessionId);
      }
    }
  }
  return sessions;
}

module.exports = {
  redis,
  createFile,
  getFile,
  updateFileStatus,
  deleteFile,
  createSession,
  getSession,
  addFileToSession,
  incrementTabs,
  decrementTabs,
  updateLastSeen,
  setSessionExpiry,
  removeSessionExpiry,
  deleteSession,
  createActiveDownload,
  getActiveDownloads,
  clearActiveDownload,
  scanOrphanedSessions,
};
