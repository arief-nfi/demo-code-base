'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Plus, X, Save, ShieldAlert, EyeOff, Filter, Settings, Clock,
} from 'lucide-react';
import {
  apiClient, PageContainer, PageHeader, Button, Input, Label, Badge,
  Card, CardHeader, CardTitle, CardDescription, CardContent,
  Switch, Checkbox,
  cn, useLanguage,
} from '@saas/ui';
import { toast } from 'sonner';

type FieldConfig = Record<string, string[]>;
type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'READ';

interface EntityFilter {
  mode: 'include' | 'exclude';
  entities: string[];
  actions?: Record<string, AuditAction[]>;
}

interface RetentionPolicy {
  enabled: boolean;
  type: 'time' | 'count';
  retainDays?: number;
  keepCount?: number;
  backup: boolean;
}

interface AuditConfig {
  sensitiveFields: FieldConfig;
  ignoredFields: FieldConfig;
  entityFilter: EntityFilter | null;
  retentionPolicy: RetentionPolicy | null;
}

// ─── Field Config Editor Component ──────────────────────────────

interface FieldConfigEditorProps {
  config: FieldConfig;
  onChange: (config: FieldConfig) => void;
  globalLabel: string;
  modelLabel: string;
  fieldPlaceholder: string;
  addModelLabel: string;
}

