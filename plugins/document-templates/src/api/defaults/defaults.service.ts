import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@saas/backend';
import * as fs from 'fs';
import * as path from 'path';
import { getSampleDataForCategory } from '../rendering/merge-fields';

interface DefaultTemplateDef {
  name: string;
  slug: string;
  description: string;
  category: string;
  fileName: string;
}

const DEFAULT_CSS = `
.document { padding: 10px; max-width: 800px; margin: 0 auto; }
.header-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px; }
.header-center { text-align: center; margin-bottom: 20px; }
.company-logo { max-height: 60px; max-width: 200px; margin-bottom: 8px; }
.company-name { font-size: 20px; font-weight: 700; color: #1a1a1a; margin-bottom: 4px; }
.company-details { font-size: 11px; color: #666; line-height: 1.4; white-space: pre-line; }
.document-title h2 { font-size: 24px; font-weight: 700; color: #2563eb; text-align: right; margin-bottom: 10px; }
.credit-note .document-title h2 { color: #dc2626; }
.info-table { margin-left: auto; }
.info-table td { padding: 2px 0; font-size: 11px; }
.info-table .label { color: #666; padding-right: 12px; text-align: right; }
.info-table .value { font-weight: 600; }
.status-badge { color: #2563eb; }
.address-row { display: flex; gap: 40px; margin-bottom: 24px; }
.bill-to, .deliver-to, .vendor-info, .ship-to { margin-bottom: 24px; }
.bill-to h3, .deliver-to h3, .vendor-info h3, .ship-to h3, .reason h3 { font-size: 11px; text-transform: uppercase; color: #999; letter-spacing: 0.5px; margin-bottom: 6px; }
.customer-name, .vendor-name { font-weight: 600; font-size: 13px; }
.items-table { width: 100%; margin-bottom: 24px; border-collapse: collapse; }
.items-table thead { background: #f8fafc; }
.items-table th { padding: 10px 12px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; border-bottom: 2px solid #e2e8f0; text-align: left; }
.items-table td { padding: 10px 12px; font-size: 12px; border-bottom: 1px solid #f1f5f9; }
.col-num { width: 40px; text-align: center; }
.col-qty, .col-unit { width: 70px; text-align: center; }
.col-price, .col-total { width: 110px; text-align: right; }
.col-check { width: 70px; text-align: center; font-size: 16px; }
.items-table th.col-price, .items-table th.col-total { text-align: right; }
.items-table th.col-qty, .items-table th.col-unit, .items-table th.col-check { text-align: center; }
.totals-section { display: flex; justify-content: flex-end; margin-bottom: 24px; }
.totals-table { width: 250px; }
.totals-table td { padding: 6px 0; font-size: 12px; }
.totals-table .label { color: #666; }
.totals-table .value { text-align: right; font-weight: 500; }
.totals-table .grand-total td { font-size: 14px; font-weight: 700; color: #1a1a1a; border-top: 2px solid #333; padding-top: 10px; }
.payment-terms, .notes, .reason { margin-bottom: 20px; padding: 12px 16px; background: #f8fafc; border-radius: 6px; }
.payment-terms h3, .notes h3 { font-size: 11px; text-transform: uppercase; color: #999; letter-spacing: 0.5px; margin-bottom: 6px; }
.signatures { display: flex; justify-content: space-between; margin-top: 50px; gap: 40px; }
.signature-block { flex: 1; text-align: center; }
.signature-line { border-bottom: 1px solid #333; margin-bottom: 8px; height: 40px; }
.sign-date { font-size: 10px; color: #999; margin-top: 4px; }
.footer-text { text-align: center; margin-top: 30px; color: #999; font-size: 11px; }
.receipt-title { text-align: center; font-size: 18px; margin: 10px 0; }
.receipt-divider { border-bottom: 1px dashed #ccc; margin: 12px 0; }
.receipt-info { width: 100%; margin-bottom: 10px; }
.receipt-info td { padding: 3px 8px; font-size: 12px; }
.receipt-info .label { color: #666; width: 100px; }
.receipt-items th, .receipt-items td { font-size: 11px; padding: 6px 8px; }
.receipt-totals { width: 100%; }
.receipt-totals td { padding: 4px 8px; }
`;

