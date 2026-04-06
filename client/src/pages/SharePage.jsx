import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSocket } from '../hooks/useSocket.js';
import { usePresence } from '../hooks/usePresence.js';
import PresenceIndicator from '../components/PresenceIndicator.jsx';
import ShareLink from '../components/ShareLink.jsx';
import { getFileInfo } from '../lib/api.js';
import { formatFileSize, getMimeIcon } from '../lib/utils.js';

function ExpiryBadge({ expiryMode, expiresAt }) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    if (!expiresAt) return;
    function update() {
      const diff = new Date(expiresAt) - new Date();
      if (diff <= 0) { setTimeLeft('Expired'); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(h > 0 ? `${h}h ${m}m left` : m > 0 ? `${m}m ${s}s left` : `${s}s left`);
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (expiryMode === 'presence') return null;

  return (
    <div className="flex items-center gap-2 text-sm text-indigo-400 bg-indigo-950/40 border border-indigo-800/50 rounded-lg px-3 py-2">
      <span>⏱</span>
      <span>Auto-deletes in <span className="font-semibold">{timeLeft}</span></span>
    </div>
  );
}

export default function SharePage() {
  const { fileId } = useParams();
  const { connected, status, on, emit } = useSocket();
  const [fileInfo, setFileInfo] = useState(null);
  const [events, setEvents] = useState([]);

  usePresence(emit, connected);

  // Only warn on close for presence-based files
  useEffect(() => {
    if (fileInfo?.expiryMode && fileInfo.expiryMode !== 'presence') return;
    function handleBeforeUnload(e) {
      e.preventDefault();
      e.returnValue = 'Your shared files will be deleted. Are you sure?';
      return e.returnValue;
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [fileInfo]);

  useEffect(() => {
    getFileInfo(fileId)
      .then(setFileInfo)
      .catch(() => setFileInfo(null));
  }, [fileId]);

  useEffect(() => {
    const offStarted = on('file:download-started', ({ fileId: fid }) => {
      if (fid === fileId) {
        setEvents((prev) => [{ type: 'started', at: new Date() }, ...prev].slice(0, 10));
      }
    });
    const offCompleted = on('file:download-completed', ({ fileId: fid }) => {
      if (fid === fileId) {
        setEvents((prev) => [{ type: 'completed', at: new Date() }, ...prev].slice(0, 10));
      }
    });
    return () => {
      offStarted?.();
      offCompleted?.();
    };
  }, [on, fileId]);

  const shareUrl = `${window.location.origin}/d/${fileId}`;
  const isPresence = !fileInfo?.expiryMode || fileInfo.expiryMode === 'presence';

  return (
    <div className="w-full max-w-lg animate-fade-in">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-6">
        <PresenceIndicator status={status} />

        <ShareLink url={shareUrl} />

        {fileInfo && (
          <>
            <div className="flex items-center gap-3 bg-gray-800/50 rounded-xl p-4 border border-gray-700">
              <span className="text-3xl">{getMimeIcon(fileInfo.mimeType)}</span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-white truncate" title={fileInfo.fileName}>
                  {fileInfo.fileName}
                </p>
                <p className="text-sm text-gray-400">{formatFileSize(fileInfo.fileSize)}</p>
              </div>
            </div>
            <ExpiryBadge expiryMode={fileInfo.expiryMode} expiresAt={fileInfo.expiresAt} />
          </>
        )}

        {events.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Activity</p>
            {events.map((e, i) => (
              <p key={i} className="text-sm text-gray-400 animate-fade-in">
                {e.type === 'started' ? '⬇️ Someone started downloading' : '✅ Download completed'}
                <span className="text-gray-600 ml-2 text-xs">{e.at.toLocaleTimeString()}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      {isPresence && (
        <div className="mt-4 p-3 bg-amber-950/40 border border-amber-800/50 rounded-xl text-amber-400 text-sm text-center">
          ⚠️ Closing this tab will permanently delete all shared files
        </div>
      )}
    </div>
  );
}