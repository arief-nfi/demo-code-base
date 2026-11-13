import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, RbacGuard, Roles, ZodValidationPipe } from '@saas/backend';
import { AppsCatalogService, type AppQuote, type AppView } from './apps-catalog.service';
import {
  appCreateSchema,
  appQuoteSchema,
  appUpdateSchema,
  type AppCreateDto,
  type AppQuoteDto,
  type AppUpdateDto,
} from './apps.schemas';

/** Sysadmin: the app catalog — bundles of plugins sold at their own price. */
@ApiTags('Apps (sysadmin)')
@ApiBearerAuth()
@Controller('apps')
@UseGuards(JwtAuthGuard, RbacGuard)
@Roles('SYSADMIN')
export class AppsController {
  constructor(private readonly catalog: AppsCatalogService) {}

  @Get()
  @ApiOperation({ summary: 'List apps with their plugins and live subscribers' })
  list(): Promise<AppView[]> {
    return this.catalog.list();
  }

  // Static routes before `:key`
  @Get('plugin-options')
  @ApiOperation({ summary: 'Plugins an app can include, with prices and dependencies' })
  pluginOptions() {
    return this.catalog.pluginOptions();
  }

  @Post('quote')
  @HttpCode(200)
  @ApiOperation({ summary: 'Missing dependencies and the saving for a set of plugins and a price' })
  quote(@Body(new ZodValidationPipe(appQuoteSchema)) body: AppQuoteDto): Promise<AppQuote> {
    return this.catalog.quote(body);
  }

  @Get(':key')
  @ApiOperation({ summary: 'One app' })
  get(@Param('key') key: string): Promise<AppView> {
    return this.catalog.get(key);
  }

  @Post()
  @ApiOperation({ summary: 'Create an app' })
  create(@Body(new ZodValidationPipe(appCreateSchema)) body: AppCreateDto): Promise<AppView> {
    return this.catalog.create(body);
  }

  @Put(':key')
  @ApiOperation({ summary: 'Change an app: plugins added reach subscribers now, removed ones at their next renewal' })
  update(@Param('key') key: string, @Body(new ZodValidationPipe(appUpdateSchema)) body: AppUpdateDto): Promise<AppView> {
    return this.catalog.update(key, body);
  }

  @Delete(':key')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an app no tenant holds any more' })
  remove(@Param('key') key: string): Promise<void> {
    return this.catalog.remove(key);
  }
}
