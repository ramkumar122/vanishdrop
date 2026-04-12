import compression from 'compression';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { Server } from 'socket.io';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');
const clientDistPath = path.join(rootDir, 'client/dist');
const port = Number.parseInt(process.env.PORT || '4173', 10);

if (!fs.existsSync(path.join(clientDistPath, 'index.html'))) {
  console.error('[E2E] Missing client build. Run `npm run build --workspace=client` first.');
  process.exit(1);
}

const SESSION_GRACE_PERIOD_MS = 2_000;
const sessions = new Map();
const shareIndex = new Map();
const files = new Map();
const sessionCleanupTimers = new Map();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
  },
  pingTimeout: 20_000,
  pingInterval: 10_000,
});

function createId(length = 12) {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}

function nowIso() {
  return new Date().toISOString();
}

function resolveExpiry(expiryMode = 'presence', expirySeconds) {
  if (expiryMode === 'presence') {
    return { expiresAt: '', expiryMode: 'presence' };
  }

  const legacyExpiries = { '1h': 3600, '4h': 14400, '24h': 86400 };
  const ttlSeconds = expiryMode === 'timed' ? Number(expirySeconds) : legacyExpiries[expiryMode];

  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    return { expiresAt: '', expiryMode: 'presence' };
  }

  return {
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    expiryMode: 'timed',
  };
}

function createSession(id = createId()) {
  const shareId = createId(16);
  const session = {
    connectedTabs: 0,
    createdAt: nowIso(),
    fileIds: new Set(),
    id,
    lastSeen: nowIso(),
    shareId,
  };
  sessions.set(id, session);
  shareIndex.set(shareId, id);
  return session;
}

function cancelSessionCleanup(sessionId) {
  const timer = sessionCleanupTimers.get(sessionId);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  sessionCleanupTimers.delete(sessionId);
}

