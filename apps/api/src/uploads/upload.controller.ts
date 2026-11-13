import {
  Controller, Post, Get, Delete, Param, Body, Req,
  UseGuards, UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '@saas/backend';
import type { AuthenticatedRequest } from '@saas/backend';
import { UploadService } from './upload.service';

const imageFileFilter = (_req: unknown, file: Express.Multer.File, cb: (error: Error | null, acceptFile: boolean) => void) => {
  const allowed = /\.(jpg|jpeg|png|svg|webp|gif|pdf|csv|xlsx|docx)$/i;
  if (allowed.test(file.originalname)) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed'), false);
  }
};

@ApiTags('Uploads')
@ApiBearerAuth()
@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post()
  @ApiOperation({ summary: 'Upload a file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        category: { type: 'string' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: imageFileFilter,
  }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('category') category: string,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!file) {
      return { error: 'No file provided' };
    }

    const tenantSlug = req.tenant?.slug;
    if (!tenantSlug) {
      return { error: 'Tenant context required' };
    }

    return this.uploadService.upload({
      file,
      category: category || 'attachment',
      tenantSlug,
      uploadedBy: (req.user as any)?.userId,
    });
  }

  @Get(':id/signed-url')
  @ApiOperation({ summary: 'Get a signed URL for a file' })
  async getSignedUrl(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const tenantSlug = req.tenant?.slug;
    if (!tenantSlug) {
      return { error: 'Tenant context required' };
    }
    return this.uploadService.getSignedUrl(id, tenantSlug);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a file' })
  async deleteFile(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const tenantSlug = req.tenant?.slug;
    if (!tenantSlug) {
      return { error: 'Tenant context required' };
    }
    await this.uploadService.deleteFile(id, tenantSlug);
    return { message: 'File deleted' };
  }
}
