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

export async function completeDownload(fileId, downloadId) {
  const { data } = await api.post(`/files/${fileId}/download/${downloadId}/complete`);
  return data;
}

function parseDownloadFileName(contentDisposition, fallbackFileName) {
  if (!contentDisposition) return fallbackFileName || 'download';

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const quotedMatch = contentDisposition.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  return fallbackFileName || 'download';
}

export async function downloadFile(fileId, fallbackFileName) {
  const response = await fetch(`${BASE_URL}/api/files/${fileId}/download`);

  if (!response.ok) {
    let message = 'Failed to download file';
    try {
      const data = await response.json();
      message = data.error || message;
    } catch {
      // Ignore JSON parsing errors and fall back to the default message.
    }

    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  let blob;
  try {
    blob = await response.blob();
  } catch {
    throw new Error('The person who shared this file set a timer and it has now expired.');
  }

  const objectUrl = window.URL.createObjectURL(blob);
  const fileName = parseDownloadFileName(response.headers.get('Content-Disposition'), fallbackFileName);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
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
