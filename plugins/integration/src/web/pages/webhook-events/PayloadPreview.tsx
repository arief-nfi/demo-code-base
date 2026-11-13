'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button, useLanguage } from '@saas/ui';

interface PayloadPreviewProps {
  label: string;
  data: unknown;
}

export function PayloadPreview({ label, data }: PayloadPreviewProps) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);

  const formatted = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for environments without clipboard API
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium leading-none text-foreground">{label}</label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={handleCopy}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              {t('integration.webhookEvents.copied')}
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              {t('integration.webhookEvents.copyPayload')}
            </>
          )}
        </Button>
      </div>
      <pre className="rounded-md border bg-muted/30 p-4 text-sm font-mono overflow-auto max-h-64 text-foreground">
        {formatted}
      </pre>
    </div>
  );
}
