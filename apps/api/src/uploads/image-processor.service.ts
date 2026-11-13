import { Injectable, Logger } from '@nestjs/common';
import * as sharp from 'sharp';

interface ProcessResult {
  resized: Buffer;
  thumbnail?: Buffer;
  metadata: { width: number; height: number };
}

const RESIZE_RULES: Record<string, { width: number; height?: number; fit: keyof sharp.FitEnum }> = {
  avatar: { width: 150, height: 150, fit: 'cover' },
  logo: { width: 400, fit: 'inside' },
  icon: { width: 64, height: 64, fit: 'cover' },
};

const IMAGE_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
]);

@Injectable()
export class ImageProcessorService {
  private readonly logger = new Logger(ImageProcessorService.name);

  isImage(mimeType: string): boolean {
    return IMAGE_MIMES.has(mimeType);
  }

  async process(buffer: Buffer, category: string, mimeType: string): Promise<ProcessResult> {
    // SVGs don't need resizing
    if (mimeType === 'image/svg+xml') {
      return { resized: buffer, metadata: { width: 0, height: 0 } };
    }

    const rule = RESIZE_RULES[category];
    const image = sharp(buffer);
    const meta = await image.metadata();

    let resized: Buffer;
    if (rule) {
      resized = await sharp(buffer)
        .resize(rule.width, rule.height, { fit: rule.fit, withoutEnlargement: true })
        .toBuffer();
    } else {
      resized = buffer; // no resize for unknown categories
    }

    // Generate thumbnail for non-avatar/icon categories
    let thumbnail: Buffer | undefined;
    if (!['avatar', 'icon'].includes(category)) {
      thumbnail = await sharp(buffer)
        .resize(200, undefined, { fit: 'inside', withoutEnlargement: true })
        .toBuffer();
    }

    const resizedMeta = await sharp(resized).metadata();

    return {
      resized,
      thumbnail,
      metadata: {
        width: resizedMeta.width || meta.width || 0,
        height: resizedMeta.height || meta.height || 0,
      },
    };
  }
}
