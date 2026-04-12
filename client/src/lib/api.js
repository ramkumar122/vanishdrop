import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || '';

const api = axios.create({
  baseURL: `${BASE_URL}/api`,
  timeout: 10000,
});

export async function initiateUpload({
  fileName,
  fileSize,
  mimeType,
  sessionId,
  expiryMode = 'presence',
  expirySeconds,
}) {
  const { data } = await api.post('/upload', {
    fileName,
    fileSize,
    mimeType,
    sessionId,
    expiryMode,
    ...(expirySeconds ? { expirySeconds } : {}),
  });
  return data;
}

export async function completeUpload(fileId, sessionId, parts = []) {
  const { data } = await api.post(`/upload/${fileId}/complete`, { sessionId, parts });
  return data;
}

export async function getFileInfo(fileId) {
  const { data } = await api.get(`/files/${fileId}`);
  return data;
}

export async function getShareFiles(shareId) {
  const { data } = await api.get(`/shares/${shareId}`);
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

export async function uploadToS3(uploadUrl, file, mimeType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        onProgress?.(e.loaded, e.total);
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
    xhr.setRequestHeader('Content-Type', mimeType);
    xhr.send(file);
  });
}

function uploadPartToS3(uploadUrl, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        onProgress?.(e.loaded, e.total);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag');
        if (!etag) {
          reject(new Error('Missing upload ETag from S3 multipart response'));
          return;
        }

        resolve(etag);
      } else {
        reject(new Error(`S3 multipart upload failed with status ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error during multipart upload')));
    xhr.addEventListener('abort', () => reject(new Error('Multipart upload aborted')));

    xhr.open('PUT', uploadUrl);
    xhr.send(blob);
  });
}

export async function uploadMultipartToS3({ file, partSize, partUrls, onProgress }) {
  const completedParts = [];
  let uploadedBytes = 0;

  for (const part of partUrls) {
    const start = (part.partNumber - 1) * partSize;
    const end = Math.min(start + partSize, file.size);
    const chunk = file.slice(start, end);

    const etag = await uploadPartToS3(part.uploadUrl, chunk, (loaded) => {
      onProgress?.(uploadedBytes + loaded, file.size);
    });

    uploadedBytes += chunk.size;
    onProgress?.(uploadedBytes, file.size);

    completedParts.push({
      ETag: etag,
      PartNumber: part.partNumber,
    });
  }

  return completedParts;
}

export default api;
