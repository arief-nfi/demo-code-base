import { SampleSettingsController } from './sample-settings.controller';

describe('SampleSettingsController', () => {
  let controller: SampleSettingsController;

  const mockSettingsService = {
    getAllSettings: jest.fn(),
    getSettingByKey: jest.fn(),
    upsertSetting: jest.fn(),
  };

  const mockReq = {
    tenant: { slug: 'test-tenant' },
  } as any;

  const mockSetting = { id: 'theme', key: 'theme', value: 'dark' };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new SampleSettingsController(mockSettingsService as any);
  });

  describe('getAllSettings', () => {
    it('should delegate to service with tenant slug', () => {
      mockSettingsService.getAllSettings.mockReturnValue([mockSetting]);

      const result = controller.getAllSettings(mockReq);

      expect(mockSettingsService.getAllSettings).toHaveBeenCalledWith('test-tenant');
      expect(result).toEqual([mockSetting]);
    });

    it('should throw when tenant context is missing', () => {
      expect(() => controller.getAllSettings({} as any)).toThrow('Tenant context is required');
      expect(mockSettingsService.getAllSettings).not.toHaveBeenCalled();
    });
  });

  describe('getSettingByKey', () => {
    it('should delegate with key and tenant slug', () => {
      mockSettingsService.getSettingByKey.mockReturnValue(mockSetting);

      const result = controller.getSettingByKey(mockReq, 'theme');

      expect(mockSettingsService.getSettingByKey).toHaveBeenCalledWith('theme', 'test-tenant');
      expect(result).toEqual(mockSetting);
    });
  });

  describe('upsertSetting', () => {
    it('should delegate with setting and tenant slug', () => {
      mockSettingsService.upsertSetting.mockReturnValue(mockSetting);

      const result = controller.upsertSetting(mockReq, mockSetting);

      expect(mockSettingsService.upsertSetting).toHaveBeenCalledWith(mockSetting, 'test-tenant');
      expect(result).toEqual(mockSetting);
    });
  });
});
