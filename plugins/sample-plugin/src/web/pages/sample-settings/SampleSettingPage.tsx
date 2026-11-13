'use client';

import React, { useEffect, useState } from 'react';
import {
  apiClient, Button, Input, Label, PageHeader,
  Protect, useRBAC, Forbidden, useLanguage,
} from '@saas/ui';
import { Plus, Save, Loader2 } from 'lucide-react';

interface SampleSetting {
  id: string;
  key: string;
  value: string;
  description?: string;
}

export const SampleSettingPage = () => {
  const { authorize, isLoading: isRBACLoading } = useRBAC();
  const { t } = useLanguage();

  const [settings, setSettings] = useState<SampleSetting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [newSetting, setNewSetting] = useState<Partial<SampleSetting>>({
    key: '',
    value: '',
    description: '',
  });

  // Fetch all settings
  const fetchSettings = async () => {
    if (isRBACLoading) return;
    try {
      setIsLoading(true);
      const data = await apiClient.get<SampleSetting[]>('/plugins/sample-plugin/settings');
      setSettings(data);
    } catch (error) {
      console.warn('Failed to fetch settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Save or update setting
  const saveSetting = async (setting: Partial<SampleSetting>) => {
    if (!setting.key || !setting.value) return;

    try {
      setIsSaving(true);
      await apiClient.post('/plugins/sample-plugin/settings', {
        id: setting.id || setting.key,
        key: setting.key,
        value: setting.value,
        description: setting.description,
      });
      await fetchSettings();
      setEditingKey(null);
      setNewSetting({ key: '', value: '', description: '' });
    } catch (error) {
      console.error('Failed to save setting:', error);
    } finally {
      setIsSaving(false);
    }
  };

  // Update setting value
  const updateSettingValue = (key: string, field: keyof SampleSetting, value: string) => {
    setSettings(prev =>
      prev.map(s => (s.key === key ? { ...s, [field]: value } : s))
    );
  };

  useEffect(() => {
    if (!isRBACLoading) {
      fetchSettings();
    }
  }, [isRBACLoading]);

  if (isRBACLoading || isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!authorize({ roles: ['ADMIN'] })) {
    return <Forbidden />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('samplePlugin.settings.title')}
        description={t('samplePlugin.settings.description')}
      />

      {/* Add New Setting */}
      <Protect roles={['ADMIN']}>
        <div className="rounded-lg bg-card shadow border border-border overflow-hidden">
          <div className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Plus className="w-5 h-5" />
              {t('samplePlugin.settings.addNew')}
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="block mb-1">
                  {t('samplePlugin.settings.key')} <span className="text-destructive">{t('samplePlugin.settings.required')}</span>
                </Label>
                <Input
                  value={newSetting.key || ''}
                  onChange={(e) => setNewSetting({ ...newSetting, key: e.target.value })}
                  placeholder={t('samplePlugin.settings.keyPlaceholder')}
                />
              </div>
              <div>
                <Label className="block mb-1">
                  {t('samplePlugin.settings.value')} <span className="text-destructive">{t('samplePlugin.settings.required')}</span>
                </Label>
                <Input
                  value={newSetting.value || ''}
                  onChange={(e) => setNewSetting({ ...newSetting, value: e.target.value })}
                  placeholder={t('samplePlugin.settings.valuePlaceholder')}
                />
              </div>
            </div>
            
            <div>
              <Label className="block mb-1">
                {t('samplePlugin.settings.descriptionLabel')}
              </Label>
              <Input
                value={newSetting.description || ''}
                onChange={(e) => setNewSetting({ ...newSetting, description: e.target.value })}
                placeholder={t('samplePlugin.settings.descriptionPlaceholder')}
              />
            </div>

            <div className="flex justify-end">
              <Button
                onClick={() => saveSetting(newSetting)}
                disabled={!newSetting.key || !newSetting.value}
                isLoading={isSaving}
              >
                <Plus className="w-4 h-4 mr-2" />
                {t('samplePlugin.settings.addSetting')}
              </Button>
            </div>
          </div>
        </div>
      </Protect>

      {/* Existing Settings */}
      <div className="rounded-lg bg-card shadow border border-border overflow-hidden">
        <div className="p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">{t('samplePlugin.settings.current')}</h2>
          
          {settings.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('samplePlugin.settings.noSettings')}</p>
          ) : (
            <div className="space-y-4">
              {settings.map((setting) => (
                <div
                  key={setting.key}
                  className="p-4 rounded-md border border-border bg-muted/30 space-y-3"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label className="block mb-1">
                        {t('samplePlugin.settings.key')}
                      </Label>
                      <Input
                        value={setting.key}
                        disabled={editingKey !== setting.key}
                        onChange={(e) => updateSettingValue(setting.key, 'key', e.target.value)}
                        placeholder={t('samplePlugin.settings.keyPlaceholder')}
                      />
                    </div>
                    <div>
                      <Label className="block mb-1">
                        {t('samplePlugin.settings.value')}
                      </Label>
                      <Input
                        value={setting.value}
                        disabled={editingKey !== setting.key}
                        onChange={(e) => updateSettingValue(setting.key, 'value', e.target.value)}
                        placeholder={t('samplePlugin.settings.valuePlaceholder')}
                      />
                    </div>
                  </div>
                  
                  <div>
                    <Label className="block mb-1">
                      {t('samplePlugin.settings.descriptionLabel')}
                    </Label>
                    <Input
                      value={setting.description || ''}
                      disabled={editingKey !== setting.key}
                      onChange={(e) => updateSettingValue(setting.key, 'description', e.target.value)}
                      placeholder={t('samplePlugin.settings.descriptionPlaceholder')}
                    />
                  </div>

                  <div className="flex gap-2 justify-end">
                    <Protect roles={['ADMIN']}>
                      {editingKey === setting.key ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              fetchSettings(); // Reset changes
                              setEditingKey(null);
                            }}
                          >
                            {t('samplePlugin.settings.cancel')}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => saveSetting(setting)}
                            isLoading={isSaving}
                          >
                            <Save className="w-4 h-4 mr-2" />
                            {t('samplePlugin.settings.save')}
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingKey(setting.key)}
                        >
                          {t('samplePlugin.settings.edit')}
                        </Button>
                      )}
                    </Protect>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      
    </div>
  );
};
