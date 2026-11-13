'use client';

import { useState } from 'react';
import {
  PageContainer,
  PageHeader,
  useRBAC,
  useApi,
  ImportWizard,
  ImportHistory,
  Button,
  Badge,
  Skeleton,
  EmptyState,
} from '@saas/ui';
import { forbidden } from 'next/navigation';
import { Upload, FileSpreadsheet, Download } from 'lucide-react';
import { toast } from 'sonner';

interface ImportDefinition {
  key: string;
  entity: string;
  label: string;
  description?: string;
  maxRows?: number;
  columns: Array<{ header: string; type: string; required?: boolean }>;
}

export default function ImportsPage() {
  const { authorize, isLoading: isRBACLoading } = useRBAC();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedImportKey, setSelectedImportKey] = useState<string>('');

  if (!isRBACLoading && !authorize({ roles: ['ADMIN'] })) {
    forbidden();
  }

  const { data: definitions, loading } = useApi<ImportDefinition[]>(
    '/imports/definitions',
    undefined,
    { skip: isRBACLoading },
  );

  function openImport(importKey: string) {
    setSelectedImportKey(importKey);
    setWizardOpen(true);
  }

  if (isRBACLoading) {
    return (
      <PageContainer>
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full" />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Data Import"
        description="Import data from CSV or Excel files into the system."
      />

      {/* Available imports */}
      <div className="mt-6">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Available Imports
        </h3>

        {loading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
          </div>
        ) : !definitions || definitions.length === 0 ? (
          <EmptyState
            icon={<FileSpreadsheet className="h-8 w-8" />}
            title="No import types available"
            description="Import definitions are registered by plugins. Enable a plugin that supports data import."
          />
        ) : (
          <div className="space-y-2">
            {definitions.map((def) => (
              <div
                key={def.key}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{def.label}</span>
                      <Badge variant="outline" className="text-xs">{def.entity}</Badge>
                    </div>
                    {def.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{def.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {def.columns.length} columns, max {def.maxRows ?? 10000} rows
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      try {
                        const response = await fetch(
                          `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/imports/templates/${def.key}`,
                          { credentials: 'include' },
                        );
                        const blob = await response.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${def.key}-template.xlsx`;
                        a.click();
                        URL.revokeObjectURL(url);
                      } catch {
                        toast.error('Failed to download template');
                      }
                    }}
                  >
                    <Download className="mr-1 h-4 w-4" />
                    Template
                  </Button>
                  <Button size="sm" onClick={() => openImport(def.key)}>
                    <Upload className="mr-1 h-4 w-4" />
                    Import
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Import History */}
      <div className="mt-8">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Import History
        </h3>
        <ImportHistory />
      </div>

      {/* Import Wizard */}
      {selectedImportKey && (
        <ImportWizard
          importKey={selectedImportKey}
          isOpen={wizardOpen}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </PageContainer>
  );
}
