import { InboundController } from './inbound.controller';

describe('InboundController', () => {
  let controller: InboundController;

  const mockTenantClient = {
    integrationWebhookEvent: { findFirst: jest.fn() },
    integrationWebhook: { findMany: jest.fn() },
  };

  const mockPrisma = {
    getTenantClient: jest.fn().mockReturnValue(mockTenantClient),
  };

  const mockDeliveryService = {
    deliverWebhook: jest.fn(),
  };

  const mockRequest = {
    tenant: { slug: 'test-tenant' },
    partner: { id: 'p1', code: 'acme', name: 'Acme' },
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new InboundController(mockDeliveryService as any, mockPrisma as any);
  });

  // ─── triggerWebhook ────────────────────────────────────

  describe('triggerWebhook', () => {
    const dto = {
      eventCode: 'order.created',
      payload: { orderId: '123' },
    };

    it('should find event and deliver to webhooks, return accepted with delivery count', async () => {
      const mockEvent = { id: 'evt-1', code: 'order.created', isActive: true };
      const mockWebhooks = [
        {
          id: 'wh-1',
          url: 'https://example.com/hook1',
          secret: 'sec1',
          headers: null,
          retryPolicy: null,
          partnerId: 'p1',
          isActive: true,
        },
        {
          id: 'wh-2',
          url: 'https://example.com/hook2',
          secret: 'sec2',
          headers: { 'X-Custom': 'val' },
          retryPolicy: { maxAttempts: 3, backoffMs: 1000, backoffMultiplier: 2 },
          partnerId: 'p1',
          isActive: true,
        },
      ];

      mockTenantClient.integrationWebhookEvent.findFirst.mockResolvedValue(mockEvent);
      mockTenantClient.integrationWebhook.findMany.mockResolvedValue(mockWebhooks);
      mockDeliveryService.deliverWebhook.mockResolvedValue(undefined);

      const result = await controller.triggerWebhook(mockRequest, dto);

      expect(result).toEqual({ accepted: true, deliveries: 2 });
      expect(mockTenantClient.integrationWebhookEvent.findFirst).toHaveBeenCalledWith({
        where: { code: 'order.created', isActive: true },
      });
      expect(mockTenantClient.integrationWebhook.findMany).toHaveBeenCalledWith({
        where: { eventId: 'evt-1', isActive: true, partnerId: 'p1' },
      });
      expect(mockDeliveryService.deliverWebhook).toHaveBeenCalledTimes(2);
      expect(mockDeliveryService.deliverWebhook).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'wh-1', url: 'https://example.com/hook1' }),
        'order.created',
        { orderId: '123' },
        'test-tenant',
      );
    });

    it('should return accepted false when event not found', async () => {
      mockTenantClient.integrationWebhookEvent.findFirst.mockResolvedValue(null);

      const result = await controller.triggerWebhook(mockRequest, dto);

      expect(result).toEqual({
        accepted: false,
        message: "Event 'order.created' not found or inactive",
        deliveries: 0,
      });
      expect(mockDeliveryService.deliverWebhook).not.toHaveBeenCalled();
    });

    it('should handle no matching webhooks (delivers 0)', async () => {
      const mockEvent = { id: 'evt-1', code: 'order.created', isActive: true };
      mockTenantClient.integrationWebhookEvent.findFirst.mockResolvedValue(mockEvent);
      mockTenantClient.integrationWebhook.findMany.mockResolvedValue([]);

      const result = await controller.triggerWebhook(mockRequest, dto);

      expect(result).toEqual({ accepted: true, deliveries: 0 });
      expect(mockDeliveryService.deliverWebhook).not.toHaveBeenCalled();
    });
  });

  // ─── health ────────────────────────────────────────────

  describe('health', () => {
    it('should return status ok with partner code', () => {
      const result = controller.health(mockRequest);

      expect(result).toEqual({
        status: 'ok',
        partner: 'acme',
        timestamp: expect.any(String),
      });
    });
  });
});
