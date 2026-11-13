import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import { AuditInterceptor } from './audit.interceptor';

export const AUDIT_METADATA_KEY = 'audit_metadata';

export interface AuditOptions {
  /** The action being audited. Defaults to 'READ'. */
  action?: 'READ' | 'CREATE' | 'UPDATE' | 'DELETE';
  /** The entity name, e.g. 'User', 'Role'. Required. */
  entity: string;
  /** Optional override for entityId extraction. If provided, this static value is used. */
  entityId?: string;
}

/**
 * Decorator for opt-in audit logging on controller endpoints.
 * Combines metadata setting with interceptor application.
 *
 * Usage:
 *   @Audit({ entity: 'User' })                        // READ action (default)
 *   @Audit({ entity: 'Role', action: 'READ' })        // Explicit READ
 *   @Audit({ entity: 'Dashboard', entityId: 'summary' }) // Static entityId
 */
export function Audit(options: AuditOptions): MethodDecorator {
  return applyDecorators(
    SetMetadata(AUDIT_METADATA_KEY, {
      action: options.action ?? 'READ',
      entity: options.entity,
      ...(options.entityId !== undefined && { entityId: options.entityId }),
    }),
    UseInterceptors(AuditInterceptor),
  );
}
