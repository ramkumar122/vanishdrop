const express = require('express');
const { nanoid } = require('nanoid');
const { validateUpload } = require('../middleware/validation');
const { uploadRateLimit } = require('../middleware/rateLimit');
const {
  MAX_SINGLE_UPLOAD_SIZE,
  generateUploadUrl,
  createMultipartUploadPlan,
  completeMultipartUpload,
  headObject,
} = require('../services/storage');
const {
  createFile,
  updateFileStatus,
  getFile,
  addFileToSession,
  addFileToShare,
  getSession,
} = require('../services/redis');
const { scheduleTimedCleanup } = require('../services/cleanup');
const config = require('../config');

const router = express.Router();

// Sanitize filename to prevent path traversal
function sanitizeFileName(fileName) {
  return fileName.replace(/[^a-zA-Z0-9._\-\s]/g, '_').replace(/\s+/g, '_');
}

router.post('/', uploadRateLimit, validateUpload, async (req, res) => {
  const {
    fileName,
    fileSize,
    mimeType,
    sessionId,
    expiryMode = 'presence',
    expirySeconds,
  } = req.body;

  try {
    const session = await getSession(sessionId);
    if (!session) {
      return res.status(400).json({ error: 'Invalid or expired session' });
    }

    const fileId = nanoid(8);
    const sanitized = sanitizeFileName(fileName.trim());
    const storageKey = `uploads/${fileId}/${sanitized}`;
    const size = Number(fileSize);
    const uploadTarget =
      size > MAX_SINGLE_UPLOAD_SIZE
        ? await createMultipartUploadPlan(storageKey, mimeType, size)
        : {
            uploadType: 'single',
            uploadUrl: await generateUploadUrl(storageKey, mimeType, size),
          };

    await createFile(fileId, {
      fileName: fileName.trim(),
      fileSize: size,
      mimeType,
      storageKey,
      sessionId,
      shareId: session.shareId,
      expiryMode,
      expirySeconds,
      uploadType: uploadTarget.uploadType,
      uploadId: uploadTarget.uploadId,
    });

    await addFileToSession(sessionId, fileId);
    await addFileToShare(session.shareId, fileId);

    const shareLink = `${config.corsOrigin}/d/${session.shareId}`;

    res.json({
      fileId,
      shareId: session.shareId,
      shareLink,
      expiryMode,
      expiresIn: config.limits.presignedUrlExpiry,
      ...uploadTarget,
    });
  } catch (err) {
    console.error('[Upload] Error:', err);
    res.status(500).json({ error: 'Failed to initiate upload' });
  }
});

router.post('/:fileId/complete', async (req, res) => {
  const { fileId } = req.params;
  const { parts = [], sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  try {
    const file = await getFile(fileId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (file.sessionId !== sessionId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (file.uploadType === 'multipart') {
      if (!Array.isArray(parts) || parts.length === 0) {
        return res.status(400).json({ error: 'Multipart upload parts are required' });
      }

      await completeMultipartUpload(file.storageKey, file.uploadId, parts);
    } else {
      const exists = await headObject(file.storageKey);
      if (!exists) {
        return res.status(400).json({ error: 'File not found in storage. Upload may have failed.' });
      }
    }

    await updateFileStatus(fileId, 'ready');

    // Schedule timed cleanup if not presence-based
    if (file.expiryMode && file.expiryMode !== 'presence' && file.expiresAt) {
      scheduleTimedCleanup(fileId, file.expiresAt);
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`session:${sessionId}`).emit('file:ready', { fileId, shareId: file.shareId });
    }

    res.json({ status: 'ready' });
  } catch (err) {
    console.error('[Upload Complete] Error:', err);
    res.status(500).json({ error: 'Failed to complete upload' });
  }
});

module.exports = router;
