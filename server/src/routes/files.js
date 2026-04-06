const express = require('express');
const { nanoid } = require('nanoid');
const { getFile, getSession, createActiveDownload } = require('../services/redis');
const { generateDownloadUrl } = require('../services/storage');

const router = express.Router();

async function isFileAccessible(file) {
  if (file.expiryMode && file.expiryMode !== 'presence') {
    // Timed expiry — available until expiresAt regardless of uploader presence
    if (!file.expiresAt) return false;
    return new Date(file.expiresAt) > new Date();
  }
  // Presence-based — uploader must have at least one connected tab
  const session = await getSession(file.sessionId);
  if (!session) return false;
  return session.connectedTabs > 0;
}

router.get('/:fileId', async (req, res) => {
  const { fileId } = req.params;

  try {
    const file = await getFile(fileId);
    if (!file || file.status !== 'ready') {
      return res.status(404).json({ error: 'File not found or no longer available' });
    }

    const accessible = await isFileAccessible(file);
    if (!accessible) {
      return res.status(404).json({ error: 'File not found or no longer available' });
    }

    res.json({
      fileName: file.fileName,
      fileSize: file.fileSize,
      mimeType: file.mimeType,
      expiryMode: file.expiryMode || 'presence',
      expiresAt: file.expiresAt || null,
      isAvailable: true,
    });
  } catch (err) {
    console.error('[Files] Error getting file info:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:fileId/download', async (req, res) => {
  const { fileId } = req.params;

  try {
    const file = await getFile(fileId);
    if (!file || file.status !== 'ready') {
      return res.status(404).json({ error: 'File not found or no longer available' });
    }

    const accessible = await isFileAccessible(file);
    if (!accessible) {
      return res.status(404).json({ error: 'File not found or no longer available' });
    }

    const downloadId = nanoid(12);
    await createActiveDownload(fileId, downloadId);

    const downloadUrl = await generateDownloadUrl(file.storageKey, file.fileName);

    const io = req.app.get('io');
    if (io) {
      io.to(`session:${file.sessionId}`).emit('file:download-started', { fileId, downloadId });
    }

    res.json({ downloadUrl, fileName: file.fileName });
  } catch (err) {
    console.error('[Files] Error generating download URL:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
