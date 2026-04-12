import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../hooks/useSocket.js';
import { useUpload } from '../hooks/useUpload.js';
import { usePresence } from '../hooks/usePresence.js';
import DropZone from '../components/DropZone.jsx';
import UploadProgress from '../components/UploadProgress.jsx';

const TIME_UNIT_OPTIONS = [
  { value: 'minutes', label: 'minutes', seconds: 60, min: 1, max: 1440 },
  { value: 'hours', label: 'hours', seconds: 3600, min: 1, max: 24 },
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
  const [customExpiryValue, setCustomExpiryValue] = useState('1');
  const [customExpiryUnit, setCustomExpiryUnit] = useState('hours');

  usePresence(emit, connected);

  useEffect(() => {
    if (uploadStatus === 'done' && shareId) {
      navigate(`/share/${shareId}`);
    }
  }, [uploadStatus, shareId, navigate]);

  const isUploading = uploadStatus === 'uploading' || uploadStatus === 'completing';
  const uploadReady = connected && sessionReady;
  const selectedUnit = TIME_UNIT_OPTIONS.find((option) => option.value === customExpiryUnit) || TIME_UNIT_OPTIONS[1];
  const customExpirySeconds = Number(customExpiryValue) * selectedUnit.seconds;
  const customTimerIsValid =
    Number.isInteger(Number(customExpiryValue)) &&
    Number(customExpiryValue) >= selectedUnit.min &&
    Number(customExpiryValue) <= selectedUnit.max;

  function buildExpirySelection() {
    if (expiryMode === 'presence') {
      return { mode: 'presence' };
    }

    return {
      mode: 'timed',
      seconds: customExpirySeconds,
    };
  }

  function handleCustomUnitChange(nextUnit) {
    const option = TIME_UNIT_OPTIONS.find((entry) => entry.value === nextUnit);
    if (!option) {
      return;
    }

    setCustomExpiryUnit(nextUnit);
    setCustomExpiryValue((current) => {
      const numeric = Number(current);
      if (!Number.isInteger(numeric)) {
        return String(option.min);
      }

      return String(Math.min(Math.max(numeric, option.min), option.max));
    });
  }

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
            <DropZone
              onFiles={(files) => uploadFiles(files, buildExpirySelection())}
              disabled={!uploadReady}
            />

            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-medium">
                Delete after
              </p>
              <div className="space-y-3">
                <button
                  onClick={() => setExpiryMode('presence')}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                    expiryMode === 'presence'
                      ? 'border-indigo-500 bg-indigo-950/50 text-white'
                      : 'border-gray-700 bg-gray-800/40 text-gray-400 hover:border-gray-500 hover:text-gray-200'
                  }`}
                >
                  <span className="font-medium block">While tab is open</span>
                  <span className="text-xs opacity-60">Deleted the moment you close this tab</span>
                </button>

                <div
                  className={`rounded-xl border p-4 transition-colors ${
                    expiryMode === 'timed'
                      ? 'border-indigo-500 bg-indigo-950/40'
                      : 'border-gray-700 bg-gray-800/30'
                  }`}
                >
                  <button
                    onClick={() => setExpiryMode('timed')}
                    className="w-full text-left"
                  >
                    <span className={`font-medium block ${expiryMode === 'timed' ? 'text-white' : 'text-gray-300'}`}>
                      Set your own timer
                    </span>
                    <span className="text-xs text-gray-500">Choose any duration from 1 minute up to 24 hours</span>
                  </button>

                  <div className="mt-3 flex gap-2">
                    <input
                      type="number"
                      min={selectedUnit.min}
                      max={selectedUnit.max}
                      value={customExpiryValue}
                      onChange={(e) => {
                        setExpiryMode('timed');
                        setCustomExpiryValue(e.target.value);
                      }}
                      className="w-32 rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
                      aria-label="Custom delete timer value"
                    />
                    <select
                      value={customExpiryUnit}
                      onChange={(e) => {
                        setExpiryMode('timed');
                        handleCustomUnitChange(e.target.value);
                      }}
                      className="flex-1 rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
                      aria-label="Custom delete timer unit"
                    >
                      {TIME_UNIT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <p className="mt-2 text-xs text-gray-500">
                    {customTimerIsValid
                      ? `Files will auto-delete ${customExpiryUnit === 'hours' ? `after ${customExpiryValue} hour${customExpiryValue === '1' ? '' : 's'}` : `after ${customExpiryValue} minute${customExpiryValue === '1' ? '' : 's'}`}.`
                      : `Choose a value between ${selectedUnit.min} and ${selectedUnit.max} ${selectedUnit.label}.`}
                  </p>
                </div>
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
