import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { getOrCreateSessionId, saveSessionId } from '../lib/utils.js';

export function useSocket() {
  const socketRef = useRef(null);
  const [sessionId, setSessionId] = useState(getOrCreateSessionId());
  const [connected, setConnected] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [status, setStatus] = useState('disconnected'); // 'connected' | 'reconnecting' | 'disconnected'

  useEffect(() => {
    const existingSessionId = getOrCreateSessionId();

    const socket = io(import.meta.env.VITE_API_URL || '/', {
      auth: { sessionId: existingSessionId },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setStatus('connected');
    });

    socket.on('disconnect', () => {
      setConnected(false);
      setSessionReady(false);
      setStatus('reconnecting');
    });

    socket.on('connect_error', () => {
      setSessionReady(false);
      setStatus('disconnected');
    });

    socket.on('reconnect', () => {
      setConnected(true);
      setStatus('connected');
    });

    socket.on('session:created', ({ sessionId: newId }) => {
      saveSessionId(newId);
      setSessionId(newId);
      setSessionReady(true);
    });

    return () => {
      socket.disconnect();
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

  return { socket: socketRef.current, sessionId, connected, sessionReady, status, on, emit, joinRoom };
}
