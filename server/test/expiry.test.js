import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  InvalidExpirySelectionError,
  MAX_TIMED_EXPIRY_SECONDS,
  MIN_TIMED_EXPIRY_SECONDS,
  resolveExpirySelection,
} = require('../src/lib/expiry');

describe('expiry selection', () => {
  it('keeps presence uploads without an expiresAt timestamp', () => {
    expect(resolveExpirySelection({ expiryMode: 'presence' })).toEqual({
      expiresAt: '',
      expiryMode: 'presence',
      ttlSeconds: null,
    });
  });

  it('normalizes a custom timed upload to timed mode', () => {
    const resolved = resolveExpirySelection({
      expiryMode: 'timed',
      expirySeconds: 5400,
    });

    expect(resolved.expiryMode).toBe('timed');
    expect(resolved.ttlSeconds).toBe(5400);
    expect(new Date(resolved.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('keeps legacy expiry values working for older clients', () => {
    const resolved = resolveExpirySelection({ expiryMode: '1h' });

    expect(resolved.expiryMode).toBe('timed');
    expect(resolved.ttlSeconds).toBe(3600);
  });

  it('rejects timed uploads outside the supported range', () => {
    expect(() =>
      resolveExpirySelection({
        expiryMode: 'timed',
        expirySeconds: MIN_TIMED_EXPIRY_SECONDS - 1,
      })
    ).toThrow(InvalidExpirySelectionError);

    expect(() =>
      resolveExpirySelection({
        expiryMode: 'timed',
        expirySeconds: MAX_TIMED_EXPIRY_SECONDS + 1,
      })
    ).toThrow(InvalidExpirySelectionError);
  });
});
