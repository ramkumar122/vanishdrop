import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

export default function ShareLink({ url }) {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers that don't support clipboard API
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="w-full">
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-medium">Share Link</p>

      <div className="flex gap-2">
        <div className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 font-mono text-sm text-indigo-300 truncate">
          {url}
        </div>

        <button
          onClick={handleCopy}
          className={`px-4 rounded-lg font-medium text-sm transition-all ${
            copied
              ? 'bg-green-600 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
          }`}
          aria-label="Copy share link"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>

        <button
          onClick={() => setShowQr((v) => !v)}
          className={`px-3 rounded-lg transition-colors ${
            showQr ? 'bg-indigo-700 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
          }`}
          aria-label="Show QR code"
          title="QR Code"
        >
          ⬛
        </button>
      </div>

      {showQr && (
        <div className="mt-4 flex justify-center animate-fade-in">
          <div className="bg-white p-3 rounded-xl inline-block">
            <QRCodeSVG value={url} size={160} />
          </div>
        </div>
      )}
    </div>
  );
}
