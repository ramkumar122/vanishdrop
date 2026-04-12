// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUpload } from './useUpload.js';
import {
  completeUpload,
  initiateUpload,
  uploadMultipartToS3,
  uploadToS3,
} from '../lib/api.js';

vi.mock('../lib/api.js', () => ({
  completeUpload: vi.fn(),
  initiateUpload: vi.fn(),
  uploadMultipartToS3: vi.fn(),
  uploadToS3: vi.fn(),
}));

describe('useUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(uploadMultipartToS3).mockResolvedValue([]);
    vi.mocked(uploadToS3).mockResolvedValue(undefined);
    vi.mocked(completeUpload).mockResolvedValue({ status: 'ready' });
  });

  it('uses the same MIME fallback for presigning and uploading files with no browser MIME type', async () => {
    vi.mocked(initiateUpload)
      .mockResolvedValueOnce({
        fileId: 'file-1',
        shareId: 'share-123',
        shareLink: 'https://vanishdrop.app/d/share-123',
        uploadType: 'single',
        uploadUrl: 'https://example.com/upload/file-1',
      })
      .mockResolvedValueOnce({
        fileId: 'file-2',
        shareId: 'share-123',
        shareLink: 'https://vanishdrop.app/d/share-123',
        uploadType: 'single',
        uploadUrl: 'https://example.com/upload/file-2',
      });

    const unknownTypeFile = new File(['# notes'], 'README.md', { type: '' });
    const knownTypeFile = new File(['<html></html>'], 'dashboard.html', { type: 'text/html' });

    const { result } = renderHook(() => useUpload('session-123'));

    let uploadResult;
    await act(async () => {
      uploadResult = await result.current.uploadFiles([unknownTypeFile, knownTypeFile], {
        mode: 'presence',
      });
    });

    expect(initiateUpload).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        fileName: 'README.md',
        mimeType: 'application/octet-stream',
      })
    );
    expect(uploadToS3).toHaveBeenNthCalledWith(
      1,
      'https://example.com/upload/file-1',
      unknownTypeFile,
      'application/octet-stream',
      expect.any(Function)
    );

    expect(initiateUpload).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        fileName: 'dashboard.html',
        mimeType: 'text/html',
      })
    );
    expect(uploadToS3).toHaveBeenNthCalledWith(
      2,
      'https://example.com/upload/file-2',
      knownTypeFile,
      'text/html',
      expect.any(Function)
    );

    expect(completeUpload).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('done');
    expect(uploadResult).toEqual({
      shareId: 'share-123',
      shareLink: 'https://vanishdrop.app/d/share-123',
      expiryMode: 'presence',
    });
  });
});
