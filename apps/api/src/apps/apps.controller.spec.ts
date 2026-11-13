import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard, RbacGuard, ROLES_KEY } from '@saas/backend';
import { AppsController } from './apps.controller';

describe('AppsController', () => {
  it('is sysadmin only', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AppsController)).toEqual([JwtAuthGuard, RbacGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, AppsController)).toEqual(['SYSADMIN']);
  });

  it('declares its static routes before /apps/:key', () => {
    const paths = Object.getOwnPropertyNames(AppsController.prototype)
      .map((name) => Reflect.getMetadata('path', (AppsController.prototype as any)[name]))
      .filter((path): path is string => typeof path === 'string');
    expect(paths.indexOf('plugin-options')).toBeLessThan(paths.indexOf(':key'));
    expect(paths.indexOf('quote')).toBeLessThan(paths.indexOf(':key'));
  });
});
