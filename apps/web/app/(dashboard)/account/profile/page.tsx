'use client';

import { useState, useEffect, useRef } from 'react';
import { User, Lock, Shield, Mail, Camera, Trash2, Eye, EyeOff } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { toast } from 'sonner';
import {
  apiClient, ApiRequestError, PageContainer, Button, Input, Label,
  ConfirmDialog, Badge, Card, CardContent,
  Avatar, AvatarImage, AvatarFallback, useAuthStore,
} from '@saas/ui';
import { getImageUrl } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { CalendarConnectionCard } from '@/components/calendar-connection-card';

const profileSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

export default function ProfilePage() {
  const [userInfo, setUserInfo] = useState<{
    username: string;
    tenantSlug: string;
    name: string | null;
    email: string;
    roles: string[];
    avatar: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleteAvatarDialogOpen, setIsDeleteAvatarDialogOpen] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setAvatar = useAuthStore(s => s.setAvatar);
  const storedTenantName = useAuthStore(s => s.tenantName);
  const storedTenantSlug = useAuthStore(s => s.tenantSlug);
  const storedUsername = useAuthStore(s => s.username);

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
  });

  const [passwords, setPasswords] = useState({
    currentPass: '',
    newPass: '',
    confirmPass: '',
  });

  useEffect(() => {
    document.title = `Profile | ${storedTenantName || 'SaaS Admin'}`;
  }, [storedTenantName]);

  useEffect(() => {
    const fetchProfile = async () => {
      const tenantSlug = storedTenantSlug;
      try {
        const data = await apiClient.get<{
          username: string;
          name: string | null;
          email: string;
          roles: string[];
          avatar: string | null;
        }>('/auth/me');
        setUserInfo({
          username: data.username,
          tenantSlug: tenantSlug || '',
          name: data.name,
          email: data.email,
          roles: data.roles || [],
          avatar: data.avatar || null,
        });
        setValue('name', data.name || '');
        setValue('email', data.email || '');
      } catch (error) {
        console.warn('Failed to fetch profile', error);
        // Fallback
        if (storedUsername && tenantSlug) {
          setUserInfo({
            username: storedUsername,
            tenantSlug: tenantSlug || '',
            name: null,
            email: '',
            roles: [],
            avatar: null,
          });
        }
      }
    };

    fetchProfile();
  }, [setValue]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const file = e.target.files[0];

    setLoading(true);

    try {
      const data = await apiClient.upload<{ avatar: string }>('/auth/me/avatar', file);
      setUserInfo(prev => prev ? { ...prev, avatar: data.avatar } : null);
      setAvatar(data.avatar);
      toast.success('Avatar updated successfully');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to upload avatar';
      toast.error(message);
    } finally {
      setLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveAvatar = async () => {
    setLoading(true);
    setIsDeleteAvatarDialogOpen(false);

    try {
      await apiClient.delete('/auth/me/avatar');
      setUserInfo(prev => prev ? { ...prev, avatar: null } : null);
      setAvatar(null);
      toast.success('Avatar removed successfully');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to remove avatar';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleProfileUpdate = async (data: ProfileFormValues) => {
    setLoading(true);

    try {
      await apiClient.patch('/auth/me', data);
      toast.success('Profile updated successfully');
      setUserInfo(prev => prev ? { ...prev, ...data, email: data.email || '' } : null);
      setIsEditing(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update profile';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();

    if (passwords.newPass !== passwords.confirmPass) {
      toast.error('New passwords do not match');
      return;
    }

    if (passwords.newPass.length < 6) {
      toast.error('Password must be at least 6 characters long');
      return;
    }

    setLoading(true);

    try {
      await apiClient.post('/auth/change-password', {
        currentPass: passwords.currentPass,
        newPass: passwords.newPass,
      });
      toast.success('Password updated successfully');
      setPasswords({ currentPass: '', newPass: '', confirmPass: '' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to change password';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const InfoRow = ({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between py-2.5">
      <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-sm font-medium">{children}</div>
    </div>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Profile Settings"
        description="Manage your account settings and preferences."
      />

      <div className="grid gap-6 md:grid-cols-2">
        {/* User Info Card */}
        <Card className="h-fit">
          <CardContent className="p-6">
            {/* Avatar + Username Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <div className="relative group">
                  <Avatar size="lg" className="border-2 border-transparent group-hover:border-primary transition-colors">
                    {userInfo?.avatar ? (
                      <AvatarImage src={getImageUrl(userInfo.avatar)} alt={userInfo.username} />
                    ) : null}
                    <AvatarFallback>{userInfo?.username?.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="absolute -bottom-2 -right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="p-1.5 rounded-full bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
                      title="Change Avatar"
                    >
                      <Camera className="h-3 w-3" />
                    </button>
                    {userInfo?.avatar && (
                      <button
                        onClick={() => setIsDeleteAvatarDialogOpen(true)}
                        className="p-1.5 rounded-full bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
                        title="Remove Avatar"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                  />
                </div>
                <div>
                  <h2 className="font-semibold">{userInfo?.name || userInfo?.username}</h2>
                  <p className="text-sm text-muted-foreground">@{userInfo?.tenantSlug}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setIsEditing(!isEditing)}>
                {isEditing ? 'Cancel' : 'Edit'}
              </Button>
            </div>

            {isEditing ? (
              <form onSubmit={handleSubmit(handleProfileUpdate)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input
                    {...register('name')}
                    placeholder="Your name"
                    error={!!errors.name}
                  />
                  {errors.name && (
                    <p className="text-xs text-destructive">{errors.name.message}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    {...register('email')}
                    placeholder="your@email.com"
                    error={!!errors.email}
                  />
                  {errors.email && (
                    <p className="text-xs text-destructive">{errors.email.message}</p>
                  )}
                </div>
                <div className="pt-2">
                  <Button type="submit" isLoading={loading} className="w-full">
                    Save Changes
                  </Button>
                </div>
              </form>
            ) : (
              <div className="divide-y divide-border">
                <InfoRow icon={<Shield className="h-4 w-4" />} label="Tenant">
                  <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{userInfo?.tenantSlug}</span>
                </InfoRow>
                <InfoRow icon={<User className="h-4 w-4" />} label="Username">
                  {userInfo?.username}
                </InfoRow>
                <InfoRow icon={<User className="h-4 w-4" />} label="Name">
                  {userInfo?.name || '-'}
                </InfoRow>
                <InfoRow icon={<Mail className="h-4 w-4" />} label="Email">
                  {userInfo?.email || '-'}
                </InfoRow>
                <div className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                    <Shield className="h-4 w-4" />
                    <span>Roles</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {userInfo?.roles && userInfo.roles.length > 0 ? (
                      userInfo.roles.map((role) => (
                        <Badge key={role} variant="outline" className="text-xs">{role}</Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <ConfirmDialog
          isOpen={isDeleteAvatarDialogOpen}
          onClose={() => setIsDeleteAvatarDialogOpen(false)}
          onConfirm={handleRemoveAvatar}
          title="Remove Avatar"
          description="Are you sure you want to remove your profile picture? This action cannot be undone."
          confirmText="Remove"
          variant="destructive"
          loading={loading}
        />

        {/* Change Password Card */}
        <Card className="h-fit">
          <CardContent className="p-6">
            <div className="flex items-center gap-2.5 mb-6">
              <div className="rounded-lg bg-primary/10 p-2">
                <Lock className="h-4 w-4 text-primary" />
              </div>
              <h2 className="font-semibold">Change Password</h2>
            </div>

            <form onSubmit={handlePasswordChange} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Current Password</Label>
                <div className="relative">
                  <Input
                    type={showCurrentPassword ? "text" : "password"}
                    required
                    value={passwords.currentPass}
                    onChange={(e) => setPasswords({ ...passwords, currentPass: e.target.value })}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground hover:text-foreground"
                    aria-label={showCurrentPassword ? 'Hide password' : 'Show password'}
                  >
                    {showCurrentPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>New Password</Label>
                <div className="relative">
                  <Input
                    type={showNewPassword ? "text" : "password"}
                    required
                    value={passwords.newPass}
                    onChange={(e) => setPasswords({ ...passwords, newPass: e.target.value })}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground hover:text-foreground"
                    aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                  >
                    {showNewPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Confirm New Password</Label>
                <div className="relative">
                  <Input
                    type={showConfirmPassword ? "text" : "password"}
                    required
                    value={passwords.confirmPass}
                    onChange={(e) => setPasswords({ ...passwords, confirmPass: e.target.value })}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground hover:text-foreground"
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="pt-2">
                <Button type="submit" isLoading={loading} className="w-full">
                  Update Password
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <CalendarConnectionCard />
      </div>
    </PageContainer>
  );
}
