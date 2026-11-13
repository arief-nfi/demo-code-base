'use client';

import { useState } from 'react';
import { Button } from '../button';
import { ImportWizard } from './ImportWizard';
import { Upload } from 'lucide-react';

interface ImportButtonProps {
  importKey: string;
  onComplete?: () => void;
  className?: string;
}

export function ImportButton({ importKey, onComplete, className }: ImportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
        className={className}
      >
        <Upload className="mr-1 h-4 w-4" />
        Import
      </Button>
      <ImportWizard
        importKey={importKey}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onComplete={onComplete}
      />
    </>
  );
}
