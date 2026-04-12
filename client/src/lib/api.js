import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || '';
const DEFAULT_API_TIMEOUT_MS = 10_000;
const COMPLETE_UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const MULTIPART_PART_UPLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const MULTIPART_MAX_CONCURRENCY = 4;
const MULTIPART_MAX_RETRIES = 3;

const api = axios.create({
  baseURL: `${BASE_URL}/api`,
  timeout: DEFAULT_API_TIMEOUT_MS,
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
  const { data } = await api.post(
    `/upload/${fileId}/complete`,
    { sessionId, parts },
    { timeout: COMPLETE_UPLOAD_TIMEOUT_MS }
  );
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
    xhr.timeout = MULTIPART_PART_UPLOAD_TIMEOUT_MS;

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
    xhr.addEventListener('timeout', () => reject(new Error('Multipart upload timed out')));

    xhr.open('PUT', uploadUrl);
    xhr.send(blob);
  });
}

async function uploadMultipartPartWithRetry(part, onProgress) {
  let lastError;

  for (let attempt = 1; attempt <= MULTIPART_MAX_RETRIES; attempt += 1) {
    try {
      onProgress?.(0, part.chunk.size);
      return await uploadPartToS3(part.uploadUrl, part.chunk, onProgress);
    } catch (error) {
      lastError = error;

      if (attempt === MULTIPART_MAX_RETRIES) {
        break;
      }
    }
  }

  throw lastError;
}

export async function uploadMultipartToS3({ file, partSize, partUrls, onProgress }) {
  const completedParts = [];
  const parts = partUrls.map((part) => {
    const start = (part.partNumber - 1) * partSize;
    const end = Math.min(start + partSize, file.size);

    return {
      ...part,
      chunk: file.slice(start, end),
    };
  });
  const loadedByPart = new Map(parts.map((part) => [part.partNumber, 0]));
  let nextIndex = 0;

  const reportProgress = () => {
    let totalLoaded = 0;

    for (const part of parts) {
      totalLoaded += loadedByPart.get(part.partNumber) || 0;
    }

    onProgress?.(Math.min(file.size, totalLoaded), file.size);
  };

  const worker = async () => {
    while (nextIndex < parts.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      const part = parts[currentIndex];
      const etag = await uploadMultipartPartWithRetry(part, (loaded) => {
        loadedByPart.set(part.partNumber, Math.min(part.chunk.size, loaded));
        reportProgress();
      });

      loadedByPart.set(part.partNumber, part.chunk.size);
      reportProgress();

      completedParts.push({
        ETag: etag,
        PartNumber: part.partNumber,
      });
    }
  };

  const workerCount = Math.min(MULTIPART_MAX_CONCURRENCY, parts.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return completedParts.sort((a, b) => a.PartNumber - b.PartNumber);
}

export default api;
