import { Injectable } from "@nestjs/common";
import { SampleSettingDto } from "./dto/sample-setting.dto";

// Default settings every tenant starts with (mock data)
const DEFAULT_SETTINGS: SampleSettingDto[] = [
  { id: 'enableExperimentalFeatures', key: 'enableExperimentalFeatures', description: 'Enable experimental features', value: 'false' },
  { id: 'defaultItemLimit', key: 'defaultItemLimit', description: 'Default item limit', value: '100' },
];

@Injectable()
export class SampleSettingsService {

  // In-memory storage for sample settings, keyed by tenant slug.
  // The service is a singleton shared by every tenant, so state must never be
  // stored in a single shared collection. Real plugins should persist settings
  // in the tenant schema via PrismaService.getTenantClient(tenantSlug).
  private readonly settingsByTenant = new Map<string, SampleSettingDto[]>();

  private getTenantSettings(tenantSlug: string): SampleSettingDto[] {
    let settings = this.settingsByTenant.get(tenantSlug);
    if (!settings) {
      settings = DEFAULT_SETTINGS.map(setting => ({ ...setting }));
      this.settingsByTenant.set(tenantSlug, settings);
    }
    return settings;
  }

  // Method to get all settings
  getAllSettings(tenantSlug: string): SampleSettingDto[] {
    return this.getTenantSettings(tenantSlug);
  }

  // Method to get a setting by key
  getSettingByKey(key: string, tenantSlug: string): SampleSettingDto | undefined {
    return this.getTenantSettings(tenantSlug).find(setting => setting.key === key);
  }

  // Method to create or update a setting
  upsertSetting(setting: SampleSettingDto, tenantSlug: string): SampleSettingDto {
    const settings = this.getTenantSettings(tenantSlug);
    const index = settings.findIndex(s => s.key === setting.key);
    if (index >= 0) {
      settings[index] = setting; // Update existing
    } else {
      settings.push(setting); // Create new
    }
    return setting;
  }

}
