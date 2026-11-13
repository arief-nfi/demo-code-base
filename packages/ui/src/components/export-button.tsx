'use client';

import { useState } from 'react';
import { Download, FileSpreadsheet, FileText, FileJson, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { API_URL, getAuthHeaders } from '../lib/api';

export interface ExportButtonProps {
  endpoint: string;
  formats?: ('csv' | 'xlsx' | 'json')[];
  filename?: string;
  params?: Record<string, string | number | undefined>;
  disabled?: boolean;
  size?: 'sm' | 'default';
}

const formatConfig = {
  csv: { label: 'CSV', icon: FileText, mime: 'text/csv' },
  xlsx: { label: 'Excel', icon: FileSpreadsheet, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  json: { label: 'JSON', icon: FileJson, mime: 'application/json' },
};

export function ExportButton({
  endpoint,
  formats = ['csv', 'xlsx', 'json'],
  filename = 'export',
  params,
  disabled = false,
  size = 'sm',
}: ExportButtonProps) {
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const handleExport = async (format: 'csv' | 'xlsx' | 'json') => {
    setLoading(true);
    setOpen(false);

    try {
      const searchParams = new URLSearchParams();
      searchParams.set('format', format);
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          if (v !== undefined && v !== '') searchParams.set(k, String(v));
        });
      }

      const url = `${API_URL}${endpoint}?${searchParams.toString()}`;
      const response = await fetch(url, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Export failed: ${response.statusText}`);
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${filename}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);

      toast.success(`Exported as ${formatConfig[format].label}`);
    } catch (error) {
      console.warn('Export failed', error);
      toast.error('Failed to export data');
    } finally {
      setLoading(false);
    }
  };

  const sizeClasses = size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-4 text-sm';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled || loading}
        className={`inline-flex items-center gap-1.5 rounded-md border border-input bg-background font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none ${sizeClasses}`}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        Export
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-36 origin-top-right rounded-md border border-border bg-popover p-1 shadow-md">
            {formats.map((format) => {
              const config = formatConfig[format];
              const Icon = config.icon;
              return (
                <button
                  key={format}
                  type="button"
                  onClick={() => handleExport(format)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {config.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
