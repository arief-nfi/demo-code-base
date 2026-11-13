import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { setSessionHint, clearSessionHint } from '../lib/session-hint';

export interface SessionData {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantDescription?: string | null;
  tenantLogo?: string | null;
  tenantIcon?: string | null;
  tenantPrimaryColor?: string | null;
  tenantAccentColor?: string | null;
  tenantSidebarBackground?: string | null;
  tenantSidebarForeground?: string | null;
  username: string;
  name?: string | null;
  avatar?: string | null;
}

interface AuthState {
  tenantId: string | null;
  tenantSlug: string | null;
  tenantName: string | null;
  tenantDescription: string | null;
  tenantLogo: string | null;
  tenantIcon: string | null;
  tenantPrimaryColor: string | null;
  tenantAccentColor: string | null;
  tenantSidebarBackground: string | null;
  tenantSidebarForeground: string | null;
  username: string | null;
  name: string | null;
  avatar: string | null;
  onboardingCompleted: boolean | null;
  _hydrated: boolean;

  setSession: (data: SessionData) => void;
  setName: (name: string | null) => void;
  setAvatar: (avatar: string | null) => void;
  setOnboardingCompleted: (value: boolean) => void;
  updateTenantInfo: (data: Partial<Pick<SessionData, 'tenantName' | 'tenantDescription' | 'tenantLogo' | 'tenantIcon' | 'tenantPrimaryColor' | 'tenantAccentColor' | 'tenantSidebarBackground' | 'tenantSidebarForeground'>>) => void;
  clearSession: () => void;
}

const initialState = {
  tenantId: null as string | null,
  tenantSlug: null as string | null,
  tenantName: null as string | null,
  tenantDescription: null as string | null,
  tenantLogo: null as string | null,
  tenantIcon: null as string | null,
  tenantPrimaryColor: null as string | null,
  tenantAccentColor: null as string | null,
  tenantSidebarBackground: null as string | null,
  tenantSidebarForeground: null as string | null,
  username: null as string | null,
  name: null as string | null,
  avatar: null as string | null,
  onboardingCompleted: null as boolean | null,
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      ...initialState,
      _hydrated: true,

      setSession: (data) => {
        setSessionHint();
        set({
          tenantId: data.tenantId,
          tenantSlug: data.tenantSlug,
          tenantName: data.tenantName,
          tenantDescription: data.tenantDescription ?? null,
          tenantLogo: data.tenantLogo ?? null,
          tenantIcon: data.tenantIcon ?? null,
          tenantPrimaryColor: data.tenantPrimaryColor ?? null,
          tenantAccentColor: data.tenantAccentColor ?? null,
          tenantSidebarBackground: data.tenantSidebarBackground ?? null,
          tenantSidebarForeground: data.tenantSidebarForeground ?? null,
          username: data.username,
          name: data.name ?? null,
          avatar: data.avatar ?? null,
        });
      },

      setName: (name) => set({ name }),
      setAvatar: (avatar) => set({ avatar }),
      setOnboardingCompleted: (value) => set({ onboardingCompleted: value }),

      updateTenantInfo: (data) =>
        set((state) => ({
          tenantName: data.tenantName ?? state.tenantName,
          tenantDescription: data.tenantDescription !== undefined ? data.tenantDescription ?? null : state.tenantDescription,
          tenantLogo: data.tenantLogo !== undefined ? data.tenantLogo ?? null : state.tenantLogo,
          tenantIcon: data.tenantIcon !== undefined ? data.tenantIcon ?? null : state.tenantIcon,
          tenantPrimaryColor: data.tenantPrimaryColor !== undefined ? data.tenantPrimaryColor ?? null : state.tenantPrimaryColor,
          tenantAccentColor: data.tenantAccentColor !== undefined ? data.tenantAccentColor ?? null : state.tenantAccentColor,
          tenantSidebarBackground: data.tenantSidebarBackground !== undefined ? data.tenantSidebarBackground ?? null : state.tenantSidebarBackground,
          tenantSidebarForeground: data.tenantSidebarForeground !== undefined ? data.tenantSidebarForeground ?? null : state.tenantSidebarForeground,
        })),

      clearSession: () => {
        clearSessionHint();
        set(initialState);
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        tenantId: state.tenantId,
        tenantSlug: state.tenantSlug,
        tenantName: state.tenantName,
        tenantDescription: state.tenantDescription,
        tenantLogo: state.tenantLogo,
        tenantIcon: state.tenantIcon,
        tenantPrimaryColor: state.tenantPrimaryColor,
        tenantAccentColor: state.tenantAccentColor,
        tenantSidebarBackground: state.tenantSidebarBackground,
        tenantSidebarForeground: state.tenantSidebarForeground,
        username: state.username,
        name: state.name,
        avatar: state.avatar,
        onboardingCompleted: state.onboardingCompleted,
      }),
    },
  ),
);
