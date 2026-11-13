'use client';

import { useState, useEffect } from 'react';
import { RefreshCw, Mail, Webhook, Download, CalendarDays, CheckCircle, XCircle, Clock, Loader2, AlertTriangle } from 'lucide-react';
import { forbidden } from 'next/navigation';
import {
  apiClient, PageContainer, Button, Badge, Card, CardHeader, CardContent,
  useRBAC, useAuthStore, formatDateTime,
} from '@saas/ui';
import { PageHeader } from '@/components/page-header';

interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

interface JobItem {
  id: string;
  name: string;
  data: Record<string, unknown>;
  status: string;
  attemptsMade: number;
  progress: number;
  timestamp: number;
  finishedOn?: number;
  failedReason?: string;
}

const queueConfig = [
  { key: 'email', label: 'Email', icon: Mail, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  { key: 'webhook', label: 'Webhook', icon: Webhook, color: 'text-purple-500', bg: 'bg-purple-500/10' },
  { key: 'export', label: 'Export', icon: Download, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
  { key: 'calendar', label: 'Calendar', icon: CalendarDays, color: 'text-amber-500', bg: 'bg-amber-500/10' },
];

const statusBadge: Record<string, { variant: 'default' | 'success' | 'destructive' | 'warning' | 'outline'; label: string }> = {
  completed: { variant: 'success', label: 'Completed' },
  failed: { variant: 'destructive', label: 'Failed' },
  active: { variant: 'default', label: 'Active' },
  waiting: { variant: 'outline', label: 'Waiting' },
  delayed: { variant: 'warning', label: 'Delayed' },
};

export default function JobsPage() {
  const { hasRole, isLoading: isRBACLoading } = useRBAC();
  const storedTenantName = useAuthStore(s => s.tenantName);

  const [stats, setStats] = useState<Record<string, QueueStats>>({});
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedQueue, setSelectedQueue] = useState('email');
  const [selectedStatus, setSelectedStatus] = useState('completed');
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    document.title = `Job Queue | ${storedTenantName || 'SaaS Admin'}`;
  }, [storedTenantName]);

  const fetchStats = async () => {
    try {
      const data = await apiClient.get<Record<string, QueueStats>>('/jobs');
      setStats(data);
    } catch {
      // ignore
    }
  };

  const fetchJobs = async () => {
    try {
      const data = await apiClient.get<JobItem[]>(`/jobs/${selectedQueue}/jobs`, {
        status: selectedStatus,
        start: 0,
        end: 20,
      });
      setJobs(data);
    } catch {
      setJobs([]);
    }
  };

  const fetchAll = async () => {
    setLoading(true);
    await Promise.all([fetchStats(), fetchJobs()]);
    setLoading(false);
  };

  useEffect(() => {
    if (!isRBACLoading) fetchAll();
  }, [isRBACLoading]);

  useEffect(() => {
    fetchJobs();
  }, [selectedQueue, selectedStatus]);

  // Auto-refresh every 10s
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchStats();
      fetchJobs();
    }, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, selectedQueue, selectedStatus]);

  if (isRBACLoading) {
    return <PageContainer><div className="flex h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div></PageContainer>;
  }

  if (!hasRole('SYSADMIN')) {
    forbidden();
  }

  const totalJobs = Object.values(stats).reduce(
    (acc, q) => ({
      waiting: acc.waiting + (q.waiting || 0),
      active: acc.active + (q.active || 0),
      completed: acc.completed + (q.completed || 0),
      failed: acc.failed + (q.failed || 0),
      delayed: acc.delayed + (q.delayed || 0),
    }),
    { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
  );

  return (
    <PageContainer>
      <PageHeader
        title="Job Queue"
        description="Monitor background job processing across all queues"
      >
        <div className="flex items-center gap-2">
          <Button
            variant={autoRefresh ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className="gap-1.5"
          >
            {autoRefresh && <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />}
            Auto-refresh {autoRefresh ? 'ON' : 'OFF'}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchAll} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </PageHeader>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <SummaryCard icon={Clock} label="Waiting" count={totalJobs.waiting} color="text-muted-foreground" />
        <SummaryCard icon={Loader2} label="Active" count={totalJobs.active} color="text-blue-500" />
        <SummaryCard icon={CheckCircle} label="Completed" count={totalJobs.completed} color="text-emerald-500" />
        <SummaryCard icon={XCircle} label="Failed" count={totalJobs.failed} color="text-red-500" />
        <SummaryCard icon={AlertTriangle} label="Delayed" count={totalJobs.delayed} color="text-amber-500" />
      </div>

      {/* Queue Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {queueConfig.map((q) => {
          const s = stats[q.key] || { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
          const isSelected = selectedQueue === q.key;

          return (
            <button
              key={q.key}
              type="button"
              onClick={() => setSelectedQueue(q.key)}
              className={`text-left rounded-lg border p-4 transition-all ${
                isSelected ? 'border-primary ring-2 ring-primary/20 bg-card' : 'border-border bg-card hover:shadow-md'
              }`}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className={`p-2 rounded-lg ${q.bg}`}>
                  <q.icon className={`h-5 w-5 ${q.color}`} />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">{q.label}</h3>
                  <p className="text-xs text-muted-foreground">{q.key} queue</p>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-1 text-center">
                <div>
                  <p className="text-lg font-bold text-foreground">{s.waiting}</p>
                  <p className="text-[10px] text-muted-foreground">Wait</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-blue-500">{s.active}</p>
                  <p className="text-[10px] text-muted-foreground">Active</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-emerald-500">{s.completed}</p>
                  <p className="text-[10px] text-muted-foreground">Done</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-red-500">{s.failed}</p>
                  <p className="text-[10px] text-muted-foreground">Fail</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-amber-500">{s.delayed}</p>
                  <p className="text-[10px] text-muted-foreground">Delay</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Job List */}
      <Card>
        <CardHeader className="p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-muted-foreground mr-2">
              {queueConfig.find((q) => q.key === selectedQueue)?.label} Jobs
            </span>
            {['completed', 'failed', 'active', 'waiting', 'delayed'].map((s) => (
              <Button
                key={s}
                variant={selectedStatus === s ? 'primary' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setSelectedStatus(s)}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent padded={false}>
          {jobs.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No {selectedStatus} jobs in the {selectedQueue} queue
            </div>
          ) : (
            <div className="divide-y divide-border">
              {jobs.map((job) => (
                <div key={job.id} className="px-4 py-3 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">#{job.id}</span>
                        <span className="text-sm font-medium">{job.name}</span>
                        <Badge variant={statusBadge[job.status]?.variant || 'outline'} className="text-[10px]">
                          {statusBadge[job.status]?.label || job.status}
                        </Badge>
                        {job.attemptsMade > 0 && (
                          <span className="text-[10px] text-muted-foreground">
                            attempt {job.attemptsMade}
                          </span>
                        )}
                      </div>
                      {job.failedReason && (
                        <p className="text-xs text-destructive mt-1 truncate">{job.failedReason}</p>
                      )}
                      <div className="text-[11px] text-muted-foreground mt-1">
                        {'to' in job.data && <span>To: {String(job.data.to)} </span>}
                        {'webhookUrl' in job.data && <span>URL: {String(job.data.webhookUrl)} </span>}
                        {'tenantSlug' in job.data && <span>Tenant: {String(job.data.tenantSlug)} </span>}
                        {'eventType' in job.data && <span>Event: {String(job.data.eventType)} </span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-muted-foreground">
                        {job.timestamp ? formatDateTime(new Date(job.timestamp).toISOString()) : ''}
                      </p>
                      {job.finishedOn && (
                        <p className="text-[10px] text-muted-foreground">
                          Finished: {formatDateTime(new Date(job.finishedOn).toISOString())}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}

function SummaryCard({ icon: Icon, label, count, color }: { icon: typeof Clock; label: string; count: number; color: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-center">
      <Icon className={`h-4 w-4 mx-auto mb-1 ${color}`} />
      <p className="text-xl font-bold text-foreground">{count}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
