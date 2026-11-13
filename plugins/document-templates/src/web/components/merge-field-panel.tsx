'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { apiClient, Button } from '@saas/ui';
import { toast } from 'sonner';

interface MergeField {
  name: string;
  type: string;
  description: string;
  example: string;
}

interface MergeFieldCategory {
  label: string;
  description: string;
  fields: MergeField[];
}

interface MergeFieldPanelProps {
  onInsert: (fieldExpression: string) => void;
}

export const MergeFieldPanel = ({ onInsert }: MergeFieldPanelProps) => {
  const [categories, setCategories] = useState<Record<string, MergeFieldCategory>>({});
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['company', 'common']));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const list = await apiClient.get<Array<{ key: string; label: string; fieldCount: number }>>(
          '/plugins/document-templates/merge-fields',
        );

        const cats: Record<string, MergeFieldCategory> = {};
        await Promise.all(
          list.map(async (cat) => {
            const detail = await apiClient.get<MergeFieldCategory>(
              `/plugins/document-templates/merge-fields/${cat.key}`,
            );
            cats[cat.key] = detail;
          }),
        );
        setCategories(cats);
      } catch (error) {
        console.warn('Failed to fetch merge fields', error);
      } finally {
        setLoading(false);
      }
    };

    fetchCategories();
  }, []);

  const toggleCategory = (key: string) => {
    const next = new Set(expandedCategories);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setExpandedCategories(next);
  };

  const handleInsert = (field: MergeField) => {
    const expression = field.type === 'array'
      ? `{{#each ${field.name.split('.')[0]}}}\n  {{this.}}\n{{/each}}`
      : `{{${field.name}}}`;
    onInsert(expression);
    toast.success(`Inserted {{${field.name}}}`);
  };

  if (loading) {
    return (
      <div className="p-3 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-6 bg-muted animate-pulse rounded" />
        ))}
      </div>
    );
  }

  return (
    <div className="text-sm">
      <div className="px-3 py-2 bg-muted/50 border-b border-border">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Merge Fields</span>
        <p className="text-xs text-muted-foreground mt-0.5">Click to insert at cursor</p>
      </div>
      <div className="overflow-y-auto max-h-[calc(100vh-300px)]">
        {Object.entries(categories).map(([key, category]) => (
          <div key={key} className="border-b border-border last:border-0">
            <button
              type="button"
              onClick={() => toggleCategory(key)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
            >
              {expandedCategories.has(key) ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
              <span className="font-medium text-xs">{category.label}</span>
              <span className="text-xs text-muted-foreground ml-auto">{category.fields.length}</span>
            </button>

            {expandedCategories.has(key) && (
              <div className="pb-1">
                {category.fields.map((field) => (
                  <button
                    key={field.name}
                    type="button"
                    onClick={() => handleInsert(field)}
                    className="w-full text-left px-3 py-1.5 pl-8 hover:bg-primary/5 transition-colors group"
                    title={`${field.description}\nExample: ${field.example}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <code className="text-xs font-mono text-primary/80 group-hover:text-primary">
                        {`{{${field.name}}}`}
                      </code>
                      <span className="text-[10px] text-muted-foreground bg-muted rounded px-1">
                        {field.type}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {field.description}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
