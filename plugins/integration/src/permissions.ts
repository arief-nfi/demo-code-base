/**
 * Permissions required by the Integration Plugin
 * These will be automatically registered when a new tenant is created
 */
export const IntegrationPermissions = [
  // Partner
  {
    name: 'integration.partner.read',
    description: 'View integration partners',
  },
  {
    name: 'integration.partner.write',
    description: 'Create, update, and delete integration partners',
  },
  // Webhook Events
  {
    name: 'integration.webhook-event.read',
    description: 'View webhook event definitions',
  },
  {
    name: 'integration.webhook-event.write',
    description: 'Create, update, and delete webhook event definitions',
  },
  // Webhooks
  {
    name: 'integration.webhook.read',
    description: 'View webhooks and delivery logs',
  },
  {
    name: 'integration.webhook.write',
    description: 'Create, update, delete webhooks and trigger deliveries',
  },
  // API Keys
  {
    name: 'integration.api-key.read',
    description: 'View API keys',
  },
  {
    name: 'integration.api-key.write',
    description: 'Create, revoke, and regenerate API keys',
  },
  // Google Calendar
  {
    name: 'integration.google-calendar.connect',
    description: 'Connect your own Google account (Calendar, Meet)',
  },
  {
    name: 'integration.google-calendar.manage',
    description: 'Manage Google Calendar and Meet for the organization',
  },
];