function getOrigin(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function getSessionById(sessionId) {
  return sessionId ? sessions.get(sessionId) || null : null;
}

function getSessionByShareId(shareId) {
  const sessionId = shareIndex.get(shareId);
  return getSessionById(sessionId);
}

function getAccessState(file) {
  if (!file || file.status !== 'ready') {
    return { error: 'File not found or no longer available', status: 404 };
  }

  if (file.expiryMode !== 'presence') {
    if (!file.expiresAt || new Date(file.expiresAt) <= new Date()) {
      return {
        error: 'The person who shared this file set a timer and it has now expired.',
        status: 410,
      };
    }

    return null;
  }

  const session = getSessionById(file.sessionId);
  const withinGraceWindow =
    session?.lastSeen && Date.now() - new Date(session.lastSeen).getTime() <= SESSION_GRACE_PERIOD_MS + 1_000;

  if (!session || (session.connectedTabs <= 0 && !withinGraceWindow)) {
    return {
      error: 'The uploader closed their tab, so this file is no longer available.',
      status: 410,
    };
  }

  return null;
}

function deletePresenceFiles(sessionId) {
  const session = getSessionById(sessionId);
  if (!session) return;

  for (const fileId of [...session.fileIds]) {
    const file = files.get(fileId);
    if (!file || file.expiryMode !== 'presence') {
      continue;
    }

    files.delete(fileId);
    session.fileIds.delete(fileId);
    io.to(`file:${fileId}`).emit('file:deleted', { fileId });
  }
}

app.use(compression());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.post('/api/upload', (req, res) => {
  const { expiryMode = 'presence', expirySeconds, fileName, fileSize, mimeType, sessionId } = req.body;
  const session = getSessionById(sessionId);

  if (!session || session.connectedTabs <= 0) {
    return res.status(400).json({ error: 'Invalid or expired session' });
  }

  const fileId = createId(8);
  const resolvedExpiry = resolveExpiry(expiryMode, expirySeconds);
  const file = {
    content: null,
    expiryMode: resolvedExpiry.expiryMode,
    expiresAt: resolvedExpiry.expiresAt,
    fileId,
    fileName,
    fileSize,
    mimeType,
    sessionId,
    status: 'uploading',
  };

  files.set(fileId, file);
  session.fileIds.add(fileId);

  return res.json({
    expiresIn: 3600,
    expiryMode: resolvedExpiry.expiryMode,
    fileId,
    shareId: session.shareId,
    shareLink: `${getOrigin(req)}/d/${session.shareId}`,
    uploadUrl: `${getOrigin(req)}/__uploads/${fileId}`,
    uploadType: 'single',
  });
});

app.put('/__uploads/:fileId', express.raw({ limit: '110mb', type: '*/*' }), (req, res) => {
  const file = files.get(req.params.fileId);
  if (!file) {
    return res.status(404).end();
  }

  file.content = Buffer.from(req.body || []);
  return res.status(200).end();
});

app.post('/api/upload/:fileId/complete', (req, res) => {
  const file = files.get(req.params.fileId);

  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  if (file.sessionId !== req.body.sessionId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  if (!file.content || file.content.length === 0) {
    return res.status(400).json({ error: 'File not found in storage. Upload may have failed.' });
  }

  file.status = 'ready';
  const session = getSessionById(file.sessionId);
  io.to(`session:${file.sessionId}`).emit('file:ready', {
    fileId: file.fileId,
    shareId: session?.shareId,
  });
  return res.json({ status: 'ready' });
});

app.get('/api/shares/:shareId', (req, res) => {
  const session = getSessionByShareId(req.params.shareId);

  if (!session) {
    return res.status(404).json({ error: 'Share not found or no longer available' });
  }

  const shareFiles = [...session.fileIds]
    .map((fileId) => files.get(fileId))
    .filter(Boolean)
    .filter((file) => file.status === 'ready')
    .map((file) => {
      const accessState = getAccessState(file);
      if (accessState) {
        return null;
      }

      return {
        expiresAt: file.expiresAt || null,
        expiryMode: file.expiryMode,
        fileId: file.fileId,
        fileName: file.fileName,
        fileSize: file.fileSize,
        isAvailable: true,
        mimeType: file.mimeType,
      };
    })
    .filter(Boolean);

  if (shareFiles.length === 0) {
    return res.status(410).json({ error: 'The uploader closed their tab, so these files are no longer available.' });
  }

  return res.json({
    files: shareFiles,
    hasPresenceFiles: shareFiles.some((file) => file.expiryMode === 'presence'),
    shareId: session.shareId,
    totalFiles: shareFiles.length,
  });
});

app.get('/api/files/:fileId', (req, res) => {
  const file = files.get(req.params.fileId);
  const accessState = getAccessState(file);

  if (accessState) {
    return res.status(accessState.status).json({ error: accessState.error });
  }

  return res.json({
    expiresAt: file.expiresAt || null,
    expiryMode: file.expiryMode,
    fileName: file.fileName,
    fileSize: file.fileSize,
    isAvailable: true,
    mimeType: file.mimeType,
  });
});

app.get('/api/files/:fileId/download', (req, res) => {
  const file = files.get(req.params.fileId);
  const accessState = getAccessState(file);

  if (accessState) {
    return res.status(accessState.status).json({ error: accessState.error });
  }

  const downloadId = createId(10);
  io.to(`session:${file.sessionId}`).emit('file:download-started', { downloadId, fileId: file.fileId });

  res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
  res.setHeader('Content-Length', String(file.content.length));
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`
  );

  res.on('finish', () => {
    io.to(`session:${file.sessionId}`).emit('file:download-completed', { downloadId, fileId: file.fileId });
  });

  res.send(file.content);
});

app.post('/api/files/:fileId/download/:downloadId/complete', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use(express.static(clientDistPath));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io') || req.path.startsWith('/__uploads')) {
    return next();
  }

  return res.sendFile(path.join(clientDistPath, 'index.html'));
});

io.on('connection', (socket) => {
  let session = getSessionById(socket.handshake.auth?.sessionId);
  if (!session) {
    session = createSession();
  }

  cancelSessionCleanup(session.id);
  session.connectedTabs += 1;
  session.lastSeen = nowIso();

  socket.join(`session:${session.id}`);
  socket.data.sessionId = session.id;

  socket.emit('session:created', { sessionId: session.id, shareId: session.shareId });
  socket.emit('presence:status', { connectedTabs: session.connectedTabs });

  socket.on('presence:ping', () => {
    session.lastSeen = nowIso();
    socket.emit('presence:pong');
  });

  socket.on('presence:tab-hidden', () => {
    session.lastSeen = nowIso();
  });

  socket.on('presence:tab-visible', () => {
    session.lastSeen = nowIso();
  });

  socket.on('file:join', (fileId) => {
    socket.join(`file:${fileId}`);
  });

  socket.on('disconnect', () => {
    const latestSession = getSessionById(session.id);
    if (!latestSession) {
      return;
    }

    latestSession.connectedTabs = Math.max(latestSession.connectedTabs - 1, 0);
    latestSession.lastSeen = nowIso();
    if (latestSession.connectedTabs === 0) {
      const timer = setTimeout(() => {
        const reconnectSession = getSessionById(latestSession.id);
        sessionCleanupTimers.delete(latestSession.id);

        if (!reconnectSession || reconnectSession.connectedTabs > 0) {
          return;
        }

        deletePresenceFiles(reconnectSession.id);
        sessions.delete(reconnectSession.id);
        shareIndex.delete(reconnectSession.shareId);
      }, SESSION_GRACE_PERIOD_MS);

      sessionCleanupTimers.set(latestSession.id, timer);
    }
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[E2E] Test server listening on http://127.0.0.1:${port}`);
});
