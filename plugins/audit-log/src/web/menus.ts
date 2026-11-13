import { Shield, Settings } from 'lucide-react';

export const AuditLogMenus = [
  {
    name: 'Audit Trail',
    icon: Shield,
    permissions: ['audit-log.log.view'],
    children: [
      {
        name: 'Audit Logs',
        href: '/plugins/audit-log/audit-logs',
        icon: Shield,
        permissions: ['audit-log.log.view'],
      },
      {
        name: 'Audit Config',
        href: '/plugins/audit-log/config',
        icon: Settings,
        permissions: ['audit-log.config.manage'],
      },
    ],
  },
];
