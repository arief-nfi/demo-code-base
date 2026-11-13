'use client';

import * as React from 'react';
import { useLanguage, Locale } from '@saas/ui';
import { Globe, Check, ChevronDown } from 'lucide-react';

interface LanguageSwitcherProps {
  variant?: 'default' | 'icon';
}

const languages: { code: Locale; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'id', label: 'Indonesia' },
];

export function LanguageSwitcher({ variant = 'default' }: LanguageSwitcherProps) {
  const { locale, setLocale } = useLanguage();
  const [isOpen, setIsOpen] = React.useState(false);

  const handleSelect = (code: Locale) => {
    setLocale(code);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      {variant === 'icon' ? (
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="group grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent"
          title="Select Language"
        >
          <Globe className="h-4 w-4" />
        </button>
      ) : (
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
          title="Select Language"
        >
          <Globe className="h-4 w-4" />
          <span>{languages.find((l) => l.code === locale)?.label || locale.toUpperCase()}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </button>
      )}

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-40 origin-top-right rounded-md border border-border bg-popover p-1 shadow-md focus:outline-none">
            {languages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => handleSelect(lang.code)}
                className={`relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground ${
                  locale === lang.code ? 'bg-accent text-accent-foreground' : ''
                }`}
              >
                {locale === lang.code && (
                  <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                    <Check className="h-4 w-4" />
                  </span>
                )}
                <span>{lang.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
