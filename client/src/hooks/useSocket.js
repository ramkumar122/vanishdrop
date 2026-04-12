import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getOrCreateSessionId, saveSessionId } from '../lib/utils.js';

const SocketContext = createContext(null);

function useProvideSocket() {
  const socketRef = useRef(null);
  const [sessionId, setSessionId] = useState(getOrCreateSessionId());
  const sessionIdRef = useRef(sessionId);
  const [connected, setConnected] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState(null);
  const [status, setStatus] = useState('disconnected'); // 'connected' | 'reconnecting' | 'disconnected'

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    const existingSessionId = getOrCreateSessionId();

    const socket = io(import.meta.env.VITE_API_URL || '/', {
      auth: { sessionId: existingSessionId },
      closeOnBeforeunload: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports: ['websocket'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setStatus('connected');
      setSessionError(null);
    });

    socket.on('disconnect', () => {
      setConnected(false);
      setSessionReady(false);
      setStatus('reconnecting');
    });

    socket.on('connect_error', () => {
      setSessionReady(false);
      setStatus('disconnected');
      setSessionError('Unable to connect to the server right now. Please try again.');
    });

    socket.on('reconnect', () => {
      setConnected(true);
      setStatus('connected');
    });

    socket.on('session:created', ({ sessionId: newId }) => {
      saveSessionId(newId);
      setSessionId(newId);
      setSessionReady(true);
      setSessionError(null);
    });

    socket.on('session:error', ({ message }) => {
      setSessionReady(false);
      setSessionError(message || 'Failed to initialize secure session. Please try again.');
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_URL || '';

    function notifyPageClose() {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId) {
        return;
      }

      const payload = JSON.stringify({ sessionId: activeSessionId });
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

    window.addEventListener('pagehide', notifyPageClose);

    return () => {
      window.removeEventListener('pagehide', notifyPageClose);
    };
  }, []);

  const on = useCallback((event, handler) => {
    socketRef.current?.on(event, handler);
    return () => socketRef.current?.off(event, handler);
  }, []);

  const emit = useCallback((event, data) => {
    socketRef.current?.emit(event, data);
  }, []);

  const joinRoom = useCallback((room) => {
    socketRef.current?.emit('file:join', room);
  }, []);

  return { socket: socketRef.current, sessionId, connected, sessionReady, sessionError, status, on, emit, joinRoom };
}

export function SocketProvider({ children }) {
  const value = useProvideSocket();
  return createElement(SocketContext.Provider, { value }, children);
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }

  return context;
}
