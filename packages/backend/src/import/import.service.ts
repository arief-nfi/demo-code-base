import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import type {
  ImportDefinition,
  IImportHandler,
} from './import.types';
import * as ExcelJS from 'exceljs';

interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);
  private readonly definitions = new Map<string, ImportDefinition>();
  private readonly handlers = new Map<string, IImportHandler>();

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.IMPORT) private readonly importQueue: Queue,
  ) {}

  /**
   * Register an import definition and handler.
   * Called by plugins during module initialization.
   */
  registerImport(definition: ImportDefinition, handler: IImportHandler): void {
    this.definitions.set(definition.key, definition);
    this.handlers.set(definition.key, handler);
    this.logger.log(`Registered import: ${definition.key} (${definition.label})`);
  }

  /**
   * Get all registered import definitions.
   */
  getDefinitions(): ImportDefinition[] {
    return Array.from(this.definitions.values());
  }

  /**
   * Get a single import definition.
   */
  getDefinition(importKey: string): ImportDefinition {
    const def = this.definitions.get(importKey);
    if (!def) throw new NotFoundException(`Import definition "${importKey}" not found`);
    return def;
  }

  /**
   * Get the handler for an import key.
   */
  getHandler(importKey: string): IImportHandler {
    const handler = this.handlers.get(importKey);
    if (!handler) throw new NotFoundException(`Import handler "${importKey}" not found`);
    return handler;
  }

  /**
   * Parse an uploaded CSV or Excel file into rows.
   * Requires exact column headers matching the import definition.
   */
  async parseFile(
    file: UploadedFile,
    importKey: string,
  ): Promise<{
    rows: Record<string, unknown>[];
    detectedColumns: string[];
    totalRows: number;
    errors: string[];
  }> {
    const def = this.getDefinition(importKey);
    const isExcel = file.originalname.endsWith('.xlsx') || file.originalname.endsWith('.xls');
    const isCsv = file.originalname.endsWith('.csv');

    if (!isExcel && !isCsv) {
      throw new BadRequestException('Unsupported file format. Please upload CSV or Excel (.xlsx) files.');
    }

    let rawRows: Record<string, string>[] = [];
    let detectedColumns: string[] = [];

    if (isExcel) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer as any);
      const worksheet = workbook.worksheets[0];
      if (!worksheet) throw new BadRequestException('Excel file has no worksheets');

      const headerRow = worksheet.getRow(1);
      detectedColumns = [];
      headerRow.eachCell((cell, colNumber) => {
        detectedColumns.push(String(cell.value || `Column${colNumber}`).trim());
      });

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // skip header
        const record: Record<string, string> = {};
        row.eachCell((cell, colNumber) => {
          const header = detectedColumns[colNumber - 1];
          if (header) record[header] = String(cell.value ?? '');
        });
        rawRows.push(record);
      });
    } else {
      // CSV parsing
      const content = file.buffer.toString('utf-8');
      const lines = content.split(/\r?\n/).filter((l: string) => l.trim().length > 0);
      if (lines.length < 2) throw new BadRequestException('CSV file must have a header row and at least one data row');

      detectedColumns = this.parseCsvLine(lines[0]);
      for (let i = 1; i < lines.length; i++) {
        const values = this.parseCsvLine(lines[i]);
        const record: Record<string, string> = {};
        detectedColumns.forEach((col, idx) => {
          record[col] = values[idx] ?? '';
        });
        rawRows.push(record);
      }
    }

    // Map detected columns to definition columns by header match
    const errors: string[] = [];
    const headerToKey = new Map<string, string>();

    for (const col of def.columns) {
      const match = detectedColumns.find(
        (d) => d.toLowerCase().trim() === col.header.toLowerCase().trim(),
      );
      if (match) {
        headerToKey.set(match, col.key);
      } else if (col.required && col.default === undefined) {
        errors.push(`Required column "${col.header}" not found in file`);
      }
    }

    // Transform rows: map file headers to definition keys, apply type coercion
    const rows = rawRows.map((raw) => {
      const mapped: Record<string, unknown> = {};
      for (const col of def.columns) {
        const fileHeader = detectedColumns.find(
          (d) => d.toLowerCase().trim() === col.header.toLowerCase().trim(),
        );
        const rawValue = fileHeader ? raw[fileHeader] : undefined;

        if (rawValue === undefined || rawValue === '') {
          mapped[col.key] = col.default ?? null;
        } else {
          mapped[col.key] = this.coerceValue(rawValue, col.type);
        }
      }
      return mapped;
    });

    // Enforce max rows
    const maxRows = def.maxRows ?? 10000;
    if (rows.length > maxRows) {
      errors.push(`File has ${rows.length} rows, maximum allowed is ${maxRows}`);
    }

    return {
      rows: rows.slice(0, maxRows),
      detectedColumns,
      totalRows: rows.length,
      errors,
    };
  }

  /**
   * Validate parsed rows against the import definition.
   */
  async validateRows(
    importKey: string,
    rows: Record<string, unknown>[],
  ): Promise<{
    validCount: number;
    invalidCount: number;
    rowErrors: Array<{ row: number; column: string; message: string }>;
  }> {
    const def = this.getDefinition(importKey);
    const rowErrors: Array<{ row: number; column: string; message: string }> = [];

    // Track unique values for duplicate detection within the file
    const uniqueTrackers = new Map<string, Set<string>>();
    for (const col of def.columns) {
      if (col.unique) uniqueTrackers.set(col.key, new Set());
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;

      for (const col of def.columns) {
        const value = row[col.key];

        // Required check
        if (col.required && (value === null || value === undefined || value === '')) {
          rowErrors.push({ row: rowNum, column: col.key, message: `"${col.header}" is required` });
          continue;
        }

        if (value === null || value === undefined || value === '') continue;

        // Type check
        if (col.type === 'number' && isNaN(Number(value))) {
          rowErrors.push({ row: rowNum, column: col.key, message: `"${col.header}" must be a number` });
        }

        // Unique check within file
        if (col.unique) {
          const tracker = uniqueTrackers.get(col.key)!;
          const strValue = String(value).toLowerCase();
          if (tracker.has(strValue)) {
            rowErrors.push({ row: rowNum, column: col.key, message: `Duplicate value "${value}" for "${col.header}"` });
          } else {
            tracker.add(strValue);
          }
        }
      }
    }

    const invalidRows = new Set(rowErrors.map((e) => e.row));
    return {
      validCount: rows.length - invalidRows.size,
      invalidCount: invalidRows.size,
      rowErrors,
    };
  }

  /**
   * Start an import job. Saves job record and queues background processing.
   */
  async execute(
    tenantSlug: string,
    importKey: string,
    rows: Record<string, unknown>[],
    userId: string,
    fileName: string,
    fileSize: number,
  ) {
    const def = this.getDefinition(importKey);
    this.getHandler(importKey); // verify handler exists

    const client = this.prisma.getTenantClient(tenantSlug);

    const job = await client.importJob.create({
      data: {
        importKey,
        fileName,
        fileSize,
        totalRows: rows.length,
        duplicateAction: def.duplicateHandling ?? 'skip',
        userId,
        status: 'IMPORTING',
        startedAt: new Date(),
      },
    });

    // Queue background job
    await this.importQueue.add(JOB_NAMES.IMPORT_DATA, {
      tenantSlug,
      importKey,
      jobId: job.id,
      rows,
      userId,
      handlerKey: importKey,
    });

    this.logger.log(`Import job ${job.id} queued: ${rows.length} rows for "${importKey}" in tenant "${tenantSlug}"`);

    return job;
  }

  /**
   * Get import job status.
   */
  async getJobStatus(tenantSlug: string, jobId: string) {
    const client = this.prisma.getTenantClient(tenantSlug);
    return client.importJob.findUniqueOrThrow({ where: { id: jobId } });
  }

  /**
   * Get import history for the tenant.
   */
  async getHistory(
    tenantSlug: string,
    params: { importKey?: string; page?: number; limit?: number },
  ) {
    const client = this.prisma.getTenantClient(tenantSlug);
    const page = params.page ?? 1;
    const limit = params.limit ?? 10;
    const where = params.importKey ? { importKey: params.importKey } : {};

    const [data, total] = await Promise.all([
      client.importJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      client.importJob.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Generate a downloadable Excel template for an import type.
   */
  async getTemplate(importKey: string): Promise<Buffer> {
    const def = this.getDefinition(importKey);
    const workbook = new ExcelJS.Workbook();

    // Data sheet with headers
    const dataSheet = workbook.addWorksheet(def.label);
    dataSheet.columns = def.columns.map((col) => ({
      header: col.header,
      key: col.key,
      width: Math.max(col.header.length + 5, 15),
    }));

    // Style header row
    const headerRow = dataSheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' },
    };

    // Add a sample row
    const sampleRow: Record<string, unknown> = {};
    for (const col of def.columns) {
      switch (col.type) {
        case 'number': sampleRow[col.key] = 0; break;
        case 'boolean': sampleRow[col.key] = 'true'; break;
        case 'date': sampleRow[col.key] = '2026-01-01'; break;
        default: sampleRow[col.key] = `Sample ${col.header}`; break;
      }
    }
    dataSheet.addRow(sampleRow);

    // Instructions sheet
    const infoSheet = workbook.addWorksheet('Instructions');
    infoSheet.columns = [
      { header: 'Column', key: 'header', width: 25 },
      { header: 'Type', key: 'type', width: 12 },
      { header: 'Required', key: 'required', width: 12 },
      { header: 'Unique', key: 'unique', width: 12 },
      { header: 'Default', key: 'default', width: 15 },
    ];

    const infoHeader = infoSheet.getRow(1);
    infoHeader.font = { bold: true };

    for (const col of def.columns) {
      infoSheet.addRow({
        header: col.header,
        type: col.type,
        required: col.required ? 'Yes' : 'No',
        unique: col.unique ? 'Yes' : 'No',
        default: col.default !== undefined ? String(col.default) : '-',
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /**
   * Get error report for a completed import job.
   */
  async getErrorReport(tenantSlug: string, jobId: string): Promise<Buffer> {
    const client = this.prisma.getTenantClient(tenantSlug);
    const job = await client.importJob.findUniqueOrThrow({ where: { id: jobId } });

    if (!job.errorLog) {
      throw new BadRequestException('No errors to report');
    }

    const errors = job.errorLog as Array<{ row: number; error: string }>;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Import Errors');
    sheet.columns = [
      { header: 'Row', key: 'row', width: 10 },
      { header: 'Error', key: 'error', width: 60 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFF0000' },
    };

    for (const err of errors) {
      sheet.addRow(err);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  // ── Private helpers ──

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  private coerceValue(value: string, type: string): unknown {
    switch (type) {
      case 'number': {
        const num = Number(value);
        return isNaN(num) ? value : num;
      }
      case 'boolean':
        return ['true', '1', 'yes', 'y'].includes(value.toLowerCase());
      case 'date':
        return value; // keep as string — the handler decides format
      default:
        return value;
    }
  }
}
