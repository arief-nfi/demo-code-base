import { Controller, Post, Get, Patch, Delete, Body, UnauthorizedException, UseGuards, Req, Res, UseInterceptors, UploadedFile, Logger } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UploadService } from '../uploads/upload.service';
import { JwtAuthGuard, ZodValidationPipe } from '@saas/backend';
import type { AuthenticatedRequest } from '@saas/backend';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody, ApiConsumes } from '@nestjs/swagger';
import { loginSchema, LoginDto } from './dto/login.dto';
import { changePasswordSchema, ChangePasswordDto } from './dto/change-password.dto';
import { updateProfileSchema, UpdateProfileDto } from './dto/update-profile.schema';
import { forgotPasswordSchema, ForgotPasswordDto, resetPasswordSchema, ResetPasswordDto } from './dto/password-reset.dto';
import { ContactSalesDto, contactSalesSchema } from './dto/contact-sales.dto';
import type { Request, Response } from 'express';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private authService: AuthService,
    private uploadService: UploadService,
    private configService: ConfigService,
    private jwtService: JwtService,
  ) {}

  // ─── Cookie Helpers ─────────────────────────────────────────────────────────

  private getCookieOptions(path: string, maxAgeMs: number) {
    const secureMode = this.configService.get<string>('COOKIE_SECURE', 'auto');
    const isProduction = process.env.NODE_ENV === 'production';
    const secure = secureMode === 'true'
      ? true
      : secureMode === 'false'
        ? false
        : isProduction;

    const sameSite = this.configService.get<'strict' | 'lax' | 'none'>('COOKIE_SAME_SITE', 'strict');
    // Browsers require secure=true when sameSite=none
    const effectiveSecure = sameSite === 'none' ? true : secure;
    const domain = this.configService.get<string>('COOKIE_DOMAIN');

    return {
      httpOnly: true,
      secure: effectiveSecure,
      sameSite,
      path,
      maxAge: maxAgeMs,
      ...(domain ? { domain } : {}),
    };
  }

  private get accessCookiePath(): string {
    return this.configService.get<string>('ACCESS_COOKIE_PATH', '/');
  }

  private get refreshCookiePath(): string {
    return this.configService.get<string>('REFRESH_COOKIE_PATH', '/');
  }

  /**
   * Emit clear-cookie Set-Cookie headers for a given cookie name at any legacy
   * paths the app used to set them at. Without this, a browser that still holds
   * a cookie at an old path will keep sending both copies on requests that match
   * both paths — cookie-parser picks one and the other silently shadows.
   */
  private clearLegacyCookiePaths(res: Response, name: string, currentPath: string) {
    const legacyPaths = ['/auth', '/auth/refresh'];
    for (const legacy of legacyPaths) {
      if (legacy !== currentPath) {
        res.cookie(name, '', this.getCookieOptions(legacy, 0));
      }
    }
  }

  private setTokenCookie(res: Response, token: string) {
    // Cookie maxAge matches the refresh token lifetime, NOT the access token lifetime.
    // The JWT itself enforces expiry via its `exp` claim (server rejects expired JWTs).
    // But the cookie must persist longer so the refresh endpoint can read tenantSlug
    // from the expired JWT payload to determine which tenant schema to query.
    const refreshExpiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');
    const maxAgeSeconds = this.parseExpiresIn(refreshExpiresIn);
    this.clearLegacyCookiePaths(res, 'token', this.accessCookiePath);
    res.cookie('token', token, this.getCookieOptions(this.accessCookiePath, maxAgeSeconds * 1000));
  }

  private setRefreshTokenCookie(res: Response, token: string) {
    const expiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');
    const maxAgeSeconds = this.parseExpiresIn(expiresIn);
    this.clearLegacyCookiePaths(res, 'refresh_token', this.refreshCookiePath);
    res.cookie('refresh_token', token, this.getCookieOptions(this.refreshCookiePath, maxAgeSeconds * 1000));
  }

  private clearTokenCookie(res: Response) {
    res.cookie('token', '', this.getCookieOptions(this.accessCookiePath, 0));
    this.clearLegacyCookiePaths(res, 'token', this.accessCookiePath);
  }

  private clearRefreshTokenCookie(res: Response) {
    res.cookie('refresh_token', '', this.getCookieOptions(this.refreshCookiePath, 0));
    this.clearLegacyCookiePaths(res, 'refresh_token', this.refreshCookiePath);
  }

  private clearAuthCookies(res: Response) {
    this.clearTokenCookie(res);
    this.clearRefreshTokenCookie(res);
  }

  private parseExpiresIn(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)(s|m|h|d)$/);
    if (!match) return 86400;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 3600;
      case 'd': return value * 86400;
      default: return 86400;
    }
  }

  /**
   * Extract tenantSlug from an expired access token cookie with signature verification.
   * Uses ignoreExpiration so the token must still have a valid signature.
   */
  private extractTenantSlugFromExpiredToken(req: Request): string | undefined {
    const token = req.cookies?.token;
    if (!token) return undefined;
    try {
      const payload = this.jwtService.verify<{ tenantSlug?: string }>(token, {
        ignoreExpiration: true,
      });
      return payload.tenantSlug;
    } catch {
      return undefined;
    }
  }

  /** Tenant for refresh/logout: the expired access token first, else body `tenantSlug`. */
  private resolveTenantSlug(req: Request): string | undefined {
    const bodySlug = (req.body as { tenantSlug?: unknown } | undefined)?.tenantSlug;
    return this.extractTenantSlugFromExpiredToken(req)
      || (typeof bodySlug === 'string' && bodySlug ? bodySlug : undefined);
  }

  // ─── Endpoints ──────────────────────────────────────────────────────────────

  @Post('login')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'User login' })
  @ApiResponse({ status: 200, description: 'Return JWT token' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body(new ZodValidationPipe(loginSchema)) body: LoginDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.authService.validateUser(body.identifier, body.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const result = await this.authService.login(user);

    this.setTokenCookie(res, result.access_token);
    this.setRefreshTokenCookie(res, result.refresh_token);

    return result;
  }

  @Post('refresh')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Refresh access token using refresh token cookie' })
  @ApiResponse({ status: 200, description: 'New access and refresh tokens issued' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.logger.debug(
      `Refresh called. Cookie names: [${Object.keys(req.cookies || {}).join(', ')}]. Has token: ${!!req.cookies?.token}. Has refresh_token: ${!!req.cookies?.refresh_token}. Body: ${JSON.stringify(req.body)}`,
    );
    // Every 401 clears the HttpOnly access `token` (the client can't), so the web
    // proxy stops bouncing /login back to / — otherwise an endless reload loop.
    // (passthrough: true keeps the Set-Cookie on the 401 response.)
    // refresh_token is left alone: with concurrent refreshes from two tabs, the
    // loser's 401 would otherwise wipe the cookie the winner just rotated to.
    // Non-auth errors (e.g. DB outage) clear nothing.
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken) {
      this.logger.warn('Refresh failed: no refresh_token cookie in request');
      this.clearTokenCookie(res);
      throw new UnauthorizedException('No refresh token provided');
    }

    // Get tenantSlug from the expired access token or from the request body
    const tenantSlug = this.resolveTenantSlug(req);

    if (!tenantSlug) {
      this.logger.warn('Refresh failed: no tenantSlug (neither in expired JWT nor in body)');
      this.clearTokenCookie(res);
      throw new UnauthorizedException('Unable to determine tenant');
    }

    try {
      const result = await this.authService.refreshTokens(refreshToken, tenantSlug);
      this.setTokenCookie(res, result.accessToken);
      this.setRefreshTokenCookie(res, result.refreshToken);
      this.logger.log(`Refresh OK for tenant=${tenantSlug} user=${result.user.username}`);
      return { user: result.user };
    } catch (err) {
      this.logger.warn(
        `Refresh failed for tenant=${tenantSlug} tokenPrefix=${refreshToken.slice(0, 6)}… : ${err instanceof Error ? err.message : err}`,
      );
      if (err instanceof UnauthorizedException) {
        this.clearTokenCookie(res);
      }
      throw err;
    }
  }

  @Post('logout')
  @ApiOperation({ summary: 'User logout — clears auth cookies and revokes refresh token' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // No JwtAuthGuard here (logout must work with an expired access token), so
    // req.user is never set — revoke by the refresh token cookie itself.
    const refreshToken = req.cookies?.refresh_token;
    const tenantSlug = refreshToken ? this.resolveTenantSlug(req) : undefined;
    if (refreshToken && tenantSlug) {
      try {
        await this.authService.revokeRefreshTokenByValue(refreshToken, tenantSlug);
      } catch (err) {
        // Best-effort revocation — don't block logout
        this.logger.warn(
          `Logout revocation failed for tenant=${tenantSlug}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    this.clearAuthCookies(res);
    return { message: 'Logged out successfully' };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'Return user profile' })
  async getProfile(@Req() req: AuthenticatedRequest) {
    return this.authService.getProfile(req.user.userId, req.user.tenantSlug);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('ws-token')
  @ApiOperation({ summary: 'Get a short-lived token for WebSocket authentication' })
  async getWsToken(@Req() req: AuthenticatedRequest) {
    const payload = {
      sub: req.user.userId,
      username: req.user.username,
      tenantId: req.user.tenantId,
      tenantSlug: req.user.tenantSlug,
    };
    const token = this.jwtService.sign(payload, { expiresIn: '5m' });
    return { token };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Patch('me')
  @ApiOperation({ summary: 'Update user profile' })
  @ApiResponse({ status: 200, description: 'Profile updated successfully' })
  @ApiBody({ schema: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' } } } })
  async updateProfile(@Req() req: AuthenticatedRequest, @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileDto) {
    return this.authService.updateProfile(req.user.userId, req.user.tenantSlug, body);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('me/avatar')
  @ApiOperation({ summary: 'Upload profile picture' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } }))
  async uploadAvatar(@Req() req: AuthenticatedRequest, @UploadedFile() file: Express.Multer.File) {
    const result = await this.uploadService.upload({
      file,
      category: 'avatar',
      tenantSlug: req.user.tenantSlug,
      uploadedBy: req.user.userId,
    });
    await this.authService.updateProfile(req.user.userId, req.user.tenantSlug, { avatar: result.url });
    return { avatar: result.url };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Delete('me/avatar')
  @ApiOperation({ summary: 'Remove profile picture' })
  @ApiResponse({ status: 200, description: 'Avatar removed successfully' })
  async removeAvatar(@Req() req: AuthenticatedRequest) {
    await this.authService.removeAvatar(req.user.userId, req.user.tenantSlug);
    return { message: 'Avatar removed successfully' };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('change-password')
  @ApiOperation({ summary: 'Change user password' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async changePassword(@Req() req: AuthenticatedRequest, @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordDto) {
    return this.authService.changePassword(req.user.userId, req.user.tenantSlug, body.currentPass, body.newPass);
  }

  @Post('forgot-password')
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @ApiOperation({ summary: 'Request password reset' })
  @ApiResponse({ status: 200, description: 'Password reset email sent if user exists' })
  async forgotPassword(@Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordDto) {
    return this.authService.forgotPassword(body.email, body.tenantSlug);
  }

  @Post('reset-password')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Reset password with token' })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async resetPassword(@Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordDto) {
    return this.authService.resetPassword(body.token, body.tenantSlug, body.newPassword);
  }

  @Post('contact-sales')
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @ApiOperation({ summary: 'Submit contact sales request' })
  @ApiResponse({ status: 200, description: 'Contact request sent successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  async contactSales(@Body(new ZodValidationPipe(contactSalesSchema)) body: ContactSalesDto) {
    return this.authService.contactSales(body);
  }
}
