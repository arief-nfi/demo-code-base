import { UnauthorizedException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { AuthService } from './auth.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { SystemEvents } from '@saas/backend';
import { legacyHtmlEncode } from './legacy-password';
import type { ValidatedUser } from '@saas/backend';

// Mock bcrypt
jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;
  let mockJwtService: { sign: jest.Mock };
  let mockEmail: { send: jest.Mock };
  let mockConfigService: { get: jest.Mock };
  let mockPluginEventService: { emit: jest.Mock; emitAsync: jest.Mock };

  // Mock tenant client (shared across tests)
  const mockTenantClient = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    tenantConfig: {
      findFirst: jest.fn(),
    },
    // getProfile reads the tenant row mirrored into the tenant schema
    tenant: {
      findFirst: jest.fn(),
    },
  };

  const mockPrismaService = {
    tenant: {
      findUnique: jest.fn(),
    },
    getTenantClient: jest.fn().mockReturnValue(mockTenantClient),
  };

  const mockUser = {
    id: 'user-1',
    email: 'admin@test.com',
    username: 'admin',
    name: 'Admin User',
    avatar: null,
    status: 'ACTIVE',
    password: '$2b$10$hashedpassword',
    roles: [
      {
        id: 'role-1',
        name: 'ADMIN',
        description: 'Administrator',
        permissions: [
          { id: 'perm-1', name: 'system.user.read', description: null },
          { id: 'perm-2', name: 'system.user.write', description: null },
        ],
      },
    ],
  };

  const mockTenant = {
    id: 'tenant-1',
    slug: 'acme',
    name: 'Acme Inc',
    status: 'ACTIVE',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockJwtService = { sign: jest.fn().mockReturnValue('mock-jwt-token') };
    mockEmail = { send: jest.fn().mockResolvedValue({ messageId: 'm1', status: 'QUEUED' }) };
    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        const map: Record<string, unknown> = {
          BCRYPT_SALT_ROUNDS: 10,
          PASSWORD_RESET_EXPIRES_MS: 3600000,
          FRONTEND_URL: 'http://web.test',
          SALES_EMAIL: 'sales@saas.test',
        };
        return map[key] ?? defaultValue;
      }),
    };
    mockPluginEventService = {
      emit: jest.fn(),
      emitAsync: jest.fn().mockResolvedValue(undefined),
    };

    // Direct construction — no NestJS DI needed for pure unit tests
    service = new AuthService(
      mockPrismaService as any,
      mockJwtService as any,
      mockEmail as any,
      mockConfigService as any,
      mockPluginEventService as any,
    );
  });

  describe('validateUser', () => {
    it('should throw for invalid identifier format (no @)', async () => {
      await expect(service.validateUser('adminonly', 'password'))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should throw for non-existent tenant', async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValue(null);

      await expect(service.validateUser('admin@nonexistent', 'password'))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should throw for non-existent user', async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValue(mockTenant);
      mockTenantClient.tenantConfig.findFirst.mockResolvedValue(null);
      mockTenantClient.user.findUnique.mockResolvedValue(null);

      await expect(service.validateUser('unknown@acme', 'password'))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should throw for inactive user', async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValue(mockTenant);
      mockTenantClient.tenantConfig.findFirst.mockResolvedValue(null);
      mockTenantClient.user.findUnique.mockResolvedValue({
        ...mockUser,
        status: 'INACTIVE',
      });

      await expect(service.validateUser('admin@acme', 'password'))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should return null for wrong password', async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValue(mockTenant);
      mockTenantClient.tenantConfig.findFirst.mockResolvedValue(null);
      mockTenantClient.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await service.validateUser('admin@acme', 'wrongpass');
      expect(result).toBeNull();
    });

    it('should return ValidatedUser for valid credentials', async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValue(mockTenant);
      mockTenantClient.tenantConfig.findFirst.mockResolvedValue({ description: 'Test', logo: null, theme: null, language: 'en' });
      mockTenantClient.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('admin@acme', 'correctpass');

      expect(result).toBeDefined();
      expect(result!.id).toBe('user-1');
      expect(result!.tenantSlug).toBe('acme');
      expect(result!.tenantName).toBe('Acme Inc');
      expect(result!.tenantDescription).toBe('Test');
      // Should not include password
      expect((result as any).password).toBeUndefined();
    });
  });

  // Users of an INACTIVE/PENDING tenant get 401 'Tenant is inactive' from the tenancy
  // middleware. Login and refresh must agree, or the client refreshes, retries, gets 401,
  // goes to /login, and the proxy bounces the fresh token back to / — forever.
  describe('inactive tenants', () => {
    const tenantWithStatus = (status: string) => ({ ...mockTenant, status });

    it.each(['INACTIVE', 'PENDING'])('validateUser rejects valid credentials for a %s tenant with a clear message', async (status) => {
      mockPrismaService.tenant.findUnique.mockResolvedValue(tenantWithStatus(status));
      mockTenantClient.tenantConfig.findFirst.mockResolvedValue(null);
      mockTenantClient.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.validateUser('admin@acme', 'correctpass')).rejects.toThrow(
        new UnauthorizedException('Tenant is inactive'),
      );
    });

    it('validateUser does not reveal the tenant status to a wrong password', async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValue(tenantWithStatus('INACTIVE'));
      mockTenantClient.tenantConfig.findFirst.mockResolvedValue(null);
      mockTenantClient.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.validateUser('admin@acme', 'wrongpass')).resolves.toBeNull();
    });

    it.each(['INACTIVE', 'PENDING'])('refreshTokens rejects a %s tenant without issuing or rotating tokens', async (status) => {
      mockPrismaService.tenant.findUnique.mockResolvedValue(tenantWithStatus(status));
      mockTenantClient.user.findFirst.mockResolvedValue(mockUser);

      await expect(service.refreshTokens('raw-refresh-token', 'acme')).rejects.toThrow(
        new UnauthorizedException('Tenant is inactive'),
      );
      expect(mockJwtService.sign).not.toHaveBeenCalled();
      expect(mockTenantClient.user.update).not.toHaveBeenCalled();
    });

    it.each(['ACTIVE', 'TRIAL', 'SUSPENDED'])('refreshTokens still works for a %s tenant', async (status) => {
      // SUSPENDED keeps refreshing: the middleware answers 403 and the client shows /tenant-suspended.
      mockPrismaService.tenant.findUnique.mockResolvedValue(tenantWithStatus(status));
      mockTenantClient.user.findFirst.mockResolvedValue(mockUser);
      mockTenantClient.user.update.mockResolvedValue({});
      mockTenantClient.tenantConfig.findFirst.mockResolvedValue(null);

      const result = await service.refreshTokens('raw-refresh-token', 'acme');

      expect(result.accessToken).toBe('mock-jwt-token');
      expect(mockTenantClient.user.update).toHaveBeenCalled();
    });
  });

  // Deactivating a user only flips User.status; the refresh token they already hold
  // must stop working, or their session renews itself indefinitely.
  describe('deactivated users', () => {
    it('refreshTokens rejects a deactivated user, issues nothing, and revokes their refresh token', async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValue(mockTenant);
      mockTenantClient.user.findFirst.mockResolvedValue({ ...mockUser, status: 'INACTIVE' });
      mockTenantClient.user.update.mockResolvedValue({});

      await expect(service.refreshTokens('raw-refresh-token', 'acme')).rejects.toThrow(
        new UnauthorizedException('User is inactive'),
      );
      expect(mockJwtService.sign).not.toHaveBeenCalled();
      expect(mockTenantClient.user.update).toHaveBeenCalledTimes(1);
      expect(mockTenantClient.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { refreshTokenHash: null, refreshTokenExpiresAt: null },
      });
    });

    it('refreshTokens still works for an active user', async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValue(mockTenant);
      mockTenantClient.user.findFirst.mockResolvedValue(mockUser);
      mockTenantClient.user.update.mockResolvedValue({});
      mockTenantClient.tenantConfig.findFirst.mockResolvedValue(null);

      await expect(service.refreshTokens('raw-refresh-token', 'acme')).resolves.toMatchObject({ accessToken: 'mock-jwt-token' });
    });
  });

  // Before the SanitizePipe became trim-only it HTML-encoded every body string,
  // so passwords containing & < > " ' were hashed in their encoded form.
  describe('legacy HTML-encoded password hashes', () => {
    // Fake bcrypt: hash(p) = 'hash:' + p, compare checks that relation.
    const fakeHash = (plain: string) => `hash:${plain}`;

    beforeEach(() => {
      (bcrypt.compare as jest.Mock).mockImplementation(async (plain: string, hash: string) => hash === fakeHash(plain));
      (bcrypt.hash as jest.Mock).mockImplementation(async (plain: string) => fakeHash(plain));
      mockPrismaService.tenant.findUnique.mockResolvedValue(mockTenant);
      mockTenantClient.tenantConfig.findFirst.mockResolvedValue(null);
      mockTenantClient.user.update.mockResolvedValue({});
    });

    it('validateUser accepts a legacy hash and rehashes the raw password', async () => {
      const raw = `p&ss<1>"'`;
      mockTenantClient.user.findUnique.mockResolvedValue({ ...mockUser, password: fakeHash(legacyHtmlEncode(raw)) });

      const result = await service.validateUser('admin@acme', raw);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('user-1');
      expect(bcrypt.compare).toHaveBeenNthCalledWith(1, raw, fakeHash(legacyHtmlEncode(raw)));
      expect(bcrypt.compare).toHaveBeenNthCalledWith(2, 'p&amp;ss&lt;1&gt;&quot;&#x27;', fakeHash(legacyHtmlEncode(raw)));
      expect(bcrypt.hash).toHaveBeenCalledWith(raw, 10);
      expect(mockTenantClient.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { password: fakeHash(raw) },
      });
    });

    it('validateUser still logs in when the legacy rehash write fails', async () => {
      const raw = 'p&ss';
      mockTenantClient.user.findUnique.mockResolvedValue({ ...mockUser, password: fakeHash(legacyHtmlEncode(raw)) });
      mockTenantClient.user.update.mockRejectedValue(new Error('DB down'));

      await expect(service.validateUser('admin@acme', raw)).resolves.not.toBeNull();
    });

    it('validateUser accepts a raw hash with special chars on the first compare', async () => {
      const raw = 'p&ss';
      mockTenantClient.user.findUnique.mockResolvedValue({ ...mockUser, password: fakeHash(raw) });

      const result = await service.validateUser('admin@acme', raw);

      expect(result).not.toBeNull();
      expect(bcrypt.compare).toHaveBeenCalledTimes(1);
      expect(mockTenantClient.user.update).not.toHaveBeenCalled();
    });

    it('validateUser rejects a wrong password with special chars after trying both forms', async () => {
      mockTenantClient.user.findUnique.mockResolvedValue({ ...mockUser, password: fakeHash(legacyHtmlEncode('right&pw')) });

      const result = await service.validateUser('admin@acme', 'wrong&pw');

      expect(result).toBeNull();
      expect(bcrypt.compare).toHaveBeenCalledTimes(2);
      expect(mockTenantClient.user.update).not.toHaveBeenCalled();
    });

    it('validateUser never does a second compare for a password without legacy-encodable chars', async () => {
      mockTenantClient.user.findUnique.mockResolvedValue({ ...mockUser, password: fakeHash('something-else') });

      const result = await service.validateUser('admin@acme', 'wrongpass!');

      expect(result).toBeNull();
      expect(bcrypt.compare).toHaveBeenCalledTimes(1);
    });

    it('changePassword accepts a legacy-encoded current password', async () => {
      const current = `o'ld&pw`;
      mockTenantClient.user.findUnique.mockResolvedValue({ ...mockUser, password: fakeHash(legacyHtmlEncode(current)) });

      const result = await service.changePassword('user-1', 'acme', current, 'newpass');

      expect(result.message).toBe('Password updated successfully');
      expect(mockTenantClient.user.update).toHaveBeenLastCalledWith({
        where: { id: 'user-1' },
        data: { password: fakeHash('newpass') },
      });
    });

    it('changePassword rejects a wrong current password with special chars', async () => {
      mockTenantClient.user.findUnique.mockResolvedValue({ ...mockUser, password: fakeHash(legacyHtmlEncode('right&pw')) });

      await expect(service.changePassword('user-1', 'acme', 'wrong&pw', 'newpass'))
        .rejects.toThrow(UnauthorizedException);
      expect(mockTenantClient.user.update).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('should return JWT token and user data', async () => {
      const validatedUser: ValidatedUser = {
        id: 'user-1',
        email: 'admin@test.com',
        username: 'admin',
        name: 'Admin User',
        avatar: null,
        status: 'ACTIVE',
        roles: mockUser.roles,
        tenantId: 'tenant-1',
        tenantSlug: 'acme',
        tenantName: 'Acme Inc',
      };

      const result = await service.login(validatedUser);

      expect(result.access_token).toBe('mock-jwt-token');
      expect(result.user.id).toBe('user-1');
      expect(result.user.roles).toEqual(['ADMIN']);
      expect(result.user.permissions).toEqual(['system.user.read', 'system.user.write']);
      expect(mockJwtService.sign).toHaveBeenCalledWith({
        username: 'admin',
        sub: 'user-1',
        tenantId: 'tenant-1',
        tenantSlug: 'acme',
      });
    });

    it('should deduplicate permissions across roles', async () => {
      const userWithMultipleRoles: ValidatedUser = {
        id: 'user-1',
        email: 'admin@test.com',
        username: 'admin',
        name: 'Admin',
        avatar: null,
        status: 'ACTIVE',
        roles: [
          { id: 'r1', name: 'ADMIN', description: null, permissions: [{ id: 'p1', name: 'system.user.read', description: null }] },
          { id: 'r2', name: 'EDITOR', description: null, permissions: [{ id: 'p1', name: 'system.user.read', description: null }] },
        ],
        tenantId: 'tenant-1',
        tenantSlug: 'acme',
        tenantName: 'Acme Inc',
      };

      const result = await service.login(userWithMultipleRoles);
      expect(result.user.permissions).toEqual(['system.user.read']);
    });
  });

  describe('revokeRefreshTokenByValue', () => {
    const rawToken = 'raw-refresh-token';
    const expectedHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    it('should null out the refresh token of the user whose hash matches sha256(raw)', async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValue(mockTenant);
      mockTenantClient.user.findFirst.mockResolvedValue({ id: 'user-1' });
      mockTenantClient.user.update.mockResolvedValue({});

      const result = await service.revokeRefreshTokenByValue(rawToken, 'acme');

      expect(result).toBe(true);
      expect(mockPrismaService.getTenantClient).toHaveBeenCalledWith('acme');
      expect(mockTenantClient.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { refreshTokenHash: expectedHash } }),
      );
      expect(mockTenantClient.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { refreshTokenHash: null, refreshTokenExpiresAt: null },
      });
      expect(mockPluginEventService.emit).toHaveBeenCalledWith(
        SystemEvents.USER_LOGGED_OUT,
        expect.objectContaining({ tenantSlug: 'acme', userId: 'user-1' }),
      );
    });

    it('should do nothing when no user holds that refresh token', async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValue(mockTenant);
      mockTenantClient.user.findFirst.mockResolvedValue(null);

      const result = await service.revokeRefreshTokenByValue(rawToken, 'acme');

      expect(result).toBe(false);
      expect(mockTenantClient.user.update).not.toHaveBeenCalled();
      expect(mockPluginEventService.emit).not.toHaveBeenCalled();
    });

    it('should not open a tenant client for an unknown tenant slug', async () => {
      // tenantSlug may come from the request body; getTenantClient would otherwise
      // spin up (and pool) a PrismaClient for any arbitrary schema name.
      mockPrismaService.tenant.findUnique.mockResolvedValue(null);

      const result = await service.revokeRefreshTokenByValue(rawToken, 'nonexistent');

      expect(result).toBe(false);
      expect(mockPrismaService.getTenantClient).not.toHaveBeenCalled();
      expect(mockTenantClient.user.update).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    it('should throw for non-existent user', async () => {
      mockTenantClient.user.findUnique.mockResolvedValue(null);

      await expect(service.changePassword('nonexistent', 'acme', 'old', 'new'))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should throw for wrong current password', async () => {
      mockTenantClient.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.changePassword('user-1', 'acme', 'wrongold', 'new'))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should update password successfully', async () => {
      mockTenantClient.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$10$newhash');
      mockTenantClient.user.update.mockResolvedValue({});

      const result = await service.changePassword('user-1', 'acme', 'oldpass', 'newpass');

      expect(result.message).toBe('Password updated successfully');
      expect(bcrypt.hash).toHaveBeenCalledWith('newpass', 10);
      expect(mockTenantClient.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { password: '$2b$10$newhash' },
      });
    });
  });

  describe('forgotPassword', () => {
    it('should return success message for non-existent tenant (no leak)', async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValue(null);

      const result = await service.forgotPassword('test@email.com', 'nonexistent');
      expect(result.message).toContain('If the email exists');
    });

    it('should return success message for non-existent user (no leak)', async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValue(mockTenant);
      mockTenantClient.user.findUnique.mockResolvedValue(null);

      const result = await service.forgotPassword('unknown@email.com', 'acme');
      expect(result.message).toContain('If the email exists');
    });

    it('should generate reset token and send email for valid user', async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValue(mockTenant);
      mockTenantClient.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'admin@test.com' });
      mockTenantClient.user.update.mockResolvedValue({});

      const result = await service.forgotPassword('admin@test.com', 'acme');

      expect(result.message).toContain('If the email exists');
      expect(mockTenantClient.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            resetPasswordToken: expect.any(String),
            resetPasswordExpires: expect.any(Date),
          }),
        }),
      );
      expect(mockEmail.send).toHaveBeenCalledWith({
        template: 'core.password-reset',
        tenantSlug: 'acme',
        to: 'admin@test.com',
        data: { resetUrl: expect.stringMatching(/^http:\/\/web\.test\/reset-password\?token=[0-9a-f]{64}&tenant=acme$/), expiresInMinutes: 60 },
      });
    });

    it('should throw if the email cannot be sent', async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValue(mockTenant);
      mockTenantClient.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'admin@test.com' });
      mockTenantClient.user.update.mockResolvedValue({});
      mockEmail.send.mockRejectedValue(new Error('db down'));

      await expect(service.forgotPassword('admin@test.com', 'acme'))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('contactSales', () => {
    const request = { companyName: 'Acme', contactName: 'Budi', email: 'budi@acme.test', phone: '0812', employees: '10-50', message: 'Hi' };

    it('sends core.contact-sales to SALES_EMAIL', async () => {
      const result = await service.contactSales(request as any);

      expect(result.message).toContain('submitted');
      expect(mockEmail.send).toHaveBeenCalledWith({ template: 'core.contact-sales', to: 'sales@saas.test', replyTo: 'budi@acme.test', data: request });
    });

    it('responds 503 and sends nothing without SALES_EMAIL', async () => {
      mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => (key === 'SALES_EMAIL' ? undefined : defaultValue));

      await expect(service.contactSales(request as any)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(mockEmail.send).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('should throw for non-existent tenant', async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValue(null);

      await expect(service.resetPassword('token', 'nonexistent', 'newpass'))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw for invalid/expired token', async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValue(mockTenant);
      mockTenantClient.user.findFirst.mockResolvedValue(null);

      await expect(service.resetPassword('invalid-token', 'acme', 'newpass'))
        .rejects.toThrow(BadRequestException);
    });

    it('should reset password and clear token', async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValue(mockTenant);
      mockTenantClient.user.findFirst.mockResolvedValue({ id: 'user-1' });
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$10$newhash');
      mockTenantClient.user.update.mockResolvedValue({});

      const result = await service.resetPassword('valid-token', 'acme', 'newpassword');

      expect(result.message).toContain('reset successfully');
      expect(mockTenantClient.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          password: '$2b$10$newhash',
          resetPasswordToken: null,
          resetPasswordExpires: null,
        },
      });
    });
  });

  describe('getProfile', () => {
    it('should throw for non-existent user', async () => {
      mockTenantClient.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('nonexistent', 'acme'))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should return profile without password', async () => {
      mockTenantClient.user.findUnique.mockResolvedValue({
        ...mockUser,
        roles: [{ id: 'r1', name: 'ADMIN', permissions: [
          { id: 'p1', name: 'system.user.read', description: null },
          { id: 'p2', name: 'system.user.write', description: null },
        ] }],
      });

      const result = await service.getProfile('user-1', 'acme');

      expect(result.id).toBe('user-1');
      expect(result.roles).toEqual(['ADMIN']);
      expect(result.permissions).toEqual(expect.arrayContaining(['system.user.read', 'system.user.write']));
      expect((result as any).password).toBeUndefined();
    });

    it('should deduplicate permissions across multiple roles', async () => {
      mockTenantClient.user.findUnique.mockResolvedValue({
        ...mockUser,
        roles: [
          { id: 'r1', name: 'ADMIN', permissions: [{ id: 'p1', name: 'system.user.read', description: null }] },
          { id: 'r2', name: 'EDITOR', permissions: [{ id: 'p1', name: 'system.user.read', description: null }] },
        ],
      });

      const result = await service.getProfile('user-1', 'acme');

      expect(result.permissions).toEqual(['system.user.read']);
    });
  });
});
