import type React from 'react';

export interface DashboardWidgetConfig {
  id: string;
  title: string;
  component: React.ComponentType<{ tenantSlug: string }>;
  size: 'sm' | 'md' | 'lg' | 'full';
  order?: number;
}
