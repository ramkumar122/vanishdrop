const config = require('../config');
const CLOSE_REQUEST_WINDOW_MS = 5000;

function getPresenceGracePeriodSeconds(configValue = config) {
  const seconds = Number(configValue?.limits?.sessionGracePeriod);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return 0;
  }

  return seconds;
}

function isRecentCloseRequest(session) {
  if (!session?.closeRequestedAt) {
    return false;
  }

  const closeRequestedAt = new Date(session.closeRequestedAt).getTime();
  if (Number.isNaN(closeRequestedAt)) {
    return false;
  }

  return Date.now() - closeRequestedAt <= CLOSE_REQUEST_WINDOW_MS;
}

function isSessionWithinGracePeriod(session, configValue = config) {
  if (!session) {
    return false;
  }

  if (session.connectedTabs > 0) {
    return true;
  }

  if (isRecentCloseRequest(session)) {
    return false;
  }

  if (!session.lastSeen) {
    return false;
  }

  const lastSeen = new Date(session.lastSeen).getTime();
  if (Number.isNaN(lastSeen)) {
    return false;
  }

  const graceWindowMs = getPresenceGracePeriodSeconds(configValue) * 1000;
  return Date.now() - lastSeen <= graceWindowMs;
}

function getPresenceUnavailableMessage(resourceName = 'file') {
  return `The uploader closed their tab, so this ${resourceName} is no longer available.`;
}

module.exports = {
  getPresenceGracePeriodSeconds,
  isRecentCloseRequest,
  isSessionWithinGracePeriod,
  getPresenceUnavailableMessage,
};
