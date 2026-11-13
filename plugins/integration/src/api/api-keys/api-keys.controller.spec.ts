import { ApiKeysController } from './api-keys.controller';

describe('ApiKeysController', () => {
  let controller: ApiKeysController;

  const mockApiKeysService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    bulkDelete: jest.fn(),
    revoke: jest.fn(),
    regenerate: jest.fn(),
  };

  const mockRequest = {
    tenant: { slug: 'test-tenant' },
    user: { id: 'user-1' },
  } as any;

  const tenantSlug = 'test-tenant';

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ApiKeysController(mockApiKeysService as any);
  });

  // ─── findAll ───────────────────────────────────────────

  describe('findAll', () => {
    it('should delegate to service.findAll', async () => {
      const query = { page: 1, limit: 10 };
      const expected = { data: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } };
      mockApiKeysService.findAll.mockResolvedValue(expected);

      const result = await controller.findAll(mockRequest, query);

      expect(result).toEqual(expected);
      expect(mockApiKeysService.findAll).toHaveBeenCalledWith(tenantSlug, query);
    });
  });

  // ─── findOne ───────────────────────────────────────────

  describe('findOne', () => {
    it('should delegate to service.findOne', async () => {
      const expected = { id: 'key-1', name: 'Test Key' };
      mockApiKeysService.findOne.mockResolvedValue(expected);

      const result = await controller.findOne(mockRequest, 'key-1');

      expect(result).toEqual(expected);
      expect(mockApiKeysService.findOne).toHaveBeenCalledWith('key-1', tenantSlug);
    });
  });

  // ─── create ────────────────────────────────────────────

  describe('create', () => {
    it('should delegate to service.create', async () => {
      const dto = { partnerId: 'p1', name: 'New Key', scopes: ['*'] };
      const expected = { apiKey: { id: 'key-1' }, rawKey: 'intk_abc' };
      mockApiKeysService.create.mockResolvedValue(expected);

      const result = await controller.create(mockRequest, dto);

      expect(result).toEqual(expected);
      expect(mockApiKeysService.create).toHaveBeenCalledWith(dto, tenantSlug);
    });
  });

  // ─── update ────────────────────────────────────────────

  describe('update', () => {
    it('should delegate to service.update', async () => {
      const dto = { name: 'Updated Key' };
      const expected = { id: 'key-1', name: 'Updated Key' };
      mockApiKeysService.update.mockResolvedValue(expected);

      const result = await controller.update(mockRequest, 'key-1', dto);

      expect(result).toEqual(expected);
      expect(mockApiKeysService.update).toHaveBeenCalledWith('key-1', dto, tenantSlug);
    });
  });

  // ─── remove ────────────────────────────────────────────

  describe('remove', () => {
    it('should delegate to service.remove and return success message', async () => {
      mockApiKeysService.remove.mockResolvedValue(undefined);

      const result = await controller.remove(mockRequest, 'key-1');

      expect(result).toEqual({ message: 'API key deleted successfully' });
      expect(mockApiKeysService.remove).toHaveBeenCalledWith('key-1', tenantSlug);
    });
  });

  // ─── bulkDelete ────────────────────────────────────────

  describe('bulkDelete', () => {
    it('should delegate to service.bulkDelete and return success message', async () => {
      mockApiKeysService.bulkDelete.mockResolvedValue(undefined);

      const result = await controller.bulkDelete(mockRequest, { ids: ['id-1', 'id-2'] });

      expect(result).toEqual({ message: 'API keys deleted successfully' });
      expect(mockApiKeysService.bulkDelete).toHaveBeenCalledWith(['id-1', 'id-2'], tenantSlug);
    });
  });

  // ─── revoke ────────────────────────────────────────────

  describe('revoke', () => {
    it('should delegate to service.revoke', async () => {
      const expected = { id: 'key-1', isActive: false };
      mockApiKeysService.revoke.mockResolvedValue(expected);

      const result = await controller.revoke(mockRequest, 'key-1');

      expect(result).toEqual(expected);
      expect(mockApiKeysService.revoke).toHaveBeenCalledWith('key-1', tenantSlug);
    });
  });

  // ─── regenerate ────────────────────────────────────────

  describe('regenerate', () => {
    it('should delegate to service.regenerate', async () => {
      const expected = { apiKey: { id: 'key-2' }, rawKey: 'intk_new' };
      mockApiKeysService.regenerate.mockResolvedValue(expected);

      const result = await controller.regenerate(mockRequest, 'key-1');

      expect(result).toEqual(expected);
      expect(mockApiKeysService.regenerate).toHaveBeenCalledWith('key-1', tenantSlug);
    });
  });
});
