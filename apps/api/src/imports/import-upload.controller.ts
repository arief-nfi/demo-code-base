import {
  Controller,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard, RbacGuard, ImportService } from '@saas/backend';

/**
 * Handles file upload + parsing for imports.
 * This controller lives in apps/api (not packages/backend) because
 * it depends on @nestjs/platform-express for Multer file handling.
 */
@Controller('imports')
@UseGuards(JwtAuthGuard, RbacGuard)
export class ImportUploadController {
  constructor(private readonly importService: ImportService) {}

  /**
   * Upload and parse a file for a specific import type.
   * Returns parsed rows that the frontend can preview and then submit to POST /imports/execute.
   */
  @Post('parse')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async parseFile(
    @UploadedFile() file: Express.Multer.File,
    @Query('importKey') importKey: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!importKey) throw new BadRequestException('importKey query parameter is required');
    return this.importService.parseFile(file, importKey);
  }
}
