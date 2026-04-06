import { useEffect } from 'react';

const HEARTBEAT_INTERVAL = 15000;

export function usePresence(emit, connected) {
  useEffect(() => {
    if (!connected) return;

    // Initial ping
    emit('presence:ping');

    // Heartbeat
    const interval = setInterval(() => {
      if (!document.hidden) {
        emit('presence:ping');
      }
    }, HEARTBEAT_INTERVAL);

    // Tab visibility
    function handleVisibility() {
      if (document.hidden) {
        emit('presence:tab-hidden');
      } else {
        emit('presence:tab-visible');
        emit('presence:ping');
      }
    }

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [emit, connected]);
}
