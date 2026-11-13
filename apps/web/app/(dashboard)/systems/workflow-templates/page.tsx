'use client';

import { useState } from 'react';
import {
  PageContainer,
  PageHeader,
  useRBAC,
  useApi,
  apiClient,
  ApiRequestError,
  Badge,
  Button,
  Skeleton,
  EmptyState,
} from '@saas/ui';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@saas/ui';
import { ConfirmDialog } from '@saas/ui';
import { Input } from '@saas/ui';
import { Textarea } from '@saas/ui';
import { Switch } from '@saas/ui';
import { forbidden } from 'next/navigation';
import {
  Plus,
  Edit,
  Trash2,
  GitBranch,
  ArrowUp,
  ArrowDown,
  X,
  Lock,
} from 'lucide-react';
import { toast } from 'sonner';

interface TemplateStep {
  id?: string;
  state: string;
  label: string;
  sortOrder: number;
  isMandatory: boolean;
  permissions: string[];
}

interface WorkflowTemplate {
  id: string;
  name: string;
  category: string;
  description?: string;
  isActive: boolean;
  steps: TemplateStep[];
  createdAt: string;
}

const EMPTY_STEP: TemplateStep = {
  state: '',
  label: '',
  sortOrder: 0,
  isMandatory: false,
  permissions: [],
};