const DEFAULT_TEMPLATES: DefaultTemplateDef[] = [
  {
    name: 'Invoice',
    slug: 'invoice',
    description: 'Standard invoice template with company branding, line items, and totals',
    category: 'sales',
    fileName: 'invoice.html',
  },
  {
    name: 'Delivery Note',
    slug: 'delivery-note',
    description: 'Delivery note with item checklist and signature fields',
    category: 'inventory',
    fileName: 'delivery-note.html',
  },
  {
    name: 'Purchase Order',
    slug: 'purchase-order',
    description: 'Purchase order with vendor details and line items',
    category: 'purchasing',
    fileName: 'purchase-order.html',
  },
  {
    name: 'Receipt',
    slug: 'receipt',
    description: 'Compact receipt with payment details',
    category: 'general',
    fileName: 'receipt.html',
  },
  {
    name: 'Credit Note',
    slug: 'credit-note',
    description: 'Credit note referencing an original invoice',
    category: 'general',
    fileName: 'credit-note.html',
  },
];

@Injectable()
export class DefaultsService {
  private readonly logger = new Logger(DefaultsService.name);
  private readonly templatesDir = path.join(__dirname, 'templates');

  constructor(private prisma: PrismaService) {}

  private getClient(tenantSlug: string) {
    return this.prisma.getTenantClient(tenantSlug);
  }

  getDefaultTemplateList() {
    return DEFAULT_TEMPLATES.map(({ fileName, ...rest }) => rest);
  }

  getDefaultTemplateContent(slug: string): { htmlContent: string; cssContent: string } | null {
    const def = DEFAULT_TEMPLATES.find((t) => t.slug === slug);
    if (!def) return null;

    const filePath = path.join(this.templatesDir, def.fileName);
    try {
      const htmlContent = fs.readFileSync(filePath, 'utf-8');
      return { htmlContent, cssContent: DEFAULT_CSS };
    } catch (error) {
      this.logger.error(`Failed to read default template: ${filePath}`, error);
      return null;
    }
  }

  async installDefaults(tenantSlug: string, userId?: string) {
    const client = this.getClient(tenantSlug);
    const installed: string[] = [];
    const skipped: string[] = [];

    for (const def of DEFAULT_TEMPLATES) {
      const existing = await client.documentTemplate.findUnique({
        where: { slug: def.slug },
      });

      if (existing) {
        skipped.push(def.slug);
        continue;
      }

      const content = this.getDefaultTemplateContent(def.slug);
      if (!content) {
        this.logger.warn(`Default template content not found for: ${def.slug}`);
        continue;
      }

      const sampleData = JSON.stringify(getSampleDataForCategory(def.category), null, 2);

      await client.documentTemplate.create({
        data: {
          name: def.name,
          slug: def.slug,
          description: def.description,
          category: def.category,
          htmlContent: content.htmlContent,
          cssContent: content.cssContent,
          sampleData,
          isDefault: true,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      installed.push(def.slug);
    }

    return { installed, skipped };
  }

  async resetToDefault(templateId: string, tenantSlug: string, userId?: string) {
    const client = this.getClient(tenantSlug);
    const template = await client.documentTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      throw new Error(`Template with ID ${templateId} not found`);
    }

    const content = this.getDefaultTemplateContent(template.slug);
    if (!content) {
      throw new Error(`No default template found for slug '${template.slug}'`);
    }

    return client.documentTemplate.update({
      where: { id: templateId },
      data: {
        htmlContent: content.htmlContent,
        cssContent: content.cssContent,
        version: template.version + 1,
        updatedBy: userId,
      },
    });
  }
}
