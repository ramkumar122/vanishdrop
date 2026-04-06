export default function PresenceIndicator({ status }) {
  const config = {
    connected: {
      dot: 'bg-green-400',
      ping: 'bg-green-400',
      label: "You're live — files are available",
      textColor: 'text-green-400',
    },
    reconnecting: {
      dot: 'bg-yellow-400',
      ping: 'bg-yellow-400',
      label: 'Reconnecting…',
      textColor: 'text-yellow-400',
    },
    disconnected: {
      dot: 'bg-red-500',
      ping: null,
      label: 'Disconnected — files may be unavailable',
      textColor: 'text-red-400',
    },
  };

  const c = config[status] || config.disconnected;

  return (
    <div className="flex items-center gap-2">
      <span className="relative flex h-3 w-3">
        {c.ping && (
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full ${c.ping} opacity-75`}
          />
        )}
        <span className={`relative inline-flex rounded-full h-3 w-3 ${c.dot}`} />
      </span>
      <span className={`text-sm font-medium ${c.textColor}`}>{c.label}</span>
    </div>
  );
}
