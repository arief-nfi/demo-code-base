'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Palette, UserPlus, Check, ChevronRight, SkipForward } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient, Button, Input, Label, useAuthStore } from '@saas/ui';

const steps = [
  { id: 1, title: 'Company Info', icon: Building2 },
  { id: 2, title: 'Branding', icon: Palette },
  { id: 3, title: 'Invite User', icon: UserPlus },
];

export default function OnboardingPage() {
  const router = useRouter();
  const tenantName = useAuthStore((s) => s.tenantName);
  const tenantSlug = useAuthStore((s) => s.tenantSlug);

  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1: Company Info
  const [description, setDescription] = useState('');

  // Step 2: Branding
  const [primaryColor, setPrimaryColor] = useState('#2563eb');

  // Step 3: Invite User
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');

  if (!tenantSlug) {
    router.push('/login');
    return null;
  }

  const handleNext = async () => {
    setLoading(true);
    try {
      if (currentStep === 1 && description) {
        await apiClient.patch('/tenants/config', { description });
      }
      if (currentStep === 2 && primaryColor) {
        await apiClient.patch('/tenants/config', { primaryColor });
        useAuthStore.getState().updateTenantInfo({ tenantPrimaryColor: primaryColor });
      }
      if (currentStep === 3 && inviteEmail) {
        try {
          await apiClient.post('/system/users', {
            username: inviteEmail.split('@')[0],
            email: inviteEmail,
            name: inviteName,
            password: crypto.randomUUID().slice(0, 16),
            roles: ['USER'],
          });
          toast.success('User invited');
        } catch {
          toast.error('Failed to invite user — you can do this later from Settings');
        }
      }

      if (currentStep < 3) {
        setCurrentStep(currentStep + 1);
      } else {
        await completeOnboarding();
      }
    } catch {
      // Non-critical — continue to next step
      if (currentStep < 3) {
        setCurrentStep(currentStep + 1);
      } else {
        await completeOnboarding();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    if (currentStep < 3) {
      setCurrentStep(currentStep + 1);
    } else {
      completeOnboarding();
    }
  };

  const completeOnboarding = async () => {
    try {
      await apiClient.patch('/tenants/onboarding-complete');
      useAuthStore.getState().setOnboardingCompleted(true);
      toast.success('Setup complete!');
      router.push('/');
    } catch {
      // Even if the API call fails, redirect to dashboard
      useAuthStore.getState().setOnboardingCompleted(true);
      router.push('/');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/30 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground">Welcome to {tenantName}</h1>
          <p className="text-muted-foreground mt-1">Let&apos;s get your workspace set up</p>
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {steps.map((step, i) => (
            <div key={step.id} className="flex items-center">
              <div
                className={`flex items-center justify-center w-9 h-9 rounded-full border-2 transition-colors ${
                  step.id < currentStep
                    ? 'bg-primary border-primary text-primary-foreground'
                    : step.id === currentStep
                      ? 'border-primary text-primary'
                      : 'border-border text-muted-foreground'
                }`}
              >
                {step.id < currentStep ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <step.icon className="h-4 w-4" />
                )}
              </div>
              {i < steps.length - 1 && (
                <div className={`w-12 h-0.5 mx-1 ${step.id < currentStep ? 'bg-primary' : 'bg-border'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step Content */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-1">{steps[currentStep - 1].title}</h2>

          {currentStep === 1 && (
            <div className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">Tell us about your company. This appears in your workspace.</p>
              <div className="space-y-2">
                <Label>Company Description</Label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does your company do?"
                  className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                />
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">Choose a primary color for your workspace theme.</p>
              <div className="space-y-2">
                <Label>Primary Color</Label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-10 h-10 rounded-md border border-input cursor-pointer"
                  />
                  <Input
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    placeholder="#2563eb"
                    className="font-mono w-32"
                  />
                  <div
                    className="h-10 flex-1 rounded-md"
                    style={{ backgroundColor: primaryColor }}
                  />
                </div>
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">Invite a team member to your workspace. You can skip this and invite users later.</p>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="Jane Smith"
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="jane@company.com"
                />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
            <Button variant="ghost" size="sm" onClick={handleSkip} className="gap-1.5 text-muted-foreground">
              <SkipForward className="h-3.5 w-3.5" />
              {currentStep === 3 ? 'Skip & Finish' : 'Skip'}
            </Button>
            <Button onClick={handleNext} disabled={loading} className="gap-1.5">
              {currentStep === 3 ? 'Complete Setup' : 'Next'}
              {currentStep < 3 && <ChevronRight className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Step counter */}
        <p className="text-center text-xs text-muted-foreground mt-4">
          Step {currentStep} of {steps.length}
        </p>
      </div>
    </div>
  );
}
