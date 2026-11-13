import { Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { IStorageProvider, StorageOptions } from './storage.interface';

export class S3StorageProvider implements IStorageProvider {
  private readonly logger = new Logger(S3StorageProvider.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly endpoint: string | undefined;
  private readonly region: string;
  private readonly forcePathStyle: boolean;

  constructor(options: StorageOptions) {
    this.bucket = options.s3Bucket || '';
    this.region = options.s3Region || 'us-east-1';
    this.endpoint = options.s3Endpoint;
    this.forcePathStyle = options.s3ForcePathStyle ?? false;

    this.client = new S3Client({
      region: this.region,
      endpoint: this.endpoint || undefined,
      forcePathStyle: this.forcePathStyle,
      credentials: options.s3AccessKeyId
        ? {
            accessKeyId: options.s3AccessKeyId,
            secretAccessKey: options.s3SecretAccessKey || '',
          }
        : undefined,
    });

    this.logger.log(`S3 storage initialized: bucket=${this.bucket}, region=${this.region}, endpoint=${this.endpoint || 'default'}`);
  }

  async upload(key: string, buffer: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
    return key;
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch (error) {
      this.logger.warn(`Failed to delete S3 object: ${key}`, error);
    }
  }

  getUrl(key: string): string {
    if (this.endpoint && this.forcePathStyle) {
      // MinIO path-style: http://localhost:9000/bucket/key
      return `${this.endpoint}/${this.bucket}/${key}`;
    }
    // AWS S3: https://bucket.s3.region.amazonaws.com/key
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
}
