const express = require('express');
const { nanoid } = require('nanoid');
const {
  getFile,
  getSession,
  createActiveDownload,
  clearActiveDownload,
} = require('../services/redis');
const { getObjectStream } = require('../services/storage');
const { registerActiveDownload, unregisterActiveDownload } = require('../services/downloads');

const router = express.Router();

function encodeDownloadFileName(fileName) {
  return encodeURIComponent(fileName).replace(/['()]/g, escape).replace(/\*/g, '%2A');
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
  if (!session || session.connectedTabs <= 0) {
    return {
      accessible: false,
      status: 410,
      error: 'The uploader closed their tab, so this file is no longer available.',
    };
  }

  return { accessible: true };
}

router.get('/:fileId', async (req, res) => {
  const { fileId } = req.params;

  try {
    const file = await getFile(fileId);
    if (!file || file.status !== 'ready') {
      return res.status(404).json({ error: 'File not found or no longer available' });
    }

    const accessState = await getFileAccessState(file);
    if (!accessState.accessible) {
      return res.status(accessState.status).json({ error: accessState.error });
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

    const accessState = await getFileAccessState(file);
    if (!accessState.accessible) {
      return res.status(accessState.status).json({ error: accessState.error });
    }

    const downloadId = nanoid(12);
    await createActiveDownload(fileId, downloadId);

    const io = req.app.get('io');
    if (io) {
      io.to(`session:${file.sessionId}`).emit('file:download-started', { fileId, downloadId });
    }

    const { body, contentLength, contentType } = await getObjectStream(file.storageKey);

    let finalized = false;

    const finalize = async (notifyCompleted = false) => {
      if (finalized) return;
      finalized = true;
      unregisterActiveDownload(fileId, downloadId);
      await clearActiveDownload(fileId, downloadId);

      if (notifyCompleted && io) {
        io.to(`session:${file.sessionId}`).emit('file:download-completed', { fileId, downloadId });
      }
    };

    const abortDownload = (reason) => {
      if (finalized) return;
      finalized = true;
      unregisterActiveDownload(fileId, downloadId);
      void clearActiveDownload(fileId, downloadId);

      const abortError = new Error(reason || 'Download expired');
      if (body?.destroy) {
        body.destroy(abortError);
      }
      if (!res.writableEnded) {
        res.destroy(abortError);
      }
    };

    registerActiveDownload(fileId, downloadId, abortDownload);

    res.setHeader('Content-Type', contentType || file.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeDownloadFileName(file.fileName)}`
    );
    if (contentLength !== undefined) {
      res.setHeader('Content-Length', String(contentLength));
    }

    res.on('finish', () => {
      void finalize(true);
    });

    res.on('close', () => {
      void finalize(false);
    });

    body.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to download file' });
      } else if (!res.writableEnded) {
        res.destroy(err);
      }
      void finalize(false);
    });

    body.pipe(res);
  } catch (err) {
    console.error('[Files] Error streaming download:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:fileId/download/:downloadId/complete', async (req, res) => {
  const { fileId, downloadId } = req.params;

  try {
    const file = await getFile(fileId);
    await clearActiveDownload(fileId, downloadId);

    const io = req.app.get('io');
    if (io && file?.sessionId) {
      io.to(`session:${file.sessionId}`).emit('file:download-completed', { fileId, downloadId });
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('[Files] Error completing download:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
