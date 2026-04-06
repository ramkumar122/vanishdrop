import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSocket } from '../hooks/useSocket.js';
import FileInfo from '../components/FileInfo.jsx';
import { completeDownload, getFileInfo, getDownloadUrl } from '../lib/api.js';

// loadState: 'loading' | 'available' | 'downloading' | 'vanished' | 'notfound'

function ExpiryInfo({ expiryMode, expiresAt }) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    if (!expiresAt) return;
    function update() {
      const diff = new Date(expiresAt) - new Date();
      if (diff <= 0) { setTimeLeft('Expiring now'); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`);
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (expiryMode === 'presence') {
    return (
      <p className="text-xs text-gray-600 text-center">
        This file will disappear when the uploader closes their tab.
      </p>
    );
  }

  return (
    <p className="text-xs text-gray-500 text-center">
      Auto-deletes in <span className="text-indigo-400 font-medium">{timeLeft}</span>
    </p>
  );
}

export default function DownloadPage() {
  const { fileId } = useParams();
  const { on, joinRoom } = useSocket();
  const [fileInfo, setFileInfo] = useState(null);
  const [loadState, setLoadState] = useState('loading');

  useEffect(() => {
    getFileInfo(fileId)
      .then((data) => {
        setFileInfo(data);
        setLoadState('available');
      })
      .catch(() => {
        setLoadState('notfound');
      });
  }, [fileId]);

  useEffect(() => {
    joinRoom(fileId);
    const off = on('file:deleted', ({ fileId: fid }) => {
      if (fid === fileId) setLoadState('vanished');
    });
    return () => off?.();
  }, [fileId, joinRoom, on]);

  async function handleDownload() {
    try {
      setLoadState('downloading');
      const { downloadUrl, downloadId } = await getDownloadUrl(fileId);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = fileInfo?.fileName || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      window.setTimeout(() => {
        completeDownload(fileId, downloadId).catch(() => {});
      }, 5000);

      setLoadState('available');
    } catch {
      setLoadState('vanished');
    }
  }

  if (loadState === 'loading') {
    return (
      <div className="w-full max-w-lg animate-fade-in">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center">
          <div className="text-4xl mb-4 opacity-50">⏳</div>
          <p className="text-gray-400">Loading file…</p>
        </div>
      </div>
    );
  }

  if (loadState === 'notfound' || loadState === 'vanished') {
    return (
      <div className="w-full max-w-lg animate-fade-in text-center">
        <div className="text-6xl mb-4">💨</div>
        <h2 className="text-2xl font-bold text-white mb-2">This file has vanished</h2>
        <p className="text-gray-400 mb-6">
          {loadState === 'vanished'
            ? 'The file was deleted. The timer expired or the uploader closed their tab.'
            : "The file you're looking for no longer exists. It may have expired or been deleted."}
        </p>
        <a href="/" className="text-indigo-400 hover:text-indigo-300 underline">
          Share your own file
        </a>
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg animate-fade-in">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-5">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
          </span>
          <span className="text-green-400 text-sm font-medium">This file is available</span>
        </div>

        {fileInfo && (
          <FileInfo
            fileName={fileInfo.fileName}
            fileSize={fileInfo.fileSize}
            mimeType={fileInfo.mimeType}
          />
        )}

        <button
          onClick={handleDownload}
          disabled={loadState === 'downloading'}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors"
        >
          {loadState === 'downloading' ? 'Downloading…' : 'Download'}
        </button>

        {fileInfo && (
          <ExpiryInfo expiryMode={fileInfo.expiryMode} expiresAt={fileInfo.expiresAt} />
        )}
      </div>
    </div>
  );
}
