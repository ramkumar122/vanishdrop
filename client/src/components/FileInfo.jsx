import { formatFileSize, getMimeIcon } from '../lib/utils.js';

export default function FileInfo({ fileName, fileSize, mimeType }) {
  return (
    <div className="flex items-center gap-3 bg-gray-800/50 rounded-xl p-4 border border-gray-700">
      <span className="text-3xl" role="img" aria-label="file type">
        {getMimeIcon(mimeType)}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-white truncate" title={fileName}>
          {fileName}
        </p>
        <p className="text-sm text-gray-400">
          {formatFileSize(fileSize)}
          {mimeType && (
            <span className="text-gray-600 ml-2">· {mimeType}</span>
          )}
        </p>
      </div>
    </div>
  );
}
