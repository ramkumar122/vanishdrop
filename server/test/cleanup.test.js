import { createRequire } from 'module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

const cleanupPath = require.resolve('../src/services/cleanup');
const downloadsPath = require.resolve('../src/services/downloads');
const redisPath = require.resolve('../src/services/redis');
const storagePath = require.resolve('../src/services/storage');

const originalCleanupModule = require.cache[cleanupPath];
const originalDownloadsModule = require.cache[downloadsPath];
const originalRedisModule = require.cache[redisPath];
const originalStorageModule = require.cache[storagePath];

function setMockModule(modulePath, exports) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
  };
}

function restoreModule(modulePath, originalModule) {
  if (originalModule) {
    require.cache[modulePath] = originalModule;
    return;
  }

  delete require.cache[modulePath];
}

describe('cleanupService', () => {
  let cleanupService;
  let downloadMocks;
  let redisMocks;
  let storageMocks;

  beforeEach(() => {
    vi.useFakeTimers();

    downloadMocks = {
      abortActiveDownloads: vi.fn().mockReturnValue(0),
    };

    redisMocks = {
      clearActiveDownloads: vi.fn().mockResolvedValue(undefined),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      getFile: vi.fn().mockResolvedValue({
        fileId: 'file-123',
        shareId: 'share-123',
        status: 'ready',
        storageKey: 'uploads/file-123/demo.txt',
      }),
      getSession: vi.fn().mockResolvedValue(null),
      removeFileFromShare: vi.fn().mockResolvedValue(undefined),
      scanOrphanedSessions: vi.fn().mockResolvedValue([]),
      scanPendingDeletionFiles: vi.fn().mockResolvedValue([]),
      updateFileStatus: vi.fn().mockResolvedValue(undefined),
    };

    storageMocks = {
      deleteObject: vi.fn(),
    };

    setMockModule(downloadsPath, downloadMocks);
    setMockModule(redisPath, redisMocks);
    setMockModule(storagePath, storageMocks);
    delete require.cache[cleanupPath];

    cleanupService = require('../src/services/cleanup');
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreModule(cleanupPath, originalCleanupModule);
    restoreModule(downloadsPath, originalDownloadsModule);
    restoreModule(redisPath, originalRedisModule);
    restoreModule(storagePath, originalStorageModule);
  });

  it('keeps metadata until a scheduled retry deletes the S3 object', async () => {
    storageMocks.deleteObject
      .mockRejectedValueOnce(new Error('temporary S3 failure'))
      .mockResolvedValueOnce(undefined);

    const firstAttempt = await cleanupService.cleanupFile('file-123', 1);

    expect(firstAttempt).toBe(false);
    expect(redisMocks.updateFileStatus).toHaveBeenNthCalledWith(1, 'file-123', 'deleting');
    expect(redisMocks.updateFileStatus).toHaveBeenNthCalledWith(2, 'file-123', 'delete_failed');
    expect(redisMocks.deleteFile).not.toHaveBeenCalled();
    expect(redisMocks.removeFileFromShare).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30000);

    expect(storageMocks.deleteObject).toHaveBeenCalledTimes(2);
    expect(redisMocks.deleteFile).toHaveBeenCalledWith('file-123');
    expect(redisMocks.removeFileFromShare).toHaveBeenCalledWith('share-123', 'file-123');
  });
});
