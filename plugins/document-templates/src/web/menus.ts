import { FileText, Mail } from 'lucide-react';

export const DocumentTemplatesMenus = [
  {
    name: 'documentTemplates.menu.parent',
    icon: FileText,
    permissions: ['document-templates.template.read', 'document-templates.email-template.read'],
    children: [
      {
        name: 'documentTemplates.menu.documents',
        href: '/plugins/document-templates/templates',
        icon: FileText,
        permissions: ['document-templates.template.read'],
      },
      {
        name: 'documentTemplates.menu.emails',
        href: '/plugins/document-templates/emails',
        icon: Mail,
        permissions: ['document-templates.email-template.read'],
      },
    ],
  },
];
