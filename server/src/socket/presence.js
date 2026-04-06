const { nanoid } = require('nanoid');
const {
  createSession,
  getSession,
  incrementTabs,
  decrementTabs,
  updateLastSeen,
  setSessionExpiry,
  removeSessionExpiry,
} = require('../services/redis');
const { cleanupSession } = require('../services/cleanup');
const config = require('../config');

// Track grace period timers: sessionId -> timeoutHandle
const graceTimers = new Map();

function cancelGrace(sessionId) {
  if (graceTimers.has(sessionId)) {
    clearTimeout(graceTimers.get(sessionId));
    graceTimers.delete(sessionId);
  }
}

function scheduleGrace(sessionId, io) {
  cancelGrace(sessionId);
  const handle = setTimeout(async () => {
    graceTimers.delete(sessionId);
    console.log(`[Presence] Grace period expired for session ${sessionId}`);
    await cleanupSession(sessionId);
  }, config.limits.sessionGracePeriod * 1000);
  graceTimers.set(sessionId, handle);
}

function registerPresenceHandlers(io) {
  io.on('connection', async (socket) => {
    let sessionId = socket.handshake.auth?.sessionId;

    // Create or resume session
    const existing = sessionId ? await getSession(sessionId) : null;
    if (!existing) {
      sessionId = nanoid(12);
      await createSession(sessionId);
    }

    // Cancel any grace period for this session (e.g. page refresh reconnect)
    cancelGrace(sessionId);
    await removeSessionExpiry(sessionId);

    const tabCount = await incrementTabs(sessionId);
    socket.join(`session:${sessionId}`);
    socket.data.sessionId = sessionId;

    socket.emit('session:created', { sessionId });
    socket.emit('presence:status', { connectedTabs: tabCount });

    console.log(`[Presence] Socket ${socket.id} joined session ${sessionId} (tabs: ${tabCount})`);

    socket.on('presence:ping', async () => {
      await updateLastSeen(sessionId);
      socket.emit('presence:pong');
    });

    socket.on('presence:tab-visible', async () => {
      await updateLastSeen(sessionId);
    });

    socket.on('presence:tab-hidden', async () => {
      await updateLastSeen(sessionId);
    });

    socket.on('file:join', (fileId) => {
      socket.join(`file:${fileId}`);
    });

    socket.on('disconnect', async () => {
      const tabs = await decrementTabs(sessionId);
      console.log(`[Presence] Socket ${socket.id} disconnected from session ${sessionId} (tabs: ${tabs})`);

      if (tabs === 0) {
        await setSessionExpiry(sessionId, config.limits.sessionGracePeriod + 5);

        // Warn any remaining clients
        io.to(`session:${sessionId}`).emit('session:expiring', {
          secondsLeft: config.limits.sessionGracePeriod,
        });

        scheduleGrace(sessionId, io);
      }
    });
  });
}

module.exports = { registerPresenceHandlers };
