'use client';

import { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';

interface TemplatePreviewProps {
  htmlContent: string;
  cssContent: string;
  headerHtml: string;
  footerHtml: string;
  sampleData: Record<string, unknown>;
}

function compileHandlebars(template: string, data: Record<string, unknown>): string {
  if (!template) return '';

  let result = template;

  // Handle {{#each items}}...{{/each}}
  result = result.replace(/\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_match, key, inner) => {
    const arr = data[key];
    if (!Array.isArray(arr)) return '';
    return arr
      .map((item, index) => {
        let row = inner;
        // Replace {{this.prop}}
        row = row.replace(/\{\{this\.(\w+)\}\}/g, (_: string, prop: string) => {
          return item[prop] != null ? String(item[prop]) : '';
        });
        // Replace {{@index}}
        row = row.replace(/\{\{@index\}\}/g, String(index));
        // Replace {{inc @index}}
        row = row.replace(/\{\{inc\s+@index\}\}/g, String(index + 1));
        // Replace {{formatCurrency this.prop ../currency}}
        row = row.replace(/\{\{formatCurrency\s+this\.(\w+)(?:\s+\.\.\/(\w+))?\}\}/g, (_: string, prop: string, currKey: string) => {
          const amount = Number(item[prop]) || 0;
          const curr = currKey ? String(data[currKey] || 'USD') : 'USD';
          try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: curr }).format(amount); }
          catch { return `${curr} ${amount.toFixed(2)}`; }
        });
        return row;
      })
      .join('');
  });

  // Handle {{#if prop}}...{{/if}} and {{#if prop}}...{{else}}...{{/if}}
  result = result.replace(/\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_match, key, inner) => {
    const val = getNestedValue(data, key);
    const parts = inner.split('{{else}}');
    if (val) return parts[0];
    return parts[1] || '';
  });

  // Handle {{formatCurrency prop currency}}
  result = result.replace(/\{\{formatCurrency\s+([\w.]+)(?:\s+([\w.]+))?\}\}/g, (_match, amtKey, currKey) => {
    const amount = Number(getNestedValue(data, amtKey)) || 0;
    const curr = currKey ? String(getNestedValue(data, currKey) || 'USD') : 'USD';
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: curr }).format(amount); }
    catch { return `${curr} ${amount.toFixed(2)}`; }
  });

  // Handle {{formatDate prop}}
  result = result.replace(/\{\{formatDate\s+([\w.]+)\}\}/g, (_match, key) => {
    const val = getNestedValue(data, key);
    return val ? String(val) : '';
  });

  // Handle {{{prop}}} (unescaped)
  result = result.replace(/\{\{\{([\w.]+)\}\}\}/g, (_match, key) => {
    const val = getNestedValue(data, key);
    return val != null ? String(val) : '';
  });

  // Handle {{prop}} (escaped)
  result = result.replace(/\{\{([\w.]+)\}\}/g, (_match, key) => {
    const val = getNestedValue(data, key);
    return val != null ? escapeHtml(String(val)) : '';
  });

  return result;
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((acc: unknown, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export const TemplatePreview = ({
  htmlContent,
  cssContent,
  headerHtml,
  footerHtml,
  sampleData,
}: TemplatePreviewProps) => {
  const renderedHtml = useMemo(() => {
    try {
      const body = compileHandlebars(htmlContent, sampleData);
      const header = headerHtml ? compileHandlebars(headerHtml, sampleData) : '';
      const footer = footerHtml ? compileHandlebars(footerHtml, sampleData) : '';

      return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #333; line-height: 1.5; padding: 20px; }
    table { width: 100%; border-collapse: collapse; }
    ${cssContent || ''}
  </style>
</head>
<body>
  ${header ? `<header>${header}</header>` : ''}
  <main>${body}</main>
  ${footer ? `<footer>${footer}</footer>` : ''}
</body>
</html>`;
    } catch (e) {
      return `<html><body><pre style="color:red;">Template Error: ${e instanceof Error ? e.message : 'Unknown error'}</pre></body></html>`;
    }
  }, [htmlContent, cssContent, headerHtml, footerHtml, sampleData]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Live Preview</span>
      </div>
      <div className="flex-1 bg-white">
        <iframe
          srcDoc={renderedHtml}
          className="w-full h-full border-0"
          sandbox="allow-same-origin"
          title="Template Preview"
        />
      </div>
    </div>
  );
};
