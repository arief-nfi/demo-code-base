'use client';

import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/auth-store';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

let globalSocket: Socket | null = null;
let connectionAttempted = false;

function getSocket(): Socket | null {
  if (typeof window === 'undefined') return null;
  if (globalSocket?.connected) return globalSocket;
  if (connectionAttempted) return globalSocket;

  const tenantSlug = useAuthStore.getState().tenantSlug;
  if (!tenantSlug) return null;

  connectionAttempted = true;

  globalSocket = io(API_URL, {
    transports: ['websocket'],
    autoConnect: false, // Don't connect until we have a token
    reconnection: true,
    reconnectionDelay: 5000,
    reconnectionDelayMax: 30000,
    reconnectionAttempts: 3,
    withCredentials: true,
  });

  // Fetch WS token once, then connect
  fetch(`${API_URL}/auth/ws-token`, { credentials: 'include' })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data?.token && globalSocket) {
        globalSocket.auth = { token: data.token };
        globalSocket.connect();
      }
    })
    .catch(() => {
      // Can't get token — don't connect
    });

  globalSocket.on('connect', () => {
    console.debug('[WebSocket] Connected');
  });

  globalSocket.on('disconnect', (reason) => {
    console.debug(`[WebSocket] Disconnected: ${reason}`);
  });

  globalSocket.on('connect_error', () => {
    // Silently handle — reconnection will retry
  });

  return globalSocket;
}

export function disconnectSocket() {
  if (globalSocket) {
    globalSocket.disconnect();
    globalSocket = null;
    connectionAttempted = false;
  }
}

export function useSocket(): Socket | null {
  const socketRef = useRef<Socket | null>(null);
  const tenantSlug = useAuthStore((s) => s.tenantSlug);

  useEffect(() => {
    if (!tenantSlug) return;
    socketRef.current = getSocket();
  }, [tenantSlug]);

  return socketRef.current;
}
