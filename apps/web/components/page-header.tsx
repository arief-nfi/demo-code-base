import { type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { PageHeader as BasePageHeader, Button } from '@saas/ui';

interface PageHeaderProps {
  title: ReactNode;
  description?: string;
  children?: ReactNode;
  backUrl?: string;
}

export function PageHeader({ title, description, children, backUrl }: PageHeaderProps) {
  return (
    <BasePageHeader
      title={title}
      description={description}
      backUrl={backUrl}
      renderBackButton={backUrl ? (url) => (
        <Link href={url}>
          <Button variant="ghost" size="icon">
            <ChevronLeft className="w-5 h-5" />
          </Button>
        </Link>
      ) : undefined}
    >
      {children}
    </BasePageHeader>
  );
}
