const activeDownloads = new Map();

function registerActiveDownload(fileId, downloadId, abort) {
  if (!activeDownloads.has(fileId)) {
    activeDownloads.set(fileId, new Map());
  }

  activeDownloads.get(fileId).set(downloadId, abort);
}

function unregisterActiveDownload(fileId, downloadId) {
  const fileDownloads = activeDownloads.get(fileId);
  if (!fileDownloads) return;

  fileDownloads.delete(downloadId);

  if (fileDownloads.size === 0) {
    activeDownloads.delete(fileId);
  }
}

function abortActiveDownloads(fileId, reason) {
  const fileDownloads = activeDownloads.get(fileId);
  if (!fileDownloads) return 0;

  const aborts = Array.from(fileDownloads.values());
  activeDownloads.delete(fileId);

  for (const abort of aborts) {
    try {
      abort(reason);
    } catch (err) {
      console.error('[Downloads] Failed to abort active download:', err.message);
    }
  }

  return aborts.length;
}

module.exports = {
  registerActiveDownload,
  unregisterActiveDownload,
  abortActiveDownloads,
};
