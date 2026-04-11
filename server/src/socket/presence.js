const { nanoid } = require('nanoid');
const config = require('../config');
const { getPresenceGracePeriodSeconds, isRecentCloseRequest } = require('../lib/presenceAccess');

function buildDependencies(overrides = {}) {
  const needsCleanupService = !overrides.cleanupSessionFn;
  const needsRedisService =
    !overrides.createSessionFn ||
    !overrides.decrementTabsFn ||
    !overrides.getSessionFn ||
    !overrides.incrementTabsFn ||
    !overrides.clearSessionCloseRequestedFn ||
    !overrides.removeSessionExpiryFn ||
    !overrides.setSessionExpiryFn ||
    !overrides.updateLastSeenFn;
  const redisService = needsRedisService ? require('../services/redis') : null;
  const cleanupService = needsCleanupService ? require('../services/cleanup') : null;

  return {
    cleanupSessionFn: overrides.cleanupSessionFn || cleanupService.cleanupSession,
    clearSessionCloseRequestedFn:
      overrides.clearSessionCloseRequestedFn || redisService.clearSessionCloseRequested,
    configValue: overrides.configValue || config,
    createSessionFn: overrides.createSessionFn || redisService.createSession,
    decrementTabsFn: overrides.decrementTabsFn || redisService.decrementTabs,
    getSessionFn: overrides.getSessionFn || redisService.getSession,
    incrementTabsFn: overrides.incrementTabsFn || redisService.incrementTabs,
    removeSessionExpiryFn: overrides.removeSessionExpiryFn || redisService.removeSessionExpiry,
    setSessionExpiryFn: overrides.setSessionExpiryFn || redisService.setSessionExpiry,
    updateLastSeenFn: overrides.updateLastSeenFn || redisService.updateLastSeen,
  };
}

// Track grace period timers: sessionId -> timeoutHandle
const graceTimers = new Map();

function cancelGrace(sessionId) {
  if (graceTimers.has(sessionId)) {
    clearTimeout(graceTimers.get(sessionId));
    graceTimers.delete(sessionId);
  }
}

function scheduleGrace(sessionId, io, dependencies = {}) {
  const needsCleanupService = !dependencies.cleanupSessionFn;
  const needsRedisService =
    !dependencies.getSessionFn ||
    !dependencies.removeSessionExpiryFn ||
    !dependencies.setSessionExpiryFn;
  const redisService = needsRedisService ? require('../services/redis') : null;
  const cleanupService = needsCleanupService ? require('../services/cleanup') : null;
  const {
    cleanupSessionFn = cleanupService.cleanupSession,
    configValue = config,
    getSessionFn = redisService.getSession,
    removeSessionExpiryFn = redisService.removeSessionExpiry,
    setSessionExpiryFn = redisService.setSessionExpiry,
  } = dependencies;
  const gracePeriodSeconds = getPresenceGracePeriodSeconds(configValue);

  cancelGrace(sessionId);
  const handle = setTimeout(async () => {
    graceTimers.delete(sessionId);

    const session = await getSessionFn(sessionId);
    if (!session) {
      console.log(`[Presence] Grace period expired for missing session ${sessionId}`);
      return;
    }

    if (session.connectedTabs > 0) {
      await removeSessionExpiryFn(sessionId);
      console.log(`[Presence] Grace expired but session ${sessionId} is active again, skipping cleanup`);
      return;
    }

    const lastSeen = new Date(session.lastSeen);
    const ageSeconds = Math.floor((Date.now() - lastSeen.getTime()) / 1000);
    const recentActivityWindow = gracePeriodSeconds;

    if (ageSeconds <= recentActivityWindow) {
      if (gracePeriodSeconds > 0) {
        await setSessionExpiryFn(sessionId, gracePeriodSeconds);
      }
      console.log(
        `[Presence] Grace expired for session ${sessionId}, but lastSeen is recent (${ageSeconds}s). Extending grace.`
      );
      scheduleGrace(sessionId, io, dependencies);
      return;
    }

    console.log(`[Presence] Grace period expired for session ${sessionId}`);
    await cleanupSessionFn(sessionId);
  }, gracePeriodSeconds * 1000);
  graceTimers.set(sessionId, handle);
}

function registerPresenceHandlers(io, dependencies = {}) {
  const {
    cleanupSessionFn,
    configValue,
    createSessionFn,
    decrementTabsFn,
    getSessionFn,
    incrementTabsFn,
    clearSessionCloseRequestedFn,
    removeSessionExpiryFn,
    setSessionExpiryFn,
    updateLastSeenFn,
  } = buildDependencies(dependencies);
  const gracePeriodSeconds = getPresenceGracePeriodSeconds(configValue);

  io.on('connection', (socket) => {
    void (async () => {
      let sessionId = socket.handshake.auth?.sessionId;
      let shareId;

      try {
        const existing = sessionId ? await getSessionFn(sessionId) : null;
        if (!existing) {
          sessionId = nanoid(12);
          shareId = await createSessionFn(sessionId);
        } else {
          shareId = existing.shareId;
        }

        cancelGrace(sessionId);
        await clearSessionCloseRequestedFn(sessionId);
        await removeSessionExpiryFn(sessionId);

        const tabCount = await incrementTabsFn(sessionId);
        socket.join(`session:${sessionId}`);
        socket.data.sessionId = sessionId;

        socket.emit('session:created', { sessionId, shareId });
        socket.emit('presence:status', { connectedTabs: tabCount });

        console.log(`[Presence] Socket ${socket.id} joined session ${sessionId} (tabs: ${tabCount})`);

        socket.on('presence:ping', async () => {
          await updateLastSeenFn(sessionId);
          socket.emit('presence:pong');
        });

        socket.on('presence:tab-visible', async () => {
          await updateLastSeenFn(sessionId);
        });

        socket.on('presence:tab-hidden', async () => {
          await updateLastSeenFn(sessionId);
        });

        socket.on('file:join', (fileId) => {
          socket.join(`file:${fileId}`);
        });

        socket.on('disconnect', async () => {
          const tabs = await decrementTabsFn(sessionId);
          console.log(`[Presence] Socket ${socket.id} disconnected from session ${sessionId} (tabs: ${tabs})`);

          if (tabs === 0) {
            const latestSession = await getSessionFn(sessionId);
            if (isRecentCloseRequest(latestSession)) {
              console.log(`[Presence] Explicit close detected for session ${sessionId}, cleaning up immediately`);
              await cleanupSessionFn(sessionId);
              return;
            }

            if (gracePeriodSeconds <= 0) {
              console.log(`[Presence] No grace period configured for session ${sessionId}, cleaning up immediately`);
              await cleanupSessionFn(sessionId);
              return;
            }

            await setSessionExpiryFn(sessionId, gracePeriodSeconds);

            io.to(`session:${sessionId}`).emit('session:expiring', {
              secondsLeft: gracePeriodSeconds,
            });

            scheduleGrace(sessionId, io, {
              cleanupSessionFn,
              configValue,
              getSessionFn,
              removeSessionExpiryFn,
              setSessionExpiryFn,
            });
          }
        });
      } catch (err) {
        console.error(`[Presence] Failed to initialize socket ${socket.id}:`, err.message);
        socket.emit('session:error', { message: 'Failed to initialize secure session. Please refresh and try again.' });
        socket.disconnect(true);
      }
    })();
  });
}

module.exports = { registerPresenceHandlers };
