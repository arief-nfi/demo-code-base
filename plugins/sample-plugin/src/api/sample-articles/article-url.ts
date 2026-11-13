/** The article's page in the app, for links from outside it (calendar events) */
export function articleUrl(articleId: string): string {
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${frontendUrl}/plugins/sample-plugin/articles/${articleId}`;
}
