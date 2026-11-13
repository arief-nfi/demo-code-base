import type React from 'react';
import { PartnersPage } from './pages/partners/PartnersPage';
import { WebhookEventsPage } from './pages/webhook-events/WebhookEventsPage';
import { WebhooksPage } from './pages/webhooks/WebhooksPage';
import { ApiKeysPage } from './pages/api-keys/ApiKeysPage';
import { GoogleCalendarPage } from './pages/google-calendar/GoogleCalendarPage';
import { GoogleCalendarCallbackPage } from './pages/google-calendar/GoogleCalendarCallbackPage';

export const IntegrationRoutes: Record<string, React.ComponentType> = {
  '/partners': PartnersPage,
  '/webhook-events': WebhookEventsPage,
  '/webhooks': WebhooksPage,
  '/api-keys': ApiKeysPage,
  '/google-calendar': GoogleCalendarPage,
  '/google-calendar/callback': GoogleCalendarCallbackPage,
};

export * from './pages/partners/PartnersPage';
export * from './pages/partners/PartnerDialog';
export * from './pages/partners/PartnerStatusDialog';
export * from './pages/webhook-events/WebhookEventsPage';
export * from './pages/webhook-events/WebhookEventDialog';
export * from './pages/webhook-events/PayloadPreview';
export * from './pages/webhooks/WebhooksPage';
export * from './pages/webhooks/WebhookDialog';
export * from './pages/webhooks/WebhookDeliveriesPage';
export * from './pages/webhooks/DeliveryDetailDialog';
export * from './pages/api-keys/ApiKeysPage';
export * from './pages/api-keys/ApiKeyDialog';
export * from './pages/api-keys/RevokeConfirmDialog';
export * from './pages/google-calendar/GoogleCalendarPage';
export * from './pages/google-calendar/GoogleCalendarCallbackPage';
