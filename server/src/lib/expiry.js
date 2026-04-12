const LEGACY_EXPIRY_SECONDS = {
  '1h': 3600,
  '4h': 14400,
  '24h': 86400,
};

const MIN_TIMED_EXPIRY_SECONDS = 60;
const MAX_TIMED_EXPIRY_SECONDS = 86400;
const VALID_EXPIRY_MODES = ['presence', 'timed', ...Object.keys(LEGACY_EXPIRY_SECONDS)];

class InvalidExpirySelectionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidExpirySelectionError';
  }
}

function resolveExpirySelection({ expiryMode = 'presence', expirySeconds } = {}) {
  if (expiryMode === 'presence' || expiryMode === undefined || expiryMode === null || expiryMode === '') {
    return {
      expiresAt: '',
      expiryMode: 'presence',
      ttlSeconds: null,
    };
  }

  if (LEGACY_EXPIRY_SECONDS[expiryMode]) {
    const ttlSeconds = LEGACY_EXPIRY_SECONDS[expiryMode];
    return {
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      expiryMode: 'timed',
      ttlSeconds,
    };
  }

  if (expiryMode !== 'timed') {
    throw new InvalidExpirySelectionError(`expiryMode must be one of: ${VALID_EXPIRY_MODES.join(', ')}`);
  }

  const ttlSeconds = Number(expirySeconds);
  if (!Number.isInteger(ttlSeconds)) {
    throw new InvalidExpirySelectionError('expirySeconds must be an integer number of seconds');
  }

  if (ttlSeconds < MIN_TIMED_EXPIRY_SECONDS) {
    throw new InvalidExpirySelectionError(
      `expirySeconds must be at least ${MIN_TIMED_EXPIRY_SECONDS} seconds`
    );
  }

  if (ttlSeconds > MAX_TIMED_EXPIRY_SECONDS) {
    throw new InvalidExpirySelectionError(
      `expirySeconds must be at most ${MAX_TIMED_EXPIRY_SECONDS} seconds`
    );
  }

  return {
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    expiryMode: 'timed',
    ttlSeconds,
  };
}

module.exports = {
  INVALID_EXPIRY_MESSAGE: `expiryMode must be one of: ${VALID_EXPIRY_MODES.join(', ')}`,
  InvalidExpirySelectionError,
  LEGACY_EXPIRY_SECONDS,
  MAX_TIMED_EXPIRY_SECONDS,
  MIN_TIMED_EXPIRY_SECONDS,
  VALID_EXPIRY_MODES,
  resolveExpirySelection,
};
