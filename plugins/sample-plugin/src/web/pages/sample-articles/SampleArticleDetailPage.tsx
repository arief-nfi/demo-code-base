// plugins/sample-plugin/src/web/pages/sample-articles/SampleArticleDetailPage.tsx
'use client';

import { useState, useEffect } from 'react';
import { ArrowLeft, Edit, Trash2, Star, FileText } from 'lucide-react';
import {
  apiClient, cn, Button, Card, CardHeader, CardContent,
  Protect, useRBAC, useLanguage, Forbidden, PageContainer, PageHeader, EmptyState,
} from '@saas/ui';
import { DeleteSampleArticleDialog, type DeleteSampleArticleTarget } from './DeleteSampleArticleDialog';
import { ReviewMeetingCard } from './ReviewMeetingCard';

interface UserRef {
  id: string;
  name: string | null;
  username: string;
}

interface SampleArticle {
  id: string;
  title: string;
  slug: string;
  body: string;
  status: 'DRAFT' | 'PUBLISHED';
  publishedAt: string | null;
  featured: boolean;
  createdById: string | null;
  updatedById: string | null;
  createdBy: UserRef | null;
  updatedBy: UserRef | null;
  createdAt: string;
  updatedAt: string;
}

export const SampleArticleDetailPage = ({
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
  const [loading, setLoading] = useState(true);
  const [notFoundState, setNotFoundState] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteSampleArticleTarget | null>(null);

  useEffect(() => {
    if (isRBACLoading || !id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await apiClient.get<SampleArticle>(`/plugins/sample-plugin/articles/${id}`);
        if (!cancelled) {
          setArticle(data);
          setNotFoundState(false);
        }
      } catch {
        if (!cancelled) setNotFoundState(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isRBACLoading]);

  if (isRBACLoading || loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!authorize({ roles: ['ADMIN'], permissions: ['sample-plugin.article.read'] })) {
    return <Forbidden />;
  }

  const goList = () => onNavigate?.('/plugins/sample-plugin/articles');

  if (notFoundState || !article) {
    return (
      <PageContainer>
        <EmptyState
          icon={<FileText className="h-12 w-12" />}
          title={t('samplePlugin.articles.detail.notFound')}
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

  const publishedLabel = article.publishedAt
    ? t('samplePlugin.articles.detail.publishedOn', {
        date: new Date(article.publishedAt).toLocaleString(),
      })
    : t('samplePlugin.articles.detail.notPublished');

  const renderUser = (id: string | null, ref: UserRef | null) => {
    if (!id) return t('samplePlugin.articles.detail.unsetUser');
    if (!ref) return t('samplePlugin.articles.detail.deletedUser');
    return ref.name ?? ref.username;
  };

  const statusBadge = (status: SampleArticle['status']) => {
    const label = status === 'PUBLISHED'
      ? t('samplePlugin.articles.status.published')
      : t('samplePlugin.articles.status.draft');
    const classes = status === 'PUBLISHED'
      ? 'bg-primary/10 text-primary'
      : 'bg-muted text-muted-foreground';
    return (
      <span className={cn('inline-flex items-center rounded-full px-2 py-1 text-xs font-medium', classes)}>
        {label}
      </span>
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title={article.title}
        description={article.slug}
      >
        <Button onClick={goList} variant="outline" className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          {t('samplePlugin.articles.detail.back')}
        </Button>
        <Protect roles={['ADMIN']} permissions={['sample-plugin.article.write']}>
          <Button
            onClick={() => onNavigate?.(`/plugins/sample-plugin/articles/${article.id}/edit`)}
            className="gap-2"
          >
            <Edit className="h-4 w-4" />
            {t('samplePlugin.articles.detail.edit')}
          </Button>
          <Button
            variant="destructive"
            className="gap-2"
            onClick={() => {
              setDeleteTarget({ kind: 'single', id: article.id });
              setDeleteOpen(true);
            }}
          >
            <Trash2 className="h-4 w-4" />
            {t('samplePlugin.articles.detail.delete')}
          </Button>
        </Protect>
      </PageHeader>

      <Card>
        <CardHeader className="p-6">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {statusBadge(article.status)}
            {article.featured && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                <Star className="h-3 w-3" fill="currentColor" />
                {t('samplePlugin.articles.detail.featured')}
              </span>
            )}
            <span className="text-muted-foreground">{publishedLabel}</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {t('samplePlugin.articles.detail.body')}
              </h3>
              <div className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-4 text-sm text-foreground">
                {article.body}
              </div>
            </div>

            <dl className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('samplePlugin.articles.detail.slug')}
                </dt>
                <dd className="mt-1 font-mono text-foreground">{article.slug}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('samplePlugin.articles.detail.idLabel')}
                </dt>
                <dd className="mt-1 font-mono text-muted-foreground">{article.id}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('samplePlugin.articles.detail.createdAtLabel')}
                </dt>
                <dd className="mt-1 text-muted-foreground">
                  {new Date(article.createdAt).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('samplePlugin.articles.detail.updatedAtLabel')}
                </dt>
                <dd className="mt-1 text-muted-foreground">
                  {new Date(article.updatedAt).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('samplePlugin.articles.detail.createdByLabel')}
                </dt>
                <dd className="mt-1 text-muted-foreground">
                  {renderUser(article.createdById, article.createdBy)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('samplePlugin.articles.detail.updatedByLabel')}
                </dt>
                <dd className="mt-1 text-muted-foreground">
                  {renderUser(article.updatedById, article.updatedBy)}
                </dd>
              </div>
            </dl>
          </div>
        </CardContent>
      </Card>

      <ReviewMeetingCard articleId={article.id} onNavigate={onNavigate} />

      <DeleteSampleArticleDialog
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onSuccess={() => {
          setDeleteOpen(false);
          onNavigate?.('/plugins/sample-plugin/articles');
        }}
        target={deleteTarget}
      />
    </PageContainer>
  );
};
