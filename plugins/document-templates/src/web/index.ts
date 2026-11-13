import { TemplatesListPage } from './pages/templates-list';
import { TemplateEditorPage } from './pages/template-editor';
import { EmailTemplatesListPage } from './pages/email-templates-list';
import { EmailTemplateEditorPage } from './pages/email-template-editor';

export const DocumentTemplatesRoutes = {
  '/templates': TemplatesListPage,
  '/templates/create': TemplateEditorPage,
  '/templates/edit': TemplateEditorPage,
  '/emails': EmailTemplatesListPage,
  '/emails/edit': EmailTemplateEditorPage,
};

export * from './pages/templates-list';
export * from './pages/template-editor';
export * from './pages/email-templates-list';
export * from './pages/email-template-editor';
