/**
 * Permissions required by the Audit Log Plugin
 * These will be automatically registered when a new tenant is created
 * Format: {pluginKey}.{resource}.{action}
 */
export const AuditLogPermissions = [
  {
    name: 'audit-log.log.view',
    description: 'Permission to view audit logs'
  },
  {
    name: 'audit-log.log.export',
    description: 'Permission to export audit logs as CSV or JSON'
  },
  {
    name: 'audit-log.log.retention',
    description: 'Permission to apply data retention policies to audit logs'
  },
  {
    name: 'audit-log.log.replay',
    description: 'Permission to replay failed audit log entries from fallback files'
  },
  {
    name: 'audit-log.log.verify',
    description: 'Permission to verify audit log hash chain integrity'
  },
  {
    name: 'audit-log.config.manage',
    description: 'Permission to manage audit field configuration (sensitive and ignored fields)'
  },
];
