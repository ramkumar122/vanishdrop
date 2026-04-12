const { nanoid } = require('nanoid');
const Redis = require('ioredis');
const config = require('../config');
const { resolveExpirySelection } = require('../lib/expiry');

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

async function createFile(fileId, metadata) {
  const key = `file:${fileId}`;
  const resolvedExpiry = resolveExpirySelection({
    expiryMode: metadata.expiryMode,
    expirySeconds: metadata.expirySeconds,
  });
  const payload = {
    fileName: metadata.fileName,
    fileSize: String(metadata.fileSize),
    mimeType: metadata.mimeType,
    storageKey: metadata.storageKey,
    sessionId: metadata.sessionId,
    uploadedAt: new Date().toISOString(),
    status: 'uploading',
    expiryMode: resolvedExpiry.expiryMode,
    expiresAt: resolvedExpiry.expiresAt,
    uploadType: metadata.uploadType || 'single',
  };
  if (metadata.shareId) {
    payload.shareId = metadata.shareId;
  }
  if (metadata.uploadId) {
    payload.uploadId = metadata.uploadId;
  }

  await redis.hset(key, payload);
  const ttl = resolvedExpiry.ttlSeconds || FILE_TTL;
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
  const shareId = nanoid(16);
  const createdAt = new Date().toISOString();

  await redis.hset(key, {
    connectedTabs: '0',
    fileIds: '[]',
    createdAt,
    lastSeen: createdAt,
    closeRequestedAt: '',
    shareId,
  });

  await redis.hset(`share:${shareId}`, {
    sessionId,
    fileIds: '[]',
    createdAt,
  });

  return shareId;
}

async function getSession(sessionId) {
  const data = await redis.hgetall(`session:${sessionId}`);
  if (!data || !data.createdAt) return null;
  return {
    ...data,
    closeRequestedAt: data.closeRequestedAt || null,
    connectedTabs: parseInt(data.connectedTabs || '0', 10),
    fileIds: JSON.parse(data.fileIds || '[]'),
  };
}

async function getShare(shareId) {
  const data = await redis.hgetall(`share:${shareId}`);
  if (!data || !data.createdAt) return null;

  return {
    ...data,
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

async function addFileToShare(shareId, fileId) {
  const share = await getShare(shareId);
  if (!share) return;

  const fileIds = share.fileIds;
  if (!fileIds.includes(fileId)) {
    fileIds.push(fileId);
  }

  await redis.hset(`share:${shareId}`, 'fileIds', JSON.stringify(fileIds));
}

async function removeFileFromShare(shareId, fileId) {
  if (!shareId) return;

  const share = await getShare(shareId);
  if (!share) return;

  const fileIds = share.fileIds.filter((existingId) => existingId !== fileId);
  if (fileIds.length === 0) {
    await deleteShare(shareId);
    return;
  }

  await redis.hset(`share:${shareId}`, 'fileIds', JSON.stringify(fileIds));
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

async function markSessionCloseRequested(sessionId) {
  await redis.hset(`session:${sessionId}`, 'closeRequestedAt', new Date().toISOString());
}

async function clearSessionCloseRequested(sessionId) {
  await redis.hset(`session:${sessionId}`, 'closeRequestedAt', '');
}

async function setSessionExpiry(sessionId, seconds) {
  await redis.expire(`session:${sessionId}`, seconds);
}

async function removeSessionExpiry(sessionId) {
  await redis.persist(`session:${sessionId}`);
}

async function deleteSession(sessionId) {
  const session = await getSession(sessionId);
  await redis.del(`session:${sessionId}`);

  if (!session?.shareId) {
    return;
  }

  const share = await getShare(session.shareId);
  if (share && share.fileIds.length === 0) {
    await deleteShare(session.shareId);
  }
}

async function deleteShare(shareId) {
  await redis.del(`share:${shareId}`);
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

async function clearActiveDownloads(fileId) {
  const keys = await getActiveDownloads(fileId);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
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

async function scanPendingDeletionFiles() {
  const keys = await redis.keys('file:*');
  const fileIds = [];

  for (const key of keys) {
    const fileId = key.replace('file:', '');
    const data = await getFile(fileId);
    if (data && (data.status === 'deleting' || data.status === 'delete_failed')) {
      fileIds.push(fileId);
    }
  }

  return fileIds;
}

module.exports = {
  redis,
  createFile,
  getFile,
  updateFileStatus,
  deleteFile,
  createSession,
  getSession,
  getShare,
  addFileToSession,
  addFileToShare,
  removeFileFromShare,
  incrementTabs,
  decrementTabs,
  updateLastSeen,
  markSessionCloseRequested,
  clearSessionCloseRequested,
  setSessionExpiry,
  removeSessionExpiry,
  deleteSession,
  deleteShare,
  createActiveDownload,
  getActiveDownloads,
  clearActiveDownload,
  clearActiveDownloads,
  scanOrphanedSessions,
  scanPendingDeletionFiles,
};
