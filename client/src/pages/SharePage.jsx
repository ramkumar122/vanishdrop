import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import FileInfo from '../components/FileInfo.jsx';
import PresenceIndicator from '../components/PresenceIndicator.jsx';
import ShareLink from '../components/ShareLink.jsx';
import { usePresence } from '../hooks/usePresence.js';
import { useSocket } from '../hooks/useSocket.js';
import { getShareFiles } from '../lib/api.js';
import { formatFileSize } from '../lib/utils.js';

function ExpiryBadge({ file }) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    if (!file.expiresAt || file.expiryMode === 'presence') {
      return undefined;
    }

    function update() {
      const diff = new Date(file.expiresAt) - new Date();
      if (diff <= 0) {
        setTimeLeft('Expired');
        return;
      }

      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(h > 0 ? `${h}h ${m}m left` : m > 0 ? `${m}m ${s}s left` : `${s}s left`);
    }

    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [file.expiresAt, file.expiryMode]);

  if (file.expiryMode === 'presence') {
    return (
      <p className="text-xs text-gray-500 mt-2">
        Vanishes when you close your tab.
      </p>
    );
  }

  return (
    <p className="text-xs text-indigo-400 mt-2">
      Auto-deletes in {timeLeft}
    </p>
  );
}

export default function SharePage() {
  const { shareId } = useParams();
  const { connected, status, on, emit, joinRoom, sessionId } = useSocket();
  const [shareData, setShareData] = useState(null);
  const [events, setEvents] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [vanishReason, setVanishReason] = useState(null);

  usePresence(emit, connected);

  const refreshShare = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoadState('loading');
    }

    try {
      const data = await getShareFiles(shareId);
      setShareData(data);
      setLoadState('available');
      setVanishReason(null);
    } catch (err) {
      const message = err.response?.data?.error;
      if (err.response?.status === 410) {
        setVanishReason(message || 'The files in this share are no longer available.');
        setLoadState('vanished');
        setShareData(null);
        return;
      }

      setLoadState('notfound');
      setShareData(null);
    }
  }, [shareId]);

  useEffect(() => {
    void refreshShare(true);
  }, [refreshShare]);

  useEffect(() => {
    if (!shareData?.hasPresenceFiles) {
      return undefined;
    }

    const baseUrl = import.meta.env.VITE_API_URL || '';
    let closeRequestSent = false;

    function notifyPageClose(event) {
      if (event?.persisted) {
        return;
      }

      if (closeRequestSent || !sessionId) {
        return;
      }

      closeRequestSent = true;
      const payload = JSON.stringify({ sessionId });
      const closeUrl = `${baseUrl}/api/presence/close`;

      if (typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([payload], { type: 'application/json' });
        if (navigator.sendBeacon(closeUrl, blob)) {
          return;
        }
      }

      void fetch(closeUrl, {
        body: payload,
        headers: {
          'Content-Type': 'application/json',
        },
        keepalive: true,
        method: 'POST',
      }).catch(() => {});
    }

    function handleBeforeUnload(e) {
      e.preventDefault();
      e.returnValue = 'Your shared files will be deleted. Are you sure?';
      notifyPageClose();
      return e.returnValue;
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', notifyPageClose);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', notifyPageClose);
    };
  }, [sessionId, shareData?.hasPresenceFiles]);

  useEffect(() => {
    if (!shareData?.files?.length) {
      return undefined;
    }

    for (const file of shareData.files) {
      joinRoom(file.fileId);
    }

    const offReady = on('file:ready', ({ shareId: readyShareId }) => {
      if (readyShareId === shareId) {
        void refreshShare(false);
      }
    });

    const offDeleted = on('file:deleted', ({ fileId }) => {
      setShareData((current) => {
        if (!current) return current;

        const files = current.files.filter((file) => file.fileId !== fileId);
        if (files.length === 0) {
          setVanishReason('All files in this share have vanished.');
          setLoadState('vanished');
          return null;
        }

        return {
          ...current,
          files,
          totalFiles: files.length,
        };
      });
    });

    const offStarted = on('file:download-started', ({ fileId }) => {
      const file = shareData.files.find((entry) => entry.fileId === fileId);
      if (!file) return;

      setEvents((prev) => [{ fileName: file.fileName, type: 'started', at: new Date() }, ...prev].slice(0, 10));
    });

    const offCompleted = on('file:download-completed', ({ fileId }) => {
      const file = shareData.files.find((entry) => entry.fileId === fileId);
      if (!file) return;

      setEvents((prev) => [{ fileName: file.fileName, type: 'completed', at: new Date() }, ...prev].slice(0, 10));
    });

    return () => {
      offReady?.();
      offDeleted?.();
      offStarted?.();
      offCompleted?.();
    };
  }, [joinRoom, on, refreshShare, shareData, shareId]);

  const shareUrl = `${window.location.origin}/d/${shareId}`;
  const totalBytes = useMemo(
    () => shareData?.files?.reduce((sum, file) => sum + file.fileSize, 0) || 0,
    [shareData]
  );

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
          Share another file set
        </a>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl animate-fade-in">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-6">
        <PresenceIndicator status={status} />

        <ShareLink url={shareUrl} />

        <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-4">
          <p className="text-sm text-gray-400">Live now</p>
          <h2 className="text-2xl font-bold text-white mt-1">
            {shareData.totalFiles} file{shareData.totalFiles === 1 ? '' : 's'} ready to share
          </h2>
          <p className="text-sm text-gray-500 mt-1">{formatFileSize(totalBytes)} total</p>
        </div>

        <div className="space-y-3">
          {shareData.files.map((file) => (
            <div key={file.fileId} className="bg-gray-800/30 border border-gray-700 rounded-xl p-4">
              <FileInfo
                fileName={file.fileName}
                fileSize={file.fileSize}
                mimeType={file.mimeType}
              />
              <ExpiryBadge file={file} />
            </div>
          ))}
        </div>

        {events.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Activity</p>
            {events.map((event, index) => (
              <p key={`${event.fileName}-${event.type}-${index}`} className="text-sm text-gray-400 animate-fade-in">
                {event.type === 'started' ? '⬇️ Download started' : '✅ Download completed'} for {event.fileName}
                <span className="text-gray-600 ml-2 text-xs">{event.at.toLocaleTimeString()}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      {shareData.hasPresenceFiles && (
        <div className="mt-4 p-3 bg-amber-950/40 border border-amber-800/50 rounded-xl text-amber-400 text-sm text-center">
          ⚠️ Closing this tab will permanently delete any presence-based files in this link
        </div>
      )}
    </div>
  );
}
