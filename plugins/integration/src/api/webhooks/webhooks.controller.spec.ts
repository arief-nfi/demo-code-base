import { WebhooksController } from './webhooks.controller';
import type { AuthenticatedRequest } from '@saas/backend';

describe('WebhooksController', () => {
  let controller: WebhooksController;

  const mockWebhooksService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    bulkDelete: jest.fn(),
    rotateSecret: jest.fn(),
    testWebhook: jest.fn(),
  };

  const mockDeliveryService = {
    findDeliveries: jest.fn(),
    retryDelivery: jest.fn(),
  };

  const mockReq = {
    tenant: { slug: 'acme' },
    user: { sub: 'admin-1', role: 'ADMIN' },
  } as unknown as AuthenticatedRequest;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new WebhooksController(
      mockWebhooksService as any,
      mockDeliveryService as any,
    );
  });

  // ─── tenant context ───────────────────────────────────

  describe('tenant context', () => {
    it('should throw when tenant context is missing', async () => {
      const reqNoTenant = { tenant: {} } as unknown as AuthenticatedRequest;
      mockWebhooksService.findAll.mockResolvedValue({ data: [], meta: {} });

      expect(() => controller.findAll(reqNoTenant, {})).toThrow('Tenant context is required');
    });

    it('should throw when tenant is undefined', async () => {
      const reqNoTenant = {} as unknown as AuthenticatedRequest;

      expect(() => controller.findAll(reqNoTenant, {})).toThrow();
    });
  });

  // ─── GET / ────────────────────────────────────────────

  describe('findAll', () => {
    it('should delegate to webhooksService.findAll with tenant slug and query', async () => {
      const query = { page: 1, limit: 10, search: 'test' };
      const expected = { data: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } };
      mockWebhooksService.findAll.mockResolvedValue(expected);

      const result = await controller.findAll(mockReq, query);

      expect(mockWebhooksService.findAll).toHaveBeenCalledWith('acme', query);
      expect(result).toEqual(expected);
    });
  });

  // ─── GET /:id ─────────────────────────────────────────

  describe('findOne', () => {
    it('should delegate to webhooksService.findOne', async () => {
      const expected = { id: 'wh-1', url: 'https://example.com' };
      mockWebhooksService.findOne.mockResolvedValue(expected);

      const result = await controller.findOne(mockReq, 'wh-1');

      expect(mockWebhooksService.findOne).toHaveBeenCalledWith('wh-1', 'acme');
      expect(result).toEqual(expected);
    });
  });

  // ─── POST / ───────────────────────────────────────────

  describe('create', () => {
    it('should delegate to webhooksService.create', async () => {
      const dto = { partnerId: 'p-1', eventId: 'e-1', url: 'https://example.com/hook' };
      const expected = { webhook: { id: 'wh-1' }, secret: 'abc123' };
      mockWebhooksService.create.mockResolvedValue(expected);

      const result = await controller.create(mockReq, dto as any);

      expect(mockWebhooksService.create).toHaveBeenCalledWith(dto, 'acme');
      expect(result).toEqual(expected);
    });
  });

  // ─── PATCH /:id ───────────────────────────────────────

  describe('update', () => {
    it('should delegate to webhooksService.update', async () => {
      const dto = { url: 'https://new-url.com' };
      const expected = { id: 'wh-1', url: 'https://new-url.com' };
      mockWebhooksService.update.mockResolvedValue(expected);

      const result = await controller.update(mockReq, 'wh-1', dto as any);

      expect(mockWebhooksService.update).toHaveBeenCalledWith('wh-1', dto, 'acme');
      expect(result).toEqual(expected);
    });
  });

  // ─── DELETE /:id ──────────────────────────────────────

  describe('remove', () => {
    it('should delegate to webhooksService.remove and return success message', async () => {
      mockWebhooksService.remove.mockResolvedValue(undefined);

      const result = await controller.remove(mockReq, 'wh-1');

      expect(mockWebhooksService.remove).toHaveBeenCalledWith('wh-1', 'acme');
      expect(result).toEqual({ message: 'Webhook deleted successfully' });
    });
  });

  // ─── POST /bulk-delete ────────────────────────────────

  describe('bulkDelete', () => {
    it('should delegate to webhooksService.bulkDelete and return success message', async () => {
      mockWebhooksService.bulkDelete.mockResolvedValue(undefined);

      const result = await controller.bulkDelete(mockReq, { ids: ['wh-1', 'wh-2'] });

      expect(mockWebhooksService.bulkDelete).toHaveBeenCalledWith(['wh-1', 'wh-2'], 'acme');
      expect(result).toEqual({ message: 'Webhooks deleted successfully' });
    });
  });

  // ─── POST /:id/rotate-secret ─────────────────────────

  describe('rotateSecret', () => {
    it('should delegate to webhooksService.rotateSecret', async () => {
      const expected = { webhook: { id: 'wh-1' }, secret: 'new-secret' };
      mockWebhooksService.rotateSecret.mockResolvedValue(expected);

      const result = await controller.rotateSecret(mockReq, 'wh-1');

      expect(mockWebhooksService.rotateSecret).toHaveBeenCalledWith('wh-1', 'acme');
      expect(result).toEqual(expected);
    });
  });

  // ─── POST /:id/test ──────────────────────────────────

  describe('testWebhook', () => {
    it('should delegate to webhooksService.testWebhook', async () => {
      const expected = { id: 'delivery-1', status: 'SUCCESS' };
      mockWebhooksService.testWebhook.mockResolvedValue(expected);

      const result = await controller.testWebhook(mockReq, 'wh-1');

      expect(mockWebhooksService.testWebhook).toHaveBeenCalledWith('wh-1', 'acme');
      expect(result).toEqual(expected);
    });
  });

  // ─── GET /:id/deliveries ─────────────────────────────

  describe('findDeliveries', () => {
    it('should delegate to deliveryService.findDeliveries', async () => {
      const query = { page: 1, limit: 10 };
      const expected = { data: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } };
      mockDeliveryService.findDeliveries.mockResolvedValue(expected);

      const result = await controller.findDeliveries(mockReq, 'wh-1', query);

      expect(mockDeliveryService.findDeliveries).toHaveBeenCalledWith('wh-1', 'acme', query);
      expect(result).toEqual(expected);
    });
  });

  // ─── POST /:id/deliveries/:deliveryId/retry ──────────

  describe('retryDelivery', () => {
    it('should delegate to deliveryService.retryDelivery', async () => {
      const expected = { id: 'del-1', status: 'RETRYING' };
      mockDeliveryService.retryDelivery.mockResolvedValue(expected);

      const result = await controller.retryDelivery(mockReq, 'wh-1', 'del-1');

      expect(mockDeliveryService.retryDelivery).toHaveBeenCalledWith('wh-1', 'del-1', 'acme');
      expect(result).toEqual(expected);
    });
  });
});
