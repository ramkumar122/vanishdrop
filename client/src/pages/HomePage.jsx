import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../hooks/useSocket.js';
import { useUpload } from '../hooks/useUpload.js';
import { usePresence } from '../hooks/usePresence.js';
import DropZone from '../components/DropZone.jsx';
import UploadProgress from '../components/UploadProgress.jsx';

const EXPIRY_OPTIONS = [
  { value: 'presence', label: 'While tab is open', description: 'Deleted the moment you close this tab' },
  { value: '1h',       label: '1 hour',            description: 'Auto-deleted after 1 hour' },
  { value: '4h',       label: '4 hours',           description: 'Auto-deleted after 4 hours' },
  { value: '24h',      label: '24 hours',          description: 'Auto-deleted after 24 hours' },
];

export default function HomePage() {
  const navigate = useNavigate();
  const { sessionId, connected, sessionReady, sessionError, emit } = useSocket();
  const {
    uploadFiles,
    reset,
    status: uploadStatus,
    progress,
    bytesUploaded,
    totalBytes,
    error,
    shareId,
    completedFiles,
    totalFiles,
    currentFileName,
  } = useUpload(sessionId);

  const [expiryMode, setExpiryMode] = useState('presence');

  usePresence(emit, connected);

  useEffect(() => {
    if (uploadStatus === 'done' && shareId) {
      navigate(`/share/${shareId}`);
    }
  }, [uploadStatus, shareId, navigate]);

  const isUploading = uploadStatus === 'uploading' || uploadStatus === 'completing';
  const uploadReady = connected && sessionReady;

  return (
    <div className="w-full max-w-lg animate-fade-in">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">
          Your files exist only while you're here
        </h1>
        <p className="text-gray-400">Close the tab, they're gone forever.</p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-5">
        {isUploading ? (
          <UploadProgress
            progress={progress}
            bytesUploaded={bytesUploaded}
            totalBytes={totalBytes}
            status={uploadStatus}
            currentFileName={currentFileName}
            completedFiles={completedFiles}
            totalFiles={totalFiles}
          />
        ) : (
          <>
            <DropZone onFiles={(files) => uploadFiles(files, expiryMode)} disabled={!uploadReady} />

            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-medium">
                Delete after
              </p>
              <div className="grid grid-cols-2 gap-2">
                {EXPIRY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setExpiryMode(opt.value)}
                    className={`text-left px-3 py-2.5 rounded-xl border text-sm transition-colors ${
                      expiryMode === opt.value
                        ? 'border-indigo-500 bg-indigo-950/50 text-white'
                        : 'border-gray-700 bg-gray-800/40 text-gray-400 hover:border-gray-500 hover:text-gray-200'
                    }`}
                  >
                    <span className="font-medium block">{opt.label}</span>
                    <span className="text-xs opacity-60">{opt.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {(error || sessionError) && (
          <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-400 text-sm animate-fade-in">
            {error || sessionError}
            <button
              onClick={sessionError ? () => window.location.reload() : reset}
              className="ml-2 underline hover:no-underline"
            >
              {sessionError ? 'Reload' : 'Try again'}
            </button>
          </div>
        )}

        {!uploadReady && (
          <p className="text-yellow-500 text-xs text-center">
            {connected ? 'Preparing secure session…' : 'Connecting to server…'}
          </p>
        )}
      </div>

      <div className="mt-10 grid grid-cols-3 gap-4 text-center text-sm text-gray-500">
        <div>
          <div className="text-2xl mb-1">☁️</div>
          <p>Upload your files</p>
        </div>
        <div>
          <div className="text-2xl mb-1">🔗</div>
          <p>Share one link</p>
        </div>
        <div>
          <div className="text-2xl mb-1">💨</div>
          <p>Recipients choose files</p>
        </div>
      </div>
    </div>
  );
}
