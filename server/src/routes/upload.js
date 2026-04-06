const express = require('express');
const { nanoid } = require('nanoid');
const { validateUpload } = require('../middleware/validation');
const { uploadRateLimit } = require('../middleware/rateLimit');
const { generateUploadUrl, headObject } = require('../services/storage');
const { createFile, updateFileStatus, getFile, addFileToSession, getSession } = require('../services/redis');
const { scheduleTimedCleanup } = require('../services/cleanup');
const config = require('../config');

const router = express.Router();

// Sanitize filename to prevent path traversal
function sanitizeFileName(fileName) {
  return fileName.replace(/[^a-zA-Z0-9._\-\s]/g, '_').replace(/\s+/g, '_');
}

router.post('/', uploadRateLimit, validateUpload, async (req, res) => {
  const { fileName, fileSize, mimeType, sessionId, expiryMode = 'presence' } = req.body;

  try {
    const session = await getSession(sessionId);
    if (!session) {
      return res.status(400).json({ error: 'Invalid or expired session' });
    }

    const fileId = nanoid(8);
    const sanitized = sanitizeFileName(fileName.trim());
    const storageKey = `uploads/${fileId}/${sanitized}`;

    const uploadUrl = await generateUploadUrl(storageKey, mimeType, Number(fileSize));

    await createFile(fileId, {
      fileName: fileName.trim(),
      fileSize: Number(fileSize),
      mimeType,
      storageKey,
      sessionId,
      expiryMode,
    });

    await addFileToSession(sessionId, fileId);

    const shareLink = `${config.corsOrigin}/d/${fileId}`;

    res.json({
      fileId,
      uploadUrl,
      shareLink,
      expiryMode,
      expiresIn: config.limits.presignedUrlExpiry,
    });
  } catch (err) {
    console.error('[Upload] Error:', err);
    res.status(500).json({ error: 'Failed to initiate upload' });
  }
});

router.post('/:fileId/complete', async (req, res) => {
  const { fileId } = req.params;
  const { sessionId } = req.body;

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

    const exists = await headObject(file.storageKey);
    if (!exists) {
      return res.status(400).json({ error: 'File not found in storage. Upload may have failed.' });
    }

    await updateFileStatus(fileId, 'ready');

    // Schedule timed cleanup if not presence-based
    if (file.expiryMode && file.expiryMode !== 'presence' && file.expiresAt) {
      scheduleTimedCleanup(fileId, file.expiresAt);
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`session:${sessionId}`).emit('file:ready', { fileId });
    }

    res.json({ status: 'ready' });
  } catch (err) {
    console.error('[Upload Complete] Error:', err);
    res.status(500).json({ error: 'Failed to complete upload' });
  }
});

module.exports = router;
