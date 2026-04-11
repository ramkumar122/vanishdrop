const express = require('express');
const { getFile, getSession, getShare } = require('../services/redis');
const { isSessionWithinGracePeriod } = require('../lib/presenceAccess');

const router = express.Router();

function serializeFile(file) {
  return {
    expiresAt: file.expiresAt || null,
    expiryMode: file.expiryMode || 'presence',
    fileId: file.fileId || null,
    fileName: file.fileName,
    fileSize: file.fileSize,
    isAvailable: true,
    mimeType: file.mimeType,
    uploadedAt: file.uploadedAt || null,
  };
}

async function getFileAccessState(file) {
  if (file.expiryMode && file.expiryMode !== 'presence') {
    if (!file.expiresAt) {
      return { accessible: false, status: 410, error: 'This file is no longer available.' };
    }

    if (new Date(file.expiresAt) <= new Date()) {
      return {
        accessible: false,
        status: 410,
        error: 'The person who shared this file set a timer and it has now expired.',
      };
    }

    return { accessible: true };
  }

  const session = await getSession(file.sessionId);
  if (!isSessionWithinGracePeriod(session)) {
    return {
      accessible: false,
      status: 410,
      error: 'The uploader closed their tab, so these files are no longer available.',
    };
  }

  return { accessible: true };
}

async function resolveShare(shareId) {
  const share = await getShare(shareId);
  if (!share) {
    const legacyFile = await getFile(shareId);
    if (!legacyFile || legacyFile.status !== 'ready') {
      return null;
    }

    const accessState = await getFileAccessState(legacyFile);
    if (!accessState.accessible) {
      return {
        files: [],
        reason: accessState.error,
        shareId,
        status: accessState.status,
      };
    }

    return {
      files: [
        {
          ...serializeFile({
            ...legacyFile,
            fileId: shareId,
          }),
        },
      ],
      hasPresenceFiles: (legacyFile.expiryMode || 'presence') === 'presence',
      shareId,
      totalFiles: 1,
    };
  }

  const files = [];
  let unavailableReason = null;

  for (const fileId of share.fileIds) {
    const file = await getFile(fileId);
    if (!file || file.status !== 'ready') {
      continue;
    }

    const accessState = await getFileAccessState(file);
    if (!accessState.accessible) {
      unavailableReason ||= accessState.error;
      continue;
    }

    files.push(
      serializeFile({
        ...file,
        fileId,
      })
    );
  }

  if (files.length === 0) {
    return {
      files: [],
      reason: unavailableReason || 'The files in this share are no longer available.',
      shareId,
      status: unavailableReason ? 410 : 404,
    };
  }

  return {
    files,
    hasPresenceFiles: files.some((file) => file.expiryMode === 'presence'),
    shareId,
    totalFiles: files.length,
  };
}

router.get('/:shareId', async (req, res) => {
  try {
    const share = await resolveShare(req.params.shareId);
    if (!share) {
      return res.status(404).json({ error: 'Share not found or no longer available' });
    }

    if (share.files.length === 0) {
      return res.status(share.status).json({ error: share.reason });
    }

    return res.json({
      files: share.files,
      hasPresenceFiles: share.hasPresenceFiles,
      shareId: share.shareId,
      totalFiles: share.totalFiles,
    });
  } catch (err) {
    console.error('[Shares] Error getting share info:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
