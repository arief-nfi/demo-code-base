import { SampleSettingsService } from './sample-settings.service';

describe('SampleSettingsService', () => {
  let service: SampleSettingsService;

  const defaultKeys = ['enableExperimentalFeatures', 'defaultItemLimit'];

  beforeEach(() => {
    service = new SampleSettingsService();
  });

  // ─── getAllSettings ────────────────────────────────────

  describe('getAllSettings', () => {
    it('should seed the default settings for a tenant on first access', () => {
      const settings = service.getAllSettings('acme');

      expect(settings.map((s) => s.key)).toEqual(defaultKeys);
      expect(service.getSettingByKey('defaultItemLimit', 'acme')?.value).toBe('100');
    });

    it('should give every tenant its own copy of the defaults', () => {
      expect(service.getAllSettings('acme')).toEqual(service.getAllSettings('beta'));
      expect(service.getAllSettings('acme')).not.toBe(service.getAllSettings('beta'));
    });
  });

  // ─── upsertSetting ─────────────────────────────────────

  describe('upsertSetting', () => {
    it('should create a new setting visible only to the same tenant', () => {
      const setting = { id: 'theme', key: 'theme', value: 'dark' };

      const result = service.upsertSetting(setting, 'acme');

      expect(result).toEqual(setting);
      expect(service.getSettingByKey('theme', 'acme')).toEqual(setting);
      expect(service.getSettingByKey('theme', 'beta')).toBeUndefined();
      expect(service.getAllSettings('beta').map((s) => s.key)).toEqual(defaultKeys);
    });

    it('should update an existing setting without affecting other tenants', () => {
      service.upsertSetting(
        { id: 'defaultItemLimit', key: 'defaultItemLimit', value: '5' },
        'acme',
      );

      expect(service.getSettingByKey('defaultItemLimit', 'acme')?.value).toBe('5');
      expect(service.getAllSettings('acme')).toHaveLength(defaultKeys.length);
      expect(service.getSettingByKey('defaultItemLimit', 'beta')?.value).toBe('100');
    });
  });
});
