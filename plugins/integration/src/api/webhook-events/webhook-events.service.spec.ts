// Mock @saas/database before any imports that trigger it
jest.mock('@saas/database', () => ({
  PrismaClient: class MockPrismaClient {},
  Prisma: {
    JsonNull: '__JSON_NULL__',
    InputJsonValue: undefined,
  },
}));

import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { WebhookEventsService } from './webhook-events.service';

describe('WebhookEventsService', () => {
  let service: WebhookEventsService;

  const mockTenantClient = {
    integrationWebhookEvent: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    integrationWebhook: {
      count: jest.fn(),
    },
  };

  const mockPrisma = {
    getTenantClient: jest.fn().mockReturnValue(mockTenantClient),
  };

  const tenantSlug = 'acme';

  const mockEvent = {
    id: 'evt-1',
    code: 'order.created',
    name: 'Order Created',
    description: 'Triggered when an order is created',
    category: 'orders',
    payloadSchema: { type: 'object' },
    samplePayload: { orderId: '123' },
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebhookEventsService(mockPrisma as any);
  });

  // ─── findAll ─────────────────────────────────────────

  describe('findAll', () => {
    it('should return paginated data with defaults', async () => {
      mockTenantClient.integrationWebhookEvent.findMany.mockResolvedValue([mockEvent]);
      mockTenantClient.integrationWebhookEvent.count.mockResolvedValue(1);

      const result = await service.findAll(tenantSlug, {});

      expect(mockPrisma.getTenantClient).toHaveBeenCalledWith(tenantSlug);
      expect(mockTenantClient.integrationWebhookEvent.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 10,
        orderBy: { createdAt: 'desc' },
      });
      expect(mockTenantClient.integrationWebhookEvent.count).toHaveBeenCalledWith({ where: {} });
      expect(result).toEqual({
        data: [mockEvent],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      });
    });

    it('should apply search, category, and isActive filters', async () => {
      mockTenantClient.integrationWebhookEvent.findMany.mockResolvedValue([]);
      mockTenantClient.integrationWebhookEvent.count.mockResolvedValue(0);

      await service.findAll(tenantSlug, {
        page: 2,
        limit: 5,
        search: 'order',
        category: 'orders',
        isActive: true,
        sortBy: 'name',
        sortOrder: 'asc',
      });

      const expectedWhere = {
        OR: [
          { name: { contains: 'order', mode: 'insensitive' } },
          { code: { contains: 'order', mode: 'insensitive' } },
        ],
        category: 'orders',
        isActive: true,
      };

      expect(mockTenantClient.integrationWebhookEvent.findMany).toHaveBeenCalledWith({
        where: expectedWhere,
        skip: 5,
        take: 5,
        orderBy: { name: 'asc' },
      });
      expect(mockTenantClient.integrationWebhookEvent.count).toHaveBeenCalledWith({
        where: expectedWhere,
      });
    });
  });

  // ─── findOne ─────────────────────────────────────────

  describe('findOne', () => {
    it('should return the event when found', async () => {
      mockTenantClient.integrationWebhookEvent.findUnique.mockResolvedValue(mockEvent);

      const result = await service.findOne('evt-1', tenantSlug);

      expect(mockTenantClient.integrationWebhookEvent.findUnique).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
      });
      expect(result).toEqual(mockEvent);
    });

    it('should throw NotFoundException when event is not found', async () => {
      mockTenantClient.integrationWebhookEvent.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing-id', tenantSlug)).rejects.toThrow(NotFoundException);
      await expect(service.findOne('missing-id', tenantSlug)).rejects.toThrow(
        'Webhook event with ID missing-id not found',
      );
    });
  });

  // ─── create ──────────────────────────────────────────

  describe('create', () => {
    it('should create an event successfully', async () => {
      mockTenantClient.integrationWebhookEvent.count.mockResolvedValue(0);
      mockTenantClient.integrationWebhookEvent.create.mockResolvedValue(mockEvent);

      const dto = {
        code: 'order.created',
        name: 'Order Created',
        description: 'Triggered when an order is created',
        category: 'orders',
        payloadSchema: { type: 'object' },
        samplePayload: { orderId: '123' },
        isActive: true,
      };

      const result = await service.create(dto, tenantSlug);

      expect(mockTenantClient.integrationWebhookEvent.count).toHaveBeenCalledWith({
        where: { code: 'order.created' },
      });
      expect(mockTenantClient.integrationWebhookEvent.create).toHaveBeenCalledWith({
        data: {
          code: 'order.created',
          name: 'Order Created',
          description: 'Triggered when an order is created',
          category: 'orders',
          payloadSchema: { type: 'object' },
          samplePayload: { orderId: '123' },
          isActive: true,
        },
      });
      expect(result).toEqual(mockEvent);
    });

    it('should throw ConflictException when code already exists', async () => {
      mockTenantClient.integrationWebhookEvent.count.mockResolvedValue(1);

      const dto = {
        code: 'order.created',
        name: 'Order Created',
        category: 'orders',
      };

      await expect(service.create(dto, tenantSlug)).rejects.toThrow(ConflictException);
      await expect(service.create(dto, tenantSlug)).rejects.toThrow(
        "Webhook event with code 'order.created' already exists",
      );
      expect(mockTenantClient.integrationWebhookEvent.create).not.toHaveBeenCalled();
    });
  });

  // ─── update ──────────────────────────────────────────

  describe('update', () => {
    it('should update an event successfully', async () => {
      const updatedEvent = { ...mockEvent, name: 'Order Created V2' };
      mockTenantClient.integrationWebhookEvent.findUnique.mockResolvedValue(mockEvent);
      mockTenantClient.integrationWebhookEvent.count.mockResolvedValue(0);
      mockTenantClient.integrationWebhookEvent.update.mockResolvedValue(updatedEvent);

      const dto = { code: 'order.created.v2', name: 'Order Created V2' };

      const result = await service.update('evt-1', dto, tenantSlug);

      expect(mockTenantClient.integrationWebhookEvent.findUnique).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
      });
      expect(mockTenantClient.integrationWebhookEvent.count).toHaveBeenCalledWith({
        where: { code: 'order.created.v2', id: { not: 'evt-1' } },
      });
      expect(mockTenantClient.integrationWebhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        data: { code: 'order.created.v2', name: 'Order Created V2' },
      });
      expect(result).toEqual(updatedEvent);
    });

    it('should throw ConflictException when updated code already exists', async () => {
      mockTenantClient.integrationWebhookEvent.findUnique.mockResolvedValue(mockEvent);
      mockTenantClient.integrationWebhookEvent.count.mockResolvedValue(1);

      const dto = { code: 'order.updated' };

      await expect(service.update('evt-1', dto, tenantSlug)).rejects.toThrow(ConflictException);
      await expect(service.update('evt-1', dto, tenantSlug)).rejects.toThrow(
        "Webhook event with code 'order.updated' already exists",
      );
      expect(mockTenantClient.integrationWebhookEvent.update).not.toHaveBeenCalled();
    });
  });

  // ─── remove ──────────────────────────────────────────

  describe('remove', () => {
    it('should delete an event when no active webhooks exist', async () => {
      mockTenantClient.integrationWebhookEvent.findUnique.mockResolvedValue(mockEvent);
      mockTenantClient.integrationWebhook.count.mockResolvedValue(0);
      mockTenantClient.integrationWebhookEvent.delete.mockResolvedValue(mockEvent);

      await service.remove('evt-1', tenantSlug);

      expect(mockTenantClient.integrationWebhook.count).toHaveBeenCalledWith({
        where: { eventId: 'evt-1', isActive: true },
      });
      expect(mockTenantClient.integrationWebhookEvent.delete).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
      });
    });

    it('should throw BadRequestException when active webhooks exist', async () => {
      mockTenantClient.integrationWebhookEvent.findUnique.mockResolvedValue(mockEvent);
      mockTenantClient.integrationWebhook.count.mockResolvedValue(3);

      await expect(service.remove('evt-1', tenantSlug)).rejects.toThrow(BadRequestException);
      await expect(service.remove('evt-1', tenantSlug)).rejects.toThrow(
        'Cannot delete webhook event: 3 active webhook(s) still reference this event',
      );
      expect(mockTenantClient.integrationWebhookEvent.delete).not.toHaveBeenCalled();
    });
  });

  // ─── bulkDelete ──────────────────────────────────────

  describe('bulkDelete', () => {
    it('should delete events when no active webhooks exist', async () => {
      mockTenantClient.integrationWebhook.count.mockResolvedValue(0);
      mockTenantClient.integrationWebhookEvent.deleteMany.mockResolvedValue({ count: 2 });

      await service.bulkDelete(['evt-1', 'evt-2'], tenantSlug);

      expect(mockTenantClient.integrationWebhook.count).toHaveBeenCalledWith({
        where: { eventId: { in: ['evt-1', 'evt-2'] }, isActive: true },
      });
      expect(mockTenantClient.integrationWebhookEvent.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['evt-1', 'evt-2'] } },
      });
    });

    it('should throw BadRequestException when active webhooks exist', async () => {
      mockTenantClient.integrationWebhook.count.mockResolvedValue(5);

      await expect(service.bulkDelete(['evt-1', 'evt-2'], tenantSlug)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.bulkDelete(['evt-1', 'evt-2'], tenantSlug)).rejects.toThrow(
        'Cannot delete: 5 active webhook(s) still reference these events',
      );
      expect(mockTenantClient.integrationWebhookEvent.deleteMany).not.toHaveBeenCalled();
    });
  });

  // ─── checkCodeAvailable ──────────────────────────────

  describe('checkCodeAvailable', () => {
    it('should return true when code is available', async () => {
      mockTenantClient.integrationWebhookEvent.count.mockResolvedValue(0);

      const result = await service.checkCodeAvailable('new.code', undefined, tenantSlug);

      expect(mockTenantClient.integrationWebhookEvent.count).toHaveBeenCalledWith({
        where: { code: 'new.code' },
      });
      expect(result).toBe(true);
    });

    it('should return false when code already exists', async () => {
      mockTenantClient.integrationWebhookEvent.count.mockResolvedValue(1);

      const result = await service.checkCodeAvailable('order.created', undefined, tenantSlug);

      expect(result).toBe(false);
    });

    it('should exclude the given id from the check', async () => {
      mockTenantClient.integrationWebhookEvent.count.mockResolvedValue(0);

      const result = await service.checkCodeAvailable('order.created', 'evt-1', tenantSlug);

      expect(mockTenantClient.integrationWebhookEvent.count).toHaveBeenCalledWith({
        where: { code: 'order.created', id: { not: 'evt-1' } },
      });
      expect(result).toBe(true);
    });
  });
});