function FieldConfigEditor({
  config,
  onChange,
  globalLabel,
  modelLabel,
  fieldPlaceholder,
  addModelLabel,
}: FieldConfigEditorProps) {
  const [newModelName, setNewModelName] = useState('');
  const [fieldInputs, setFieldInputs] = useState<Record<string, string>>({});

  const addField = (model: string) => {
    const fieldName = fieldInputs[model]?.trim();
    if (!fieldName) return;
    const current = config[model] ?? [];
    if (current.includes(fieldName)) {
      toast.error(`Field "${fieldName}" already exists`);
      return;
    }
    onChange({ ...config, [model]: [...current, fieldName] });
    setFieldInputs((prev) => ({ ...prev, [model]: '' }));
  };

  const removeField = (model: string, field: string) => {
    const current = config[model] ?? [];
    const updated = current.filter((f) => f !== field);
    if (updated.length === 0 && model !== '*') {
      const { [model]: _, ...rest } = config;
      onChange(rest);
    } else {
      onChange({ ...config, [model]: updated });
    }
  };

  const addModel = () => {
    const name = newModelName.trim();
    if (!name) return;
    if (name === '*') {
      toast.error('Use the Global section for global fields');
      return;
    }
    if (config[name]) {
      toast.error(`Model "${name}" already exists`);
      return;
    }
    onChange({ ...config, [name]: [] });
    setNewModelName('');
  };

  const removeModel = (model: string) => {
    const { [model]: _, ...rest } = config;
    onChange(rest);
  };

  const handleFieldKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, model: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addField(model);
    }
  };

  const models = Object.keys(config).filter((k) => k !== '*');

  return (
    <div className="space-y-4">
      {/* Global fields */}
      <div className="rounded-lg border border-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">{globalLabel}</Label>
          <Badge variant="outline" className="text-xs">*</Badge>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(config['*'] ?? []).map((field) => (
            <Badge key={field} variant="outline" className="gap-1 pr-1">
              {field}
              <button
                onClick={() => removeField('*', field)}
                className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={fieldInputs['*'] ?? ''}
            onChange={(e) => setFieldInputs((prev) => ({ ...prev, '*': e.target.value }))}
            onKeyDown={(e) => handleFieldKeyDown(e, '*')}
            placeholder={fieldPlaceholder}
            className="h-8 text-sm"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => addField('*')}
            className="shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Per-model fields */}
      {models.map((model) => (
        <div key={model} className="rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">{model}</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeModel(model)}
              className="h-6 px-2 text-destructive hover:text-destructive"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(config[model] ?? []).map((field) => (
              <Badge key={field} variant="outline" className="gap-1 pr-1">
                {field}
                <button
                  onClick={() => removeField(model, field)}
                  className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
            {(config[model] ?? []).length === 0 && (
              <span className="text-xs text-muted-foreground italic">No fields configured</span>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              value={fieldInputs[model] ?? ''}
              onChange={(e) => setFieldInputs((prev) => ({ ...prev, [model]: e.target.value }))}
              onKeyDown={(e) => handleFieldKeyDown(e, model)}
              placeholder={fieldPlaceholder}
              className="h-8 text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => addField(model)}
              className="shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      ))}

      {/* Add model */}
      <div className="flex gap-2">
        <Input
          value={newModelName}
          onChange={(e) => setNewModelName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addModel();
            }
          }}
          placeholder={modelLabel}
          className="h-8 text-sm"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addModel}
          className="shrink-0 gap-1"
        >
          <Plus className="w-3.5 h-3.5" />
          {addModelLabel}
        </Button>
      </div>
    </div>
  );
}

// ─── Entity Filter Editor Component ─────────────────────────────

const AUDIT_ACTIONS: AuditAction[] = ['CREATE', 'UPDATE', 'DELETE', 'READ'];

interface EntityFilterEditorProps {
  filter: EntityFilter;
  onChange: (filter: EntityFilter) => void;
  t: (key: string) => string;
}

function EntityFilterEditor({ filter, onChange, t }: EntityFilterEditorProps) {
  const [newEntity, setNewEntity] = useState('');
  const [newActionModel, setNewActionModel] = useState('');

  // ── Entity include/exclude list ──

  const toggleMode = () => {
    onChange({
      mode: filter.mode === 'include' ? 'exclude' : 'include',
      entities: [],
      actions: filter.actions,
    });
  };

  const addEntity = () => {
    const name = newEntity.trim();
    if (!name) return;
    if (name === 'AuditLog') {
      toast.error(t('auditConfig.entityFilter.auditLogProtected') || 'AuditLog is always excluded from auditing');
      return;
    }
    if (filter.entities.includes(name)) {
      toast.error(`"${name}" already exists`);
      return;
    }
    onChange({ ...filter, entities: [...filter.entities, name] });
    setNewEntity('');
  };

  const removeEntity = (entity: string) => {
    onChange({ ...filter, entities: filter.entities.filter((e) => e !== entity) });
  };

  // ── Per-model action filter ──

  const addActionModel = () => {
    const name = newActionModel.trim();
    if (!name) return;
    if (filter.actions?.[name]) {
      toast.error(`"${name}" already has action filter`);
      return;
    }
    onChange({ ...filter, actions: { ...filter.actions, [name]: [...AUDIT_ACTIONS] } });
    setNewActionModel('');
  };

  const removeActionModel = (model: string) => {
    const actions = { ...filter.actions };
    delete actions[model];
    onChange({ ...filter, actions });
  };

  const toggleAction = (model: string, action: AuditAction) => {
    const current = filter.actions?.[model] ?? [];
    const updated = current.includes(action)
      ? current.filter((a) => a !== action)
      : [...current, action];

    const actions = { ...filter.actions };
    if (updated.length === 0) {
      delete actions[model];
    } else {
      actions[model] = updated;
    }
    onChange({ ...filter, actions });
  };

  const actionModels = Object.keys(filter.actions ?? {});

  return (
    <div className="space-y-6">
      {/* ── Section 1: Entity Include/Exclude ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={filter.mode === 'include'}
            onCheckedChange={toggleMode}
          />
          <Label className="text-sm font-medium">
            {filter.mode === 'include'
              ? (t('auditConfig.entityFilter.includeMode') || 'Include mode (allowlist)')
              : (t('auditConfig.entityFilter.excludeMode') || 'Exclude mode (blocklist)')}
          </Label>
        </div>
        <p className="text-xs text-muted-foreground">
          {filter.mode === 'include'
            ? (t('auditConfig.entityFilter.includeModeDesc') || 'Only entities listed below will be audited.')
            : (t('auditConfig.entityFilter.excludeModeDesc') || 'All entities are audited except those listed below. AuditLog is always excluded.')}
        </p>

        {/* Entity badges */}
        <div className="flex flex-wrap gap-1.5">
          {filter.mode === 'exclude' && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              AuditLog ({t('auditConfig.entityFilter.auditLogProtected') || 'always excluded'})
            </Badge>
          )}
          {filter.entities.map((entity) => (
            <Badge key={entity} variant="outline" className="gap-1 pr-1">
              {entity}
              <button
                onClick={() => removeEntity(entity)}
                className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>

        {/* Add entity input */}
        <div className="flex gap-2">
          <Input
            value={newEntity}
            onChange={(e) => setNewEntity(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); addEntity(); }
            }}
            placeholder={t('auditConfig.entityFilter.entityPlaceholder') || 'Entity name to exclude/include'}
            className="h-8 text-sm"
          />
          <Button type="button" variant="outline" size="sm" onClick={addEntity} className="shrink-0 gap-1">
            <Plus className="w-3.5 h-3.5" />
            {t('auditConfig.entityFilter.addEntity') || 'Add Entity'}
          </Button>
        </div>
      </div>

      {/* ── Section 2: Per-Model Action Filter ── */}
      <div className="space-y-3 border-t border-border pt-4">
        <Label className="text-sm font-medium">
          {t('auditConfig.entityFilter.actionFilterTitle') || 'Per-Model Action Filter'}
        </Label>
        <p className="text-xs text-muted-foreground">
          {t('auditConfig.entityFilter.actionFilterDesc') || 'Restrict which actions are audited for specific models. Models without an action filter audit all actions.'}
        </p>

        {actionModels.map((model) => (
          <div key={model} className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">{model}</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeActionModel(model)}
                className="h-6 px-2 text-destructive hover:text-destructive"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-4">
              {AUDIT_ACTIONS.map((action) => (
                <label key={action} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <Checkbox
                    checked={(filter.actions?.[model] ?? []).includes(action)}
                    onChange={() => toggleAction(model, action)}
                  />
                  {action}
                </label>
              ))}
            </div>
          </div>
        ))}

        {/* Add action model input */}
        <div className="flex gap-2">
          <Input
            value={newActionModel}
            onChange={(e) => setNewActionModel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); addActionModel(); }
            }}
            placeholder={t('auditConfig.entityFilter.actionModelPlaceholder') || 'Model name (e.g. User, Permission)'}
            className="h-8 text-sm"
          />
          <Button type="button" variant="outline" size="sm" onClick={addActionModel} className="shrink-0 gap-1">
            <Plus className="w-3.5 h-3.5" />
            {t('auditConfig.entityFilter.addActionFilter') || 'Add Action Filter'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Scheduled Retention Editor Component ────────────────────────

interface ScheduledRetentionEditorProps {
  policy: RetentionPolicy;
  onChange: (policy: RetentionPolicy) => void;
  t: (key: string) => string;
}

function ScheduledRetentionEditor({ policy, onChange, t }: ScheduledRetentionEditorProps) {
  return (
    <div className="space-y-4">
      {/* Enable/Disable Toggle */}
      <label className="flex items-center gap-3 cursor-pointer group">
        <input
          type="checkbox"
          checked={policy.enabled}
          onChange={(e) => onChange({ ...policy, enabled: e.target.checked })}
          className="w-4 h-4 text-primary focus:ring-primary rounded border-border"
        />
        <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
          {t('auditConfig.scheduledRetention.enable') || 'Enable scheduled retention'}
        </span>
      </label>

      {policy.enabled && (
        <>
          {/* Retention Type */}
          <div className="space-y-3">
            <Label>{t('auditConfig.scheduledRetention.retentionType') || 'Retention Type'}</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="retentionPolicyType"
                  value="time"
                  checked={policy.type === 'time'}
                  onChange={() => onChange({ ...policy, type: 'time' })}
                  className="w-4 h-4 text-primary focus:ring-primary"
                />
                <span className="text-sm">{t('auditConfig.scheduledRetention.byDate') || 'By Date'}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="retentionPolicyType"
                  value="count"
                  checked={policy.type === 'count'}
                  onChange={() => onChange({ ...policy, type: 'count' })}
                  className="w-4 h-4 text-primary focus:ring-primary"
                />
                <span className="text-sm">{t('auditConfig.scheduledRetention.byCount') || 'By Record Count'}</span>
              </label>
            </div>
          </div>

          {/* Threshold */}
          {policy.type === 'time' ? (
            <div className="space-y-2">
              <Label>{t('auditConfig.scheduledRetention.retainDays') || 'Retain days'}</Label>
              <Input
                type="number"
                min="1"
                value={policy.retainDays ?? 90}
                onChange={(e) => onChange({ ...policy, retainDays: parseInt(e.target.value) || undefined })}
                placeholder="90"
                className="h-10 max-w-xs"
              />
              <p className="text-xs text-muted-foreground">
                {t('auditConfig.scheduledRetention.retainDaysHelp') || 'Logs older than this number of days will be automatically deleted.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>{t('auditConfig.scheduledRetention.keepCount') || 'Keep record count'}</Label>
              <Input
                type="number"
                min="1"
                value={policy.keepCount ?? 10000}
                onChange={(e) => onChange({ ...policy, keepCount: parseInt(e.target.value) || undefined })}
                placeholder="10000"
                className="h-10 max-w-xs"
              />
              <p className="text-xs text-muted-foreground">
                {t('auditConfig.scheduledRetention.keepCountHelp') || 'Only the specified number of most recent logs will be kept per tenant.'}
              </p>
            </div>
          )}

          {/* Backup Toggle */}
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={policy.backup}
              onChange={(e) => onChange({ ...policy, backup: e.target.checked })}
              className="w-4 h-4 text-primary focus:ring-primary rounded border-border"
            />
            <div className="flex-1">
              <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                {t('auditConfig.scheduledRetention.backupBeforeDelete') || 'Backup logs before deletion'}
              </span>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t('auditConfig.scheduledRetention.backupHelp') || 'Deleted logs will be saved to a JSON file in the backups directory.'}
              </p>
            </div>
          </label>
        </>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────

export function AuditConfigPage() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isRetentionRunning, setIsRetentionRunning] = useState(false);
  const [config, setConfig] = useState<AuditConfig>({
    sensitiveFields: { '*': [] },
    ignoredFields: { '*': [] },
    entityFilter: null,
    retentionPolicy: null,
  });

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient.get<AuditConfig & { isRetentionRunning?: boolean }>('/plugins/audit-log/config');
      setConfig({
        sensitiveFields: data.sensitiveFields ?? { '*': [] },
        ignoredFields: data.ignoredFields ?? { '*': [] },
        entityFilter: data.entityFilter ?? null,
        retentionPolicy: data.retentionPolicy ?? null,
      });
      setIsRetentionRunning(data.isRetentionRunning ?? false);
    } catch {
      toast.error(t('auditConfig.fetchError') || 'Failed to load audit configuration');
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = await apiClient.put<AuditConfig & { isRetentionRunning?: boolean }>('/plugins/audit-log/config', config);
      setConfig({
        sensitiveFields: data.sensitiveFields ?? config.sensitiveFields,
        ignoredFields: data.ignoredFields ?? config.ignoredFields,
        entityFilter: data.entityFilter ?? config.entityFilter,
        retentionPolicy: data.retentionPolicy ?? config.retentionPolicy,
      });
      setIsRetentionRunning(data.isRetentionRunning ?? false);
      toast.success(t('auditConfig.saveSuccess') || 'Audit configuration saved successfully');
    } catch {
      toast.error(t('auditConfig.saveError') || 'Failed to save audit configuration');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('auditConfig.title') || 'Audit Configuration'}
        description={t('auditConfig.description') || 'Configure which fields are redacted or excluded from audit logs'}
      >
        <div className="flex gap-2">
          <Button onClick={fetchConfig} variant="outline" className="gap-2" disabled={loading}>
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            {t('auditLog.refresh') || 'Refresh'}
          </Button>
          <Button onClick={handleSave} className="gap-2" disabled={saving || loading}>
            <Save className={cn('w-4 h-4', saving && 'animate-pulse')} />
            {saving
              ? (t('auditConfig.saving') || 'Saving...')
              : (t('auditConfig.save') || 'Save Changes')}
          </Button>
        </div>
      </PageHeader>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-6">
          {/* Sensitive Fields Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-orange-500" />
                <CardTitle>{t('auditConfig.sensitiveFields') || 'Sensitive Fields (Redacted)'}</CardTitle>
              </div>
              <CardDescription>
                {t('auditConfig.sensitiveFieldsDescription') || 'Fields listed here will have their values replaced with [REDACTED] in audit logs. The field name still appears but the value is hidden.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldConfigEditor
                config={config.sensitiveFields}
                onChange={(sensitiveFields) => setConfig((prev) => ({ ...prev, sensitiveFields }))}
                globalLabel={t('auditConfig.globalFields') || 'Global (all models)'}
                modelLabel={t('auditConfig.modelNamePlaceholder') || 'Model name (e.g. User, Payment)'}
                fieldPlaceholder={t('auditConfig.fieldPlaceholder') || 'Field name'}
                addModelLabel={t('auditConfig.addModel') || 'Add Model'}
              />
            </CardContent>
          </Card>

          {/* Ignored Fields Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <EyeOff className="w-5 h-5 text-muted-foreground" />
                <CardTitle>{t('auditConfig.ignoredFields') || 'Ignored Fields (Excluded)'}</CardTitle>
              </div>
              <CardDescription>
                {t('auditConfig.ignoredFieldsDescription') || 'Fields listed here are completely removed from audit log changes. If an update only changes ignored fields, no audit record is created.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldConfigEditor
                config={config.ignoredFields}
                onChange={(ignoredFields) => setConfig((prev) => ({ ...prev, ignoredFields }))}
                globalLabel={t('auditConfig.globalFields') || 'Global (all models)'}
                modelLabel={t('auditConfig.modelNamePlaceholder') || 'Model name (e.g. User, Payment)'}
                fieldPlaceholder={t('auditConfig.fieldPlaceholder') || 'Field name'}
                addModelLabel={t('auditConfig.addModel') || 'Add Model'}
              />
            </CardContent>
          </Card>

          {/* Entity Filtering Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Filter className="w-5 h-5 text-blue-500" />
                <CardTitle>{t('auditConfig.entityFilter.title') || 'Entity Filtering'}</CardTitle>
              </div>
              <CardDescription>
                {t('auditConfig.entityFilter.description') || 'Control which entities (models) are audited. Choose include mode to audit only specific entities, or exclude mode to audit everything except listed entities.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {config.entityFilter ? (
                <div className="space-y-4">
                  <EntityFilterEditor
                    filter={config.entityFilter}
                    onChange={(entityFilter) => setConfig((prev) => ({ ...prev, entityFilter }))}
                    t={t}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfig((prev) => ({ ...prev, entityFilter: null }))}
                    className="text-muted-foreground"
                  >
                    {t('auditConfig.entityFilter.resetToDefault') || 'Reset to Default'}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {t('auditConfig.entityFilter.usingDefault') || 'Using default configuration: all entities are audited except AuditLog.'}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfig((prev) => ({
                      ...prev,
                      entityFilter: { mode: 'exclude', entities: [] },
                    }))}
                  >
                    {t('auditConfig.entityFilter.customize') || 'Customize Entity Filtering'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Scheduled Retention Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-purple-500" />
                <CardTitle>{t('auditConfig.scheduledRetention.title') || 'Scheduled Retention'}</CardTitle>
                {isRetentionRunning && (
                  <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">
                    <Clock className="h-3 w-3 animate-spin" />
                    {t('auditConfig.scheduledRetention.cronRunning') || 'Running'}
                  </span>
                )}
              </div>
              <CardDescription>
                {t('auditConfig.scheduledRetention.description') || 'Configure automatic cleanup of old audit logs. The retention job runs daily at 2:00 AM.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {config.retentionPolicy ? (
                <div className="space-y-4">
                  <ScheduledRetentionEditor
                    policy={config.retentionPolicy}
                    onChange={(retentionPolicy) => setConfig((prev) => ({ ...prev, retentionPolicy }))}
                    t={t}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfig((prev) => ({ ...prev, retentionPolicy: null }))}
                    className="text-muted-foreground"
                  >
                    {t('auditConfig.scheduledRetention.resetToDefault') || 'Reset to Default'}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {t('auditConfig.scheduledRetention.usingDefault') || 'Using default configuration: scheduled retention is disabled.'}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfig((prev) => ({
                      ...prev,
                      retentionPolicy: { enabled: false, type: 'time', retainDays: 90, backup: true },
                    }))}
                  >
                    {t('auditConfig.scheduledRetention.customize') || 'Configure Scheduled Retention'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
