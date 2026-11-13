export const QUEUE_NAMES = {
  EMAIL: 'email',
  WEBHOOK: 'webhook',
  EXPORT: 'export',
  IMPORT: 'import',
  CALENDAR: 'calendar',
} as const;

export const JOB_NAMES = {
  SEND_EMAIL: 'send-email',
  DELIVER_WEBHOOK: 'deliver-webhook',
  EXPORT_TENANT_DATA: 'export-tenant-data',
  IMPORT_DATA: 'import-data',
  SYNC_CALENDAR_EVENT: 'sync-calendar-event',
} as const;

export const RETRY_POLICIES = {
  email: { attempts: 3, backoff: { type: 'exponential' as const, delay: 5000 } },
  webhook: { attempts: 5, backoff: { type: 'exponential' as const, delay: 10000 } },
  export: { attempts: 2, backoff: { type: 'fixed' as const, delay: 30000 } },
  import: { attempts: 1, backoff: { type: 'fixed' as const, delay: 5000 } },
  calendar: { attempts: 5, backoff: { type: 'exponential' as const, delay: 10000 } },
};
