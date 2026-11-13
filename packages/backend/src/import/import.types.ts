/**
 * Column definition for an importable entity.
 */
export interface ImportColumnDef {
  key: string;
  header: string;
  type: 'string' | 'number' | 'boolean' | 'date';
  required?: boolean;
  unique?: boolean;
  default?: unknown;
}

/**
 * Import definition — describes what can be imported and how.
 * Provided by plugins or business modules.
 */
export interface ImportDefinition {
  key: string;             // e.g., 'inventory.items'
  entity: string;          // display name: 'Item'
  label: string;           // menu label: 'Items'
  description?: string;
  permissions?: string[];
  maxRows?: number;        // default 10000
  columns: ImportColumnDef[];
  duplicateHandling?: 'skip' | 'update' | 'error';
}

/**
 * Handler interface that plugins implement for each importable entity.
 */
export interface IImportHandler {
  handleRow(
    tenantSlug: string,
    data: Record<string, unknown>,
    context: { userId: string; jobId: string; rowNumber: number },
  ): Promise<{ success: boolean; error?: string }>;

  afterImport?(
    tenantSlug: string,
    summary: { imported: number; skipped: number; failed: number },
  ): Promise<void>;
}

/**
 * Data passed to the import background job.
 */
export interface ImportJobData {
  tenantSlug: string;
  importKey: string;
  jobId: string;
  rows: Record<string, unknown>[];
  userId: string;
  handlerKey: string;
}
