import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
  PluginEnabledGuard,
  PluginKey,
  PrismaService,
  RbacGuard,
  Roles,
  SYSTEM_TENANT_SLUG,
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

/**
 * The sysadmin's edits of platform emails (billing, welcome, workspace notices), kept in
 * the public schema. Sysadmins sign in to the System workspace, so PluginEnabledGuard
 * makes these usable exactly while core uses the edits. No @Permissions: roles and
 * permissions are OR'd, and a permission would let tenant admins in.
 */
@ApiTags('Email Templates')
@ApiBearerAuth()
@Controller('plugins/document-templates/platform-emails')
@PluginKey('document-templates')
@UseGuards(JwtAuthGuard, PluginEnabledGuard, RbacGuard)
@Roles('SYSADMIN')
export class PlatformEmailTemplatesController {
  constructor(
    private readonly templates: EmailTemplatesService,
    @Inject(EMAIL_SERVICE) private readonly email: IEmailService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Platform emails the sysadmin can reword, with the state of each language' })
  async list(@Req() req: AuthenticatedRequest) {
    this.requireSystem(req);
    const edits = await this.templates.listEdits(null);
    return this.email.listPlatformDefinitions().map((def) => ({
      key: def.key,
      name: def.name,
      description: def.description,
      locales: localeStates(this.email, def.key, edits),
    }));
  }

  @Get(':key')
  @ApiOperation({ summary: 'A platform email definition with the edits per language' })
  async get(@Req() req: AuthenticatedRequest, @Param('key') key: string) {
    const def = this.definition(req, key);
    return { ...def, edits: editsByLocale(this.email, key, await this.templates.listEdits(null)) };
  }

  @Put(':key/:locale')
  @ApiOperation({ summary: 'Save the platform edit for one language' })
  async save(
    @Req() req: AuthenticatedRequest,
    @Param('key') key: string,
    @Param('locale') locale: string,
    @Body(new ZodValidationPipe(saveEmailTemplateSchema)) body: SaveEmailTemplateDto,
  ) {
    this.definition(req, key);
    return this.templates.save(null, key, parseLocale(locale), body, req.user?.userId);
  }

  @Delete(':key/:locale')
  @ApiOperation({ summary: 'Reset one language of a platform email to the default' })
  async reset(@Req() req: AuthenticatedRequest, @Param('key') key: string, @Param('locale') locale: string) {
    this.definition(req, key);
    await this.templates.reset(null, key, parseLocale(locale));
    return { message: 'Email reset to the default' };
  }

  @Post(':key/:locale/preview')
  @ApiOperation({ summary: 'Render a draft (or the default) with sample data in the platform layout' })
  async preview(
    @Req() req: AuthenticatedRequest,
    @Param('key') key: string,
    @Param('locale') locale: string,
    @Body(new ZodValidationPipe(draftEmailTemplateSchema)) body: DraftEmailTemplateDto,
  ) {
    this.definition(req, key);
    return this.email.preview(null, key, parseLocale(locale), cleanDraft(body));
  }

  @Post(':key/:locale/test')
  @ApiOperation({ summary: 'Send a draft (or the current template) with sample data to yourself' })
  async sendTest(
    @Req() req: AuthenticatedRequest,
    @Param('key') key: string,
    @Param('locale') locale: string,
    @Body(new ZodValidationPipe(draftEmailTemplateSchema)) body: DraftEmailTemplateDto,
  ) {
    this.definition(req, key);
    const user = await this.prisma.getTenantClient(SYSTEM_TENANT_SLUG).user.findUnique({ where: { id: req.user?.userId }, select: { email: true } });
    if (!user?.email) throw new BadRequestException('Your account has no email address');
    return this.email.sendTest(null, key, parseLocale(locale), user.email, cleanDraft(body));
  }

  private definition(req: AuthenticatedRequest, key: string): EmailDefinitionSummary {
    this.requireSystem(req);
    const def = this.email.listPlatformDefinitions().find((d) => d.key === key);
    if (!def) throw new NotFoundException('Email not found');
    return def;
  }

  private requireSystem(req: AuthenticatedRequest): void {
    if (req.tenant?.slug !== SYSTEM_TENANT_SLUG) throw new ForbiddenException('Platform emails are managed from the System workspace');
  }
}
