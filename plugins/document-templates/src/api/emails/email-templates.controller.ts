import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  EMAIL_SERVICE,
  JwtAuthGuard,
  Permissions,
  PluginEnabledGuard,
  PluginKey,
  PrismaService,
  RbacGuard,
  Roles,
  ZodValidationPipe,
  type EmailDefinitionSummary,
  type IEmailService,
} from '@saas/backend';
import type { AuthenticatedRequest } from '@saas/backend';
import { EmailTemplatesService } from './email-templates.service';
import { cleanDraft, editsByLocale, localeStates, parseLocale } from './edit-states';
import {
  draftEmailTemplateSchema,
  saveEmailTemplateSchema,
  type DraftEmailTemplateDto,
  type SaveEmailTemplateDto,
} from './dto/save-email-template.dto';

@ApiTags('Email Templates')
@ApiBearerAuth()
@Controller('plugins/document-templates/emails')
@PluginKey('document-templates')
@UseGuards(JwtAuthGuard, PluginEnabledGuard, RbacGuard)
@Roles('ADMIN')
export class EmailTemplatesController {
  constructor(
    private readonly templates: EmailTemplatesService,
    @Inject(EMAIL_SERVICE) private readonly email: IEmailService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Permissions('document-templates.email-template.read')
  @ApiOperation({ summary: 'Emails the tenant can reword, with the state of each language' })
  async list(@Req() req: AuthenticatedRequest) {
    const tenantSlug = this.tenantSlug(req);
    const [definitions, edits] = await Promise.all([this.email.listTenantDefinitions(tenantSlug), this.templates.listEdits(tenantSlug)]);

    return definitions.map((def) => ({
      key: def.key,
      source: def.source,
      name: def.name,
      description: def.description,
      locales: localeStates(this.email, def.key, edits),
    }));
  }

  @Get(':key')
  @Permissions('document-templates.email-template.read')
  @ApiOperation({ summary: 'An email definition with the tenant edits per language' })
  async get(@Req() req: AuthenticatedRequest, @Param('key') key: string) {
    const tenantSlug = this.tenantSlug(req);
    const def = await this.definition(tenantSlug, key);
    return { ...def, edits: editsByLocale(this.email, key, await this.templates.listEdits(tenantSlug)) };
  }

  @Put(':key/:locale')
  @Permissions('document-templates.email-template.update')
  @ApiOperation({ summary: 'Save the tenant edit for one language' })
  async save(
    @Req() req: AuthenticatedRequest,
    @Param('key') key: string,
    @Param('locale') locale: string,
    @Body(new ZodValidationPipe(saveEmailTemplateSchema)) body: SaveEmailTemplateDto,
  ) {
    const tenantSlug = this.tenantSlug(req);
    await this.definition(tenantSlug, key);
    return this.templates.save(tenantSlug, key, parseLocale(locale), body, req.user?.userId);
  }

  @Delete(':key/:locale')
  @Permissions('document-templates.email-template.update')
  @ApiOperation({ summary: 'Reset one language to the default' })
  async reset(@Req() req: AuthenticatedRequest, @Param('key') key: string, @Param('locale') locale: string) {
    const tenantSlug = this.tenantSlug(req);
    await this.definition(tenantSlug, key);
    await this.templates.reset(tenantSlug, key, parseLocale(locale));
    return { message: 'Email reset to the default' };
  }

  @Post(':key/:locale/preview')
  @Permissions('document-templates.email-template.read')
  @ApiOperation({ summary: 'Render a draft (or the default) with sample data in the tenant layout' })
  async preview(
    @Req() req: AuthenticatedRequest,
    @Param('key') key: string,
    @Param('locale') locale: string,
    @Body(new ZodValidationPipe(draftEmailTemplateSchema)) body: DraftEmailTemplateDto,
  ) {
    const tenantSlug = this.tenantSlug(req);
    await this.definition(tenantSlug, key);
    return this.email.preview(tenantSlug, key, parseLocale(locale), cleanDraft(body));
  }

  @Post(':key/:locale/test')
  @Permissions('document-templates.email-template.update')
  @ApiOperation({ summary: 'Send a draft (or the current template) with sample data to yourself' })
  async sendTest(
    @Req() req: AuthenticatedRequest,
    @Param('key') key: string,
    @Param('locale') locale: string,
    @Body(new ZodValidationPipe(draftEmailTemplateSchema)) body: DraftEmailTemplateDto,
  ) {
    const tenantSlug = this.tenantSlug(req);
    await this.definition(tenantSlug, key);
    const user = await this.prisma.getTenantClient(tenantSlug).user.findUnique({ where: { id: req.user?.userId }, select: { email: true } });
    if (!user?.email) throw new BadRequestException('Your account has no email address');
    return this.email.sendTest(tenantSlug, key, parseLocale(locale), user.email, cleanDraft(body));
  }

  /** Only emails the tenant can edit: core tenant emails and those of plugins enabled for it */
  private async definition(tenantSlug: string, key: string): Promise<EmailDefinitionSummary> {
    const def = (await this.email.listTenantDefinitions(tenantSlug)).find((d) => d.key === key);
    if (!def) throw new NotFoundException('Email not found');
    return def;
  }

  private tenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) throw new BadRequestException('Tenant context is required');
    return req.tenant.slug;
  }
}
