import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

// ─── Prisma Error (structural typing to avoid direct dependency) ────────────

interface PrismaClientError {
  code: string;
  meta?: Record<string, unknown>;
  message: string;
}

function isPrismaError(error: unknown): error is PrismaClientError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as PrismaClientError).code === 'string' &&
    (error as PrismaClientError).code.startsWith('P')
  );
}

// ─── Zod Error (structural typing for v3/v4 compat) ────────────────────────

interface ZodIssue {
  path: (string | number)[];
  message: string;
}

function isZodError(error: unknown): error is { issues: ZodIssue[] } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'issues' in error &&
    Array.isArray((error as { issues: unknown[] }).issues)
  );
}

// ─── Standard Error Response ────────────────────────────────────────────────

interface ErrorResponse {
  statusCode: number;
  message: string;
  errors?: Record<string, string[]>;
  timestamp: string;
}

// ─── Prisma Error Mapping ───────────────────────────────────────────────────

const PRISMA_ERROR_MAP: Record<string, { status: number; message: string }> = {
  P2002: { status: HttpStatus.CONFLICT, message: 'A record with this value already exists' },
  P2003: { status: HttpStatus.BAD_REQUEST, message: 'Related record not found' },
  P2025: { status: HttpStatus.NOT_FOUND, message: 'Record not found' },
  P2014: { status: HttpStatus.BAD_REQUEST, message: 'Required relation violation' },
  P2016: { status: HttpStatus.BAD_REQUEST, message: 'Query interpretation error' },
};

// ─── Filter Implementation ──────────────────────────────────────────────────

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const errorResponse = this.buildErrorResponse(exception);

    if (errorResponse.statusCode >= 500) {
      this.logger.error(
        `${errorResponse.statusCode} ${errorResponse.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`${errorResponse.statusCode} ${errorResponse.message}`);
    }

    response.status(errorResponse.statusCode).json(errorResponse);
  }

  private buildErrorResponse(exception: unknown): ErrorResponse {
    const timestamp = new Date().toISOString();

    // NestJS HTTP Exceptions (BadRequestException, NotFoundException, etc.)
    if (exception instanceof HttpException) {
      return this.handleHttpException(exception, timestamp);
    }

    // Zod Validation Errors
    if (isZodError(exception)) {
      return this.handleZodError(exception, timestamp);
    }

    // Prisma Errors
    if (isPrismaError(exception)) {
      return this.handlePrismaError(exception, timestamp);
    }

    // Unknown errors
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      timestamp,
    };
  }

  private handleHttpException(exception: HttpException, timestamp: string): ErrorResponse {
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    if (typeof exceptionResponse === 'string') {
      return { statusCode: status, message: exceptionResponse, timestamp };
    }

    const responseObj = exceptionResponse as Record<string, unknown>;

    return {
      statusCode: status,
      message: (responseObj.message as string) || exception.message,
      ...(responseObj.errors ? { errors: responseObj.errors as Record<string, string[]> } : {}),
      timestamp,
    };
  }

  private handleZodError(error: { issues: ZodIssue[] }, timestamp: string): ErrorResponse {
    const errors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const path = issue.path.join('.') || '_root';
      if (!errors[path]) {
        errors[path] = [];
      }
      errors[path].push(issue.message);
    }

    return {
      statusCode: HttpStatus.BAD_REQUEST,
      message: 'Validation failed',
      errors,
      timestamp,
    };
  }

  private handlePrismaError(error: PrismaClientError, timestamp: string): ErrorResponse {
    const mapped = PRISMA_ERROR_MAP[error.code];

    if (mapped) {
      const response: ErrorResponse = {
        statusCode: mapped.status,
        message: mapped.message,
        timestamp,
      };

      // For unique constraint violations, include the target fields
      if (error.code === 'P2002' && error.meta?.target) {
        const fields = error.meta.target as string[];
        response.message = `A record with this ${fields.join(', ')} already exists`;
      }

      return response;
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Database error',
      timestamp,
    };
  }
}
