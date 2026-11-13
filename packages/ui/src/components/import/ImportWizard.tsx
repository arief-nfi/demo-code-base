'use client';

import { useState, useCallback } from 'react';
import { apiClient } from '../../lib/api-client';
import { cn } from '../../lib/utils';
import { Button } from '../button';
import { Progress } from '../progress';
import { Spinner } from '../spinner';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../dialog';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Download,
} from 'lucide-react';
import { toast } from 'sonner';

interface ImportWizardProps {
  importKey: string;
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
}

type WizardStep = 'upload' | 'preview' | 'importing' | 'result';

interface ParseResult {
  rows: Record<string, unknown>[];
  detectedColumns: string[];
  totalRows: number;
  errors: string[];
}

interface ValidationResult {
  validCount: number;
  invalidCount: number;
  rowErrors: Array<{ row: number; column: string; message: string }>;
}

interface ImportJob {
  id: string;
  status: string;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  failedRows: number;
}

export function ImportWizard({ importKey, isOpen, onClose, onComplete }: ImportWizardProps) {
  const [step, setStep] = useState<WizardStep>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [jobResult, setJobResult] = useState<ImportJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setStep('upload');
    setFile(null);
    setParseResult(null);
    setValidation(null);
    setIsParsing(false);
    setJobResult(null);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  const handleFileDrop = useCallback(
    async (selectedFile: File) => {
      setFile(selectedFile);
      setError(null);
      setIsParsing(true);

      try {
        const formData = new FormData();
        formData.append('file', selectedFile);

        const result = await apiClient.upload<ParseResult>(
          `/imports/parse?importKey=${importKey}`,
          selectedFile,
          'file',
        );

        setParseResult(result);

        // Validate
        const validationResult = await apiClient.post<ValidationResult>('/imports/validate', {
          importKey,
          rows: result.rows,
        });
        setValidation(validationResult);
        setStep('preview');
      } catch (err: any) {
        setError(err.message || 'Failed to parse file');
      } finally {
        setIsParsing(false);
      }
    },
    [importKey],
  );

  async function handleImport() {
    if (!parseResult || !file) return;
    setStep('importing');

    try {
      const job = await apiClient.post<ImportJob>('/imports/execute', {
        importKey,
        rows: parseResult.rows,
        fileName: file.name,
        fileSize: file.size,
      });

      // Poll for completion
      let result = job;
      while (result.status === 'IMPORTING' || result.status === 'PENDING') {
        await new Promise((r) => setTimeout(r, 1000));
        result = await apiClient.get<ImportJob>(`/imports/jobs/${job.id}`);
      }

      setJobResult(result);
      setStep('result');

      if (result.status === 'COMPLETED') {
        toast.success(`Imported ${result.importedRows} of ${result.totalRows} rows`);
        onComplete?.();
      }
    } catch (err: any) {
      setError(err.message || 'Import failed');
      setStep('result');
    }
  }

  return (
    <DialogRoot open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Data</DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Upload a CSV or Excel file to import.'}
            {step === 'preview' && 'Review your data before importing.'}
            {step === 'importing' && 'Importing your data...'}
            {step === 'result' && 'Import complete.'}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-4">
          {/* Upload Step */}
          {step === 'upload' && (
            <div className="space-y-4">
              <div
                className={cn(
                  'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors',
                  isParsing ? 'border-primary/50 bg-primary/5' : 'border-border hover:border-primary/30',
                )}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) handleFileDrop(f);
                }}
              >
                {isParsing ? (
                  <>
                    <Spinner className="h-8 w-8 mb-3" />
                    <p className="text-sm text-muted-foreground">Parsing file...</p>
                  </>
                ) : (
                  <>
                    <Upload className="h-8 w-8 text-muted-foreground/50 mb-3" />
                    <p className="text-sm font-medium">Drag and drop your file here</p>
                    <p className="text-xs text-muted-foreground mt-1">CSV or Excel (.xlsx) up to 10MB</p>
                    <label className="mt-3">
                      <input
                        type="file"
                        accept=".csv,.xlsx,.xls"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleFileDrop(f);
                        }}
                      />
                      <Button variant="outline" size="sm" type="button">
                        <span>Browse Files</span>
                      </Button>
                    </label>
                  </>
                )}
              </div>

              {/* Template download */}
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileSpreadsheet className="h-4 w-4" />
                  <span>Need the template?</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    try {
                      const response = await fetch(
                        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/imports/templates/${importKey}`,
                        { credentials: 'include' },
                      );
                      const blob = await response.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${importKey}-template.xlsx`;
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch {
                      toast.error('Failed to download template');
                    }
                  }}
                >
                  <Download className="mr-1 h-3 w-3" />
                  Download Template
                </Button>
              </div>

              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertTriangle className="inline h-4 w-4 mr-1" />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Preview Step */}
          {step === 'preview' && parseResult && validation && (
            <div className="space-y-4">
              {/* File info */}
              <div className="flex items-center gap-3 rounded-md border px-3 py-2">
                <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{file?.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {parseResult.totalRows} rows, {parseResult.detectedColumns.length} columns
                  </div>
                </div>
              </div>

              {/* Parse errors */}
              {parseResult.errors.length > 0 && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive space-y-1">
                  {parseResult.errors.map((err, i) => (
                    <div key={i}><AlertTriangle className="inline h-3 w-3 mr-1" />{err}</div>
                  ))}
                </div>
              )}

              {/* Validation summary */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border p-3 text-center">
                  <div className="text-2xl font-semibold text-green-600">{validation.validCount}</div>
                  <div className="text-xs text-muted-foreground">Valid rows</div>
                </div>
                <div className="rounded-md border p-3 text-center">
                  <div className={cn('text-2xl font-semibold', validation.invalidCount > 0 ? 'text-destructive' : 'text-green-600')}>
                    {validation.invalidCount}
                  </div>
                  <div className="text-xs text-muted-foreground">Invalid rows</div>
                </div>
              </div>

              {/* Validation errors (show first 10) */}
              {validation.rowErrors.length > 0 && (
                <div className="rounded-md border p-3 space-y-1 max-h-40 overflow-y-auto">
                  <div className="text-sm font-medium text-destructive mb-2">Validation Errors:</div>
                  {validation.rowErrors.slice(0, 10).map((err, i) => (
                    <div key={i} className="text-xs text-muted-foreground">
                      Row {err.row}: {err.message}
                    </div>
                  ))}
                  {validation.rowErrors.length > 10 && (
                    <div className="text-xs text-muted-foreground italic">
                      ...and {validation.rowErrors.length - 10} more errors
                    </div>
                  )}
                </div>
              )}

              {/* Data preview (first 5 rows) */}
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">#</th>
                      {parseResult.detectedColumns.map((col) => (
                        <th key={col} className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parseResult.rows.slice(0, 5).map((row, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1.5 text-muted-foreground">{i + 1}</td>
                        {parseResult.detectedColumns.map((col) => (
                          <td key={col} className="px-2 py-1.5 max-w-32 truncate">
                            {String(row[col] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parseResult.rows.length > 5 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground bg-muted/30 border-t">
                    Showing 5 of {parseResult.rows.length} rows
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Importing Step */}
          {step === 'importing' && (
            <div className="flex flex-col items-center py-8 space-y-4">
              <Spinner className="h-8 w-8" />
              <p className="text-sm font-medium">Importing data...</p>
              <p className="text-xs text-muted-foreground">This may take a moment for large files.</p>
              <Progress value={50} className="w-48" />
            </div>
          )}

          {/* Result Step */}
          {step === 'result' && (
            <div className="space-y-4">
              {jobResult ? (
                <>
                  <div className="flex flex-col items-center py-4">
                    {jobResult.status === 'COMPLETED' && jobResult.failedRows === 0 ? (
                      <CheckCircle className="h-12 w-12 text-green-600 mb-2" />
                    ) : jobResult.status === 'FAILED' ? (
                      <XCircle className="h-12 w-12 text-destructive mb-2" />
                    ) : (
                      <AlertTriangle className="h-12 w-12 text-yellow-500 mb-2" />
                    )}
                    <h3 className="text-lg font-medium">
                      {jobResult.status === 'COMPLETED' ? 'Import Complete' : 'Import Failed'}
                    </h3>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-md border p-3 text-center">
                      <div className="text-2xl font-semibold text-green-600">{jobResult.importedRows}</div>
                      <div className="text-xs text-muted-foreground">Imported</div>
                    </div>
                    <div className="rounded-md border p-3 text-center">
                      <div className="text-2xl font-semibold text-muted-foreground">{jobResult.skippedRows}</div>
                      <div className="text-xs text-muted-foreground">Skipped</div>
                    </div>
                    <div className="rounded-md border p-3 text-center">
                      <div className={cn('text-2xl font-semibold', jobResult.failedRows > 0 ? 'text-destructive' : 'text-muted-foreground')}>
                        {jobResult.failedRows}
                      </div>
                      <div className="text-xs text-muted-foreground">Failed</div>
                    </div>
                  </div>

                  {jobResult.failedRows > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={async () => {
                        try {
                          const response = await fetch(
                            `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/imports/jobs/${jobResult.id}/errors`,
                            { credentials: 'include' },
                          );
                          const blob = await response.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `import-errors-${jobResult.id}.xlsx`;
                          a.click();
                          URL.revokeObjectURL(url);
                        } catch {
                          toast.error('Failed to download error report');
                        }
                      }}
                    >
                      <Download className="mr-1 h-4 w-4" />
                      Download Error Report
                    </Button>
                  )}
                </>
              ) : error ? (
                <div className="rounded-md bg-destructive/10 p-4 text-sm text-destructive text-center">
                  <XCircle className="inline h-5 w-5 mr-1" />
                  {error}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 pt-4">
          {step === 'upload' && (
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
          )}
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={() => { setStep('upload'); setFile(null); setParseResult(null); }}>
                Back
              </Button>
              <Button
                onClick={handleImport}
                disabled={!validation || validation.invalidCount > 0 || (parseResult?.errors.length ?? 0) > 0}
              >
                Import {validation?.validCount} Rows
              </Button>
            </>
          )}
          {step === 'result' && (
            <>
              <Button variant="outline" onClick={handleClose}>Close</Button>
              <Button onClick={reset}>Import Again</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
