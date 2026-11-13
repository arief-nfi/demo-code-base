// plugins/sample-plugin/src/web/pages/sample-articles/SampleArticleFormFields.tsx
'use client';

import type { UseFormReturn, FieldValues } from 'react-hook-form';
import {
  Input,
  Textarea,
  Label,
  useLanguage,
} from '@saas/ui';

export interface SampleArticleFormValues {
  title: string;
  slug: string;
  body: string;
  status: 'DRAFT' | 'PUBLISHED';
  featured: boolean;
}

interface Props<TForm extends FieldValues = SampleArticleFormValues> {
  form: UseFormReturn<TForm>;
  disabled?: boolean;
  publishedAtIso?: string | null;
}

export function SampleArticleFormFields<TForm extends FieldValues = SampleArticleFormValues>({
  form,
  disabled,
  publishedAtIso,
}: Props<TForm>) {
  const { t } = useLanguage();
  const { register, watch, setValue, formState: { errors } } = form as unknown as UseFormReturn<SampleArticleFormValues>;

  const status = watch('status');
  const featured = watch('featured');

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="space-y-2">
        <Label>
          {t('samplePlugin.articles.form.titleLabel')}{' '}
          <span className="text-destructive">*</span>
        </Label>
        <Input
          type="text"
          placeholder={t('samplePlugin.articles.form.titlePlaceholder')}
          disabled={disabled}
          error={!!errors.title}
          {...register('title')}
        />
        {errors.title && (
          <p className="text-sm text-destructive">{String(errors.title.message)}</p>
        )}
      </div>

      {/* Slug */}
      <div className="space-y-2">
        <Label>
          {t('samplePlugin.articles.form.slugLabel')}{' '}
          <span className="text-destructive">*</span>
        </Label>
        <Input
          type="text"
          placeholder={t('samplePlugin.articles.form.slugPlaceholder')}
          disabled={disabled}
          error={!!errors.slug}
          {...register('slug')}
        />
        <p className="text-xs text-muted-foreground">
          {t('samplePlugin.articles.form.slugHint')}
        </p>
        {errors.slug && (
          <p className="text-sm text-destructive">{String(errors.slug.message)}</p>
        )}
      </div>

      {/* Body */}
      <div className="space-y-2">
        <Label>
          {t('samplePlugin.articles.form.bodyLabel')}{' '}
          <span className="text-destructive">*</span>
        </Label>
        <Textarea
          rows={10}
          placeholder={t('samplePlugin.articles.form.bodyPlaceholder')}
          disabled={disabled}
          error={!!errors.body}
          {...register('body')}
        />
        {errors.body && (
          <p className="text-sm text-destructive">{String(errors.body.message)}</p>
        )}
      </div>

      {/* Status + Featured row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>{t('samplePlugin.articles.form.statusLabel')}</Label>
          <select
            className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            {...register('status')}
          >
            <option value="DRAFT">{t('samplePlugin.articles.status.draft')}</option>
            <option value="PUBLISHED">{t('samplePlugin.articles.status.published')}</option>
          </select>
          {status === 'PUBLISHED' && publishedAtIso && (
            <p className="text-xs text-muted-foreground">
              {t('samplePlugin.articles.form.publishedAtLabel')}:{' '}
              {new Date(publishedAtIso).toLocaleString()}
            </p>
          )}
          {status === 'PUBLISHED' && !publishedAtIso && (
            <p className="text-xs text-muted-foreground">
              {t('samplePlugin.articles.form.publishedAtHint')}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>{t('samplePlugin.articles.form.featuredLabel')}</Label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border"
              checked={!!featured}
              disabled={disabled}
              onChange={(e) => setValue('featured', e.target.checked, { shouldDirty: true })}
            />
            <span className="text-foreground">
              {t('samplePlugin.articles.form.featuredLabel')}
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
