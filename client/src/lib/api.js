import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || '';

const api = axios.create({
  baseURL: `${BASE_URL}/api`,
  timeout: 10000,
});

export async function initiateUpload({ fileName, fileSize, mimeType, sessionId, expiryMode = 'presence' }) {
  const { data } = await api.post('/upload', { fileName, fileSize, mimeType, sessionId, expiryMode });
  return data;
}

export async function completeUpload(fileId, sessionId) {
  const { data } = await api.post(`/upload/${fileId}/complete`, { sessionId });
  return data;
}

export async function getFileInfo(fileId) {
  const { data } = await api.get(`/files/${fileId}`);
  return data;
}

export async function getDownloadUrl(fileId) {
  const { data } = await api.get(`/files/${fileId}/download`);
  return data;
}

export async function uploadToS3(uploadUrl, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        onProgress?.(pct, e.loaded, e.total);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`S3 upload failed with status ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.send(file);
  });
}

export default api;
