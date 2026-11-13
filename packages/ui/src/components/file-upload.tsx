'use client';

import { useState, useRef, ReactNode } from 'react';
import { Upload, X, Loader2 } from 'lucide-react';

interface FileUploadProps {
  value?: string;
  onChange: (url: string) => void;
  onUpload: (file: File) => Promise<string>;
  renderImage?: (url: string, label?: string) => ReactNode;
  label?: string;
  error?: boolean;
  accept?: string;
}

export function FileUpload({
  value,
  onChange,
  onUpload,
  renderImage,
  label,
  error,
  accept = "image/*"
}: FileUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const url = await onUpload(file);
      onChange(url);
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemove = () => {
    onChange('');
  };

  const defaultRenderImage = (url: string, label?: string) => (
    <div className="relative w-40 h-40 rounded-md overflow-hidden border border-input bg-background">
      <img
        src={url}
        alt={label || 'Image'}
        className="w-full h-full object-contain p-2"
      />
      <button
        type="button"
        onClick={handleRemove}
        className="absolute top-1 right-1 p-1 bg-destructive text-destructive-foreground rounded-full hover:bg-destructive/90 transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <div className="space-y-2">
      {label && (
        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
          {label}
        </label>
      )}

      {value ? (
        renderImage ? renderImage(value, label) : defaultRenderImage(value, label)
      ) : (
        <div
          className={`
            flex flex-col items-center justify-center w-full h-32 
            border-2 border-dashed rounded-md cursor-pointer 
            hover:bg-accent/50 transition-colors
            ${error ? 'border-destructive/50' : 'border-muted-foreground/25'}
          `}
          onClick={() => fileInputRef.current?.click()}
        >
          {isUploading ? (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          ) : (
            <>
              <Upload className="h-8 w-8 text-muted-foreground mb-2" />
              <span className="text-xs text-muted-foreground">Click to upload</span>
            </>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleFileChange}
        disabled={isUploading}
      />
    </div>
  );
}
