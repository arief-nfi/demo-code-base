// plugins/sample-plugin/src/web/pages/sample-articles/SampleArticleEditPage.tsx
'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, FileText } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  apiClient, Button, Card, CardContent, CardFooter,
  PageContainer, PageHeader, useRBAC, useLanguage, Forbidden, EmptyState,
} from '@saas/ui';
import { toast } from 'sonner';
import { SampleArticleFormFields } from './SampleArticleFormFields';

interface SampleArticle {
  id: string;
  title: string;
  slug: string;
  body: string;
  status: 'DRAFT' | 'PUBLISHED';
  publishedAt: string | null;
  featured: boolean;
  createdAt: string;
  updatedAt: string;
}

const buildSchema = (currentId: string | undefined) =>
  z.object({
    title: z.string().min(1, 'Title is required').max(200),
    slug: z.string()
      .min(1, 'Slug is required')
      .max(200)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug must be lowercase kebab-case (letters, numbers, and single hyphens)')
      .refine(async (slug) => {
        try {
          const params: Record<string, string> = { slug };
          if (currentId) params.excludeId = currentId;
          const data = await apiClient.get<{ available: boolean }>(
            '/plugins/sample-plugin/articles/check-slug',
            params,
          );
          return data.available;
        } catch {
          return true;
        }
      }, 'This slug is already in use'),
    body: z.string().min(1, 'Body is required'),
    status: z.enum(['DRAFT', 'PUBLISHED']),
    featured: z.boolean(),
  });

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

export const SampleArticleEditPage = ({
  params,
  onNavigate,
}: {
  params?: Record<string, string>;
  searchParams?: Record<string, string>;
  onNavigate?: (path: string) => void;
} = {}) => {
  const { authorize, isLoading: isRBACLoading } = useRBAC();
  const { t } = useLanguage();
  const id = params?.id;

  const [article, setArticle] = useState<SampleArticle | null>(null);
  const [loadingArticle, setLoadingArticle] = useState(true);
  const [notFoundState, setNotFoundState] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(buildSchema(id)) as any,
    defaultValues: {
      title: '',
      slug: '',
      body: '',
      status: 'DRAFT',
      featured: false,
    },
  });

  useEffect(() => {
    if (isRBACLoading || !id) return;
    let cancelled = false;
    (async () => {
      setLoadingArticle(true);
      try {
        const data = await apiClient.get<SampleArticle>(`/plugins/sample-plugin/articles/${id}`);
        if (cancelled) return;
        setArticle(data);
        form.reset({
          title: data.title,
          slug: data.slug,
          body: data.body,
          status: data.status,
          featured: data.featured,
        });
        setNotFoundState(false);
      } catch {
        if (!cancelled) setNotFoundState(true);
      } finally {
        if (!cancelled) setLoadingArticle(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isRBACLoading]);

  if (isRBACLoading || loadingArticle) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!authorize({ roles: ['ADMIN'], permissions: ['sample-plugin.article.write'] })) {
    return <Forbidden />;
  }

  const goList = () => onNavigate?.('/plugins/sample-plugin/articles');
  const goDetail = () => (id ? onNavigate?.(`/plugins/sample-plugin/articles/${id}`) : goList());

  if (notFoundState || !article) {
    return (
      <PageContainer>
        <EmptyState
          icon={<FileText className="h-12 w-12" />}
          title={t('samplePlugin.articles.edit.notFound')}
          description={t('samplePlugin.articles.detail.notFoundDescription')}
          action={
            <Button onClick={goList} variant="outline" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              {t('samplePlugin.articles.detail.back')}
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const onSubmit = async (data: FormValues) => {
    try {
      await apiClient.patch(`/plugins/sample-plugin/articles/${article.id}`, data);
      toast.success(t('samplePlugin.articles.edit.success'));
      onNavigate?.(`/plugins/sample-plugin/articles/${article.id}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('samplePlugin.articles.edit.errorOccurred');
      if (message.toLowerCase().includes('slug')) {
        form.setError('slug', { message: t('samplePlugin.articles.form.slugTaken') });
        return;
      }
      toast.error(message);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('samplePlugin.articles.edit.title')}
        description={article.title}
      >
        <Button onClick={goDetail} variant="outline" className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          {t('samplePlugin.articles.edit.cancel')}
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="p-6">
          <form id="article-edit-form" onSubmit={form.handleSubmit(onSubmit)}>
            <SampleArticleFormFields<FormValues>
              form={form}
              disabled={form.formState.isSubmitting}
              publishedAtIso={article.publishedAt}
            />
          </form>
        </CardContent>
        <CardFooter align="between">
          <Button variant="outline" onClick={goDetail} disabled={form.formState.isSubmitting}>
            {t('samplePlugin.articles.edit.cancel')}
          </Button>
          <Button
            type="submit"
            form="article-edit-form"
            disabled={form.formState.isSubmitting}
            isLoading={form.formState.isSubmitting}
          >
            {t('samplePlugin.articles.edit.save')}
          </Button>
        </CardFooter>
      </Card>
    </PageContainer>
  );
};
