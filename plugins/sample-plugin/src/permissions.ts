/**
 * Permissions required by the Sample Plugin
 * These will be automatically registered when a new tenant is created
 */
export const SamplePluginPermissions = [
  {
    name: 'sample-plugin.item.read',
    description: 'Permission to view sample items'
  },
  {
    name: 'sample-plugin.item.write',
    description: 'Permission to create, update, and delete sample items'
  },
  {
    name: 'sample-plugin.article.read',
    description: 'Permission to view sample articles'
  },
  {
    name: 'sample-plugin.article.write',
    description: 'Permission to create, update, and delete sample articles'
  }
];
