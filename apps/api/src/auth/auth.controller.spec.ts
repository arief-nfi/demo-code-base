import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UploadService } from '../uploads/upload.service';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { GlobalExceptionFilter } from '@saas/backend';

// Mock the auth service
const mockAuthService = {
  validateUser: jest.fn(),
  login: jest.fn(),
  getProfile: jest.fn(),
  updateProfile: jest.fn(),
  changePassword: jest.fn(),
  forgotPassword: jest.fn(),
  resetPassword: jest.fn(),
  contactSales: jest.fn(),
  removeAvatar: jest.fn(),
  refreshTokens: jest.fn(),
  revokeRefreshToken: jest.fn(),
  revokeRefreshTokenByValue: jest.fn(),
};

const mockJwtService = {
  sign: jest.fn(),
  verify: jest.fn(),
};

const mockUploadService = {
  upload: jest.fn(),
};

/**
 * True when the response carries a Set-Cookie that expires `name` at the
 * current cookie path (`/`), i.e. `name=; Max-Age=0; Path=/; ...`.
 */
function expiresCookie(res: request.Response, name: string): boolean {
  return setCookies(res).some(
    (c) => c.startsWith(`${name}=;`) && /Max-Age=0(;|$)/.test(c) && /Path=\/(;|$)/.test(c),
  );
}

/** True when the response sets `name` at all (any path, any value). */
function touchesCookie(res: request.Response, name: string): boolean {
  return setCookies(res).some((c) => c.startsWith(`${name}=`));
}

function setCookies(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
}

