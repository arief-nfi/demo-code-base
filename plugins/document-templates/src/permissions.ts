/**
 * Permissions required by the Document Templates Plugin
 * These will be automatically registered when a new tenant is created
 * Format: {pluginKey}.{resource}.{action}
 */
export const DocumentTemplatesPermissions = [
  {
    name: 'document-templates.template.read',
    description: 'Permission to view document templates',
  },
  {
    name: 'document-templates.template.create',
    description: 'Permission to create document templates',
  },
  {
    name: 'document-templates.template.update',
    description: 'Permission to update document templates',
  },
  {
    name: 'document-templates.template.delete',
    description: 'Permission to delete document templates',
  },
  {
    name: 'document-templates.template.render',
    description: 'Permission to render documents (PDF/HTML)',
  },
  // Descriptions match the email_templates migration that backfills existing tenants
  {
    name: 'document-templates.email-template.read',
    description: 'View email templates',
  },
  {
    name: 'document-templates.email-template.update',
    description: 'Edit, test and reset email templates',
  },
];
