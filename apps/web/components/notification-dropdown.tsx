'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Check, CheckCheck, Info, AlertTriangle, AlertCircle, CheckCircle, Zap } from 'lucide-react';
import { apiClient, Button } from '@saas/ui';

interface Notification {
  id: string;
  title: string;
  body: string;
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'ACTION';
  read: boolean;
  link?: string | null;
  category: string;
  createdAt: string;
}

const typeIcons: Record<string, typeof Info> = {
  INFO: Info,
  SUCCESS: CheckCircle,
  WARNING: AlertTriangle,
  ERROR: AlertCircle,
  ACTION: Zap,
};

const typeColors: Record<string, string> = {
  INFO: 'text-blue-500',
  SUCCESS: 'text-emerald-500',
  WARNING: 'text-amber-500',
  ERROR: 'text-red-500',
  ACTION: 'text-purple-500',
};

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface NotificationDropdownProps {
  onClose: () => void;
  onNotificationRead: () => void;
}

export function NotificationDropdown({ onClose, onNotificationRead }: NotificationDropdownProps) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const data = await apiClient.get<{ data: Notification[] }>('/notifications', { limit: 10 });
        setNotifications(data.data);
      } catch {
        // silently ignore
      } finally {
        setLoading(false);
      }
    };
    fetchNotifications();
  }, []);

  const handleClick = async (notification: Notification) => {
    if (!notification.read) {
      try {
        await apiClient.patch(`/notifications/${notification.id}/read`);
        setNotifications((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n)),
        );
        onNotificationRead();
      } catch {
        // ignore
      }
    }
    if (notification.link) {
      onClose();
      router.push(notification.link);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await apiClient.patch('/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      onNotificationRead();
    } catch {
      // ignore
    }
  };

  return (
    <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-lg border border-border bg-popover shadow-lg z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold">Notifications</h3>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleMarkAllRead}>
          <CheckCheck className="h-3.5 w-3.5 mr-1" /> Mark all read
        </Button>
      </div>

      {/* List */}
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-3/4 bg-muted animate-pulse rounded" />
                  <div className="h-3 w-1/2 bg-muted animate-pulse rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No notifications yet
          </div>
        ) : (
          notifications.map((n) => {
            const Icon = typeIcons[n.type] || Info;
            const color = typeColors[n.type] || 'text-muted-foreground';

            return (
              <button
                key={n.id}
                type="button"
                onClick={() => handleClick(n)}
                className={`w-full flex gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors border-b border-border last:border-0 ${
                  !n.read ? 'bg-primary/5' : ''
                }`}
              >
                <div className={`mt-0.5 shrink-0 ${color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm truncate ${!n.read ? 'font-semibold' : 'font-medium'}`}>
                      {n.title}
                    </p>
                    {!n.read && (
                      <span className="shrink-0 h-2 w-2 rounded-full bg-primary" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.body}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{timeAgo(n.createdAt)}</p>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full h-7 text-xs"
          onClick={() => {
            onClose();
            router.push('/notifications');
          }}
        >
          View all notifications
        </Button>
      </div>
    </div>
  );
}
