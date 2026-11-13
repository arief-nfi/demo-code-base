export interface ExportColumn<T = Record<string, unknown>> {
  header: string;
  accessor: (row: T) => string | number | Date | null | undefined;
  width?: number;
  format?: string;
}

export type ExportFormat = 'csv' | 'xlsx' | 'json';

export interface ExportResult {
  data: Buffer | string;
  contentType: string;
  extension: string;
}
