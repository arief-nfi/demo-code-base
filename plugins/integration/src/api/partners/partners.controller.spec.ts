import { PartnersController } from './partners.controller';

describe('PartnersController', () => {
  let controller: PartnersController;

  const mockPartnersService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    bulkDelete: jest.fn(),
    updateStatus: jest.fn(),
    checkCodeAvailable: jest.fn(),
  };

  const mockReq = {
    tenant: { slug: 'test-tenant' },
  } as any;

  const mockPartner = {
    id: 'partner-1',
    code: 'P001',
    name: 'Acme Corp',
    status: 'ACTIVE',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new PartnersController(mockPartnersService as any);
  });

  // ─── findAll ───────────────────────────────────────────

  describe('findAll', () => {
    it('should delegate to service with tenant slug and query', async () => {
      const query = { page: 1, limit: 10, search: 'acme' };
      const expected = { data: [mockPartner], meta: { total: 1, page: 1, limit: 10, totalPages: 1 } };
      mockPartnersService.findAll.mockResolvedValue(expected);

      const result = await controller.findAll(mockReq, query);

      expect(mockPartnersService.findAll).toHaveBeenCalledWith('test-tenant', query);
      expect(result).toEqual(expected);
    });
  });

  // ─── checkCode ─────────────────────────────────────────

  describe('checkCode', () => {
    it('should delegate to checkCodeAvailable and return { available }', async () => {
      mockPartnersService.checkCodeAvailable.mockResolvedValue(true);

      const result = await controller.checkCode(mockReq, 'P001', undefined);

      expect(mockPartnersService.checkCodeAvailable).toHaveBeenCalledWith('P001', undefined, 'test-tenant');
      expect(result).toEqual({ available: true });
    });

    it('should pass excludeId when provided', async () => {
      mockPartnersService.checkCodeAvailable.mockResolvedValue(false);

      const result = await controller.checkCode(mockReq, 'P001', 'partner-1');

      expect(mockPartnersService.checkCodeAvailable).toHaveBeenCalledWith('P001', 'partner-1', 'test-tenant');
      expect(result).toEqual({ available: false });
    });
  });

  // ─── findOne ───────────────────────────────────────────

  describe('findOne', () => {
    it('should delegate with id and tenant slug', async () => {
      mockPartnersService.findOne.mockResolvedValue(mockPartner);

      const result = await controller.findOne(mockReq, 'partner-1');

      expect(mockPartnersService.findOne).toHaveBeenCalledWith('partner-1', 'test-tenant');
      expect(result).toEqual(mockPartner);
    });
  });

  // ─── create ────────────────────────────────────────────

  describe('create', () => {
    it('should delegate with dto and tenant slug', async () => {
      const dto = { code: 'P002', name: 'New Partner', contactName: 'Jane', contactEmail: 'jane@new.com' };
      mockPartnersService.create.mockResolvedValue({ id: 'partner-2', ...dto });

      const result = await controller.create(mockReq, dto);

      expect(mockPartnersService.create).toHaveBeenCalledWith(dto, 'test-tenant');
      expect(result).toEqual(expect.objectContaining({ code: 'P002' }));
    });
  });

  // ─── update ────────────────────────────────────────────

  describe('update', () => {
    it('should delegate with id, dto, and tenant slug', async () => {
      const dto = { name: 'Updated' };
      mockPartnersService.update.mockResolvedValue({ ...mockPartner, name: 'Updated' });

      const result = await controller.update(mockReq, 'partner-1', dto);

      expect(mockPartnersService.update).toHaveBeenCalledWith('partner-1', dto, 'test-tenant');
      expect(result.name).toBe('Updated');
    });
  });

  // ─── remove ────────────────────────────────────────────

  describe('remove', () => {
    it('should delegate and return success message', async () => {
      mockPartnersService.remove.mockResolvedValue(undefined);

      const result = await controller.remove(mockReq, 'partner-1');

      expect(mockPartnersService.remove).toHaveBeenCalledWith('partner-1', 'test-tenant');
      expect(result).toEqual({ message: 'Partner deleted successfully' });
    });
  });

  // ─── bulkDelete ────────────────────────────────────────

  describe('bulkDelete', () => {
    it('should delegate with ids and return success message', async () => {
      mockPartnersService.bulkDelete.mockResolvedValue(undefined);

      const result = await controller.bulkDelete(mockReq, { ids: ['id-1', 'id-2'] });

      expect(mockPartnersService.bulkDelete).toHaveBeenCalledWith(['id-1', 'id-2'], 'test-tenant');
      expect(result).toEqual({ message: 'Partners deleted successfully' });
    });
  });

  // ─── updateStatus ─────────────────────────────────────

  describe('updateStatus', () => {
    it('should delegate with id, status, and tenant slug', async () => {
      mockPartnersService.updateStatus.mockResolvedValue({ ...mockPartner, status: 'INACTIVE' });

      const result = await controller.updateStatus(mockReq, 'partner-1', { status: 'INACTIVE' });

      expect(mockPartnersService.updateStatus).toHaveBeenCalledWith('partner-1', 'INACTIVE', 'test-tenant');
      expect(result.status).toBe('INACTIVE');
    });
  });

  // ─── tenant context ───────────────────────────────────

  describe('tenant context', () => {
    it('should throw when tenant context is missing', () => {
      const reqNoTenant = { tenant: {} } as any;

      expect(() => controller.findAll(reqNoTenant, {})).toThrow('Tenant context is required');
    });
  });
});
