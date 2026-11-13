import { Injectable, Inject, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService, STORAGE_PROVIDER } from '@saas/backend';
import type { IStorageProvider } from '@saas/backend';
import { ImageProcessorService } from './image-processor.service';
import * as crypto from 'crypto';
import * as path from 'path';

const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
  'application/pdf', 'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    @Inject(STORAGE_PROVIDER) private storage: IStorageProvider,
    private prisma: PrismaService,
    private imageProcessor: ImageProcessorService,
  ) {}

  async upload(params: {
    file: Express.Multer.File;
    category: string;
    tenantSlug: string;
    uploadedBy?: string;
  }) {
    const { file, category, tenantSlug, uploadedBy } = params;

    if (!ALLOWED_MIMES.has(file.mimetype)) {
      throw new BadRequestException(`File type '${file.mimetype}' is not allowed`);
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(`File size exceeds the ${MAX_FILE_SIZE / (1024 * 1024)}MB limit`);
    }

    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    const uuid = crypto.randomUUID();
    const storageKey = `tenant_${tenantSlug}/${category}/${uuid}${ext}`;

    let buffer = file.buffer;
    const metadata: Record<string, unknown> = {};

    // Image processing (skip if file is too small or processing fails)
    if (this.imageProcessor.isImage(file.mimetype) && buffer.length > 100) {
      try {
        const result = await this.imageProcessor.process(buffer, category, file.mimetype);
        buffer = result.resized;
        metadata.width = result.metadata.width;
        metadata.height = result.metadata.height;

        // Store original if it was resized
        if (result.resized !== file.buffer) {
          const originalKey = `tenant_${tenantSlug}/${category}/originals/${uuid}${ext}`;
          await this.storage.upload(originalKey, file.buffer, file.mimetype);
          metadata.originalKey = originalKey;
        }

        // Store thumbnail
        if (result.thumbnail) {
          const thumbKey = `tenant_${tenantSlug}/${category}/thumbnails/${uuid}${ext}`;
          await this.storage.upload(thumbKey, result.thumbnail, file.mimetype);
          metadata.thumbnailKey = thumbKey;
        }
      } catch (e) {
        this.logger.warn(`Image processing failed for ${file.originalname}, storing as-is`, e);
        // Store original without processing
      }
    }

    // Store the (possibly resized) file
    await this.storage.upload(storageKey, buffer, file.mimetype);

    // Track in DB
    const tenantClient = this.prisma.getTenantClient(tenantSlug);
    const fileRecord = await tenantClient.file.create({
      data: {
        filename: file.originalname,
        storageKey,
        mimeType: file.mimetype,
        size: buffer.length,
        category,
        uploadedBy,
        metadata: Object.keys(metadata).length > 0 ? metadata as any : undefined,
      },
    });

    return {
      ...fileRecord,
      url: this.storage.getUrl(storageKey),
    };
  }

  async deleteFile(fileId: string, tenantSlug: string) {
    const tenantClient = this.prisma.getTenantClient(tenantSlug);
    const file = await tenantClient.file.findUnique({ where: { id: fileId } });

    if (!file) {
      throw new NotFoundException(`File ${fileId} not found`);
    }

    // Delete from storage
    await this.storage.delete(file.storageKey);

    // Delete original and thumbnail if they exist
    const meta = file.metadata as Record<string, unknown> | null;
    if (meta?.originalKey) {
      await this.storage.delete(meta.originalKey as string);
    }
    if (meta?.thumbnailKey) {
      await this.storage.delete(meta.thumbnailKey as string);
    }

    // Delete DB record
    await tenantClient.file.delete({ where: { id: fileId } });
  }

  async deleteByStorageKey(storageKey: string, tenantSlug: string) {
    const tenantClient = this.prisma.getTenantClient(tenantSlug);
    const file = await tenantClient.file.findUnique({ where: { storageKey } });

    if (file) {
      await this.deleteFile(file.id, tenantSlug);
    } else {
      // No DB record, just try to delete from storage
      await this.storage.delete(storageKey);
    }
  }

  async getSignedUrl(fileId: string, tenantSlug: string, expiresIn = 3600) {
    const tenantClient = this.prisma.getTenantClient(tenantSlug);
    const file = await tenantClient.file.findUnique({ where: { id: fileId } });

    if (!file) {
      throw new NotFoundException(`File ${fileId} not found`);
    }

    const url = await this.storage.getSignedUrl(file.storageKey, expiresIn);
    return { url, expiresIn };
  }

  getPublicUrl(storageKey: string): string {
    return this.storage.getUrl(storageKey);
  }
}
