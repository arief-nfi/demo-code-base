import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';

const ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.svg', '.webp', '.gif'];
const ALLOWED_IMAGE_MIMES = [
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
  'image/gif',
];

const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_ASSET_SIZE = 5 * 1024 * 1024;  // 5MB

function imageFileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
) {
  const ext = extname(file.originalname).toLowerCase();
  if (!ALLOWED_IMAGE_EXTENSIONS.includes(ext)) {
    return cb(new BadRequestException(`File type '${ext}' is not allowed. Allowed: ${ALLOWED_IMAGE_EXTENSIONS.join(', ')}`), false);
  }
  if (!ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
    return cb(new BadRequestException(`MIME type '${file.mimetype}' is not allowed`), false);
  }
  cb(null, true);
}

function secureFilename(_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) {
  const ext = extname(file.originalname).toLowerCase();
  cb(null, `${randomUUID()}${ext}`);
}

interface UploadConfigOptions {
  /** Subpath within the tenant's upload directory (e.g., 'avatar', 'config') */
  subpath: string;
  /** Max file size in bytes */
  maxSize: number;
  /** Function to extract tenant slug from the request */
  getSlug: (req: Request) => string | undefined;
}

export function createUploadConfig(options: UploadConfigOptions) {
  return {
    storage: diskStorage({
      destination: (req: Request, _file: Express.Multer.File, cb) => {
        const slug = options.getSlug(req);
        if (!slug) {
          return cb(new Error('Tenant slug is required for upload'), '');
        }
        const uploadPath = `./uploads/tenant_${slug}/${options.subpath}`;
        if (!existsSync(uploadPath)) {
          mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
      },
      filename: secureFilename,
    }),
    fileFilter: imageFileFilter,
    limits: { fileSize: options.maxSize },
  };
}

export const avatarUploadConfig = createUploadConfig({
  subpath: 'avatar',
  maxSize: MAX_AVATAR_SIZE,
  getSlug: (req) => (req as unknown as { user?: { tenantSlug?: string } }).user?.tenantSlug,
});

export const tenantAssetUploadConfig = createUploadConfig({
  subpath: 'config',
  maxSize: MAX_ASSET_SIZE,
  getSlug: (req) => (req.query.slug as string) || (req as unknown as { tenant?: { slug?: string } }).tenant?.slug,
});
