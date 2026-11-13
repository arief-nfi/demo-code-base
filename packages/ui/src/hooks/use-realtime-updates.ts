'use client';

import { useEffect, useCallback } from 'react';
import { useSocket } from './use-socket';

/**
 * Subscribe to real-time events from the WebSocket server.
 * Falls back gracefully if WebSocket is not connected.
 *
 * @param eventName - An event a service broadcasts with WebSocketBridgeService (e.g., 'notification:new')
 * @param callback - Function called when the event is received
 */
export function useRealtimeUpdates(eventName: string, callback: (data: any) => void) {
  const socket = useSocket();

  const stableCallback = useCallback(callback, []);

  useEffect(() => {
    if (!socket) return;

    socket.on(eventName, stableCallback);

    return () => {
      socket.off(eventName, stableCallback);
    };
  }, [socket, eventName, stableCallback]);
}
