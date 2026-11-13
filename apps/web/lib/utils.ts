import { API_URL } from "@saas/ui";

export function getImageUrl(url: string | null | undefined) {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('https')) return url;
  const baseUrl = API_URL.replace(/\/$/, '');
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${baseUrl}${path}`;
}
