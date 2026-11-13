'use client';

import { useState } from 'react';
import {
  PageContainer,
  PageHeader,
  useRBAC,
  useApi,
  apiClient,
  WorkflowStepManager,
  Badge,
  Button,
  Skeleton,
} from '@saas/ui';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@saas/ui';
import { forbidden } from 'next/navigation';
import { ChevronDown, ChevronRight, GitBranch, Plus } from 'lucide-react';
import { toast } from 'sonner';

interface WorkflowProcess {
  id: string;
  pluginKey: string;
  processKey: string;
  name: string;
  description?: string;
  steps: Array<{
    id: string;
    state: string;
    label: string;
    isActive: boolean;
    isMandatory: boolean;
  }>;
}

interface WorkflowTemplate {
  id: string;
  name: string;
  category: string;
  description?: string;
  isActive: boolean;
  steps: Array<{
    state: string;
    label: string;
    isMandatory: boolean;
  }>;
}

export default function WorkflowsPage() {
  const { authorize, isLoading: isRBACLoading } = useRBAC();
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [activateDialogOpen, setActivateDialogOpen] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null);

  if (!isRBACLoading && !authorize({ permissions: ['system.workflow.manage'] })) {
    forbidden();
  }

  const { data: processes, loading, refetch } = useApi<WorkflowProcess[]>(
    '/workflow/processes',
    undefined,
    { skip: isRBACLoading },
  );

  const { data: templates } = useApi<WorkflowTemplate[]>(
    '/workflow-templates',
    undefined,
    { skip: isRBACLoading },
  );

  // Filter out templates that are already activated (by matching category + name pattern)
  const activatedProcessKeys = new Set((processes || []).map((p) => p.processKey));
  const availableTemplates = (templates || []).filter((t) => {
    const processKey = `${t.category}.${t.name.toLowerCase().replace(/\s+/g, '-')}`;
    return t.isActive && !activatedProcessKeys.has(processKey);
  });

  function toggleExpand(processKey: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(processKey)) {
        next.delete(processKey);
      } else {
        next.add(processKey);
      }
      return next;
    });
  }

  async function handleActivate() {
    if (!selectedTemplate) return;
    setIsActivating(true);
    try {
      await apiClient.post(`/workflow-templates/${selectedTemplate.id}/activate`);
      toast.success(`Workflow "${selectedTemplate.name}" activated`);
      setActivateDialogOpen(false);
      setSelectedTemplate(null);
      refetch();
    } catch (err: any) {
      toast.error(err.message || 'Failed to activate workflow');
    } finally {
      setIsActivating(false);
    }
  }

  if (isRBACLoading) {
    return (
      <PageContainer>
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Workflow Management"
        description="Configure workflow steps for each business process. Toggle steps on or off to customize the flow for your organization."
      />

      {availableTemplates.length > 0 && (
        <div className="mt-4 flex justify-end">
          <Button onClick={() => setActivateDialogOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Activate Workflow
          </Button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3 mt-6">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : !processes || processes.length === 0 ? (
        <div className="mt-6 flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <GitBranch className="h-10 w-10 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-medium">No workflows configured</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {availableTemplates.length > 0
              ? 'Activate a workflow template to get started.'
              : 'Workflow templates are created by the system administrator. Contact your admin to set up workflows.'}
          </p>
          {availableTemplates.length > 0 && (
            <Button className="mt-4" onClick={() => setActivateDialogOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Activate Workflow
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {processes.map((process) => {
            const isExpanded = expandedKeys.has(process.processKey);
            const activeCount = process.steps.filter((s) => s.isActive).length;
            const totalCount = process.steps.length;

            return (
              <div
                key={process.id}
                className="rounded-lg border border-border bg-card overflow-hidden"
              >
                <button
                  onClick={() => toggleExpand(process.processKey)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{process.name}</span>
                        <Badge variant="outline" className="text-xs">
                          {process.pluginKey}
                        </Badge>
                      </div>
                      {process.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {process.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {activeCount}/{totalCount} steps active
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-t-border px-4 py-4">
                    <WorkflowStepManager processKey={process.processKey} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Activate Workflow Template Dialog */}
      <DialogRoot open={activateDialogOpen} onOpenChange={setActivateDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Activate Workflow</DialogTitle>
            <DialogDescription>
              Choose a workflow template to activate for your organization.
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 py-4 space-y-2 max-h-96 overflow-y-auto">
            {availableTemplates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No templates available to activate.
              </p>
            ) : (
              availableTemplates.map((template) => (
                <button
                  key={template.id}
                  onClick={() => setSelectedTemplate(template)}
                  className={`w-full text-left rounded-lg border p-3 transition-colors ${
                    selectedTemplate?.id === template.id
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{template.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {template.category}
                    </Badge>
                  </div>
                  {template.description && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {template.description}
                    </p>
                  )}
                  <div className="text-xs text-muted-foreground mt-1">
                    {template.steps.map((s) => s.label).join(' → ')}
                  </div>
                </button>
              ))
            )}
          </div>

          <DialogFooter className="gap-2 pt-4">
            <Button variant="outline" onClick={() => setActivateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleActivate}
              disabled={!selectedTemplate || isActivating}
            >
              {isActivating ? 'Activating...' : 'Activate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>
    </PageContainer>
  );
}
