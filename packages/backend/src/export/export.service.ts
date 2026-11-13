import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { ExportColumn, ExportFormat, ExportResult } from './export.types';

@Injectable()
export class ExportService {
  async export<T extends Record<string, unknown>>(
    columns: ExportColumn<T>[],
    rows: T[],
    format: ExportFormat,
    options?: { sheetName?: string; filename?: string },
  ): Promise<ExportResult> {
    switch (format) {
      case 'xlsx':
        return {
          data: await this.toExcel(columns, rows, options?.sheetName),
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          extension: 'xlsx',
        };
      case 'json':
        return {
          data: this.toJson(columns, rows),
          contentType: 'application/json',
          extension: 'json',
        };
      case 'csv':
      default:
        return {
          data: this.toCsv(columns, rows),
          contentType: 'text/csv',
          extension: 'csv',
        };
    }
  }

  toCsv<T extends Record<string, unknown>>(columns: ExportColumn<T>[], rows: T[]): string {
    const header = columns.map((c) => this.escapeCsvField(c.header)).join(',');
    const lines = rows.map((row) =>
      columns.map((col) => this.escapeCsvField(String(col.accessor(row) ?? ''))).join(','),
    );
    return [header, ...lines].join('\n');
  }

  async toExcel<T extends Record<string, unknown>>(
    columns: ExportColumn<T>[],
    rows: T[],
    sheetName = 'Sheet1',
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SaaS Admin';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(sheetName);

    // Define columns
    sheet.columns = columns.map((col) => ({
      header: col.header,
      key: col.header,
      width: col.width || Math.max(col.header.length + 4, 15),
    }));

    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE2E8F0' },
    };

    // Add data rows
    for (const row of rows) {
      const values: Record<string, unknown> = {};
      columns.forEach((col) => {
        values[col.header] = col.accessor(row) ?? '';
      });
      sheet.addRow(values);
    }

    // Auto-filter
    if (rows.length > 0) {
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: rows.length + 1, column: columns.length },
      };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  toJson<T extends Record<string, unknown>>(columns: ExportColumn<T>[], rows: T[]): string {
    const mapped = rows.map((row) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col) => {
        obj[col.header] = col.accessor(row);
      });
      return obj;
    });
    return JSON.stringify(mapped, null, 2);
  }

  private escapeCsvField(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
