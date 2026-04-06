import { useRef, useState, useCallback } from 'react';
import { formatFileSize } from '../lib/utils.js';

const MAX_FILE_SIZE = 104857600;

export default function DropZone({ onFile, disabled }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [error, setError] = useState(null);

  const handleFile = useCallback(
    (file) => {
      setError(null);
      if (file.size > MAX_FILE_SIZE) {
        setError(`File too large. Max 100MB. Your file: ${formatFileSize(file.size)}`);
        return;
      }
      if (file.size === 0) {
        setError('File is empty.');
        return;
      }
      setSelectedFile(file);
    },
    []
  );

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
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function handleInputChange(e) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset input so same file can be re-selected
    e.target.value = '';
  }

  function handleUploadClick() {
    if (selectedFile) {
      onFile(selectedFile);
    } else {
      inputRef.current?.click();
    }
  }

  function handleClear() {
    setSelectedFile(null);
    setError(null);
  }

  return (
    <div className="w-full">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !selectedFile && !disabled && inputRef.current?.click()}
        className={`
          relative border-2 rounded-xl p-10 text-center transition-all duration-200 cursor-pointer
          ${dragOver
            ? 'border-indigo-500 bg-indigo-950/40 scale-[1.01]'
            : selectedFile
            ? 'border-indigo-600 bg-indigo-950/20 cursor-default'
            : 'border-gray-700 hover:border-gray-500 bg-gray-900/50 hover:bg-gray-900/80'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={handleInputChange}
          disabled={disabled}
        />

        {selectedFile ? (
          <div className="animate-fade-in">
            <div className="text-5xl mb-3">📎</div>
            <p className="font-semibold text-white text-lg truncate max-w-xs mx-auto" title={selectedFile.name}>
              {selectedFile.name}
            </p>
            <p className="text-gray-400 text-sm mt-1">{formatFileSize(selectedFile.size)}</p>
          </div>
        ) : (
          <div>
            <div className="text-5xl mb-4 opacity-60">
              {dragOver ? '📥' : '☁️'}
            </div>
            <p className="text-gray-300 font-medium">
              {dragOver ? 'Release to select' : 'Drop your file here'}
            </p>
            <p className="text-gray-500 text-sm mt-1">or click to browse</p>
            <p className="text-gray-600 text-xs mt-3">Any file type · Max 100MB</p>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-3 text-red-400 text-sm text-center animate-fade-in">{error}</p>
      )}

      {selectedFile && !disabled && (
        <div className="flex gap-3 mt-4">
          <button
            onClick={handleUploadClick}
            className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            Upload & Share
          </button>
          <button
            onClick={handleClear}
            className="px-4 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl transition-colors"
            aria-label="Clear selection"
          >
            ✕
          </button>
        </div>
      )}

      {!selectedFile && !disabled && (
        <button
          onClick={() => inputRef.current?.click()}
          className="w-full mt-4 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 rounded-xl transition-colors"
        >
          Choose File
        </button>
      )}
    </div>
  );
}
