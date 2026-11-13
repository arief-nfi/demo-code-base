'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, Save, FileDown, RotateCcw, Settings, ExternalLink } from 'lucide-react';
import {
  apiClient, API_URL, getAuthHeaders, PageContainer, Button, Input, Label,
  useRBAC, useLanguage, Forbidden,
  Card, CardContent,
} from '@saas/ui';
import { toast } from 'sonner';
import { TemplateCodeEditor } from '../components/template-code-editor';
import { TemplatePreview } from '../components/template-preview';
import { MergeFieldPanel } from '../components/merge-field-panel';
import { PdfSettingsPanel } from '../components/pdf-settings-panel';

interface DocumentTemplate {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  category: string;
  htmlContent: string;
  cssContent?: string | null;
  headerHtml?: string | null;
  footerHtml?: string | null;
  paperSize: string;
  orientation: string;
  marginTop: string;
  marginBottom: string;
  marginLeft: string;
  marginRight: string;
  isDefault: boolean;
  isActive: boolean;
  version: number;
  sampleData?: string | null;
}

export interface TemplateEditorPageProps {
  params?: Record<string, string>;
  searchParams?: Record<string, string>;
  onNavigate?: (path: string) => void;
}

type EditorTab = 'html' | 'css' | 'header' | 'footer';

