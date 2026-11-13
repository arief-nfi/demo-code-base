// plugins/sample-plugin/src/web/index.ts
import { SampleItemsPage } from './pages/sample-items/SampleItemPage';
import { SampleSettingPage } from './pages/sample-settings/SampleSettingPage';
import { SampleArticleListPage } from './pages/sample-articles/SampleArticleListPage';
import { SampleArticleDetailPage } from './pages/sample-articles/SampleArticleDetailPage';
import { SampleArticleCreatePage } from './pages/sample-articles/SampleArticleCreatePage';
import { SampleArticleEditPage } from './pages/sample-articles/SampleArticleEditPage';

export const SamplePluginRoutes = {
  '/items':                 SampleItemsPage,
  '/settings':              SampleSettingPage,
  '/articles':              SampleArticleListPage,
  '/articles/new':          SampleArticleCreatePage,
  '/articles/[id]':         SampleArticleDetailPage,
  '/articles/[id]/edit':    SampleArticleEditPage,
};

export * from './pages/sample-items/SampleItemPage';
export * from './pages/sample-settings/SampleSettingPage';
export * from './pages/sample-articles/SampleArticleListPage';
export * from './pages/sample-articles/SampleArticleDetailPage';
export * from './pages/sample-articles/SampleArticleCreatePage';
export * from './pages/sample-articles/SampleArticleEditPage';
