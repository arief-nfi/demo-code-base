import { WebhookEventsController } from './webhook-events.controller';
import type { AuthenticatedRequest } from '@saas/backend';

describe('WebhookEventsController', () => {
  let controller: WebhookEventsController;

  const mockWebhookEventsService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    bulkDelete: jest.fn(),
    checkCodeAvailable: jest.fn(),
  };

  const mockReq = {
    tenant: { slug: 'acme' },
    user: { sub: 'admin-1', role: 'ADMIN' },
  } as unknown as AuthenticatedRequest;

  const mockEvent = {
    id: 'evt-1',
    code: 'order.created',
    name: 'Order Created',
    category: 'orders',
    isActive: true,
  };

  const mockPaginatedResult = {
    data: [mockEvent],
    meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockWebhookEventsService.findAll.mockResolvedValue(mockPaginatedResult);
    mockWebhookEventsService.findOne.mockResolvedValue(mockEvent);
    mockWebhookEventsService.create.mockResolvedValue(mockEvent);
    mockWebhookEventsService.update.mockResolvedValue(mockEvent);
    mockWebhookEventsService.remove.mockResolvedValue(undefined);
    mockWebhookEventsService.bulkDelete.mockResolvedValue(undefined);
    mockWebhookEventsService.checkCodeAvailable.mockResolvedValue(true);

    controller = new WebhookEventsController(mockWebhookEventsService as any);
  });

  // ─── tenant context ─────────────────────────────────

  describe('tenant context', () => {
    it('should throw when tenant context is missing', () => {
      const reqNoTenant = { tenant: {} } as unknown as AuthenticatedRequest;

      expect(() => controller.findAll(reqNoTenant, {})).toThrow('Tenant context is required');
    });

    it('should throw when tenant is undefined', () => {
      const reqNoTenant = {} as unknown as AuthenticatedRequest;

      expect(() => controller.findAll(reqNoTenant, {})).toThrow();
    });
  });

  // ─── GET / ───────────────────────────────────────────

  describe('findAll', () => {
    it('should delegate to service with tenant slug and query', async () => {
      const query = { page: 2, limit: 5, search: 'order', category: 'orders' };

      const result = await controller.findAll(mockReq, query);

      expect(mockWebhookEventsService.findAll).toHaveBeenCalledWith('acme', query);
      expect(result).toEqual(mockPaginatedResult);
    });
  });

  // ─── GET /check-code ────────────────────────────────

  describe('checkCode', () => {
    it('should delegate to checkCodeAvailable and return availability', async () => {
      const result = await controller.checkCode(mockReq, 'order.created', 'evt-1');

      expect(mockWebhookEventsService.checkCodeAvailable).toHaveBeenCalledWith(
        'order.created',
        'evt-1',
        'acme',
      );
      expect(result).toEqual({ available: true });
    });

    it('should return false when code is taken', async () => {
      mockWebhookEventsService.checkCodeAvailable.mockResolvedValue(false);

      const result = await controller.checkCode(mockReq, 'order.created');

      expect(mockWebhookEventsService.checkCodeAvailable).toHaveBeenCalledWith(
        'order.created',
        undefined,
        'acme',
      );
      expect(result).toEqual({ available: false });
    });
  });

  // ─── GET /:id ────────────────────────────────────────

  describe('findOne', () => {
    it('should delegate to service with id and tenant slug', async () => {
      const result = await controller.findOne(mockReq, 'evt-1');

      expect(mockWebhookEventsService.findOne).toHaveBeenCalledWith('evt-1', 'acme');
      expect(result).toEqual(mockEvent);
    });
  });

  // ─── POST / ──────────────────────────────────────────

  describe('create', () => {
    it('should delegate to service with dto and tenant slug', async () => {
      const dto = { code: 'order.created', name: 'Order Created', category: 'orders' };

      const result = await controller.create(mockReq, dto as any);

      expect(mockWebhookEventsService.create).toHaveBeenCalledWith(dto, 'acme');
      expect(result).toEqual(mockEvent);
    });
  });

  // ─── PATCH /:id ──────────────────────────────────────

  describe('update', () => {
    it('should delegate to service with id, dto, and tenant slug', async () => {
      const dto = { name: 'Order Created V2' };

      const result = await controller.update(mockReq, 'evt-1', dto as any);

      expect(mockWebhookEventsService.update).toHaveBeenCalledWith('evt-1', dto, 'acme');
      expect(result).toEqual(mockEvent);
    });
  });

  // ─── DELETE /:id ─────────────────────────────────────

  describe('remove', () => {
    it('should delegate to service and return success message', async () => {
      const result = await controller.remove(mockReq, 'evt-1');

      expect(mockWebhookEventsService.remove).toHaveBeenCalledWith('evt-1', 'acme');
      expect(result).toEqual({ message: 'Webhook event deleted successfully' });
    });
  });

  // ─── POST /bulk-delete ──────────────────────────────

  describe('bulkDelete', () => {
    it('should delegate to service and return success message', async () => {
      const result = await controller.bulkDelete(mockReq, { ids: ['evt-1', 'evt-2'] });

      expect(mockWebhookEventsService.bulkDelete).toHaveBeenCalledWith(['evt-1', 'evt-2'], 'acme');
      expect(result).toEqual({ message: 'Webhook events deleted successfully' });
    });
  });
});
