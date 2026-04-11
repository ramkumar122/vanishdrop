import { createRequire } from 'module';
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { assertInfraEnv } from './helpers/loadInfraEnv.js';

assertInfraEnv();

const require = createRequire(import.meta.url);
const { createServer } = require('../src/index');
const cleanupService = require('../src/services/cleanup');
const redisService = require('../src/services/redis');
const storageService = require('../src/services/storage');

const trackedFileIds = new Set();
const trackedShareIds = new Set();
const trackedSessionIds = new Set();
const trackedStorageKeys = new Set();

let app;

function createId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function trackSession(sessionId) {
  trackedSessionIds.add(sessionId);
  return sessionId;
}

function trackFile(fileId) {
  trackedFileIds.add(fileId);
  return fileId;
}

function trackShare(shareId) {
  trackedShareIds.add(shareId);
  return shareId;
}

function trackStorageKey(storageKey) {
  trackedStorageKeys.add(storageKey);
  return storageKey;
}

async function readStreamBody(body) {
  if (!body) {
    return Buffer.alloc(0);
  }

  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray());
  }

  if (typeof body.transformToString === 'function') {
    return Buffer.from(await body.transformToString(), 'utf8');
  }

  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function binaryParser(res, callback) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
  res.on('error', callback);
}

async function putObjectViaPresignedUrl(storageKey, contents, mimeType = 'text/plain') {
  const body = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  const uploadUrl = await storageService.generateUploadUrl(storageKey, mimeType, body.length);

  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`S3 upload failed with status ${response.status}`);
  }
}

