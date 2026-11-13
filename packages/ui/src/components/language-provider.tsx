'use client';

import React, { createContext, useContext, useCallback } from 'react';
import { Locale, Dictionaries } from '../lib/dictionaries';
import { usePreferencesStore } from '../stores/preferences-store';

type LanguageContextType = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

interface LanguageProviderProps {
  children: React.ReactNode;
  dictionaries: Dictionaries;
}

export function LanguageProvider({ children, dictionaries }: LanguageProviderProps) {
  const locale = usePreferencesStore(s => s.locale) as Locale;
  const storeSetLocale = usePreferencesStore(s => s.setLocale);

  const setLocale = useCallback((newLocale: Locale) => {
    storeSetLocale(newLocale);
  }, [storeSetLocale]);

  const t = useCallback((path: string, params?: Record<string, string | number>) => {
    const keys = path.split('.');
    let current: any = dictionaries[locale];

    for (const key of keys) {
      if (current[key] === undefined) {
        return path;
      }
      current = current[key];
    }

    let translation = current as string;

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        translation = translation.replace(`{${key}}`, String(value));
      });
    }

    return translation;
  }, [dictionaries, locale]);

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
