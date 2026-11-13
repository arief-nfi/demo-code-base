import { Plug, Users, Zap, Webhook, KeyRound, CalendarDays } from 'lucide-react';

export const IntegrationMenus = [
  {
    name: 'Integration',
    icon: Plug,
    permissions: ['integration.partner.read', 'integration.google-calendar.connect', 'integration.google-calendar.manage'],
    children: [
      {
        name: 'Partners',
        href: '/plugins/integration/partners',
        icon: Users,
        permissions: ['integration.partner.read'],
      },
      {
        name: 'Webhook Events',
        href: '/plugins/integration/webhook-events',
        icon: Zap,
        permissions: ['integration.webhook-event.read'],
      },
      {
        name: 'Webhooks',
        href: '/plugins/integration/webhooks',
        icon: Webhook,
        permissions: ['integration.webhook.read'],
      },
      {
        name: 'API Keys',
        href: '/plugins/integration/api-keys',
        icon: KeyRound,
        permissions: ['integration.api-key.read'],
      },
      {
        name: 'integration.menu.googleCalendar',
        href: '/plugins/integration/google-calendar',
        icon: CalendarDays,
        permissions: ['integration.google-calendar.connect', 'integration.google-calendar.manage'],
      },
    ],
  },
];
