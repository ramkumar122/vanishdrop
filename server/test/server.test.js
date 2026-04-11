import { createRequire } from 'module';
import request from 'supertest';
import { io as createClient } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const express = require('express');
const { createServer } = require('../src/index');
const { registerPresenceHandlers } = require('../src/socket/presence');

function createTestConfig() {
  return {
    corsOrigin: 'http://127.0.0.1:4173',
    nodeEnv: 'test',
    port: 0,
    s3: {
      bucket: 'test-bucket',
      region: 'us-east-1',
    },
    limits: {
      sessionGracePeriod: 1,
    },
  };
}

function createImmediateCleanupConfig() {
  return {
    corsOrigin: 'http://127.0.0.1:4173',
    nodeEnv: 'test',
    port: 0,
    s3: {
      bucket: 'test-bucket',
      region: 'us-east-1',
    },
    limits: {
      sessionGracePeriod: 0,
    },
  };
}

function createPresenceDeps(overrides = {}) {
  return {
    cleanupSessionFn: vi.fn().mockResolvedValue(undefined),
    clearSessionCloseRequestedFn: vi.fn().mockResolvedValue(undefined),
    configValue: {
      limits: {
        sessionGracePeriod: 1,
      },
    },
    createSessionFn: vi.fn().mockResolvedValue('share-test-123'),
    decrementTabsFn: vi.fn().mockResolvedValue(0),
    getSessionFn: vi.fn().mockResolvedValue(null),
    incrementTabsFn: vi.fn().mockResolvedValue(1),
    removeSessionExpiryFn: vi.fn().mockResolvedValue(undefined),
    setSessionExpiryFn: vi.fn().mockResolvedValue(undefined),
    updateLastSeenFn: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createEmptyRouter() {
  return express.Router();
}

function waitForEvent(socket, eventName) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, 5000);

    socket.once(eventName, (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });

    socket.once('connect_error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function listen(server) {
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

const socketsToClose = [];
const serversToClose = [];

afterEach(async () => {
  while (socketsToClose.length > 0) {
    const socket = socketsToClose.pop();
    socket.close();
  }

  while (serversToClose.length > 0) {
    const server = serversToClose.pop();
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) {
          if (err.code === 'ERR_SERVER_NOT_RUNNING') {
            resolve();
            return;
          }

          reject(err);
          return;
        }

        resolve();
      });
    });
  }
});

describe('server verification', () => {
  it('serves the health endpoint', async () => {
    const deps = createPresenceDeps();
    const { app, server } = createServer({
      cleanupOrphanedSessionsFn: vi.fn().mockResolvedValue(undefined),
      configOverride: createTestConfig(),
      enableStartupCleanup: false,
      filesRoutesModule: createEmptyRouter(),
      healthRoutesModule: require('../src/routes/health'),
      presenceRoutesModule: createEmptyRouter(),
      registerPresenceHandlersFn: (io) => registerPresenceHandlers(io, deps),
      setIoFn: () => {},
      sharesRoutesModule: createEmptyRouter(),
      uploadRoutesModule: createEmptyRouter(),
    });
    serversToClose.push(server);

    const response = await request(app).get('/api/health').expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.uptime).toBeTypeOf('number');
  });

  it('creates a session for a new socket connection', async () => {
    const deps = createPresenceDeps();
    const { server } = createServer({
      cleanupOrphanedSessionsFn: vi.fn().mockResolvedValue(undefined),
      configOverride: createTestConfig(),
      enableStartupCleanup: false,
      filesRoutesModule: createEmptyRouter(),
      healthRoutesModule: require('../src/routes/health'),
      presenceRoutesModule: createEmptyRouter(),
      registerPresenceHandlersFn: (io) => registerPresenceHandlers(io, deps),
      setIoFn: () => {},
      sharesRoutesModule: createEmptyRouter(),
      uploadRoutesModule: createEmptyRouter(),
    });
    serversToClose.push(server);

    const port = await listen(server);
    const socket = createClient(`http://127.0.0.1:${port}`, {
      auth: { sessionId: 'missing-session' },
      reconnection: false,
      transports: ['websocket'],
    });
    socketsToClose.push(socket);

    const payload = await waitForEvent(socket, 'session:created');

    expect(payload.sessionId).toHaveLength(12);
    expect(payload.shareId).toBe('share-test-123');
    expect(deps.createSessionFn).toHaveBeenCalledWith(payload.sessionId);
    expect(deps.incrementTabsFn).toHaveBeenCalledWith(payload.sessionId);
  });

  it('emits a session error when initialization fails', async () => {
    const deps = createPresenceDeps({
      getSessionFn: vi.fn().mockRejectedValue(new Error('redis unavailable')),
    });
    const { server } = createServer({
      cleanupOrphanedSessionsFn: vi.fn().mockResolvedValue(undefined),
      configOverride: createTestConfig(),
      enableStartupCleanup: false,
      filesRoutesModule: createEmptyRouter(),
      healthRoutesModule: require('../src/routes/health'),
      presenceRoutesModule: createEmptyRouter(),
      registerPresenceHandlersFn: (io) => registerPresenceHandlers(io, deps),
      setIoFn: () => {},
      sharesRoutesModule: createEmptyRouter(),
      uploadRoutesModule: createEmptyRouter(),
    });
    serversToClose.push(server);

    const port = await listen(server);
    const socket = createClient(`http://127.0.0.1:${port}`, {
      auth: { sessionId: 'broken-session' },
      reconnection: false,
      transports: ['websocket'],
    });
    socketsToClose.push(socket);

    const payload = await waitForEvent(socket, 'session:error');

    expect(payload).toEqual({
      message: 'Failed to initialize secure session. Please refresh and try again.',
    });
  });

  it('cleans up immediately when the last tab disconnects and grace is disabled', async () => {
    const deps = createPresenceDeps({
      configValue: {
        limits: {
          sessionGracePeriod: 0,
        },
      },
    });
    const { server } = createServer({
      cleanupOrphanedSessionsFn: vi.fn().mockResolvedValue(undefined),
      configOverride: createImmediateCleanupConfig(),
      enableStartupCleanup: false,
      filesRoutesModule: createEmptyRouter(),
      healthRoutesModule: require('../src/routes/health'),
      presenceRoutesModule: createEmptyRouter(),
      registerPresenceHandlersFn: (io) => registerPresenceHandlers(io, deps),
      setIoFn: () => {},
      sharesRoutesModule: createEmptyRouter(),
      uploadRoutesModule: createEmptyRouter(),
    });
    serversToClose.push(server);

    const port = await listen(server);
    const socket = createClient(`http://127.0.0.1:${port}`, {
      auth: { sessionId: 'presence-close-now' },
      reconnection: false,
      transports: ['websocket'],
    });
    socketsToClose.push(socket);

    const payload = await waitForEvent(socket, 'session:created');
    socket.close();

    await vi.waitFor(() => {
      expect(deps.cleanupSessionFn).toHaveBeenCalledWith(payload.sessionId);
    });
    expect(deps.setSessionExpiryFn).not.toHaveBeenCalled();
  });
});
