'use client';

import { Link2 } from 'lucide-react';
import { useLanguage } from '@saas/ui';

export interface EmailVariable {
  name: string;
  description?: string;
}

interface EmailVariablesPanelProps {
  variables: EmailVariable[];
  /** Variables that may only be a whole link: inserted as a button */
  sensitive: string[];
  onInsert: (expression: string) => void;
}

// Every email template gets these, whatever the definition declares
const BUILT_IN: EmailVariable[] = [
  { name: 'company.name' },
  { name: 'company.logoUrl' },
  { name: 'appUrl' },
];

export const EmailVariablesPanel = ({ variables, sensitive, onInsert }: EmailVariablesPanelProps) => {
  const { t } = useLanguage();

  const item = (variable: EmailVariable, builtIn: boolean) => {
    const linkOnly = sensitive.includes(variable.name);
    const expression = linkOnly ? `{{button ${variable.name} "…"}}` : `{{${variable.name}}}`;
    return (
      <button
        key={variable.name}
        type="button"
        onClick={() => onInsert(expression)}
        className="w-full text-left rounded px-2 py-1.5 hover:bg-muted transition-colors"
        title={t('documentTemplates.emails.clickToInsert') || 'Click to insert at the cursor'}
      >
        <div className="flex items-center gap-1.5 font-mono text-xs text-primary">
          {linkOnly && <Link2 className="h-3 w-3" />}
          {variable.name}
          {linkOnly && (
            <span className="font-sans text-[10px] text-amber-700 dark:text-amber-400">
              ({t('documentTemplates.emails.linkOnly') || 'link only'})
            </span>
          )}
        </div>
        {variable.description && <div className="text-xs text-muted-foreground">{variable.description}</div>}
        {builtIn && <div className="text-xs text-muted-foreground">{t('documentTemplates.emails.builtIn') || 'Added automatically'}</div>}
      </button>
    );
  };

  return (
    <div className="space-y-1">
      <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('documentTemplates.emails.variables') || 'Variables'}
      </div>
      {variables.map((v) => item(v, false))}
      <div className="border-t border-border my-2" />
      {BUILT_IN.map((v) => item(v, true))}
    </div>
  );
};
