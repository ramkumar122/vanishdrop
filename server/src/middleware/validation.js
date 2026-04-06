const config = require('../config');

function validateUpload(req, res, next) {
  const { fileName, fileSize, mimeType, sessionId } = req.body;

  if (!fileName || typeof fileName !== 'string' || fileName.trim().length === 0) {
    return res.status(400).json({ error: 'fileName is required' });
  }
  if (fileName.length > 255) {
    return res.status(400).json({ error: 'fileName must be 255 characters or fewer' });
  }

  if (fileSize === undefined || fileSize === null) {
    return res.status(400).json({ error: 'fileSize is required' });
  }
  const size = Number(fileSize);
  if (!Number.isInteger(size) || size <= 0) {
    return res.status(400).json({ error: 'fileSize must be a positive integer' });
  }
  if (size > config.limits.maxFileSize) {
    return res.status(400).json({
      error: `File size exceeds maximum of ${config.limits.maxFileSize} bytes (100MB)`,
    });
  }

  if (!mimeType || typeof mimeType !== 'string' || !mimeType.includes('/')) {
    return res.status(400).json({ error: 'mimeType must be a valid MIME type' });
  }

  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  const { expiryMode } = req.body;
  const validExpiry = ['presence', '1h', '4h', '24h'];
  if (expiryMode !== undefined && !validExpiry.includes(expiryMode)) {
    return res.status(400).json({ error: `expiryMode must be one of: ${validExpiry.join(', ')}` });
  }

  next();
}

module.exports = { validateUpload };
