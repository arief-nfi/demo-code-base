import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import * as dns from 'dns';
import { assertSafeOutboundUrl } from '@saas/backend';
import { WebhooksService } from './webhooks.service';

// Wrap (not replace) the SSRF guard so a test can inject an error from "another copy" of the package.
jest.mock('@saas/backend', () => {
  const actual = jest.requireActual('@saas/backend');
  return { ...actual, assertSafeOutboundUrl: jest.fn(actual.assertSafeOutboundUrl) };
});
const mockAssertSafeOutboundUrl = assertSafeOutboundUrl as jest.MockedFunction<typeof assertSafeOutboundUrl>;

describe('WebhooksService', () => {
  let service: WebhooksService;

  const mockTenantClient = {
    integrationWebhook: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    integrationPartner: { findUnique: jest.fn() },
    integrationWebhookEvent: { findUnique: jest.fn() },
  };

  const mockPrisma = {
    getTenantClient: jest.fn().mockReturnValue(mockTenantClient),
  };

  const mockDeliveryService = {
    deliverWebhook: jest.fn(),
  };

  const tenantSlug = 'acme';

  const sampleWebhook = {
    id: 'wh-1',
    partnerId: 'partner-1',
    eventId: 'event-1',
    url: 'https://example.com/webhook',
    description: 'Test webhook',
    secret: 'super-secret-value',
    headers: null,
    retryPolicy: null,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    partner: { id: 'partner-1', code: 'P1', name: 'Partner One' },
    event: { id: 'event-1', code: 'order.created', name: 'Order Created' },
  };

  let lookupSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ALLOW_PRIVATE_WEBHOOK_URLS;
    // Webhook URLs are resolved at config time — keep unit tests off the network.
    lookupSpy = jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    service = new WebhooksService(mockPrisma as any, mockDeliveryService as any);
  });

  afterEach(() => {
    lookupSpy.mockRestore();
    delete process.env.ALLOW_PRIVATE_WEBHOOK_URLS;
  });

  // ─── findAll ───────────────────────────────────────────

  describe('findAll', () => {
    it('should return paginated data with secret removed', async () => {
      mockTenantClient.integrationWebhook.findMany.mockResolvedValue([sampleWebhook]);
      mockTenantClient.integrationWebhook.count.mockResolvedValue(1);

      const result = await service.findAll(tenantSlug, { page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).not.toHaveProperty('secret');
      expect(result.data[0]).toHaveProperty('id', 'wh-1');
      expect(result.data[0]).toHaveProperty('partner');
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
      expect(mockTenantClient.integrationWebhook.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            partner: { select: { id: true, code: true, name: true } },
            event: { select: { id: true, code: true, name: true } },
          },
        }),
      );
    });
  });

  // ─── findOne ───────────────────────────────────────────

  describe('findOne', () => {
    it('should return webhook without secret', async () => {
      mockTenantClient.integrationWebhook.findUnique.mockResolvedValue(sampleWebhook);

      const result = await service.findOne('wh-1', tenantSlug);

      expect(result).not.toHaveProperty('secret');
      expect(result).toHaveProperty('id', 'wh-1');
      expect(result).toHaveProperty('partner');
      expect(result).toHaveProperty('event');
    });

    it('should throw NotFoundException when webhook does not exist', async () => {
      mockTenantClient.integrationWebhook.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing-id', tenantSlug)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── create ────────────────────────────────────────────

  describe('create', () => {
    const createDto = {
      partnerId: 'partner-1',
      eventId: 'event-1',
      url: 'https://example.com/webhook',
      description: 'New webhook',
    };

    it('should create webhook and return webhook with secret', async () => {
      mockTenantClient.integrationPartner.findUnique.mockResolvedValue({ id: 'partner-1' });
      mockTenantClient.integrationWebhookEvent.findUnique.mockResolvedValue({ id: 'event-1' });
      mockTenantClient.integrationWebhook.findFirst.mockResolvedValue(null);
      mockTenantClient.integrationWebhook.create.mockResolvedValue(sampleWebhook);

      const result = await service.create(createDto, tenantSlug);

      expect(result).toHaveProperty('webhook');
      expect(result).toHaveProperty('secret');
      expect(result.webhook).not.toHaveProperty('secret');
      expect(typeof result.secret).toBe('string');
      expect(result.secret.length).toBe(64); // crypto.randomBytes(32).toString('hex')
      expect(mockTenantClient.integrationWebhook.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            partnerId: 'partner-1',
            eventId: 'event-1',
            url: 'https://example.com/webhook',
          }),
        }),
      );
    });

    it('should throw BadRequestException when partner does not exist', async () => {
      mockTenantClient.integrationPartner.findUnique.mockResolvedValue(null);

      await expect(service.create(createDto, tenantSlug)).rejects.toThrow(BadRequestException);
      await expect(service.create(createDto, tenantSlug)).rejects.toThrow(
        `Partner with ID ${createDto.partnerId} not found`,
      );
    });

    it('should throw BadRequestException when event does not exist', async () => {
      mockTenantClient.integrationPartner.findUnique.mockResolvedValue({ id: 'partner-1' });
      mockTenantClient.integrationWebhookEvent.findUnique.mockResolvedValue(null);

      await expect(service.create(createDto, tenantSlug)).rejects.toThrow(BadRequestException);
      await expect(service.create(createDto, tenantSlug)).rejects.toThrow(
        `Webhook event with ID ${createDto.eventId} not found`,
      );
    });

    it('should throw ConflictException when duplicate webhook exists', async () => {
      mockTenantClient.integrationPartner.findUnique.mockResolvedValue({ id: 'partner-1' });
      mockTenantClient.integrationWebhookEvent.findUnique.mockResolvedValue({ id: 'event-1' });
      mockTenantClient.integrationWebhook.findFirst.mockResolvedValue(sampleWebhook);

      await expect(service.create(createDto, tenantSlug)).rejects.toThrow(ConflictException);
    });
  });

  // ─── update ────────────────────────────────────────────

  describe('update', () => {
    it('should update webhook and return sanitized result', async () => {
      const updateDto = { url: 'https://new-url.com/webhook', isActive: false };
      mockTenantClient.integrationWebhook.findUnique.mockResolvedValue(sampleWebhook);
      mockTenantClient.integrationWebhook.update.mockResolvedValue({
        ...sampleWebhook,
        url: 'https://new-url.com/webhook',
        isActive: false,
      });

      const result = await service.update('wh-1', updateDto, tenantSlug);

      expect(result).not.toHaveProperty('secret');
      expect(result).toHaveProperty('url', 'https://new-url.com/webhook');
      expect(mockTenantClient.integrationWebhook.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'wh-1' } }),
      );
    });

    it('should throw NotFoundException when webhook does not exist', async () => {
      mockTenantClient.integrationWebhook.findUnique.mockResolvedValue(null);

      await expect(service.update('missing-id', { url: 'https://x.com' }, tenantSlug)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── SSRF: webhook URL validation ──────────────────────

  describe('webhook URL validation (SSRF)', () => {
    const baseDto = { partnerId: 'partner-1', eventId: 'event-1', description: 'x' };

    beforeEach(() => {
      mockTenantClient.integrationPartner.findUnique.mockResolvedValue({ id: 'partner-1' });
      mockTenantClient.integrationWebhookEvent.findUnique.mockResolvedValue({ id: 'event-1' });
      mockTenantClient.integrationWebhook.findFirst.mockResolvedValue(null);
      mockTenantClient.integrationWebhook.create.mockResolvedValue(sampleWebhook);
      mockTenantClient.integrationWebhook.findUnique.mockResolvedValue(sampleWebhook);
      mockTenantClient.integrationWebhook.update.mockResolvedValue(sampleWebhook);
    });

    it.each([
      'http://127.0.0.1:59123/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]:8080/hook',
      'http://10.0.0.5/hook',
    ])('create rejects private/reserved address %s with 400', async (url) => {
      const err = await service.create({ ...baseDto, url }, tenantSlug).catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/^Webhook URL is not allowed: .*private or reserved/);
      expect(mockTenantClient.integrationWebhook.create).not.toHaveBeenCalled();
    });

    it('create rejects a hostname that resolves to a private address', async () => {
      lookupSpy.mockResolvedValue([{ address: '10.20.30.40', family: 4 }] as never);

      await expect(service.create({ ...baseDto, url: 'https://internal.example.com/hook' }, tenantSlug)).rejects.toThrow(
        'Webhook URL is not allowed: Host internal.example.com resolves to private or reserved address 10.20.30.40',
      );
      expect(mockTenantClient.integrationWebhook.create).not.toHaveBeenCalled();
    });

    it('create rejects non-http(s) schemes', async () => {
      await expect(service.create({ ...baseDto, url: 'ftp://example.com/x' }, tenantSlug)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('create accepts a public URL', async () => {
      await expect(service.create({ ...baseDto, url: 'https://example.com/webhook' }, tenantSlug)).resolves.toHaveProperty(
        'secret',
      );
      expect(lookupSpy).toHaveBeenCalledWith('example.com', expect.objectContaining({ all: true }));
    });

    it('create does not fail on DNS errors (delivery re-validates and records the failure)', async () => {
      lookupSpy.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND not-yet.example.com'), { code: 'ENOTFOUND' }));

      await expect(
        service.create({ ...baseDto, url: 'https://not-yet.example.com/hook' }, tenantSlug),
      ).resolves.toHaveProperty('secret');
    });

    it('update rejects a private/reserved URL with 400', async () => {
      const err = await service.update('wh-1', { url: 'http://127.0.0.1:59123/' }, tenantSlug).catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/private or reserved/);
      expect(mockTenantClient.integrationWebhook.update).not.toHaveBeenCalled();
    });

    it('update without a url change does not resolve anything', async () => {
      await service.update('wh-1', { isActive: false }, tenantSlug);

      expect(lookupSpy).not.toHaveBeenCalled();
      expect(mockTenantClient.integrationWebhook.update).toHaveBeenCalled();
    });

    it('matches policy errors by code (a second copy of @saas/backend still yields 400)', async () => {
      mockAssertSafeOutboundUrl.mockRejectedValueOnce(
        Object.assign(new Error('Host 127.0.0.1 is a private or reserved address'), { code: 'ERR_UNSAFE_OUTBOUND_URL' }),
      );

      const err = await service.create({ ...baseDto, url: 'http://127.0.0.1/' }, tenantSlug).catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Webhook URL is not allowed: Host 127.0.0.1 is a private or reserved address');
      expect(mockTenantClient.integrationWebhook.create).not.toHaveBeenCalled();
    });

    it('ALLOW_PRIVATE_WEBHOOK_URLS=true permits private targets (local development)', async () => {
      process.env.ALLOW_PRIVATE_WEBHOOK_URLS = 'true';

      await expect(service.create({ ...baseDto, url: 'http://127.0.0.1:59123/' }, tenantSlug)).resolves.toHaveProperty(
        'secret',
      );
      await expect(service.update('wh-1', { url: 'http://localhost:4000/hook' }, tenantSlug)).resolves.toBeDefined();
    });
  });

  // ─── remove ────────────────────────────────────────────

  describe('remove', () => {
    it('should delete webhook', async () => {
      mockTenantClient.integrationWebhook.findUnique.mockResolvedValue(sampleWebhook);
      mockTenantClient.integrationWebhook.delete.mockResolvedValue(sampleWebhook);

      await service.remove('wh-1', tenantSlug);

      expect(mockTenantClient.integrationWebhook.delete).toHaveBeenCalledWith({ where: { id: 'wh-1' } });
    });

    it('should throw NotFoundException when webhook does not exist', async () => {
      mockTenantClient.integrationWebhook.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing-id', tenantSlug)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── bulkDelete ────────────────────────────────────────

  describe('bulkDelete', () => {
    it('should delete multiple webhooks', async () => {
      mockTenantClient.integrationWebhook.deleteMany.mockResolvedValue({ count: 3 });

      await service.bulkDelete(['wh-1', 'wh-2', 'wh-3'], tenantSlug);

      expect(mockTenantClient.integrationWebhook.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['wh-1', 'wh-2', 'wh-3'] } },
      });
    });
  });

  // ─── rotateSecret ─────────────────────────────────────

  describe('rotateSecret', () => {
    it('should rotate secret and return webhook with new secret', async () => {
      mockTenantClient.integrationWebhook.findUnique.mockResolvedValue(sampleWebhook);
      mockTenantClient.integrationWebhook.update.mockResolvedValue({
        ...sampleWebhook,
        secret: 'new-rotated-secret',
      });

      const result = await service.rotateSecret('wh-1', tenantSlug);

      expect(result).toHaveProperty('webhook');
      expect(result).toHaveProperty('secret');
      expect(result.webhook).not.toHaveProperty('secret');
      expect(typeof result.secret).toBe('string');
      expect(result.secret.length).toBe(64);
      expect(mockTenantClient.integrationWebhook.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wh-1' },
          data: expect.objectContaining({ secret: expect.any(String) }),
        }),
      );
    });

    it('should throw NotFoundException when webhook does not exist', async () => {
      mockTenantClient.integrationWebhook.findUnique.mockResolvedValue(null);

      await expect(service.rotateSecret('missing-id', tenantSlug)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── testWebhook ──────────────────────────────────────

  describe('testWebhook', () => {
    it('should call deliveryService.deliverWebhook with webhook data', async () => {
      const webhookWithEvent = {
        ...sampleWebhook,
        event: { ...sampleWebhook.event, code: 'order.created', samplePayload: { orderId: '123' } },
      };
      mockTenantClient.integrationWebhook.findUnique.mockResolvedValue(webhookWithEvent);
      mockDeliveryService.deliverWebhook.mockResolvedValue({ id: 'delivery-1', status: 'SUCCESS' });

      await service.testWebhook('wh-1', tenantSlug);

      expect(mockDeliveryService.deliverWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'wh-1',
          url: 'https://example.com/webhook',
          secret: 'super-secret-value',
        }),
        'order.created',
        { orderId: '123' },
        tenantSlug,
      );
    });

    it('should throw NotFoundException when webhook does not exist', async () => {
      mockTenantClient.integrationWebhook.findUnique.mockResolvedValue(null);

      await expect(service.testWebhook('missing-id', tenantSlug)).rejects.toThrow(NotFoundException);
    });
  });
});
