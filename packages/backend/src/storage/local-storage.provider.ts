import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import type { IStorageProvider, StorageOptions } from './storage.interface';

export class LocalStorageProvider implements IStorageProvider {
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly uploadDir: string;
  private readonly serveRoot: string;

  constructor(options: StorageOptions) {
    this.uploadDir = options.uploadDir || 'uploads';
    this.serveRoot = options.serveRoot || '/uploads';
  }

  async upload(key: string, buffer: Buffer, _contentType: string): Promise<string> {
    const filePath = path.join(this.uploadDir, key);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, buffer);
    return key;
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(this.uploadDir, key);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      this.logger.warn(`Failed to delete file: ${filePath}`, error);
    }
  }

  getUrl(key: string): string {
    return `${this.serveRoot}/${key}`;
  }

  async getSignedUrl(key: string, _expiresInSeconds: number): Promise<string> {
    // Local storage doesn't support signed URLs — return the public URL
    return this.getUrl(key);
  }

  async exists(key: string): Promise<boolean> {
    const filePath = path.join(this.uploadDir, key);
    return fs.existsSync(filePath);
  }
}
