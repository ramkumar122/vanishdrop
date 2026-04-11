import { useCallback, useRef, useState } from 'react';
import { formatFileSize } from '../lib/utils.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024;

function makeFileKey(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export default function DropZone({ disabled, onFiles }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [error, setError] = useState(null);

  const handleFiles = useCallback((incomingFiles) => {
    const files = Array.from(incomingFiles || []);
    if (files.length === 0) {
      return;
    }

    const invalidFile = files.find((file) => file.size > MAX_FILE_SIZE || file.size === 0);
    if (invalidFile) {
      if (invalidFile.size === 0) {
        setError(`File "${invalidFile.name}" is empty.`);
      } else {
        setError(`File "${invalidFile.name}" is too large. Max 10GB. Your file: ${formatFileSize(invalidFile.size)}`);
      }
      return;
    }

    setError(null);
    setSelectedFiles((current) => {
      const existing = new Set(current.map(makeFileKey));
      const nextFiles = files.filter((file) => !existing.has(makeFileKey(file)));
      return [...current, ...nextFiles];
    });
  }, []);

  function handleDragOver(e) {
    e.preventDefault();
    if (!disabled) setDragOver(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    setDragOver(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    handleFiles(e.dataTransfer.files);
  }

  function handleInputChange(e) {
    handleFiles(e.target.files);
    e.target.value = '';
  }

  function handleUploadClick() {
    if (selectedFiles.length > 0) {
      onFiles(selectedFiles);
    } else {
      inputRef.current?.click();
    }
  }

  function handleClear() {
    setSelectedFiles([]);
    setError(null);
  }

  function handleRemove(fileToRemove) {
    setSelectedFiles((current) => current.filter((file) => makeFileKey(file) !== makeFileKey(fileToRemove)));
  }

  const totalBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className="w-full">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`
          relative border-2 rounded-xl p-10 text-center transition-all duration-200 cursor-pointer
          ${dragOver
            ? 'border-indigo-500 bg-indigo-950/40 scale-[1.01]'
            : selectedFiles.length > 0
            ? 'border-indigo-600 bg-indigo-950/20'
            : 'border-gray-700 hover:border-gray-500 bg-gray-900/50 hover:bg-gray-900/80'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleInputChange}
          disabled={disabled}
        />

        {selectedFiles.length > 0 ? (
          <div className="animate-fade-in text-left">
            <div className="text-center mb-5">
              <div className="text-5xl mb-3">📦</div>
              <p className="font-semibold text-white text-lg">
                {selectedFiles.length} file{selectedFiles.length === 1 ? '' : 's'} ready
              </p>
              <p className="text-gray-400 text-sm mt-1">
                {formatFileSize(totalBytes)} total
              </p>
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {selectedFiles.map((file) => (
                <div
                  key={makeFileKey(file)}
                  className="flex items-center gap-3 bg-gray-800/50 rounded-xl p-3 border border-gray-700"
                >
                  <span className="text-2xl">📎</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white truncate" title={file.name}>
                      {file.name}
                    </p>
                    <p className="text-sm text-gray-400">{formatFileSize(file.size)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemove(file);
                    }}
                    className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
                    aria-label={`Remove ${file.name}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div className="text-5xl mb-4 opacity-60">
              {dragOver ? '📥' : '☁️'}
            </div>
            <p className="text-gray-300 font-medium">
              {dragOver ? 'Release to add files' : 'Drop your files here'}
            </p>
            <p className="text-gray-500 text-sm mt-1">or click to browse</p>
            <p className="text-gray-600 text-xs mt-3">Any file type · Up to 10GB per file</p>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-3 text-red-400 text-sm text-center animate-fade-in">{error}</p>
      )}

      {selectedFiles.length > 0 && !disabled && (
        <div className="grid grid-cols-3 gap-3 mt-4">
          <button
            onClick={handleUploadClick}
            className="col-span-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            Upload & Share Files
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
            className="bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl transition-colors"
          >
            Add More
          </button>
          <button
            onClick={handleClear}
            className="col-span-3 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl transition-colors"
            aria-label="Clear selection"
          >
            Clear Selection
          </button>
        </div>
      )}

      {selectedFiles.length === 0 && !disabled && (
        <button
          onClick={() => inputRef.current?.click()}
          className="w-full mt-4 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 rounded-xl transition-colors"
        >
          Choose Files
        </button>
      )}
    </div>
  );
}
