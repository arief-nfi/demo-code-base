import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Locale = 'en' | 'id';

interface PreferencesState {
  locale: Locale;
  dateFormat: string;
  timeFormat: string;
  timezone: string;
  currency: string;
  numberFormat: string;
  currencyFormat: string;
  sidebarCollapsed: boolean;
  sidebarExpandedItems: string[];

  setLocale: (locale: Locale) => void;
  setPreferences: (prefs: Partial<Omit<PreferencesState, 'setLocale' | 'setPreferences' | 'setSidebarCollapsed' | 'setSidebarExpandedItems'>>) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarExpandedItems: (items: string[]) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      locale: 'en' as Locale,
      dateFormat: 'dd/MM/yyyy',
      timeFormat: 'HH:mm:ss',
      timezone: 'UTC',
      currency: 'USD',
      numberFormat: '1,000.00',
      currencyFormat: '${value}',
      sidebarCollapsed: false,
      sidebarExpandedItems: [],

      setLocale: (locale) => set({ locale }),
      setPreferences: (prefs) => set(prefs),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setSidebarExpandedItems: (items) => set({ sidebarExpandedItems: items }),
    }),
    {
      name: 'preferences-storage',
      partialize: (state) => ({
        locale: state.locale,
        dateFormat: state.dateFormat,
        timeFormat: state.timeFormat,
        timezone: state.timezone,
        currency: state.currency,
        numberFormat: state.numberFormat,
        currencyFormat: state.currencyFormat,
        sidebarCollapsed: state.sidebarCollapsed,
        sidebarExpandedItems: state.sidebarExpandedItems,
      }),
    },
  ),
);
