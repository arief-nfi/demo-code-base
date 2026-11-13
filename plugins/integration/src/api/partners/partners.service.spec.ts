import { NotFoundException, ConflictException } from '@nestjs/common';
import { PartnersService } from './partners.service';

describe('PartnersService', () => {
  let service: PartnersService;

  const mockTenantClient = {
    integrationPartner: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  const mockPrisma = {
    getTenantClient: jest.fn().mockReturnValue(mockTenantClient),
  };

  const tenantSlug = 'test-tenant';

  const mockPartner = {
    id: 'partner-1',
    code: 'P001',
    name: 'Acme Corp',
    description: 'Test partner',
    contactName: 'John',
    contactEmail: 'john@acme.com',
    status: 'ACTIVE',
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PartnersService(mockPrisma as any);
  });

  // ─── findAll ───────────────────────────────────────────

  describe('findAll', () => {
    it('should return paginated data with meta', async () => {
      const partners = [mockPartner];
      mockTenantClient.integrationPartner.findMany.mockResolvedValue(partners);
      mockTenantClient.integrationPartner.count.mockResolvedValue(1);

      const result = await service.findAll(tenantSlug, { page: 1, limit: 10 });

      expect(result).toEqual({
        data: partners,
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      });
      expect(mockTenantClient.integrationPartner.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      );
    });

    it('should apply search filter', async () => {
      mockTenantClient.integrationPartner.findMany.mockResolvedValue([]);
      mockTenantClient.integrationPartner.count.mockResolvedValue(0);

      await service.findAll(tenantSlug, { search: 'acme' });

      const call = mockTenantClient.integrationPartner.findMany.mock.calls[0][0];
      expect(call.where.OR).toEqual([
        { name: { contains: 'acme', mode: 'insensitive' } },
        { code: { contains: 'acme', mode: 'insensitive' } },
        { contactEmail: { contains: 'acme', mode: 'insensitive' } },
      ]);
    });

    it('should apply status filter', async () => {
      mockTenantClient.integrationPartner.findMany.mockResolvedValue([]);
      mockTenantClient.integrationPartner.count.mockResolvedValue(0);

      await service.findAll(tenantSlug, { status: 'ACTIVE' });

      const call = mockTenantClient.integrationPartner.findMany.mock.calls[0][0];
      expect(call.where.status).toBe('ACTIVE');
    });
  });

  // ─── findOne ───────────────────────────────────────────

  describe('findOne', () => {
    it('should return a partner', async () => {
      mockTenantClient.integrationPartner.findUnique.mockResolvedValue(mockPartner);

      const result = await service.findOne('partner-1', tenantSlug);

      expect(result).toEqual(mockPartner);
      expect(mockTenantClient.integrationPartner.findUnique).toHaveBeenCalledWith({
        where: { id: 'partner-1' },
      });
    });

    it('should throw NotFoundException when partner is missing', async () => {
      mockTenantClient.integrationPartner.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing-id', tenantSlug)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── create ────────────────────────────────────────────

  describe('create', () => {
    const createDto = {
      code: 'P002',
      name: 'New Partner',
      description: 'Desc',
      contactName: 'Jane',
      contactEmail: 'jane@new.com',
    };

    it('should create a partner', async () => {
      mockTenantClient.integrationPartner.count.mockResolvedValue(0);
      mockTenantClient.integrationPartner.create.mockResolvedValue({ id: 'partner-2', ...createDto });

      const result = await service.create(createDto, tenantSlug);

      expect(result).toEqual(expect.objectContaining({ code: 'P002' }));
      expect(mockTenantClient.integrationPartner.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ code: 'P002', name: 'New Partner' }),
      });
    });

    it('should throw ConflictException for duplicate code', async () => {
      mockTenantClient.integrationPartner.count.mockResolvedValue(1);

      await expect(service.create(createDto, tenantSlug)).rejects.toThrow(ConflictException);
      expect(mockTenantClient.integrationPartner.create).not.toHaveBeenCalled();
    });
  });

  // ─── update ────────────────────────────────────────────

  describe('update', () => {
    const updateDto = { name: 'Updated Name', code: 'P001-UPD' };

    it('should update a partner', async () => {
      mockTenantClient.integrationPartner.findUnique.mockResolvedValue(mockPartner);
      mockTenantClient.integrationPartner.count.mockResolvedValue(0);
      mockTenantClient.integrationPartner.update.mockResolvedValue({ ...mockPartner, ...updateDto });

      const result = await service.update('partner-1', updateDto, tenantSlug);

      expect(result.name).toBe('Updated Name');
      expect(mockTenantClient.integrationPartner.update).toHaveBeenCalledWith({
        where: { id: 'partner-1' },
        data: expect.objectContaining({ name: 'Updated Name', code: 'P001-UPD' }),
      });
    });

    it('should throw ConflictException for duplicate code on update', async () => {
      mockTenantClient.integrationPartner.findUnique.mockResolvedValue(mockPartner);
      mockTenantClient.integrationPartner.count.mockResolvedValue(1);

      await expect(service.update('partner-1', updateDto, tenantSlug)).rejects.toThrow(ConflictException);
      expect(mockTenantClient.integrationPartner.update).not.toHaveBeenCalled();
    });
  });

  // ─── remove ────────────────────────────────────────────

  describe('remove', () => {
    it('should delete a partner', async () => {
      mockTenantClient.integrationPartner.findUnique.mockResolvedValue(mockPartner);
      mockTenantClient.integrationPartner.delete.mockResolvedValue(mockPartner);

      await service.remove('partner-1', tenantSlug);

      expect(mockTenantClient.integrationPartner.delete).toHaveBeenCalledWith({
        where: { id: 'partner-1' },
      });
    });

    it('should throw NotFoundException for missing partner', async () => {
      mockTenantClient.integrationPartner.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing-id', tenantSlug)).rejects.toThrow(NotFoundException);
      expect(mockTenantClient.integrationPartner.delete).not.toHaveBeenCalled();
    });
  });

  // ─── bulkDelete ────────────────────────────────────────

  describe('bulkDelete', () => {
    it('should delete multiple partners', async () => {
      mockTenantClient.integrationPartner.deleteMany.mockResolvedValue({ count: 3 });

      await service.bulkDelete(['id-1', 'id-2', 'id-3'], tenantSlug);

      expect(mockTenantClient.integrationPartner.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['id-1', 'id-2', 'id-3'] } },
      });
    });
  });

  // ─── updateStatus ─────────────────────────────────────

  describe('updateStatus', () => {
    it('should update partner status', async () => {
      mockTenantClient.integrationPartner.findUnique.mockResolvedValue(mockPartner);
      mockTenantClient.integrationPartner.update.mockResolvedValue({ ...mockPartner, status: 'INACTIVE' });

      const result = await service.updateStatus('partner-1', 'INACTIVE', tenantSlug);

      expect(result.status).toBe('INACTIVE');
      expect(mockTenantClient.integrationPartner.update).toHaveBeenCalledWith({
        where: { id: 'partner-1' },
        data: { status: 'INACTIVE' },
      });
    });
  });

  // ─── checkCodeAvailable ───────────────────────────────

  describe('checkCodeAvailable', () => {
    it('should return true when code is available', async () => {
      mockTenantClient.integrationPartner.count.mockResolvedValue(0);

      const result = await service.checkCodeAvailable('NEW-CODE', undefined, tenantSlug);

      expect(result).toBe(true);
      expect(mockTenantClient.integrationPartner.count).toHaveBeenCalledWith({
        where: { code: 'NEW-CODE' },
      });
    });

    it('should return false when code is taken', async () => {
      mockTenantClient.integrationPartner.count.mockResolvedValue(1);

      const result = await service.checkCodeAvailable('EXISTING', undefined, tenantSlug);

      expect(result).toBe(false);
    });

    it('should exclude a specific id from the check', async () => {
      mockTenantClient.integrationPartner.count.mockResolvedValue(0);

      await service.checkCodeAvailable('P001', 'partner-1', tenantSlug);

      expect(mockTenantClient.integrationPartner.count).toHaveBeenCalledWith({
        where: { code: 'P001', id: { not: 'partner-1' } },
      });
    });
  });
});
