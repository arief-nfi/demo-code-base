import { NotFoundException } from '@nestjs/common';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { safeHttpRequest, UnsafeOutboundUrlError } from '@saas/backend';
import { WebhookDeliveryService } from './webhook-delivery.service';

jest.mock('@saas/backend', () => ({
  ...jest.requireActual('@saas/backend'),
  safeHttpRequest: jest.fn(),
}));

const mockSafeHttpRequest = safeHttpRequest as jest.MockedFunction<typeof safeHttpRequest>;
const realSafeHttpRequest: typeof safeHttpRequest = jest.requireActual('@saas/backend').safeHttpRequest;

const httpResponse = (status: number, statusText: string, body = '') => ({
  ok: status >= 200 && status < 300,
  status,
  statusText,
  headers: {},
  body,
  truncated: false,
});

describe('WebhookDeliveryService', () => {
  let service: WebhookDeliveryService;

  const mockTenantClient = {
    integrationWebhookDelivery: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockPrisma = {
    getTenantClient: jest.fn().mockReturnValue(mockTenantClient),
  };

  const tenantSlug = 'acme';

  const sampleWebhook = {
    id: 'wh-1',
    url: 'https://example.com/webhook',
    secret: 'test-secret-key',
    headers: null,
    retryPolicy: { maxAttempts: 3, backoffMs: 1000, backoffMultiplier: 2 },
  };

  const sampleDelivery = {
    id: 'del-1',
    webhookId: 'wh-1',
    eventCode: 'order.created',
    payload: { orderId: '123' },
    status: 'PENDING',
    attempt: 1,
    maxAttempts: 3,
    createdAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockSafeHttpRequest.mockReset();
    delete process.env.ALLOW_PRIVATE_WEBHOOK_URLS;
    service = new WebhookDeliveryService(mockPrisma as any);
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.ALLOW_PRIVATE_WEBHOOK_URLS;
  });

  // ─── deliverWebhook ───────────────────────────────────

  describe('deliverWebhook', () => {
    it('should create delivery record and update to SUCCESS on successful fetch', async () => {
      mockTenantClient.integrationWebhookDelivery.create.mockResolvedValue(sampleDelivery);
      const successDelivery = { ...sampleDelivery, status: 'SUCCESS', httpStatus: 200 };
      mockTenantClient.integrationWebhookDelivery.update.mockResolvedValue(successDelivery);

      mockSafeHttpRequest.mockResolvedValue(httpResponse(200, 'OK', 'OK'));

      const result = await service.deliverWebhook(
        sampleWebhook,
        'order.created',
        { orderId: '123' },
        tenantSlug,
      );

      expect(mockTenantClient.integrationWebhookDelivery.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          webhookId: 'wh-1',
          eventCode: 'order.created',
          status: 'PENDING',
          attempt: 1,
          maxAttempts: 3,
        }),
      });
      expect(mockTenantClient.integrationWebhookDelivery.update).toHaveBeenCalledWith({
        where: { id: 'del-1' },
        data: expect.objectContaining({
          status: 'SUCCESS',
          httpStatus: 200,
        }),
      });
      expect(result).toEqual(successDelivery);
    });

    it('should set status to RETRYING when fetch returns non-ok and attempt < maxAttempts', async () => {
      mockTenantClient.integrationWebhookDelivery.create.mockResolvedValue(sampleDelivery);
      const retryingDelivery = { ...sampleDelivery, status: 'RETRYING', httpStatus: 500 };
      mockTenantClient.integrationWebhookDelivery.update.mockResolvedValue(retryingDelivery);

      mockSafeHttpRequest.mockResolvedValue(httpResponse(500, 'Internal Server Error', 'Server Error'));

      const result = await service.deliverWebhook(
        sampleWebhook,
        'order.created',
        { orderId: '123' },
        tenantSlug,
      );

      expect(mockTenantClient.integrationWebhookDelivery.update).toHaveBeenCalledWith({
        where: { id: 'del-1' },
        data: expect.objectContaining({
          status: 'RETRYING',
          httpStatus: 500,
          error: 'HTTP 500: Internal Server Error',
        }),
      });
      expect(result).toEqual(retryingDelivery);
    });

    it('should set status to FAILED when max retries exceeded', async () => {
      const maxedWebhook = {
        ...sampleWebhook,
        retryPolicy: { maxAttempts: 1, backoffMs: 1000, backoffMultiplier: 2 },
      };
      const maxedDelivery = { ...sampleDelivery, maxAttempts: 1 };
      mockTenantClient.integrationWebhookDelivery.create.mockResolvedValue(maxedDelivery);
      const failedDelivery = { ...maxedDelivery, status: 'FAILED', httpStatus: 500 };
      mockTenantClient.integrationWebhookDelivery.update.mockResolvedValue(failedDelivery);

      mockSafeHttpRequest.mockResolvedValue(httpResponse(500, 'Internal Server Error', 'Server Error'));

      const result = await service.deliverWebhook(
        maxedWebhook,
        'order.created',
        { orderId: '123' },
        tenantSlug,
      );

      expect(mockTenantClient.integrationWebhookDelivery.update).toHaveBeenCalledWith({
        where: { id: 'del-1' },
        data: expect.objectContaining({
          status: 'FAILED',
          completedAt: expect.any(Date),
        }),
      });
      expect(result).toEqual(failedDelivery);
    });

    it('should handle fetch throwing a network error', async () => {
      mockTenantClient.integrationWebhookDelivery.create.mockResolvedValue(sampleDelivery);
      const retryingDelivery = { ...sampleDelivery, status: 'RETRYING' };
      mockTenantClient.integrationWebhookDelivery.update.mockResolvedValue(retryingDelivery);

      mockSafeHttpRequest.mockRejectedValue(new Error('Network timeout'));

      const result = await service.deliverWebhook(
        sampleWebhook,
        'order.created',
        { orderId: '123' },
        tenantSlug,
      );

      expect(mockTenantClient.integrationWebhookDelivery.update).toHaveBeenCalledWith({
        where: { id: 'del-1' },
        data: expect.objectContaining({
          error: 'Network timeout',
          httpStatus: null,
          responseBody: null,
        }),
      });
      expect(result).toEqual(retryingDelivery);
    });

    it('should generate correct HMAC signature in fetch headers', async () => {
      mockTenantClient.integrationWebhookDelivery.create.mockResolvedValue(sampleDelivery);
      mockTenantClient.integrationWebhookDelivery.update.mockResolvedValue(sampleDelivery);

      mockSafeHttpRequest.mockResolvedValue(httpResponse(200, 'OK', 'OK'));

      await service.deliverWebhook(
        sampleWebhook,
        'order.created',
        { orderId: '123' },
        tenantSlug,
      );

      expect(mockSafeHttpRequest).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ orderId: '123' }),
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Webhook-Event': 'order.created',
            'X-Webhook-Delivery-Id': 'del-1',
            'X-Webhook-Signature': expect.stringMatching(/^sha256=[a-f0-9]{64}$/),
            'X-Webhook-Timestamp': expect.any(String),
          }),
        }),
      );
    });
  });

  // ─── SSRF protection ──────────────────────────────────

  describe('SSRF protection', () => {
    beforeEach(() => {
      mockTenantClient.integrationWebhookDelivery.create.mockResolvedValue(sampleDelivery);
      mockTenantClient.integrationWebhookDelivery.update.mockImplementation(async ({ data }) => ({ ...sampleDelivery, ...data }));
    });

    it('never contacts an internal service: records FAILED without retrying', async () => {
      mockSafeHttpRequest.mockImplementation(realSafeHttpRequest);
      const hits: string[] = [];
      const internal = http.createServer((req, res) => {
        hits.push(req.url ?? '');
        res.end('internal-only secret');
      });
      await new Promise<void>((resolve) => internal.listen(0, '127.0.0.1', resolve));
      const { port } = internal.address() as AddressInfo;

      try {
        const result = await service.deliverWebhook(
          { ...sampleWebhook, url: `http://127.0.0.1:${port}/` },
          'order.created',
          { orderId: '123' },
          tenantSlug,
        );

        expect(hits).toEqual([]);
        expect(result).toEqual(
          expect.objectContaining({
            status: 'FAILED',
            httpStatus: null,
            responseBody: null,
            error: expect.stringMatching(/^Blocked by SSRF protection: .*private or reserved/),
            completedAt: expect.any(Date),
          }),
        );
        expect(jest.getTimerCount()).toBe(0); // no retry scheduled
      } finally {
        await new Promise((resolve) => internal.close(resolve));
      }
    });

    it('re-validates at delivery time (DNS may have changed since config) and fails permanently', async () => {
      mockSafeHttpRequest.mockRejectedValue(
        new UnsafeOutboundUrlError('Host hooks.example.com resolves to private or reserved address 10.0.0.7'),
      );

      const result = await service.deliverWebhook(sampleWebhook, 'order.created', { orderId: '123' }, tenantSlug);

      expect(result).toEqual(
        expect.objectContaining({
          status: 'FAILED',
          error: 'Blocked by SSRF protection: Host hooks.example.com resolves to private or reserved address 10.0.0.7',
        }),
      );
      expect(mockTenantClient.integrationWebhookDelivery.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'RETRYING' }) }),
      );
      expect(jest.getTimerCount()).toBe(0);
    });

    it('matches policy errors by code, so a second copy of @saas/backend (src vs dist) is still treated as permanent', async () => {
      const foreignCopyError = Object.assign(new Error('Host hooks.example.com resolves to private or reserved address 10.0.0.7'), {
        name: 'UnsafeOutboundUrlError',
        code: 'ERR_UNSAFE_OUTBOUND_URL',
      });
      expect(foreignCopyError).not.toBeInstanceOf(UnsafeOutboundUrlError);
      mockSafeHttpRequest.mockRejectedValue(foreignCopyError);

      const result = await service.deliverWebhook(sampleWebhook, 'order.created', { orderId: '123' }, tenantSlug);

      expect(result).toEqual(
        expect.objectContaining({
          status: 'FAILED',
          error: 'Blocked by SSRF protection: Host hooks.example.com resolves to private or reserved address 10.0.0.7',
        }),
      );
      expect(jest.getTimerCount()).toBe(0);
    });

    it('does not follow redirects and records the 3xx status', async () => {
      mockSafeHttpRequest.mockResolvedValue(httpResponse(302, 'Found'));

      await service.deliverWebhook(sampleWebhook, 'order.created', { orderId: '123' }, tenantSlug);

      expect(mockSafeHttpRequest).toHaveBeenCalledTimes(1);
      expect(mockTenantClient.integrationWebhookDelivery.update).toHaveBeenCalledWith({
        where: { id: 'del-1' },
        data: expect.objectContaining({
          httpStatus: 302,
          error: 'HTTP 302: Found (redirects are not followed)',
        }),
      });
    });

    it('sends through the SSRF-safe client with private targets disallowed by default', async () => {
      mockSafeHttpRequest.mockResolvedValue(httpResponse(200, 'OK'));

      await service.deliverWebhook(sampleWebhook, 'order.created', { orderId: '123' }, tenantSlug);

      expect(mockSafeHttpRequest).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({ allowPrivate: false, timeoutMs: 10000 }),
      );
    });

    it('honours ALLOW_PRIVATE_WEBHOOK_URLS=true for local development', async () => {
      process.env.ALLOW_PRIVATE_WEBHOOK_URLS = 'true';
      mockSafeHttpRequest.mockResolvedValue(httpResponse(200, 'OK'));

      await service.deliverWebhook(sampleWebhook, 'order.created', { orderId: '123' }, tenantSlug);

      expect(mockSafeHttpRequest).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({ allowPrivate: true }),
      );
    });
  });

  // ─── findDeliveries ───────────────────────────────────

  describe('findDeliveries', () => {
    it('should return paginated delivery data', async () => {
      const deliveries = [sampleDelivery];
      mockTenantClient.integrationWebhookDelivery.findMany.mockResolvedValue(deliveries);
      mockTenantClient.integrationWebhookDelivery.count.mockResolvedValue(1);

      const result = await service.findDeliveries('wh-1', tenantSlug, { page: 1, limit: 10 });

      expect(result.data).toEqual(deliveries);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
      expect(mockTenantClient.integrationWebhookDelivery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { webhookId: 'wh-1' },
        }),
      );
    });

    it('should apply status filter when provided', async () => {
      mockTenantClient.integrationWebhookDelivery.findMany.mockResolvedValue([]);
      mockTenantClient.integrationWebhookDelivery.count.mockResolvedValue(0);

      await service.findDeliveries('wh-1', tenantSlug, { page: 1, limit: 10, status: 'FAILED' });

      expect(mockTenantClient.integrationWebhookDelivery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { webhookId: 'wh-1', status: 'FAILED' },
        }),
      );
    });
  });

  // ─── retryDelivery ────────────────────────────────────

  describe('retryDelivery', () => {
    it('should retry delivery and call executeDelivery', async () => {
      const deliveryWithWebhook = {
        ...sampleDelivery,
        attempt: 1,
        webhook: {
          id: 'wh-1',
          url: 'https://example.com/webhook',
          secret: 'test-secret-key',
          headers: null,
          retryPolicy: { maxAttempts: 3, backoffMs: 1000, backoffMultiplier: 2 },
        },
      };
      mockTenantClient.integrationWebhookDelivery.findFirst.mockResolvedValue(deliveryWithWebhook);
      mockTenantClient.integrationWebhookDelivery.update.mockResolvedValue({
        ...sampleDelivery,
        status: 'SUCCESS',
        attempt: 2,
      });

      mockSafeHttpRequest.mockResolvedValue(httpResponse(200, 'OK', 'OK'));

      const result = await service.retryDelivery('wh-1', 'del-1', tenantSlug);

      expect(mockTenantClient.integrationWebhookDelivery.findFirst).toHaveBeenCalledWith({
        where: { id: 'del-1', webhookId: 'wh-1' },
        include: { webhook: true },
      });
      expect(mockTenantClient.integrationWebhookDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'del-1' },
          data: expect.objectContaining({ status: 'RETRYING', attempt: 2 }),
        }),
      );
      expect(result).toHaveProperty('status', 'SUCCESS');
    });

    it('should throw NotFoundException when delivery is not found', async () => {
      mockTenantClient.integrationWebhookDelivery.findFirst.mockResolvedValue(null);

      await expect(service.retryDelivery('wh-1', 'missing-del', tenantSlug)).rejects.toThrow(NotFoundException);
      await expect(service.retryDelivery('wh-1', 'missing-del', tenantSlug)).rejects.toThrow(
        'Delivery missing-del not found for webhook wh-1',
      );
    });
  });

  // ─── processRetries ───────────────────────────────────

  describe('processRetries', () => {
    it('should process pending retries and return count', async () => {
      const pendingDeliveries = [
        {
          ...sampleDelivery,
          status: 'RETRYING',
          nextRetryAt: new Date('2025-12-31'),
          webhook: {
            id: 'wh-1',
            url: 'https://example.com/webhook',
            secret: 'test-secret-key',
            headers: null,
            retryPolicy: { maxAttempts: 3, backoffMs: 1000, backoffMultiplier: 2 },
          },
        },
      ];
      mockTenantClient.integrationWebhookDelivery.findMany.mockResolvedValue(pendingDeliveries);
      mockTenantClient.integrationWebhookDelivery.update.mockResolvedValue({
        ...sampleDelivery,
        status: 'SUCCESS',
      });

      mockSafeHttpRequest.mockResolvedValue(httpResponse(200, 'OK', 'OK'));

      const result = await service.processRetries(tenantSlug);

      expect(result).toEqual({ processed: 1 });
      expect(mockTenantClient.integrationWebhookDelivery.findMany).toHaveBeenCalledWith({
        where: {
          status: 'RETRYING',
          nextRetryAt: { lte: expect.any(Date) },
        },
        include: { webhook: true },
      });
    });

    it('should return processed 0 when no pending retries', async () => {
      mockTenantClient.integrationWebhookDelivery.findMany.mockResolvedValue([]);

      const result = await service.processRetries(tenantSlug);

      expect(result).toEqual({ processed: 0 });
    });
  });
});
