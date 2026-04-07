require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

const config = require('./config');
const uploadRoutes = require('./routes/upload');
const filesRoutes = require('./routes/files');
const healthRoutes = require('./routes/health');
const { registerPresenceHandlers } = require('./socket/presence');
const { setIo, cleanupOrphanedSessions } = require('./services/cleanup');

const app = express();
const server = http.createServer(app);
const clientDistPath = path.resolve(__dirname, '../../client/dist');
const socketOrigin = config.corsOrigin.replace(/^http/, 'ws');
const s3UploadOrigin = `https://${config.s3.bucket}.s3.${config.s3.region}.amazonaws.com`;

const io = new Server(server, {
  cors: {
    origin: config.corsOrigin,
    methods: ['GET', 'POST'],
  },
  pingTimeout: 20000,
  pingInterval: 10000,
});

// Store io on app for use in route handlers
app.set('io', io);
setIo(io);

// Trust nginx reverse proxy so req.ip is the real client IP (for rate limiting)
app.set('trust proxy', 1);

app.use(
  helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        fontSrc: ["'self'", 'https:', 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
        connectSrc: ["'self'", config.corsOrigin, socketOrigin, s3UploadOrigin],
        upgradeInsecureRequests: [],
      },
    },
  })
);
app.use(compression());
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

app.use('/api/upload', uploadRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/health', healthRoutes);

app.use(express.static(clientDistPath));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
    return next();
  }

  return res.sendFile(path.join(clientDistPath, 'index.html'));
});

registerPresenceHandlers(io);

// On startup: clean up sessions orphaned by a previous server crash
setTimeout(() => {
  cleanupOrphanedSessions().catch((err) =>
    console.error('[Startup] Orphan cleanup failed:', err.message)
  );
}, 5000);

server.listen(config.port, () => {
  console.log(`[Server] VanishDrop server running on port ${config.port}`);
  console.log(`[Server] Environment: ${config.nodeEnv}`);
  console.log(`[Server] CORS origin: ${config.corsOrigin}`);
});

module.exports = { app, server, io };
