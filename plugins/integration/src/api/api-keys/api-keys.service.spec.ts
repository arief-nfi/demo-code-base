import { NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { ApiKeysService } from './api-keys.service';

const KEY_PREFIX = 'intk_';

function generateTestKey() {
  const rawKey = KEY_PREFIX + crypto.randomBytes(32).toString('hex');
  const keyPrefix = rawKey.substring(5, 9);
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  return { rawKey, keyPrefix, keyHash };
}

describe('ApiKeysService', () => {
  let service: ApiKeysService;

  const mockTenantClient = {
    integrationApiKey: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    integrationPartner: {
      findUnique: jest.fn(),
    },
  };

  const mockPrisma = {
    getTenantClient: jest.fn().mockReturnValue(mockTenantClient),
  };

  const tenantSlug = 'test-tenant';

  const mockPartner = {
    id: 'partner-1',
    code: 'ACME',
    name: 'Acme Corp',
    status: 'ACTIVE',
  };

  const mockApiKey = {
    id: 'key-1',
    partnerId: 'partner-1',
    name: 'Test Key',
    keyPrefix: 'abcd',
    keyHash: 'hashed-value',
    scopes: ['webhook.trigger'],
    isActive: true,
    revokedAt: null,
    expiresAt: null,
    lastUsedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    partner: { id: 'partner-1', code: 'ACME', name: 'Acme Corp' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ApiKeysService(mockPrisma as any);
  });

  // ─── findAll ───────────────────────────────────────────

  describe('findAll', () => {
    it('should return paginated data with keyHash removed', async () => {
      mockTenantClient.integrationApiKey.findMany.mockResolvedValue([mockApiKey]);
      mockTenantClient.integrationApiKey.count.mockResolvedValue(1);

      const result = await service.findAll(tenantSlug, { page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).not.toHaveProperty('keyHash');
      expect(result.data[0]).toHaveProperty('id', 'key-1');
      expect(result.meta).toEqual({ total: 1, page: 1, limit: 10, totalPages: 1 });
    });
  });

  // ─── findOne ───────────────────────────────────────────

  describe('findOne', () => {
    it('should return key without keyHash', async () => {
      mockTenantClient.integrationApiKey.findUnique.mockResolvedValue(mockApiKey);

      const result = await service.findOne('key-1', tenantSlug);

      expect(result).not.toHaveProperty('keyHash');
      expect(result).toHaveProperty('id', 'key-1');
      expect(result).toHaveProperty('partner');
    });

    it('should throw NotFoundException when key is missing', async () => {
      mockTenantClient.integrationApiKey.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing-id', tenantSlug)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── create ────────────────────────────────────────────

  describe('create', () => {
    const createDto = {
      partnerId: 'partner-1',
      name: 'New Key',
      scopes: ['webhook.trigger'],
    };

    it('should create key and return { apiKey, rawKey } where rawKey starts with intk_', async () => {
      mockTenantClient.integrationPartner.findUnique.mockResolvedValue(mockPartner);
      mockTenantClient.integrationApiKey.create.mockResolvedValue(mockApiKey);

      const result = await service.create(createDto, tenantSlug);

      expect(result).toHaveProperty('apiKey');
      expect(result).toHaveProperty('rawKey');
      expect(result.rawKey).toMatch(/^intk_[a-f0-9]{64}$/);
      expect(result.apiKey).not.toHaveProperty('keyHash');
      expect(mockTenantClient.integrationApiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            partnerId: 'partner-1',
            name: 'New Key',
            keyPrefix: expect.any(String),
            keyHash: expect.any(String),
          }),
        }),
      );
    });

    it('should throw BadRequestException when partner does not exist', async () => {
      mockTenantClient.integrationPartner.findUnique.mockResolvedValue(null);

      await expect(service.create(createDto, tenantSlug)).rejects.toThrow(BadRequestException);
      expect(mockTenantClient.integrationApiKey.create).not.toHaveBeenCalled();
    });
  });

  // ─── update ────────────────────────────────────────────

  describe('update', () => {
    const updateDto = { name: 'Updated Key' };

    it('should update key', async () => {
      mockTenantClient.integrationApiKey.findUnique.mockResolvedValue(mockApiKey);
      mockTenantClient.integrationApiKey.update.mockResolvedValue({ ...mockApiKey, name: 'Updated Key' });

      const result = await service.update('key-1', updateDto, tenantSlug);

      expect(result).toHaveProperty('name', 'Updated Key');
      expect(result).not.toHaveProperty('keyHash');
    });

    it('should throw NotFoundException when key is missing', async () => {
      mockTenantClient.integrationApiKey.findUnique.mockResolvedValue(null);

      await expect(service.update('missing-id', updateDto, tenantSlug)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── remove ────────────────────────────────────────────

  describe('remove', () => {
    it('should delete key', async () => {
      mockTenantClient.integrationApiKey.findUnique.mockResolvedValue(mockApiKey);
      mockTenantClient.integrationApiKey.delete.mockResolvedValue(mockApiKey);

      await service.remove('key-1', tenantSlug);

      expect(mockTenantClient.integrationApiKey.delete).toHaveBeenCalledWith({ where: { id: 'key-1' } });
    });

    it('should throw NotFoundException when key is missing', async () => {
      mockTenantClient.integrationApiKey.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing-id', tenantSlug)).rejects.toThrow(NotFoundException);
      expect(mockTenantClient.integrationApiKey.delete).not.toHaveBeenCalled();
    });
  });

  // ─── bulkDelete ────────────────────────────────────────

  describe('bulkDelete', () => {
    it('should delete multiple keys', async () => {
      mockTenantClient.integrationApiKey.deleteMany.mockResolvedValue({ count: 3 });

      await service.bulkDelete(['id-1', 'id-2', 'id-3'], tenantSlug);

      expect(mockTenantClient.integrationApiKey.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['id-1', 'id-2', 'id-3'] } },
      });
    });
  });

  // ─── revoke ────────────────────────────────────────────

  describe('revoke', () => {
    it('should revoke key (sets isActive=false, revokedAt)', async () => {
      mockTenantClient.integrationApiKey.findUnique.mockResolvedValue(mockApiKey);
      const revokedKey = { ...mockApiKey, isActive: false, revokedAt: new Date() };
      mockTenantClient.integrationApiKey.update.mockResolvedValue(revokedKey);

      const result = await service.revoke('key-1', tenantSlug);

      expect(result).not.toHaveProperty('keyHash');
      expect(mockTenantClient.integrationApiKey.update).toHaveBeenCalledWith({
        where: { id: 'key-1' },
        data: { isActive: false, revokedAt: expect.any(Date) },
        include: { partner: { select: { id: true, code: true, name: true } } },
      });
    });

    it('should throw NotFoundException when key is missing', async () => {
      mockTenantClient.integrationApiKey.findUnique.mockResolvedValue(null);

      await expect(service.revoke('missing-id', tenantSlug)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if already revoked', async () => {
      mockTenantClient.integrationApiKey.findUnique.mockResolvedValue({ ...mockApiKey, isActive: false });

      await expect(service.revoke('key-1', tenantSlug)).rejects.toThrow(BadRequestException);
    });
  });

  // ─── regenerate ────────────────────────────────────────

  describe('regenerate', () => {
    it('should revoke old key and create new one', async () => {
      mockTenantClient.integrationApiKey.findUnique.mockResolvedValue(mockApiKey);
      mockTenantClient.integrationApiKey.update.mockResolvedValue({ ...mockApiKey, isActive: false });
      mockTenantClient.integrationApiKey.create.mockResolvedValue({ ...mockApiKey, id: 'key-2' });

      const result = await service.regenerate('key-1', tenantSlug);

      expect(result).toHaveProperty('apiKey');
      expect(result).toHaveProperty('rawKey');
      expect(result.rawKey).toMatch(/^intk_[a-f0-9]{64}$/);
      expect(mockTenantClient.integrationApiKey.update).toHaveBeenCalledWith({
        where: { id: 'key-1' },
        data: { isActive: false, revokedAt: expect.any(Date) },
      });
      expect(mockTenantClient.integrationApiKey.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException when key is missing', async () => {
      mockTenantClient.integrationApiKey.findUnique.mockResolvedValue(null);

      await expect(service.regenerate('missing-id', tenantSlug)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── validateApiKey ────────────────────────────────────

  describe('validateApiKey', () => {
    it('should return partner context for valid key', async () => {
      const { rawKey, keyPrefix, keyHash } = generateTestKey();
      const matchedKey = {
        ...mockApiKey,
        keyPrefix,
        keyHash,
        isActive: true,
        revokedAt: null,
        expiresAt: null,
        partner: { id: 'partner-1', code: 'ACME', name: 'Acme Corp', status: 'ACTIVE' },
      };

      mockTenantClient.integrationApiKey.findMany.mockResolvedValue([matchedKey]);
      mockTenantClient.integrationApiKey.update.mockResolvedValue(matchedKey);

      const result = await service.validateApiKey(rawKey, tenantSlug);

      expect(result).toEqual({
        partnerId: 'partner-1',
        partnerCode: 'ACME',
        partnerName: 'Acme Corp',
        scopes: ['webhook.trigger'],
      });
    });

    it('should throw UnauthorizedException for invalid format (no intk_ prefix)', async () => {
      await expect(service.validateApiKey('badkey_abc123', tenantSlug)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for invalid key (hash mismatch)', async () => {
      const { rawKey, keyPrefix } = generateTestKey();
      const keyWithDifferentHash = {
        ...mockApiKey,
        keyPrefix,
        keyHash: 'completely-different-hash',
        partner: { id: 'partner-1', code: 'ACME', name: 'Acme Corp', status: 'ACTIVE' },
      };

      mockTenantClient.integrationApiKey.findMany.mockResolvedValue([keyWithDifferentHash]);

      await expect(service.validateApiKey(rawKey, tenantSlug)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for revoked key', async () => {
      const { rawKey, keyPrefix, keyHash } = generateTestKey();
      const revokedKey = {
        ...mockApiKey,
        keyPrefix,
        keyHash,
        isActive: false,
        revokedAt: new Date(),
        partner: { id: 'partner-1', code: 'ACME', name: 'Acme Corp', status: 'ACTIVE' },
      };

      mockTenantClient.integrationApiKey.findMany.mockResolvedValue([revokedKey]);

      await expect(service.validateApiKey(rawKey, tenantSlug)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for expired key', async () => {
      const { rawKey, keyPrefix, keyHash } = generateTestKey();
      const expiredKey = {
        ...mockApiKey,
        keyPrefix,
        keyHash,
        isActive: true,
        revokedAt: null,
        expiresAt: new Date('2020-01-01'),
        partner: { id: 'partner-1', code: 'ACME', name: 'Acme Corp', status: 'ACTIVE' },
      };

      mockTenantClient.integrationApiKey.findMany.mockResolvedValue([expiredKey]);

      await expect(service.validateApiKey(rawKey, tenantSlug)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for inactive partner', async () => {
      const { rawKey, keyPrefix, keyHash } = generateTestKey();
      const keyWithInactivePartner = {
        ...mockApiKey,
        keyPrefix,
        keyHash,
        isActive: true,
        revokedAt: null,
        expiresAt: null,
        partner: { id: 'partner-1', code: 'ACME', name: 'Acme Corp', status: 'INACTIVE' },
      };

      mockTenantClient.integrationApiKey.findMany.mockResolvedValue([keyWithInactivePartner]);

      await expect(service.validateApiKey(rawKey, tenantSlug)).rejects.toThrow(UnauthorizedException);
    });
  });
});
