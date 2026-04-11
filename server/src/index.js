require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

const defaultConfig = require('./config');

function buildConfig(configOverride = {}) {
  return {
    ...defaultConfig,
    ...configOverride,
    redis: {
      ...defaultConfig.redis,
      ...configOverride.redis,
    },
    s3: {
      ...defaultConfig.s3,
      ...configOverride.s3,
    },
    limits: {
      ...defaultConfig.limits,
      ...configOverride.limits,
    },
  };
}

function createServer(options = {}) {
  const {
    configOverride = {},
    enableStartupCleanup = true,
    cleanupOrphanedSessionsFn,
    filesRoutesModule,
    healthRoutesModule,
    presenceRoutesModule,
    registerPresenceHandlersFn,
    setIoFn,
    sharesRoutesModule,
    uploadRoutesModule,
  } = options;
  const cleanupService =
    cleanupOrphanedSessionsFn && setIoFn ? null : require('./services/cleanup');
  const localCleanupOrphanedSessionsFn = cleanupOrphanedSessionsFn || cleanupService.cleanupOrphanedSessions;
  const localRegisterPresenceHandlersFn =
    registerPresenceHandlersFn || require('./socket/presence').registerPresenceHandlers;
  const localSetIoFn = setIoFn || cleanupService.setIo;

  const config = buildConfig(configOverride);
  const app = express();
  const server = http.createServer(app);
  const uploadRoutes = uploadRoutesModule || require('./routes/upload');
  const filesRoutes = filesRoutesModule || require('./routes/files');
  const healthRoutes = healthRoutesModule || require('./routes/health');
  const presenceRoutes = presenceRoutesModule || require('./routes/presence');
  const sharesRoutes = sharesRoutesModule || require('./routes/shares');
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

  app.set('io', io);
  localSetIoFn(io);

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
  app.use('/api/presence', presenceRoutes);
  app.use('/api/shares', sharesRoutes);
  app.use('/api/health', healthRoutes);

  app.use(express.static(clientDistPath));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
      return next();
    }

    return res.sendFile(path.join(clientDistPath, 'index.html'));
  });

  localRegisterPresenceHandlersFn(io);

  let startupCleanupTimer = null;
  if (enableStartupCleanup) {
    startupCleanupTimer = setTimeout(() => {
      localCleanupOrphanedSessionsFn().catch((err) =>
        console.error('[Startup] Orphan cleanup failed:', err.message)
      );
    }, 5000);
  }

  server.on('close', () => {
    if (startupCleanupTimer) {
      clearTimeout(startupCleanupTimer);
    }
  });

  return { app, server, io, config };
}

function startServer(options = {}) {
  const instance = createServer(options);

  return new Promise((resolve) => {
    instance.server.listen(instance.config.port, () => {
      console.log(`[Server] VanishDrop server running on port ${instance.config.port}`);
      console.log(`[Server] Environment: ${instance.config.nodeEnv}`);
      console.log(`[Server] CORS origin: ${instance.config.corsOrigin}`);
      resolve(instance);
    });
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
  });
}

module.exports = { createServer, startServer };
