import { PipeTransform, Injectable, ArgumentMetadata } from '@nestjs/common';

/**
 * Global pipe that normalizes string inputs in request bodies by trimming
 * leading/trailing whitespace (recursively through objects and arrays).
 *
 * It deliberately does NOT HTML-encode: data is stored as submitted, and
 * escaping happens at output time (React escapes text, Handlebars `{{ }}`
 * escapes, HTML emails escape interpolated values). Encoding on input
 * corrupted data such as "R&D" -> "R&amp;D" and template markup.
 *
 * Applied globally to all incoming request bodies.
 */
@Injectable()
export class SanitizePipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    // Only sanitize body parameters (not query/param which are already strings)
    if (metadata.type !== 'body') {
      return value;
    }

    return this.sanitize(value);
  }

  private sanitize(value: unknown): unknown {
    if (typeof value === 'string') {
      return this.sanitizeString(value);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitize(item));
    }

    if (value !== null && typeof value === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        sanitized[key] = this.sanitize(val);
      }
      return sanitized;
    }

    return value;
  }

  private sanitizeString(str: string): string {
    return str.trim();
  }
}