describe('AuthController (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 100 }] }),
      ],
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: UploadService, useValue: mockUploadService },
        { provide: JwtService, useValue: mockJwtService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string, defaultValue?: any) => {
            if (key === 'JWT_EXPIRES_IN') return '24h';
            return defaultValue;
          }) },
        },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true }) // Skip throttling in tests
      .compile();

    app = module.createNestApplication();
    app.use(cookieParser());
    // Same filter as production (APP_FILTER) so error responses are shaped identically
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /auth/login', () => {
    it('should return 201 with JWT and set cookies on valid credentials', async () => {
      const mockUser = { id: 'user-1', username: 'admin', roles: [], tenantSlug: 'acme' };
      mockAuthService.validateUser.mockResolvedValue(mockUser);
      mockAuthService.login.mockResolvedValue({
        access_token: 'jwt-token',
        refresh_token: 'refresh-token',
        user: { id: 'user-1', username: 'admin' },
      });

      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: 'admin@acme', password: 'password123' })
        .expect(201); // NestJS POST returns 201 by default

      expect(res.body.access_token).toBe('jwt-token');
      expect(mockAuthService.validateUser).toHaveBeenCalledWith('admin@acme', 'password123');

      // Verify cookies are set
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : cookies;
      expect(cookieStr).toContain('token=');
      expect(cookieStr).toContain('refresh_token=');
      expect(cookieStr).toContain('HttpOnly');
    });

    it('should return 401 for invalid credentials', async () => {
      mockAuthService.validateUser.mockResolvedValue(null);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: 'admin@acme', password: 'wrong' })
        .expect(401);
    });

    it('should return 400 for missing identifier', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ password: 'password123' })
        .expect(400);
    });

    it('should return 400 for missing password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: 'admin@acme' })
        .expect(400);
    });
  });

  describe('POST /auth/forgot-password', () => {
    it('should return 201 with success message', async () => {
      mockAuthService.forgotPassword.mockResolvedValue({
        message: 'If the email exists in our system, you will receive a password reset link shortly.',
      });

      const res = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'test@example.com', tenantSlug: 'acme' })
        .expect(201);

      expect(res.body.message).toContain('If the email exists');
    });

    it('should return 400 for invalid email format', async () => {
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'not-an-email', tenantSlug: 'acme' })
        .expect(400);
    });
  });

  describe('POST /auth/reset-password', () => {
    it('should return 201 on successful reset', async () => {
      mockAuthService.resetPassword.mockResolvedValue({
        message: 'Password has been reset successfully.',
      });

      const res = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: 'valid-token', tenantSlug: 'acme', newPassword: 'newPass123!' })
        .expect(201);

      expect(res.body.message).toContain('reset successfully');
    });

    it('should return 400 for short password', async () => {
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: 'valid-token', tenantSlug: 'acme', newPassword: '123' })
        .expect(400);
    });
  });

  describe('POST /auth/refresh', () => {
    it('should return 401 when no refresh token cookie', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .expect(401);
    });

    // A 401 refresh clears the HttpOnly access `token` (JS can't), so the web proxy
    // stops bouncing /login back to / (reload loop). It must NOT touch
    // refresh_token: with concurrent tabs, the losing tab's 401 would otherwise
    // wipe the R2 cookie the winning tab just rotated to → logged out everywhere.
    it('should clear only the access token cookie on 401 when no refresh token cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', ['token=stale.jwt.token'])
        .expect(401);

      expect(expiresCookie(res, 'token')).toBe(true);
      expect(touchesCookie(res, 'refresh_token')).toBe(false);
    });

    it('should clear only the access token cookie on 401 when tenant cannot be determined', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', ['refresh_token=some-refresh-token'])
        .send({})
        .expect(401);

      expect(mockAuthService.refreshTokens).not.toHaveBeenCalled();
      expect(expiresCookie(res, 'token')).toBe(true);
      expect(touchesCookie(res, 'refresh_token')).toBe(false);
    });

    it('should clear only the access token cookie on 401 when the refresh token is rejected', async () => {
      mockJwtService.verify.mockReturnValue({ tenantSlug: 'acme' });
      mockAuthService.refreshTokens.mockRejectedValue(
        new UnauthorizedException('Invalid or expired refresh token'),
      );

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', ['refresh_token=revoked-refresh-token', 'token=expired.jwt.token'])
        .expect(401);

      expect(res.body.message).toBe('Invalid or expired refresh token');
      expect(mockAuthService.refreshTokens).toHaveBeenCalledWith('revoked-refresh-token', 'acme');
      expect(expiresCookie(res, 'token')).toBe(true);
      expect(touchesCookie(res, 'refresh_token')).toBe(false);
    });

    it('should clear no cookies when refresh fails with a non-auth error', async () => {
      // e.g. DB/Prisma outage — must not log the user out
      mockJwtService.verify.mockReturnValue({ tenantSlug: 'acme' });
      mockAuthService.refreshTokens.mockRejectedValue(new Error('Connection refused'));

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', ['refresh_token=good-refresh-token', 'token=expired.jwt.token'])
        .expect(500);

      expect(touchesCookie(res, 'token')).toBe(false);
      expect(touchesCookie(res, 'refresh_token')).toBe(false);
    });

    it('should refresh tokens when valid refresh_token cookie is present', async () => {
      // Mock jwtService.verify to return the tenant slug from the expired token
      mockJwtService.verify.mockReturnValue({ tenantSlug: 'acme' });

      mockAuthService.refreshTokens.mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        user: { id: 'user-1', username: 'admin' },
      });

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', [`refresh_token=old-refresh-token; Path=/auth/refresh`, `token=expired.jwt.token`])
        .expect(201);

      expect(res.body.user).toBeDefined();
      expect(mockJwtService.verify).toHaveBeenCalledWith('expired.jwt.token', { ignoreExpiration: true });
      expect(mockAuthService.refreshTokens).toHaveBeenCalledWith('old-refresh-token', 'acme');

      // Verify new cookies are set
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : cookies;
      expect(cookieStr).toContain('token=');
      expect(cookieStr).toContain('refresh_token=');
    });
  });

  describe('POST /auth/logout', () => {
    it('should clear cookies and return success', async () => {
      mockAuthService.revokeRefreshToken.mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .post('/auth/logout')
        .expect(201);

      expect(res.body.message).toBe('Logged out successfully');

      // Verify cookies are cleared (maxAge=0)
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
    });

    // Logout has no JwtAuthGuard (it must work with an expired access token), so
    // revocation is keyed off the refresh_token cookie itself.
    it('should revoke the refresh token from the cookie using the tenant in the expired JWT', async () => {
      mockJwtService.verify.mockReturnValue({ tenantSlug: 'acme' });
      mockAuthService.revokeRefreshTokenByValue.mockResolvedValue(true);

      const res = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', ['refresh_token=raw-refresh-token', 'token=expired.jwt.token'])
        .expect(201);

      expect(mockJwtService.verify).toHaveBeenCalledWith('expired.jwt.token', { ignoreExpiration: true });
      expect(mockAuthService.revokeRefreshTokenByValue).toHaveBeenCalledWith('raw-refresh-token', 'acme');
      expect(expiresCookie(res, 'token')).toBe(true);
      expect(expiresCookie(res, 'refresh_token')).toBe(true);
    });

    it('should fall back to body tenantSlug when there is no access token cookie', async () => {
      mockAuthService.revokeRefreshTokenByValue.mockResolvedValue(true);

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', ['refresh_token=raw-refresh-token'])
        .send({ tenantSlug: 'acme' })
        .expect(201);

      expect(mockAuthService.revokeRefreshTokenByValue).toHaveBeenCalledWith('raw-refresh-token', 'acme');
    });

    it('should not attempt revocation without a refresh_token cookie', async () => {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ tenantSlug: 'acme' })
        .expect(201);

      expect(mockAuthService.revokeRefreshTokenByValue).not.toHaveBeenCalled();
    });

    it('should still log out and clear cookies when revocation fails', async () => {
      mockJwtService.verify.mockReturnValue({ tenantSlug: 'acme' });
      mockAuthService.revokeRefreshTokenByValue.mockRejectedValue(new Error('DB down'));

      const res = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', ['refresh_token=raw-refresh-token', 'token=expired.jwt.token'])
        .expect(201);

      expect(res.body.message).toBe('Logged out successfully');
      expect(expiresCookie(res, 'token')).toBe(true);
      expect(expiresCookie(res, 'refresh_token')).toBe(true);
    });
  });
});
