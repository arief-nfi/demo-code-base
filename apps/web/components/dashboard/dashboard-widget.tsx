'use client';

import { Component, type ReactNode } from 'react';
import { Card, CardContent } from '@saas/ui';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class WidgetErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

const sizeToColSpan: Record<string, string> = {
  sm: 'col-span-1',
  md: 'col-span-1 md:col-span-2',
  lg: 'col-span-1 md:col-span-2 lg:col-span-3',
  full: 'col-span-1 md:col-span-2 lg:col-span-4',
};

interface DashboardWidgetProps {
  size: 'sm' | 'md' | 'lg' | 'full';
  title?: string;
  children: ReactNode;
  noPadding?: boolean;
}

export function DashboardWidget({ size, title, children, noPadding }: DashboardWidgetProps) {
  return (
    <div className={sizeToColSpan[size] || 'col-span-1'}>
      <WidgetErrorBoundary
        fallback={
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Widget failed to load
            </CardContent>
          </Card>
        }
      >
        {title ? (
          <Card>
            <CardContent className={noPadding ? 'p-0' : 'p-6'}>
              {title && !noPadding && <h3 className="font-semibold mb-3">{title}</h3>}
              {children}
            </CardContent>
          </Card>
        ) : (
          children
        )}
      </WidgetErrorBoundary>
    </div>
  );
}
