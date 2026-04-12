import { createRequire } from 'module';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const express = require('express');

const uploadRoutePath = require.resolve('../src/routes/upload');
const redisPath = require.resolve('../src/services/redis');
const storagePath = require.resolve('../src/services/storage');

const originalUploadRouteModule = require.cache[uploadRoutePath];
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

describe('upload route', () => {
  let app;
  let redisMocks;
  let storageMocks;

  beforeEach(() => {
    redisMocks = {
      addFileToSession: vi.fn().mockResolvedValue(undefined),
      addFileToShare: vi.fn().mockResolvedValue(undefined),
      createFile: vi.fn().mockResolvedValue(undefined),
      getFile: vi.fn().mockResolvedValue(null),
      getSession: vi.fn().mockResolvedValue({ shareId: 'share-test-123' }),
      updateFileStatus: vi.fn().mockResolvedValue(undefined),
    };

    storageMocks = {
      MAX_SINGLE_UPLOAD_SIZE: 100 * 1024 * 1024,
      completeMultipartUpload: vi.fn().mockResolvedValue(undefined),
      createMultipartUploadPlan: vi.fn().mockResolvedValue({
        uploadId: 'multipart-upload-id',
        uploadType: 'multipart',
        partSize: 64 * 1024 * 1024,
        partUrls: [{ partNumber: 1, uploadUrl: 'https://example.com/part-1' }],
      }),
      generateUploadUrl: vi.fn().mockResolvedValue('https://example.com/single-put'),
      headObject: vi.fn().mockResolvedValue(true),
    };

    setMockModule(redisPath, redisMocks);
    setMockModule(storagePath, storageMocks);
    delete require.cache[uploadRoutePath];

    const uploadRoutes = require('../src/routes/upload');
    app = express();
    app.use(express.json());
    app.use('/api/upload', uploadRoutes);
  });

  afterEach(() => {
    restoreModule(uploadRoutePath, originalUploadRouteModule);
    restoreModule(redisPath, originalRedisModule);
    restoreModule(storagePath, originalStorageModule);
  });

  it('uses multipart uploads for files over the browser-safe threshold', async () => {
    const response = await request(app)
      .post('/api/upload')
      .send({
        expiryMode: 'presence',
        fileName: 'large-video.bin',
        fileSize: 1024 * 1024 * 1024,
        mimeType: 'application/octet-stream',
        sessionId: 'session-123',
      })
      .expect(200);

    expect(storageMocks.createMultipartUploadPlan).toHaveBeenCalledTimes(1);
    expect(storageMocks.generateUploadUrl).not.toHaveBeenCalled();
    expect(response.body.uploadType).toBe('multipart');
  });
});