async function waitFor(checkFn, { timeoutMs = 10_000, intervalMs = 250 } = {}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await checkFn()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

async function cleanupTrackedState() {
  for (const fileId of trackedFileIds) {
    try {
      await redisService.deleteFile(fileId);
    } catch {
      // Ignore cleanup failures and continue best-effort teardown.
    }
  }

  for (const sessionId of trackedSessionIds) {
    try {
      await redisService.deleteSession(sessionId);
    } catch {
      // Ignore cleanup failures and continue best-effort teardown.
    }
  }

  for (const shareId of trackedShareIds) {
    try {
      await redisService.deleteShare(shareId);
    } catch {
      // Ignore cleanup failures and continue best-effort teardown.
    }
  }

  for (const storageKey of trackedStorageKeys) {
    try {
      await storageService.deleteObject(storageKey);
    } catch {
      // Ignore cleanup failures and continue best-effort teardown.
    }
  }

  trackedFileIds.clear();
  trackedShareIds.clear();
  trackedSessionIds.clear();
  trackedStorageKeys.clear();
}

beforeAll(async () => {
  const instance = createServer({ enableStartupCleanup: false });
  app = instance.app;
  expect(await redisService.redis.ping()).toBe('PONG');
});

afterEach(async () => {
  await cleanupTrackedState();
});

afterAll(async () => {
  await cleanupTrackedState();
  await redisService.redis.quit();
});

describe('production-style infrastructure verification', () => {
  it('manages Redis session lifecycle against the configured Redis instance', async () => {
    const sessionId = trackSession(createId('it-session'));

    const shareId = trackShare(await redisService.createSession(sessionId));

    const created = await redisService.getSession(sessionId);
    expect(created).toMatchObject({
      connectedTabs: 0,
      fileIds: [],
      shareId,
    });

    await redisService.incrementTabs(sessionId);
    await redisService.incrementTabs(sessionId);
    expect((await redisService.getSession(sessionId)).connectedTabs).toBe(2);

    await redisService.decrementTabs(sessionId);
    await redisService.decrementTabs(sessionId);
    await redisService.decrementTabs(sessionId);
    expect((await redisService.getSession(sessionId)).connectedTabs).toBe(0);

    await redisService.setSessionExpiry(sessionId, 120);
    expect(await redisService.redis.ttl(`session:${sessionId}`)).toBeGreaterThan(0);

    await redisService.removeSessionExpiry(sessionId);
    expect(await redisService.redis.ttl(`session:${sessionId}`)).toBe(-1);

    const oldLastSeen = new Date(Date.now() - 90_000).toISOString();
    await redisService.redis.hset(`session:${sessionId}`, {
      connectedTabs: '0',
      lastSeen: oldLastSeen,
    });

    const orphaned = await redisService.scanOrphanedSessions();
    expect(orphaned).toContain(sessionId);
  });

  it('uploads, reads, and deletes a real object in S3', async () => {
    const storageKey = trackStorageKey(`integration-tests/${createId('storage')}/hello.txt`);
    const contents = Buffer.from('hello from direct s3 integration');

    await putObjectViaPresignedUrl(storageKey, contents);

    expect(await storageService.headObject(storageKey)).toBe(true);

    const object = await storageService.getObjectStream(storageKey);
    expect(object.contentLength).toBe(contents.length);
    expect(object.contentType).toBe('text/plain');
    expect(await readStreamBody(object.body)).toEqual(contents);

    await storageService.deleteObject(storageKey);
    trackedStorageKeys.delete(storageKey);

    expect(await storageService.headObject(storageKey)).toBe(false);
  });

  it('completes multi-file share routes against real Redis and S3', async () => {
    const sessionId = trackSession(createId('route-session'));
    const shareId = trackShare(await redisService.createSession(sessionId));
    await redisService.incrementTabs(sessionId);

    const uploads = [
      { fileName: 'route-a.txt', contents: Buffer.from('download me from route a') },
      { fileName: 'route-b.txt', contents: Buffer.from('download me from route b') },
    ];
    const uploadedFileIds = [];

    for (const upload of uploads) {
      const uploadResponse = await request(app)
        .post('/api/upload')
        .send({
          expiryMode: 'presence',
          fileName: upload.fileName,
          fileSize: upload.contents.length,
          mimeType: 'text/plain',
          sessionId,
        })
        .expect(200);

      const { fileId, shareId: returnedShareId, uploadUrl } = uploadResponse.body;
      expect(returnedShareId).toBe(shareId);
      trackFile(fileId);
      uploadedFileIds.push(fileId);

      const uploadedFile = await redisService.getFile(fileId);
      trackStorageKey(uploadedFile.storageKey);

      const putResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: upload.contents,
      });
      expect(putResponse.ok).toBe(true);

      await request(app)
        .post(`/api/upload/${fileId}/complete`)
        .send({ sessionId })
        .expect(200, { status: 'ready' });
    }

    const shareResponse = await request(app).get(`/api/shares/${shareId}`).expect(200);
    expect(shareResponse.body).toMatchObject({
      shareId,
      totalFiles: 2,
    });
    expect(shareResponse.body.files.map((file) => file.fileName).sort()).toEqual(
      uploads.map((upload) => upload.fileName).sort()
    );

    const downloadResponse = await request(app)
      .get(`/api/files/${uploadedFileIds[0]}/download`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);

    expect(downloadResponse.body).toEqual(uploads[0].contents);
    expect(downloadResponse.headers['content-disposition']).toContain("filename*=UTF-8''route-a.txt");

    await waitFor(async () => {
      const active = await redisService.getActiveDownloads(uploadedFileIds[0]);
      return active.length === 0;
    });

    for (const fileId of uploadedFileIds) {
      const uploadedFile = await redisService.getFile(fileId);
      await cleanupService.cleanupFile(fileId);
      trackedFileIds.delete(fileId);
      trackedStorageKeys.delete(uploadedFile.storageKey);
      expect(await redisService.getFile(fileId)).toBeNull();
      expect(await storageService.headObject(uploadedFile.storageKey)).toBe(false);
    }
  });

  it('deletes a scheduled file from Redis and S3 within seconds', async () => {
    const sessionId = trackSession(createId('timed-session'));
    const fileId = trackFile(createId('timed-file'));
    const storageKey = trackStorageKey(`integration-tests/${createId('timed-object')}/soon.txt`);
    const contents = Buffer.from('delete me soon');

    const shareId = trackShare(await redisService.createSession(sessionId));
    await redisService.addFileToSession(sessionId, fileId);
    await redisService.addFileToShare(shareId, fileId);
    await putObjectViaPresignedUrl(storageKey, contents);

    await redisService.createFile(fileId, {
      expiryMode: 'presence',
      fileName: 'soon.txt',
      fileSize: contents.length,
      mimeType: 'text/plain',
      sessionId,
      shareId,
      storageKey,
    });

    cleanupService.scheduleTimedCleanup(fileId, new Date(Date.now() + 1_000).toISOString());

    await waitFor(async () => {
      const file = await redisService.getFile(fileId);
      const existsInS3 = await storageService.headObject(storageKey);
      return file === null && existsInS3 === false;
    }, { timeoutMs: 8_000, intervalMs: 300 });

    trackedFileIds.delete(fileId);
    trackedStorageKeys.delete(storageKey);
    trackedShareIds.delete(shareId);
  });
});
