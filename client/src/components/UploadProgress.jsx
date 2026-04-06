import { formatFileSize } from '../lib/utils.js';

export default function UploadProgress({ progress, bytesUploaded, totalBytes, status }) {
  const label =
    status === 'completing'
      ? 'Finalizing…'
      : `${formatFileSize(bytesUploaded)} / ${formatFileSize(totalBytes)}`;

  return (
    <div className="w-full animate-fade-in">
      <div className="flex justify-between text-sm text-gray-400 mb-2">
        <span>{status === 'completing' ? 'Verifying upload…' : 'Uploading…'}</span>
        <span>{status === 'completing' ? '100%' : `${progress}%`}</span>
      </div>

      <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
        <div
          className="h-3 rounded-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all duration-300"
          style={{ width: `${status === 'completing' ? 100 : progress}%` }}
        />
      </div>

      <p className="text-center text-gray-500 text-xs mt-2">{label}</p>
    </div>
  );
}
