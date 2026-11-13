'use client';

import { FileUpload as BaseFileUpload } from '@saas/ui';
import Image from 'next/image';
import { toast } from 'sonner';
import { apiClient } from '@saas/ui';
import { getImageUrl } from '@/lib/utils';
import { X } from 'lucide-react';

interface FileUploadProps {
  value?: string;
  onChange: (url: string) => void;
  label?: string;
  error?: boolean;
  endpoint?: string;
}

export function FileUpload({ value, onChange, label, error, endpoint }: FileUploadProps) {
  const handleUpload = async (file: File): Promise<string> => {
    try {
      const uploadEndpoint = endpoint || '/tenants/upload';
      const data = await apiClient.upload<{ url: string }>(uploadEndpoint, file);
      toast.success('File uploaded successfully');
      return data.url;
    } catch (error) {
      console.error(error);
      toast.error('Failed to upload file');
      throw error;
    }
  };

  const renderImage = (url: string, label?: string) => (
    <div className="relative w-40 h-40 rounded-md overflow-hidden border border-input bg-background">
      <Image
        src={getImageUrl(url)}
        alt={label || 'Image'}
        fill
        className="object-contain p-2"
        unoptimized
      />
      <button
        type="button"
        onClick={() => onChange('')}
        className="absolute top-1 right-1 p-1 bg-destructive text-destructive-foreground rounded-full hover:bg-destructive/90 transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <BaseFileUpload
      value={value}
      onChange={onChange}
      onUpload={handleUpload}
      renderImage={renderImage}
      label={label}
      error={error}
    />
  );
}
