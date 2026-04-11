import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import FileInfo from '../components/FileInfo.jsx';
import { downloadFile, getShareFiles } from '../lib/api.js';
import { useSocket } from '../hooks/useSocket.js';
import { formatFileSize } from '../lib/utils.js';

function ExpiryInfo({ file }) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    if (!file.expiresAt || file.expiryMode === 'presence') {
      return undefined;
    }

    function update() {
      const diff = new Date(file.expiresAt) - new Date();
      if (diff <= 0) {
        setTimeLeft('Expiring now');
        return;
      }

      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`);
    }

    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [file.expiresAt, file.expiryMode]);

  if (file.expiryMode === 'presence') {
    return (
      <p className="text-xs text-gray-500 mt-2">
        Vanishes when the uploader closes their tab.
      </p>
    );
  }

  return (
    <p className="text-xs text-indigo-400 mt-2">
      Auto-deletes in {timeLeft}
    </p>
  );
}

export default function DownloadPage() {
  const { shareId } = useParams();
  const { on, joinRoom } = useSocket();
  const [files, setFiles] = useState([]);
  const [selectedFileIds, setSelectedFileIds] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [vanishReason, setVanishReason] = useState(null);
  const [downloadError, setDownloadError] = useState(null);
  const [downloadingIds, setDownloadingIds] = useState([]);

  const refreshShare = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoadState('loading');
    }

    try {
      const data = await getShareFiles(shareId);
      setFiles(data.files);
      setLoadState('available');
      setVanishReason(null);
      setSelectedFileIds((current) => current.filter((fileId) => data.files.some((file) => file.fileId === fileId)));
    } catch (err) {
      const message = err.response?.data?.error;
      if (err.response?.status === 410) {
        setVanishReason(message || 'The files in this share are no longer available.');
        setLoadState('vanished');
        setFiles([]);
        setSelectedFileIds([]);
        return;
      }

      setLoadState('notfound');
      setFiles([]);
      setSelectedFileIds([]);
    }
  }, [shareId]);

  useEffect(() => {
    void refreshShare(true);
  }, [refreshShare]);

  useEffect(() => {
    if (files.length === 0) {
      return undefined;
    }

    for (const file of files) {
      joinRoom(file.fileId);
    }

    const offDeleted = on('file:deleted', ({ fileId }) => {
      setFiles((current) => {
        const next = current.filter((file) => file.fileId !== fileId);
        if (next.length === 0) {
          setVanishReason('The uploader closed their tab, so these files are no longer available.');
          setLoadState('vanished');
        }
        return next;
      });
      setSelectedFileIds((current) => current.filter((selectedId) => selectedId !== fileId));
      setDownloadingIds((current) => current.filter((selectedId) => selectedId !== fileId));
    });

    return () => offDeleted?.();
  }, [files, joinRoom, on]);

  const totalBytes = useMemo(
    () => files.reduce((sum, file) => sum + file.fileSize, 0),
    [files]
  );

  async function downloadOne(file) {
    try {
      setDownloadError(null);
      setDownloadingIds((current) => (current.includes(file.fileId) ? current : [...current, file.fileId]));
      await downloadFile(file.fileId, file.fileName);
    } catch (err) {
      const message = err.message || 'Failed to download file';
      if (message.toLowerCase().includes('expired') || message.toLowerCase().includes('closed their tab')) {
        setVanishReason(message);
        setLoadState('vanished');
        setFiles([]);
        setSelectedFileIds([]);
        return;
      }

      setDownloadError(message);
    } finally {
      setDownloadingIds((current) => current.filter((fileId) => fileId !== file.fileId));
    }
  }

  async function handleDownloadSelected() {
    const selectedFiles = files.filter((file) => selectedFileIds.includes(file.fileId));
    for (const file of selectedFiles) {
      await downloadOne(file);
    }
  }

  function toggleSelected(fileId) {
    setSelectedFileIds((current) =>
      current.includes(fileId)
        ? current.filter((selectedId) => selectedId !== fileId)
        : [...current, fileId]
    );
  }

  if (loadState === 'loading') {
    return (
      <div className="w-full max-w-lg animate-fade-in">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center">
          <div className="text-4xl mb-4 opacity-50">⏳</div>
          <p className="text-gray-400">Loading shared files…</p>
        </div>
      </div>
    );
  }

  if (loadState === 'notfound' || loadState === 'vanished') {
    return (
      <div className="w-full max-w-lg animate-fade-in text-center">
        <div className="text-6xl mb-4">💨</div>
        <h2 className="text-2xl font-bold text-white mb-2">This share has vanished</h2>
        <p className="text-gray-400 mb-6">
          {loadState === 'vanished'
            ? (vanishReason || 'The files were deleted. The timer expired or the uploader closed their tab.')
            : 'The shared link you are looking for no longer exists.'}
        </p>
        <a href="/" className="text-indigo-400 hover:text-indigo-300 underline">
          Share your own files
        </a>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl animate-fade-in">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
              </span>
              <span className="text-green-400 text-sm font-medium">Files available to download</span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {files.length} file{files.length === 1 ? '' : 's'} · {formatFileSize(totalBytes)} total
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setSelectedFileIds(files.map((file) => file.fileId))}
              className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
            >
              Select All
            </button>
            <button
              onClick={() => setSelectedFileIds([])}
              className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
            >
              Clear
            </button>
            <button
              onClick={handleDownloadSelected}
              disabled={selectedFileIds.length === 0 || downloadingIds.length > 0}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              Download Selected
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {files.map((file) => {
            const isSelected = selectedFileIds.includes(file.fileId);
            const isDownloading = downloadingIds.includes(file.fileId);

            return (
              <div key={file.fileId} className="bg-gray-800/30 border border-gray-700 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelected(file.fileId)}
                    className="mt-3 h-4 w-4 rounded border-gray-600 bg-gray-900 text-indigo-500 focus:ring-indigo-500"
                    aria-label={`Select ${file.fileName}`}
                  />

                  <div className="flex-1 min-w-0">
                    <FileInfo
                      fileName={file.fileName}
                      fileSize={file.fileSize}
                      mimeType={file.mimeType}
                    />
                    <ExpiryInfo file={file} />
                  </div>

                  <button
                    onClick={() => downloadOne(file)}
                    disabled={isDownloading}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold rounded-xl transition-colors"
                  >
                    {isDownloading ? 'Downloading…' : 'Download'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {downloadError && (
          <p className="text-sm text-red-400 text-center">{downloadError}</p>
        )}
      </div>
    </div>
  );
}
