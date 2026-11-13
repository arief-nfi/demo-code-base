import { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Button } from './button';

interface PageHeaderProps {
  title: ReactNode;
  description?: string;
  children?: ReactNode;
  backUrl?: string;
  renderBackButton?: (backUrl: string) => ReactNode;
}

export function PageHeader({
  title,
  description,
  children,
  backUrl,
  renderBackButton
}: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
      <div className="flex items-center gap-4">
        {backUrl && (
          renderBackButton ? (
            renderBackButton(backUrl)
          ) : (
            <a href={backUrl}>
              <Button variant="ghost" size="icon">
                <ChevronLeft className="w-5 h-5" />
              </Button>
            </a>
          )
        )}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description && (
            <p className="text-muted-foreground mt-1">{description}</p>
          )}
        </div>
      </div>
      {children && (
        <div className="flex items-center gap-2">
          {children}
        </div>
      )}
    </div>
  );
}
