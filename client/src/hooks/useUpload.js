import { useState, useCallback } from 'react';
import { initiateUpload, completeUpload, uploadToS3 } from '../lib/api.js';

const MAX_FILE_SIZE = 104857600; // 100MB

export function useUpload(sessionId) {
  const [state, setState] = useState({
    status: 'idle', // 'idle' | 'uploading' | 'completing' | 'done' | 'error'
    progress: 0,
    bytesUploaded: 0,
    totalBytes: 0,
    error: null,
    fileId: null,
    shareLink: null,
    expiryMode: 'presence',
  });

  const reset = useCallback(() => {
    setState({
      status: 'idle',
      progress: 0,
      bytesUploaded: 0,
      totalBytes: 0,
      error: null,
      fileId: null,
      shareLink: null,
      expiryMode: 'presence',
    });
  }, []);

  const upload = useCallback(
    async (file, expiryMode = 'presence') => {
      if (!sessionId) {
        setState((s) => ({ ...s, status: 'error', error: 'No active session. Please wait a moment and try again.' }));
        return null;
      }

      if (file.size > MAX_FILE_SIZE) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: `File is too large. Maximum size is 100MB. Your file is ${(file.size / 1024 / 1024).toFixed(1)}MB.`,
        }));
        return null;
      }

      if (file.size === 0) {
        setState((s) => ({ ...s, status: 'error', error: 'File is empty.' }));
        return null;
      }

      setState((s) => ({
        ...s,
        status: 'uploading',
        progress: 0,
        bytesUploaded: 0,
        totalBytes: file.size,
        error: null,
      }));

      try {
        const { fileId, uploadUrl, shareLink } = await initiateUpload({
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || 'application/octet-stream',
          sessionId,
          expiryMode,
        });

        await uploadToS3(uploadUrl, file, (pct, loaded, total) => {
          setState((s) => ({
            ...s,
            progress: pct,
            bytesUploaded: loaded,
            totalBytes: total,
          }));
        });

        setState((s) => ({ ...s, status: 'completing' }));

        await completeUpload(fileId, sessionId);

        setState((s) => ({
          ...s,
          status: 'done',
          progress: 100,
          fileId,
          shareLink,
          expiryMode,
        }));

        return { fileId, shareLink, expiryMode };
      } catch (err) {
        const message = err.response?.data?.error || err.message || 'Upload failed';
        setState((s) => ({ ...s, status: 'error', error: message }));
        return null;
      }
    },
    [sessionId]
  );

  return { ...state, upload, reset };
}
