const {
  getSession,
  getFile,
  deleteFile,
  deleteSession,
  removeFileFromShare,
  updateFileStatus,
  clearActiveDownloads,
  scanOrphanedSessions,
} = require('./redis');
const { deleteObject } = require('./storage');
const { abortActiveDownloads } = require('./downloads');

let ioInstance = null;

function setIo(io) {
  ioInstance = io;
}

async function cleanupFile(fileId, retries = 3) {
  const file = await getFile(fileId);
  if (!file) return;

  const abortedDownloads = abortActiveDownloads(
    fileId,
    'The person who shared this file set a timer and it has now expired.'
  );
  if (abortedDownloads > 0) {
    console.log(`[Cleanup] Aborted ${abortedDownloads} active download(s) for file ${fileId}`);
  }

  await clearActiveDownloads(fileId);

  await updateFileStatus(fileId, 'deleting');

  let attempt = 0;
  while (attempt < retries) {
    try {
      await deleteObject(file.storageKey);
      break;
    } catch (err) {
      attempt++;
      if (attempt >= retries) {
        console.error(`[Cleanup] Failed to delete S3 object ${file.storageKey} after ${retries} attempts:`, err.message);
      } else {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  await deleteFile(fileId);
  await removeFileFromShare(file.shareId, fileId);

  if (ioInstance) {
    ioInstance.to(`file:${fileId}`).emit('file:deleted', { fileId });
  }

  console.log(`[Cleanup] Deleted file ${fileId}`);
}

// Schedule timed-expiry cleanup for a file
function scheduleTimedCleanup(fileId, expiresAt) {
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  if (msLeft <= 0) {
    cleanupFile(fileId);
    return;
  }
  setTimeout(() => cleanupFile(fileId), msLeft);
  console.log(`[Cleanup] Scheduled timed cleanup for file ${fileId} in ${Math.round(msLeft / 1000)}s`);
}

async function cleanupSession(sessionId) {
  console.log(`[Cleanup] Starting cleanup for session ${sessionId}`);

  const session = await getSession(sessionId);
  if (!session) return;

  const fileIds = session.fileIds;

  for (const fileId of fileIds) {
    const file = await getFile(fileId);
    // Skip timed files — they clean up on their own schedule
    if (file && file.expiryMode && file.expiryMode !== 'presence') {
      console.log(`[Cleanup] Skipping timed file ${fileId} (expires at ${file.expiresAt})`);
      continue;
    }
    await cleanupFile(fileId);
  }

  await deleteSession(sessionId);
  console.log(`[Cleanup] Session ${sessionId} fully cleaned up`);
}

async function cleanupOrphanedSessions() {
  console.log('[Cleanup] Scanning for orphaned sessions...');
  const orphaned = await scanOrphanedSessions();
  for (const sessionId of orphaned) {
    console.log(`[Cleanup] Found orphaned session ${sessionId}, cleaning up`);
    await cleanupSession(sessionId);
  }
  console.log(`[Cleanup] Orphan scan complete. Found ${orphaned.length} orphaned sessions.`);
}

module.exports = { cleanupSession, cleanupFile, cleanupOrphanedSessions, scheduleTimedCleanup, setIo };
