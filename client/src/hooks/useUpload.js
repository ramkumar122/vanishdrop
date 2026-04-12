import { useState, useCallback } from 'react';
import {
  completeUpload,
  initiateUpload,
  uploadMultipartToS3,
  uploadToS3,
} from '../lib/api.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10GB
const MIN_TIMED_EXPIRY_SECONDS = 60;
const MAX_TIMED_EXPIRY_SECONDS = 24 * 60 * 60;

function initialState() {
  return {
    status: 'idle', // 'idle' | 'uploading' | 'completing' | 'done' | 'error'
    progress: 0,
    bytesUploaded: 0,
    totalBytes: 0,
    error: null,
    shareId: null,
    shareLink: null,
    expiryMode: 'presence',
    completedFiles: 0,
    totalFiles: 0,
    currentFileName: null,
  };
}

function formatFileSizeInGb(bytes) {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

function clampProgress(loadedBytes, totalBytes) {
  if (totalBytes <= 0) {
    return 0;
  }

  const safeLoadedBytes = Math.min(totalBytes, Math.max(0, loadedBytes));
  return Math.min(100, Math.max(0, Math.round((safeLoadedBytes / totalBytes) * 100)));
}

export function useUpload(sessionId) {
  const [state, setState] = useState(initialState);

  const reset = useCallback(() => {
    setState(initialState());
  }, []);

  const uploadFiles = useCallback(
    async (files, expirySelection = { mode: 'presence' }) => {
      if (!sessionId) {
        setState((current) => ({
          ...current,
          status: 'error',
          error: 'No active session. Please wait a moment and try again.',
        }));
        return null;
      }

      if (!Array.isArray(files) || files.length === 0) {
        setState((current) => ({
          ...current,
          status: 'error',
          error: 'Choose at least one file to upload.',
        }));
        return null;
      }

      for (const file of files) {
        if (file.size > MAX_FILE_SIZE) {
          setState((current) => ({
            ...current,
            status: 'error',
            error: `File "${file.name}" is too large. Maximum size is 10GB. Your file is ${formatFileSizeInGb(file.size)}.`,
          }));
          return null;
        }

        if (file.size === 0) {
          setState((current) => ({
            ...current,
            status: 'error',
            error: `File "${file.name}" is empty.`,
          }));
          return null;
        }
      }

      const resolvedExpiryMode = expirySelection?.mode || 'presence';
      const resolvedExpirySeconds =
        resolvedExpiryMode === 'timed' ? Number(expirySelection?.seconds) : null;

      if (resolvedExpiryMode === 'timed') {
        if (!Number.isInteger(resolvedExpirySeconds)) {
          setState((current) => ({
            ...current,
            status: 'error',
            error: 'Choose a valid custom timer before uploading.',
          }));
          return null;
        }

        if (resolvedExpirySeconds < MIN_TIMED_EXPIRY_SECONDS) {
          setState((current) => ({
            ...current,
            status: 'error',
            error: 'Custom timers must be at least 1 minute.',
          }));
          return null;
        }

        if (resolvedExpirySeconds > MAX_TIMED_EXPIRY_SECONDS) {
          setState((current) => ({
            ...current,
            status: 'error',
            error: 'Custom timers can be up to 24 hours.',
          }));
          return null;
        }
      }

      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

      setState((current) => ({
        ...current,
        status: 'uploading',
        progress: 0,
        bytesUploaded: 0,
        totalBytes,
        error: null,
        shareId: null,
        shareLink: null,
        expiryMode: resolvedExpiryMode,
        completedFiles: 0,
        totalFiles: files.length,
        currentFileName: files[0]?.name || null,
      }));

      let uploadedBytesBeforeCurrent = 0;
      let completedFiles = 0;
      let shareId = null;
      let shareLink = null;

      try {
        for (const file of files) {
          const uploadMimeType = file.type || 'application/octet-stream';

          setState((current) => ({
            ...current,
            currentFileName: file.name,
            status: 'uploading',
          }));

          const uploadTarget = await initiateUpload({
            fileName: file.name,
            fileSize: file.size,
            mimeType: uploadMimeType,
            sessionId,
            expiryMode: resolvedExpiryMode,
            expirySeconds: resolvedExpirySeconds,
          });

          if (!shareId) {
            shareId = uploadTarget.shareId;
            shareLink = uploadTarget.shareLink;
          }

          const onProgress = (loaded, total) => {
            const aggregateLoaded = Math.min(totalBytes, uploadedBytesBeforeCurrent + loaded);
            setState((current) => ({
              ...current,
              bytesUploaded: aggregateLoaded,
              progress: clampProgress(aggregateLoaded, totalBytes),
              totalBytes,
            }));
          };

          if (uploadTarget.uploadType === 'multipart') {
            const parts = await uploadMultipartToS3({
              file,
              partSize: uploadTarget.partSize,
              partUrls: uploadTarget.partUrls,
              onProgress,
            });

            setState((current) => ({
              ...current,
              status: 'completing',
            }));

            await completeUpload(uploadTarget.fileId, sessionId, parts);
          } else {
            await uploadToS3(uploadTarget.uploadUrl, file, uploadMimeType, onProgress);

            setState((current) => ({
              ...current,
              status: 'completing',
            }));

            await completeUpload(uploadTarget.fileId, sessionId);
          }

          uploadedBytesBeforeCurrent += file.size;
          completedFiles += 1;

          setState((current) => ({
            ...current,
            bytesUploaded: uploadedBytesBeforeCurrent,
            completedFiles,
            progress: clampProgress(uploadedBytesBeforeCurrent, totalBytes),
            status: completedFiles === files.length ? 'done' : 'uploading',
          }));
        }

        setState((current) => ({
          ...current,
          status: 'done',
          progress: 100,
          bytesUploaded: totalBytes,
          completedFiles,
          currentFileName: null,
          shareId,
          shareLink,
          expiryMode: resolvedExpiryMode,
        }));

        return { shareId, shareLink, expiryMode: resolvedExpiryMode };
      } catch (err) {
        const message = err.response?.data?.error || err.message || 'Upload failed';
        setState((current) => ({
          ...current,
          status: 'error',
          error:
            completedFiles > 0
              ? `${message} ${completedFiles} of ${files.length} file(s) uploaded before the failure.`
              : message,
        }));
        return null;
      }
    },
    [sessionId]
  );

  return { ...state, uploadFiles, reset };
}
