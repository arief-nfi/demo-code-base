import { AuditLogPage } from './audit-log-page';
import { AuditConfigPage } from './audit-config-page';

export const AuditLogRoutes = {
  '/audit-logs': AuditLogPage,
  '/config': AuditConfigPage,
};

export * from './audit-log-page';
export * from './audit-config-page';