export default function WorkflowTemplatesPage() {
  const { authorize, hasRole, isLoading: isRBACLoading } = useRBAC();

  if (!isRBACLoading && !hasRole('SYSADMIN')) {
    forbidden();
  }

  const { data: templates, loading, refetch } = useApi<WorkflowTemplate[]>(
    '/workflow-templates',
    undefined,
    { skip: isRBACLoading },
  );

  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<WorkflowTemplate | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Wizard state
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<TemplateStep[]>([]);
  const [wizardStep, setWizardStep] = useState(0); // 0: info, 1: steps, 2: review

  function openCreate() {
    setEditingTemplate(null);
    setName('');
    setCategory('');
    setDescription('');
    setSteps([
      { state: '', label: '', sortOrder: 1, isMandatory: true, permissions: [] },
      { state: '', label: '', sortOrder: 2, isMandatory: false, permissions: [] },
    ]);
    setWizardStep(0);
    setWizardOpen(true);
  }

  function openEdit(template: WorkflowTemplate) {
    setEditingTemplate(template);
    setName(template.name);
    setCategory(template.category);
    setDescription(template.description || '');
    setSteps(
      template.steps.map((s, i) => ({
        state: s.state,
        label: s.label,
        sortOrder: i + 1,
        isMandatory: s.isMandatory,
        permissions: s.permissions,
      })),
    );
    setWizardStep(0);
    setWizardOpen(true);
  }

  function addStep() {
    setSteps((prev) => [
      ...prev,
      { state: '', label: '', sortOrder: prev.length + 1, isMandatory: false, permissions: [] },
    ]);
  }

  function removeStep(index: number) {
    if (steps.length <= 2) {
      toast.error('A workflow must have at least 2 steps');
      return;
    }
    setSteps((prev) => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, sortOrder: i + 1 })));
  }

  function moveStep(index: number, direction: 'up' | 'down') {
    const newSteps = [...steps];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newSteps.length) return;
    [newSteps[index], newSteps[swapIndex]] = [newSteps[swapIndex], newSteps[index]];
    setSteps(newSteps.map((s, i) => ({ ...s, sortOrder: i + 1 })));
  }

  function updateStep(index: number, field: keyof TemplateStep, value: any) {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    );
  }

  function canProceedToSteps() {
    return name.trim().length > 0 && category.trim().length > 0;
  }

  function canProceedToReview() {
    return (
      steps.length >= 2 &&
      steps.every((s) => s.state.trim().length > 0 && s.label.trim().length > 0) &&
      new Set(steps.map((s) => s.state)).size === steps.length
    );
  }

  async function handleSave() {
    setIsSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        category: category.trim().toLowerCase(),
        description: description.trim() || undefined,
        steps: steps.map((s) => ({
          state: s.state.trim().toUpperCase(),
          label: s.label.trim(),
          sortOrder: s.sortOrder,
          isMandatory: s.isMandatory,
          permissions: s.permissions.filter((p) => p.length > 0),
        })),
      };

      if (editingTemplate) {
        await apiClient.patch(`/workflow-templates/${editingTemplate.id}`, payload);
        toast.success('Workflow template updated');
      } else {
        await apiClient.post('/workflow-templates', payload);
        toast.success('Workflow template created');
      }

      setWizardOpen(false);
      refetch();
    } catch (err: any) {
      toast.error(err instanceof ApiRequestError ? err.message : 'Failed to save template');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await apiClient.delete(`/workflow-templates/${deleteId}`);
      toast.success('Template deleted');
      setDeleteId(null);
      refetch();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete');
    }
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

  // Group templates by category
  const grouped = (templates || []).reduce<Record<string, WorkflowTemplate[]>>((acc, t) => {
    acc[t.category] = acc[t.category] || [];
    acc[t.category].push(t);
    return acc;
  }, {});

  return (
    <PageContainer>
      <PageHeader
        title="Workflow Templates"
        description="Create and manage workflow templates. Tenants can activate these templates to use in their business processes."
      />

      <div className="mt-4 flex justify-end">
        <Button onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" />
          Create Template
        </Button>
      </div>

      {loading ? (
        <div className="mt-6 space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : !templates || templates.length === 0 ? (
        <EmptyState
          icon={<GitBranch className="h-8 w-8" />}
          title="No workflow templates"
          description="Create your first workflow template to get started."
          action={
            <Button onClick={openCreate}>
              <Plus className="mr-1 h-4 w-4" />
              Create Template
            </Button>
          }
        />
      ) : (
        <div className="mt-6 space-y-6">
          {Object.entries(grouped).map(([cat, tmpls]) => (
            <div key={cat}>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {cat}
              </h3>
              <div className="space-y-2">
                {tmpls.map((template) => (
                  <div
                    key={template.id}
                    className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <GitBranch className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{template.name}</span>
                          <Badge variant={template.isActive ? 'success' : 'outline'}>
                            {template.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {template.steps.length} steps: {template.steps.map((s) => s.label).join(' → ')}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(template)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleteId(template.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Wizard */}
      <DialogRoot open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? 'Edit' : 'Create'} Workflow Template
            </DialogTitle>
            <DialogDescription>
              {wizardStep === 0 && 'Name your workflow and assign a category.'}
              {wizardStep === 1 && 'Define the steps in your workflow. Add, remove, and reorder as needed.'}
              {wizardStep === 2 && 'Review your workflow before saving.'}
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 py-4 space-y-4">
            {/* Step indicator */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
              {['Details', 'Steps', 'Review'].map((label, i) => (
                <div key={label} className="flex items-center gap-1">
                  <div
                    className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-medium ${
                      i === wizardStep
                        ? 'bg-primary text-primary-foreground'
                        : i < wizardStep
                          ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {i + 1}
                  </div>
                  <span className={i === wizardStep ? 'font-medium text-foreground' : ''}>{label}</span>
                  {i < 2 && <span className="mx-1">→</span>}
                </div>
              ))}
            </div>

            {/* Step 0: Details */}
            {wizardStep === 0 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Workflow Name <span className="text-red-500">*</span></label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Basic Purchasing"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Category <span className="text-red-500">*</span></label>
                  <Input
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="e.g., purchasing, selling, expense"
                  />
                  <p className="text-xs text-muted-foreground">
                    Group related workflows under the same category (e.g., &ldquo;purchasing&rdquo; for all purchase order variants).
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Description</label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Brief description of this workflow..."
                    rows={2}
                  />
                </div>
              </div>
            )}

            {/* Step 1: Steps */}
            {wizardStep === 1 && (
              <div className="space-y-3">
                {steps.map((step, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-2 rounded-md border p-3"
                  >
                    <span className="text-sm font-medium text-muted-foreground mt-2 w-6">
                      {index + 1}.
                    </span>
                    <div className="flex-1 space-y-2">
                      <div className="flex gap-2">
                        <Input
                          value={step.state}
                          onChange={(e) => updateStep(index, 'state', e.target.value.toUpperCase().replace(/\s+/g, '_'))}
                          placeholder="STATE_CODE"
                          className="w-40 font-mono text-sm"
                        />
                        <Input
                          value={step.label}
                          onChange={(e) => updateStep(index, 'label', e.target.value)}
                          placeholder="Display Label"
                          className="flex-1"
                        />
                      </div>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Switch
                            checked={step.isMandatory}
                            onCheckedChange={(v: boolean) => updateStep(index, 'isMandatory', v)}
                          />
                          <span className="flex items-center gap-1">
                            <Lock className="h-3 w-3" /> Required
                          </span>
                        </label>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => moveStep(index, 'up')}
                        disabled={index === 0}
                        className="h-7 w-7 p-0"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => moveStep(index, 'down')}
                        disabled={index === steps.length - 1}
                        className="h-7 w-7 p-0"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeStep(index)}
                        disabled={steps.length <= 2}
                        className="h-7 w-7 p-0"
                      >
                        <X className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addStep}>
                  <Plus className="mr-1 h-3 w-3" />
                  Add Step
                </Button>
              </div>
            )}

            {/* Step 2: Review */}
            {wizardStep === 2 && (
              <div className="space-y-4">
                <div className="rounded-md border p-4 space-y-2">
                  <div className="text-sm">
                    <span className="font-medium">Name:</span> {name}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Category:</span> {category}
                  </div>
                  {description && (
                    <div className="text-sm">
                      <span className="font-medium">Description:</span> {description}
                    </div>
                  )}
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-sm font-medium mb-2">Flow:</div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {steps.map((step, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <span className="text-sm">
                          {step.label}
                          {step.isMandatory && (
                            <Lock className="inline h-3 w-3 ml-0.5 text-muted-foreground" />
                          )}
                        </span>
                        {i < steps.length - 1 && (
                          <span className="text-muted-foreground mx-1">→</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">
                    {steps.length} steps, {steps.filter((s) => s.isMandatory).length} required
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 pt-4">
            {wizardStep > 0 && (
              <Button variant="outline" onClick={() => setWizardStep((s) => s - 1)}>
                Back
              </Button>
            )}
            <Button variant="outline" onClick={() => setWizardOpen(false)}>
              Cancel
            </Button>
            {wizardStep < 2 ? (
              <Button
                onClick={() => setWizardStep((s) => s + 1)}
                disabled={
                  (wizardStep === 0 && !canProceedToSteps()) ||
                  (wizardStep === 1 && !canProceedToReview())
                }
              >
                Next
              </Button>
            ) : (
              <Button onClick={handleSave} disabled={isSubmitting}>
                {isSubmitting
                  ? 'Saving...'
                  : editingTemplate
                    ? 'Update Template'
                    : 'Create Template'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </DialogRoot>

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Template"
        description="Are you sure you want to delete this workflow template? This cannot be undone. Tenants who have already activated it will keep their copy."
        confirmText="Delete"
      />
    </PageContainer>
  );
}
