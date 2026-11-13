'use client';

import { useRouter } from 'next/navigation';
import { apiClient, AuthGate, Spinner, setSessionHint, useAuthStore, useRBACStore } from '@saas/ui';
import { SessionErrorScreen } from './session-error-screen';

interface MeResponse {
  id: string;
  username: string;
  name: string | null;
  avatar: string | null;
  roles: string[];
  permissions: string[];
  onboardingCompleted?: boolean;
}

/**
 * Wraps every dashboard page (mounted once by app/(dashboard)/layout.tsx, above
 * the admin and plugin layouts). Shows a neutral loading screen until /auth/me
 * succeeds, then syncs auth + RBAC state and renders the page — so neither the
 * shell nor "Access Denied" flashes before an invalid session is sent to /login.
 * Admins who haven't finished onboarding go to /onboarding instead.
 *
 * Visitors with no session cookie never get here: proxy.ts redirects them.
 */
export function SessionGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  return (
    <AuthGate
      loadSession={() => apiClient.get<MeResponse>('/auth/me')}
      onSession={(data) => {
        const roles = data.roles ?? [];
        // Keeps the proxy's session hint alive for as long as the session is.
        setSessionHint();
        useAuthStore.getState().setName(data.name ?? null);
        useAuthStore.getState().setAvatar(data.avatar ?? null);
        useRBACStore.getState().setRBAC(roles, data.permissions ?? []);

        const onboardingCompleted = data.onboardingCompleted ?? true;
        useAuthStore.getState().setOnboardingCompleted(onboardingCompleted);

        if (!onboardingCompleted && roles.includes('ADMIN')) {
          router.replace('/onboarding');
          return false;
        }
      }}
      fallback={
        <div className="flex h-screen items-center justify-center bg-background">
          <Spinner />
        </div>
      }
      // Sign out stays on that screen as the way out when retrying can't help (e.g. a
      // session the API rejects with something other than 401, which /login bounces back from).
      renderError={(retry, state) => <SessionErrorScreen retry={retry} {...state} />}
    >
      {children}
    </AuthGate>
  );
}
