import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, RbacGuard, Roles, ZodValidationPipe } from '@saas/backend';
import { BillingSettingsService } from './billing-settings.service';
import { InvoiceService, type AdminInvoicePage } from './invoice.service';
import { SubscriptionsService } from './subscriptions.service';
import { BillingJob, type BillingJobResult } from './billing.job';
import type { Invoice } from '@saas/database';
import {
  adminInvoiceQuerySchema,
  billingSettingsSchema,
  markPaidSchema,
  type AdminInvoiceQueryDto,
  type BillingSettingsDto,
  type MarkPaidDto,
} from './billing.schemas';

/** Sysadmin billing across all tenants. */
@ApiTags('Billing (sysadmin)')
@ApiBearerAuth()
@Controller('billing/admin')
@UseGuards(JwtAuthGuard, RbacGuard)
@Roles('SYSADMIN')
export class BillingAdminController {
  constructor(
    private readonly settings: BillingSettingsService,
    private readonly invoices: InvoiceService,
    private readonly subscriptions: SubscriptionsService,
    private readonly job: BillingJob,
  ) {}

  @Get('settings')
  @ApiOperation({ summary: 'Get billing settings' })
  getSettings() {
    return this.settings.getSettings();
  }

  @Put('settings')
  @ApiOperation({ summary: 'Update billing settings' })
  updateSettings(@Body(new ZodValidationPipe(billingSettingsSchema)) body: BillingSettingsDto) {
    return this.settings.updateSettings(body);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Revenue and overdue figures' })
  summary() {
    return this.invoices.adminSummary(new Date());
  }

  @Get('invoices')
  @ApiOperation({ summary: 'List invoices across tenants' })
  listInvoices(@Query(new ZodValidationPipe(adminInvoiceQuerySchema)) query: AdminInvoiceQueryDto): Promise<AdminInvoicePage> {
    return this.invoices.listAdmin(query);
  }

  @Get('invoices/:id')
  @ApiOperation({ summary: 'Get any invoice' })
  getInvoice(@Param('id', ParseUUIDPipe) id: string): Promise<Invoice> {
    return this.invoices.getAdmin(id);
  }

  @Post('invoices/:id/mark-paid')
  @HttpCode(200)
  @ApiOperation({ summary: 'Record a payment made outside the system, or a complimentary period' })
  markPaid(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(markPaidSchema)) body: MarkPaidDto): Promise<Invoice> {
    return this.subscriptions.markPaid(id, body);
  }

  @Post('invoices/:id/void')
  @HttpCode(200)
  @ApiOperation({ summary: "Void an open invoice (the charge shouldn't exist)" })
  voidInvoice(@Param('id', ParseUUIDPipe) id: string): Promise<Invoice> {
    return this.subscriptions.voidInvoice(id);
  }

  @Post('run-job')
  @HttpCode(200)
  @ApiOperation({ summary: 'Run the hourly billing job now' })
  runJob(): Promise<BillingJobResult> {
    return this.job.run();
  }
}
