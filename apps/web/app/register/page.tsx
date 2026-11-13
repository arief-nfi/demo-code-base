'use client';

import { useState, useRef } from 'react';
import { Loader2, Building2, User2, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { API_URL, Button, Input, Label } from '@saas/ui';
import { useAuthStore, useRBACStore } from '@saas/ui';
import { useTheme } from 'next-themes';
import { AuthLayout } from '@/components/auth-layout';

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function RegisterForm() {
  const [companyName, setCompanyName] = useState('');
  const [slug, setSlug] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { setTheme } = useTheme();

  const handleCompanyNameChange = (value: string) => {
    setCompanyName(value);
    setSlug(generateSlug(value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // 1. Register
      const regRes = await fetch(`${API_URL}/tenants/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName,
          slug,
          adminName,
          adminEmail,
          adminPassword: password,
        }),
      });

      if (!regRes.ok) {
        const data = await regRes.json();
        throw new Error(data.message || 'Registration failed');
      }

      const regData = await regRes.json();

      // 2. Auto-login
      const loginRes = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: `${regData.admin.username}@${regData.tenant.slug}`,
          password,
        }),
        credentials: 'include',
      });

      if (!loginRes.ok) {
        // Registration succeeded but login failed — redirect to login
        toast.success('Account created! Please log in.');
        router.push('/login');
        return;
      }

      const loginData = await loginRes.json();

      useAuthStore.getState().setSession({
        tenantId: loginData.user.tenantId,
        tenantSlug: loginData.user.tenantSlug,
        tenantName: loginData.user.tenantName,
        tenantDescription: loginData.user.tenantDescription,
        tenantLogo: loginData.user.tenantLogo,
        tenantIcon: loginData.user.tenantIcon,
        tenantPrimaryColor: loginData.user.tenantPrimaryColor,
        tenantAccentColor: loginData.user.tenantAccentColor,
        tenantSidebarBackground: loginData.user.tenantSidebarBackground,
        tenantSidebarForeground: loginData.user.tenantSidebarForeground,
        username: loginData.user.username,
        avatar: loginData.user.avatar ?? null,
      });
      useAuthStore.getState().setOnboardingCompleted(loginData.user.onboardingCompleted ?? false);
      useRBACStore.getState().setRBAC(loginData.user.roles || [], loginData.user.permissions || []);

      if (loginData.user.tenantTheme) {
        setTheme(loginData.user.tenantTheme.toLowerCase());
      }

      toast.success('Account created!');
      router.push('/onboarding');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md space-y-8">
      <div className="text-center lg:text-left">
        <h2 className="text-3xl font-bold tracking-tight text-foreground">
          Create your account
        </h2>
        <p className="mt-2 text-muted-foreground">
          Set up your workspace in seconds
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="companyName">Company Name</Label>
          <div className="relative">
            <Building2 className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
            <Input
              id="companyName"
              value={companyName}
              onChange={(e) => handleCompanyNameChange(e.target.value)}
              placeholder="Acme Inc"
              className="pl-10"
              required
            />
          </div>
          {slug && (
            <p className="text-xs text-muted-foreground">
              Your workspace URL: <span className="font-mono text-primary">{slug}</span>
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="adminName">Your Name</Label>
          <div className="relative">
            <User2 className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
            <Input
              id="adminName"
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              placeholder="John Smith"
              className="pl-10"
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="john@acme.com"
              className="pl-10"
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 8 characters"
              className="pl-10 pr-10"
              required
              minLength={8}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
        </div>

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4" />
              Creating account...
            </>
          ) : (
            'Create Account'
          )}
        </Button>
      </form>

      <div className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary hover:text-primary/80 transition-colors">
          Sign in
        </Link>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <AuthLayout>
      <RegisterForm />
    </AuthLayout>
  );
}
