// plugins/sample-plugin/src/web/pages/sample-articles/SampleArticleCreatePage.tsx
'use client';

import { ArrowLeft } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  apiClient, Button, Card, CardContent, CardFooter,
  PageContainer, PageHeader, useRBAC, useLanguage, Forbidden,
} from '@saas/ui';
import { toast } from 'sonner';
import { SampleArticleFormFields } from './SampleArticleFormFields';

// Client schema with async slug uniqueness check
const buildSchema = () =>
  z.object({
    title: z.string().min(1, 'Title is required').max(200),
    slug: z.string()
      .min(1, 'Slug is required')
      .max(200)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug must be lowercase kebab-case (letters, numbers, and single hyphens)')
      .refine(async (slug) => {
        try {
          const data = await apiClient.get<{ available: boolean }>(
            '/plugins/sample-plugin/articles/check-slug',
            { slug },
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

export const SampleArticleCreatePage = ({
  onNavigate,
}: {
  onNavigate?: (path: string) => void;
  params?: Record<string, string>;
  searchParams?: Record<string, string>;
} = {}) => {
  const { authorize, isLoading: isRBACLoading } = useRBAC();
  const { t } = useLanguage();

  const form = useForm<FormValues>({
    resolver: zodResolver(buildSchema()) as any,
    defaultValues: {
      title: '',
      slug: '',
      body: '',
      status: 'DRAFT',
      featured: false,
    },
  });

  if (isRBACLoading) {
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

  const onSubmit = async (data: FormValues) => {
    try {
      const created = await apiClient.post<{ id: string }>('/plugins/sample-plugin/articles', data);
      toast.success(t('samplePlugin.articles.create.success'));
      onNavigate?.(`/plugins/sample-plugin/articles/${created.id}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('samplePlugin.articles.create.errorOccurred');
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
        title={t('samplePlugin.articles.create.title')}
        description={t('samplePlugin.articles.create.description')}
      >
        <Button onClick={goList} variant="outline" className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          {t('samplePlugin.articles.create.cancel')}
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="p-6">
          <form id="article-create-form" onSubmit={form.handleSubmit(onSubmit)}>
            <SampleArticleFormFields<FormValues>
              form={form}
              disabled={form.formState.isSubmitting}
            />
          </form>
        </CardContent>
        <CardFooter align="between">
          <Button variant="outline" onClick={goList} disabled={form.formState.isSubmitting}>
            {t('samplePlugin.articles.create.cancel')}
          </Button>
          <Button
            type="submit"
            form="article-create-form"
            disabled={form.formState.isSubmitting}
            isLoading={form.formState.isSubmitting}
          >
            {t('samplePlugin.articles.create.save')}
          </Button>
        </CardFooter>
      </Card>
    </PageContainer>
  );
};
