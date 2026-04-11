import { useState, useCallback } from 'react';
import {
  completeUpload,
  initiateUpload,
  uploadMultipartToS3,
  uploadToS3,
} from '../lib/api.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10GB

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

export function useUpload(sessionId) {
  const [state, setState] = useState(initialState);

  const reset = useCallback(() => {
    setState(initialState());
  }, []);

  const uploadFiles = useCallback(
    async (files, expiryMode = 'presence') => {
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
        expiryMode,
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
          setState((current) => ({
            ...current,
            currentFileName: file.name,
            status: 'uploading',
          }));

          const uploadTarget = await initiateUpload({
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || 'application/octet-stream',
            sessionId,
            expiryMode,
          });

          if (!shareId) {
            shareId = uploadTarget.shareId;
            shareLink = uploadTarget.shareLink;
          }

          const onProgress = (loaded, total) => {
            const aggregateLoaded = uploadedBytesBeforeCurrent + loaded;
            setState((current) => ({
              ...current,
              bytesUploaded: aggregateLoaded,
              progress: totalBytes === 0 ? 0 : Math.round((aggregateLoaded / totalBytes) * 100),
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
            await uploadToS3(uploadTarget.uploadUrl, file, onProgress);

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
            progress: totalBytes === 0 ? 0 : Math.round((uploadedBytesBeforeCurrent / totalBytes) * 100),
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
          expiryMode,
        }));

        return { shareId, shareLink, expiryMode };
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
