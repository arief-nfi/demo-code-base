import { PluginList, PluginModules, PluginPermissions } from '../plugin-registry';

describe('Plugin Contract Validation', () => {
  describe('PluginList', () => {
    it('should have entries for all plugin modules', () => {
      expect(PluginList.length).toBeGreaterThan(0);
    });

    for (const plugin of PluginList) {
      describe(`Plugin: ${plugin.key}`, () => {
        it('should have a valid key (kebab-case)', () => {
          expect(plugin.key).toMatch(/^[a-z][a-z0-9-]*$/);
        });

        it('should have a display name', () => {
          expect(plugin.name).toBeTruthy();
        });

        it('should have a version', () => {
          expect(plugin.version).toMatch(/^\d+\.\d+\.\d+/);
        });
      });
    }
  });

  describe('PluginPermissions', () => {
    for (const [pluginKey, permissions] of Object.entries(PluginPermissions)) {
      describe(`Plugin: ${pluginKey}`, () => {
        it('should have permissions array', () => {
          expect(Array.isArray(permissions)).toBe(true);
        });

        for (const perm of permissions) {
          it(`permission '${perm.name}' should be namespaced to plugin`, () => {
            expect(perm.name).toMatch(new RegExp(`^${pluginKey}\\.`));
          });

          it(`permission '${perm.name}' should follow format: key.resource.action`, () => {
            expect(perm.name.split('.')).toHaveLength(3);
          });

          it(`permission '${perm.name}' should have a description`, () => {
            expect(perm.description).toBeTruthy();
          });
        }
      });
    }
  });

  describe('PluginModules', () => {
    it('should be an array of NestJS modules', () => {
      for (const mod of PluginModules) {
        expect(mod).toBeDefined();
        expect(mod.name).toMatch(/Module$/);
      }
    });
  });
});