export const TemplateEditorPage = ({ onNavigate, searchParams }: TemplateEditorPageProps) => {
  const { authorize, isLoading: isRBACLoading } = useRBAC();
  const { t } = useLanguage();

  const templateId = searchParams?.id;
  const isEditMode = !!templateId;

  const [loading, setLoading] = useState(isEditMode);
  const [saving, setSaving] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  // Template fields
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('sales');

  // Editor content
  const [htmlContent, setHtmlContent] = useState('');
  const [cssContent, setCssContent] = useState('');
  const [headerHtml, setHeaderHtml] = useState('');
  const [footerHtml, setFooterHtml] = useState('');

  // Debounced preview content
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewCss, setPreviewCss] = useState('');
  const [previewHeader, setPreviewHeader] = useState('');
  const [previewFooter, setPreviewFooter] = useState('');

  // PDF settings
  const [pdfSettings, setPdfSettings] = useState({
    paperSize: 'A4',
    orientation: 'portrait',
    marginTop: '20mm',
    marginBottom: '20mm',
    marginLeft: '15mm',
    marginRight: '15mm',
  });

  // Sample data
  const [sampleData, setSampleData] = useState<Record<string, unknown>>({});
  const [sampleDataStr, setSampleDataStr] = useState('{}');

  // UI state
  const [activeTab, setActiveTab] = useState<EditorTab>('html');
  const [showSettings, setShowSettings] = useState(false);
  const [isDefault, setIsDefault] = useState(false);

  const editorRef = useRef<HTMLTextAreaElement>(null);

  // Debounce preview updates
  useEffect(() => {
    const timer = setTimeout(() => {
      setPreviewHtml(htmlContent);
      setPreviewCss(cssContent);
      setPreviewHeader(headerHtml);
      setPreviewFooter(footerHtml);
    }, 300);
    return () => clearTimeout(timer);
  }, [htmlContent, cssContent, headerHtml, footerHtml]);

  // Load template if editing
  useEffect(() => {
    if (!templateId || isRBACLoading) return;

    const loadTemplate = async () => {
      try {
        const tmpl = await apiClient.get<DocumentTemplate>(
          `/plugins/document-templates/templates/${templateId}`,
        );
        setName(tmpl.name);
        setSlug(tmpl.slug);
        setDescription(tmpl.description || '');
        setCategory(tmpl.category);
        setHtmlContent(tmpl.htmlContent);
        setCssContent(tmpl.cssContent || '');
        setHeaderHtml(tmpl.headerHtml || '');
        setFooterHtml(tmpl.footerHtml || '');
        setPdfSettings({
          paperSize: tmpl.paperSize,
          orientation: tmpl.orientation,
          marginTop: tmpl.marginTop,
          marginBottom: tmpl.marginBottom,
          marginLeft: tmpl.marginLeft,
          marginRight: tmpl.marginRight,
        });
        setIsDefault(tmpl.isDefault);

        if (tmpl.sampleData) {
          try {
            const parsed = JSON.parse(tmpl.sampleData);
            setSampleData(parsed);
            setSampleDataStr(tmpl.sampleData);
          } catch {
            // ignore invalid JSON
          }
        }
      } catch (error) {
        console.error('Failed to load template', error);
        toast.error('Failed to load template');
      } finally {
        setLoading(false);
      }
    };

    loadTemplate();
  }, [templateId, isRBACLoading]);

  const handleSave = async () => {
    if (!name || !slug || !htmlContent) {
      toast.error('Name, slug, and HTML content are required');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name,
        slug,
        description: description || undefined,
        category,
        htmlContent,
        cssContent: cssContent || undefined,
        headerHtml: headerHtml || undefined,
        footerHtml: footerHtml || undefined,
        sampleData: sampleDataStr || undefined,
        ...pdfSettings,
      };

      if (isEditMode && templateId) {
        await apiClient.patch(`/plugins/document-templates/templates/${templateId}`, payload);
        toast.success(t('documentTemplates.saveSuccess') || 'Template saved');
      } else {
        const created = await apiClient.post<DocumentTemplate>('/plugins/document-templates/templates', payload);
        toast.success(t('documentTemplates.saveSuccess') || 'Template created');
        if (onNavigate) {
          onNavigate(`/plugins/document-templates/templates/edit?id=${created.id}`);
        }
      }
    } catch (error) {
      console.error('Failed to save template', error);
      toast.error(t('documentTemplates.saveError') || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const handlePreviewPdf = async () => {
    if (!templateId) {
      toast.error('Save the template first to preview PDF');
      return;
    }

    setPdfLoading(true);
    try {
      const response = await fetch(
        `${API_URL}/plugins/document-templates/render`,
        {
          method: 'POST',
          headers: getAuthHeaders(),
          credentials: 'include',
          body: JSON.stringify({
            templateSlug: slug,
            data: sampleData,
            format: 'pdf',
          }),
        },
      );

      if (!response.ok) throw new Error('PDF generation failed');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (error) {
      console.warn('Failed to generate PDF', error);
      toast.error('Failed to generate PDF preview');
    } finally {
      setPdfLoading(false);
    }
  };

  const handleFullPreview = () => {
    if (!templateId) {
      toast.error('Save the template first to preview');
      return;
    }
    // Open the server-rendered HTML preview in a new tab
    const headers = getAuthHeaders();
    const tenantHeader = headers['x-tenant-id'] || '';
    fetch(`${API_URL}/plugins/document-templates/templates/${templateId}/preview`, {
      headers: getAuthHeaders(),
      credentials: 'include',
    })
      .then((res) => {
        if (!res.ok) throw new Error('Preview failed');
        return res.text();
      })
      .then((html) => {
        const win = window.open('', '_blank');
        if (win) {
          win.document.write(html);
          win.document.close();
        }
      })
      .catch(() => toast.error('Failed to open preview'));
  };

  const handleResetToDefault = async () => {
    if (!templateId) return;
    try {
      await apiClient.post(`/plugins/document-templates/defaults/${templateId}/reset`);
      toast.success('Template reset to default');
      // Reload
      window.location.reload();
    } catch (error) {
      console.error('Failed to reset', error);
      toast.error('Failed to reset template');
    }
  };

  const handleInsertMergeField = useCallback((expression: string) => {
    // Find the active editor textarea and insert
    const textarea = document.querySelector<HTMLTextAreaElement>(
      `[data-editor-tab="${activeTab}"] textarea`,
    );
    if (textarea && (textarea as any).__insertAtCursor) {
      (textarea as any).__insertAtCursor(expression);
    } else {
      // Fallback: append to current tab content
      const setters: Record<EditorTab, (fn: (prev: string) => string) => void> = {
        html: (fn) => setHtmlContent((prev) => fn(prev)),
        css: (fn) => setCssContent((prev) => fn(prev)),
        header: (fn) => setHeaderHtml((prev) => fn(prev)),
        footer: (fn) => setFooterHtml((prev) => fn(prev)),
      };
      setters[activeTab]((prev) => prev + expression);
    }
  }, [activeTab]);

  const handleSampleDataChange = (value: string) => {
    setSampleDataStr(value);
    try {
      setSampleData(JSON.parse(value));
    } catch {
      // invalid JSON, keep old data
    }
  };

  const generateSlug = (value: string) => {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  };

  if (isRBACLoading || loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!authorize({ roles: ['ADMIN'], permissions: ['document-templates.template.read'] })) {
    return <Forbidden />;
  }

  const tabs: { key: EditorTab; label: string }[] = [
    { key: 'html', label: 'HTML' },
    { key: 'css', label: 'CSS' },
    { key: 'header', label: 'Header' },
    { key: 'footer', label: 'Footer' },
  ];

  const editorValues: Record<EditorTab, string> = { html: htmlContent, css: cssContent, header: headerHtml, footer: footerHtml };
  const editorSetters: Record<EditorTab, (v: string) => void> = {
    html: setHtmlContent,
    css: setCssContent,
    header: setHeaderHtml,
    footer: setFooterHtml,
  };

  return (
    <PageContainer>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onNavigate?.('/plugins/document-templates/templates')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">
            {isEditMode ? (t('documentTemplates.editTemplate') || 'Edit Template') : (t('documentTemplates.createTemplate') || 'Create Template')}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {isDefault && isEditMode && (
            <Button variant="outline" size="sm" onClick={handleResetToDefault} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSettings(!showSettings)}
            className="gap-1.5"
          >
            <Settings className="h-3.5 w-3.5" /> Settings
          </Button>
          {isEditMode && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleFullPreview}
                className="gap-1.5"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Full Preview
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePreviewPdf}
                disabled={pdfLoading}
                className="gap-1.5"
              >
                <FileDown className="h-3.5 w-3.5" /> {pdfLoading ? 'Generating...' : 'PDF Preview'}
              </Button>
            </>
          )}
          <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
            <Save className="h-3.5 w-3.5" /> {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      {/* Template metadata */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!isEditMode) setSlug(generateSlug(e.target.value));
                }}
                placeholder="Invoice"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Slug</Label>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="invoice"
                className="h-9 font-mono"
                readOnly={isEditMode}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Category</Label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="sales">Sales</option>
                <option value="purchasing">Purchasing</option>
                <option value="inventory">Inventory</option>
                <option value="general">General</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Template description..."
                className="h-9"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Settings panel (collapsible) */}
      {showSettings && (
        <Card className="mb-4">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-medium mb-3">PDF Settings</h3>
                <PdfSettingsPanel settings={pdfSettings} onChange={setPdfSettings} />
              </div>
              <div>
                <h3 className="text-sm font-medium mb-3">Sample Data (JSON)</h3>
                <textarea
                  value={sampleDataStr}
                  onChange={(e) => handleSampleDataChange(e.target.value)}
                  className="w-full h-[180px] font-mono text-xs p-3 rounded-md border border-input bg-background resize-none"
                  placeholder='{"company": {"name": "Acme"}, "items": [...]}'
                  spellCheck={false}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Editor + Preview split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ minHeight: '500px' }}>
        {/* Left: Code editor */}
        <div className="flex flex-col">
          {/* Tabs */}
          <div className="flex border-b border-border mb-0">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Editor */}
          {tabs.map((tab) => (
            <div
              key={tab.key}
              data-editor-tab={tab.key}
              className={activeTab === tab.key ? 'flex-1' : 'hidden'}
            >
              <TemplateCodeEditor
                value={editorValues[tab.key]}
                onChange={editorSetters[tab.key]}
                height="460px"
              />
            </div>
          ))}
        </div>

        {/* Right: Preview + Merge fields */}
        <div className="flex flex-col border border-border rounded-md overflow-hidden">
          <div className="flex-1 min-h-0">
            <TemplatePreview
              htmlContent={previewHtml}
              cssContent={previewCss}
              headerHtml={previewHeader}
              footerHtml={previewFooter}
              sampleData={sampleData}
            />
          </div>
          <div className="border-t border-border max-h-[250px] overflow-y-auto">
            <MergeFieldPanel onInsert={handleInsertMergeField} />
          </div>
        </div>
      </div>
    </PageContainer>
  );
};
