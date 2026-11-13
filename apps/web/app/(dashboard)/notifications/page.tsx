'use client';

import { useState, useEffect } from 'react';
import { Bell, Check, CheckCheck, Trash2, Info, AlertTriangle, AlertCircle, CheckCircle, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  apiClient, PageContainer, Button, Badge, EmptyState,
  useRBAC, useAuthStore, formatDateTime,
} from '@saas/ui';
import { PageHeader } from '@/components/page-header';
import { toast } from 'sonner';

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
  INFO: Info, SUCCESS: CheckCircle, WARNING: AlertTriangle, ERROR: AlertCircle, ACTION: Zap,
};

const typeColors: Record<string, string> = {
  INFO: 'text-blue-500', SUCCESS: 'text-emerald-500', WARNING: 'text-amber-500', ERROR: 'text-red-500', ACTION: 'text-purple-500',
};

const categoryLabels: Record<string, string> = {
  system: 'System', security: 'Security', plugins: 'Plugins',
};

export default function NotificationsPage() {
  const router = useRouter();
  const storedTenantName = useAuthStore(s => s.tenantName);

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const limit = 20;

  useEffect(() => {
    document.title = `Notifications | ${storedTenantName || 'SaaS Admin'}`;
  }, [storedTenantName]);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { limit, offset };
      if (filter === 'unread') params.read = 'false';
      else if (filter === 'read') params.read = 'true';
      if (categoryFilter) params.category = categoryFilter;

      const data = await apiClient.get<{ data: Notification[]; meta: { total: number } }>('/notifications', params);
      setNotifications(data.data);
      setTotal(data.meta.total);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, [filter, categoryFilter, offset]);

  const handleMarkAsRead = async (id: string) => {
    await apiClient.patch(`/notifications/${id}/read`);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };

  const handleMarkAllRead = async () => {
    await apiClient.patch('/notifications/read-all');
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    toast.success('All notifications marked as read');
  };

  const handleDelete = async (id: string) => {
    await apiClient.delete(`/notifications/${id}`);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setTotal((prev) => prev - 1);
  };

  const handleClick = (n: Notification) => {
    if (!n.read) handleMarkAsRead(n.id);
    if (n.link) router.push(n.link);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Notifications"
        description={`${total} notification${total !== 1 ? 's' : ''}`}
      >
        <Button variant="outline" size="sm" onClick={handleMarkAllRead} className="gap-1.5">
          <CheckCheck className="h-3.5 w-3.5" /> Mark all read
        </Button>
      </PageHeader>

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {(['all', 'unread', 'read'] as const).map((f) => (
          <Button key={f} variant={filter === f ? 'primary' : 'outline'} size="sm" onClick={() => { setFilter(f); setOffset(0); }}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </Button>
        ))}
        <div className="w-px bg-border mx-1" />
        {['', 'system', 'security', 'plugins'].map((cat) => (
          <Button key={cat || 'all-cat'} variant={categoryFilter === cat ? 'primary' : 'outline'} size="sm" onClick={() => { setCategoryFilter(cat); setOffset(0); }}>
            {cat ? categoryLabels[cat] || cat : 'All Categories'}
          </Button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-3 p-4 rounded-lg border border-border">
              <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 bg-muted animate-pulse rounded" />
                <div className="h-3 w-2/3 bg-muted animate-pulse rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-8 w-8" />}
          title="No notifications"
          description={filter !== 'all' ? `No ${filter} notifications.` : 'You\'re all caught up!'}
        />
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => {
            const Icon = typeIcons[n.type] || Info;
            const color = typeColors[n.type] || 'text-muted-foreground';

            return (
              <div
                key={n.id}
                className={`flex items-start gap-3 p-4 rounded-lg border border-border hover:bg-muted/50 transition-colors cursor-pointer ${
                  !n.read ? 'bg-primary/5 border-primary/20' : ''
                }`}
                onClick={() => handleClick(n)}
              >
                <div className={`mt-0.5 shrink-0 ${color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm ${!n.read ? 'font-semibold' : 'font-medium'}`}>{n.title}</p>
                    {!n.read && <span className="h-2 w-2 rounded-full bg-primary shrink-0" />}
                    <Badge variant="outline" className="text-[10px] ml-auto shrink-0">
                      {categoryLabels[n.category] || n.category}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">{n.body}</p>
                  <p className="text-xs text-muted-foreground mt-1">{formatDateTime(n.createdAt)}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {!n.read && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleMarkAsRead(n.id)} title="Mark as read">
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(n.id)} title="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-muted-foreground">
            Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
