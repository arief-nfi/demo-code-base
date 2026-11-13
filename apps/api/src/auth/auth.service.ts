import { Inject, Injectable, UnauthorizedException, BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EMAIL_SERVICE, PrismaService, PluginEventService, SystemEvents, isTenantInactive } from '@saas/backend';
import type { IEmailService, ValidatedUser } from '@saas/backend';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { legacyHtmlEncode, hasLegacyEncodableChars } from './legacy-password';
import { ContactSalesDto } from './dto/contact-sales.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    @Inject(EMAIL_SERVICE) private email: IEmailService,
    private configService: ConfigService,
    private pluginEventService: PluginEventService,
  ) {}

  async validateUser(identifier: string, pass: string): Promise<ValidatedUser | null> {
    // Identifier format: username@tenant_slug
    const parts = identifier.split('@');
    if (parts.length !== 2) {
      throw new UnauthorizedException('Invalid identifier format. Use username@tenant_slug');
    }

    const [username, tenantSlug] = parts;

    // 1. Find Tenant
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
    });

    if (!tenant) {
      throw new UnauthorizedException('Tenant not found');
    }

    // 2. Get Tenant Client
    const tenantClient = await this.prisma.getTenantClient(tenant.slug);

    const tenantConfig = await tenantClient.tenantConfig.findFirst();

    // 3. Find User in Tenant Schema
    // Note: We added 'username' field to User model.
    const user = await tenantClient.user.findUnique({
      where: { username },
      include: {
        roles: {
          include: {
            permissions: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User is inactive');
    }

    // 4. Validate Password
    const isMatch = await this.matchPassword(pass, user.password);
    if (isMatch === 'legacy') {
      await this.upgradeLegacyPasswordHash(user.id, tenant.slug, pass);
    }
    if (isMatch) {
      // Checked only after the password, so the tenant's status isn't revealed to guessers.
      if (isTenantInactive(tenant.status)) {
        throw new UnauthorizedException('Tenant is inactive');
      }
      const { password, ...result } = user;
      return { 
        ...result, 
        tenantId: tenant.id, 
        tenantSlug: tenant.slug,
        tenantName: tenant.name,
        tenantDescription: tenantConfig?.description,
        tenantLogo: tenantConfig?.logo,
        tenantIcon: tenantConfig?.icon,
        tenantTheme: tenantConfig?.theme,
        tenantLanguage: tenantConfig?.language,
        tenantPrimaryColor: tenantConfig?.primaryColor,
        tenantAccentColor: tenantConfig?.accentColor,
        tenantSidebarBackground: tenantConfig?.sidebarBackground,
        tenantSidebarForeground: tenantConfig?.sidebarForeground,
        onboardingCompleted: tenant.onboardingCompleted,
      };
    }
    return null;
  }

  async login(user: ValidatedUser) {
    const payload = { username: user.username, sub: user.id, tenantId: user.tenantId, tenantSlug: user.tenantSlug };

    // Extract roles and permissions
    const roles = user.roles.map(r => r.name);
    const permissions = new Set<string>();
    user.roles.forEach(role => {
      role.permissions.forEach(perm => {
        permissions.add(perm.name);
      });
    });

    // Generate refresh token
    const refreshToken = await this.generateRefreshToken(user.id, user.tenantSlug);

    this.pluginEventService.emit(SystemEvents.USER_LOGGED_IN, {
      tenantSlug: user.tenantSlug,
      userId: user.id,
      username: user.username,
      timestamp: new Date(),
    });

    return {
      access_token: this.jwtService.sign(payload),
      refresh_token: refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        tenantId: user.tenantId,
        tenantSlug: user.tenantSlug,
        tenantName: user.tenantName,
        tenantDescription: user.tenantDescription,
        tenantLogo: user.tenantLogo,
        tenantIcon: user.tenantIcon,
        tenantTheme: user.tenantTheme,
        tenantLanguage: user.tenantLanguage,
        tenantPrimaryColor: user.tenantPrimaryColor,
        tenantAccentColor: user.tenantAccentColor,
        tenantSidebarBackground: user.tenantSidebarBackground,
        tenantSidebarForeground: user.tenantSidebarForeground,
        onboardingCompleted: user.onboardingCompleted ?? true,
        roles: roles,
        permissions: Array.from(permissions),
      },
    };
  }

  /**
   * Generate a random refresh token, store its hash in the DB, and return the raw token.
   */
  async generateRefreshToken(userId: string, tenantSlug: string): Promise<string> {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const refreshExpiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');
    const expiresMs = this.parseExpiresInMs(refreshExpiresIn);
    const expiresAt = new Date(Date.now() + expiresMs);

    const tenantClient = this.prisma.getTenantClient(tenantSlug);
    await tenantClient.user.update({
      where: { id: userId },
      data: {
        refreshTokenHash: hash,
        refreshTokenExpiresAt: expiresAt,
      },
    });

    return rawToken;
  }

  /**
   * Validate a refresh token, rotate it, and return new access + refresh tokens.
   */
  async refreshTokens(rawToken: string, tenantSlug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
    });
    if (!tenant) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    // The tenancy middleware rejects every request for these tenants with 401; issuing
    // fresh tokens here would loop the client between /login and / forever.
    if (isTenantInactive(tenant.status)) {
      throw new UnauthorizedException('Tenant is inactive');
    }

    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const tenantClient = this.prisma.getTenantClient(tenantSlug);

    // Find user with matching, non-expired refresh token hash
    const user = await tenantClient.user.findFirst({
      where: {
        refreshTokenHash: hash,
        refreshTokenExpiresAt: { gt: new Date() },
      },
      include: {
        roles: { include: { permissions: true } },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Deactivation only flips User.status, so end the session here: refuse, and revoke
    // the token so reactivating the user later doesn't silently resume this session.
    if (user.status !== 'ACTIVE') {
      await tenantClient.user.update({
        where: { id: user.id },
        data: { refreshTokenHash: null, refreshTokenExpiresAt: null },
      });
      throw new UnauthorizedException('User is inactive');
    }

    // Issue new access token
    const payload = { username: user.username, sub: user.id, tenantId: tenant.id, tenantSlug: tenant.slug };
    const accessToken = this.jwtService.sign(payload);

    // Rotate refresh token
    const newRefreshToken = await this.generateRefreshToken(user.id, tenantSlug);

    // Build user info for frontend
    const roles = user.roles.map(r => r.name);
    const permissions = new Set<string>();
    user.roles.forEach(role => {
      role.permissions.forEach(perm => {
        permissions.add(perm.name);
      });
    });

    // Fetch tenant config for branding fields
    const tenantConfig = await tenantClient.tenantConfig.findFirst();

    this.pluginEventService.emit(SystemEvents.TOKEN_REFRESHED, {
      tenantSlug: tenant.slug,
      userId: user.id,
      username: user.username,
      timestamp: new Date(),
    });

    return {
      accessToken,
      refreshToken: newRefreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenantName: tenant.name,
        tenantDescription: tenantConfig?.description,
        tenantLogo: tenantConfig?.logo,
        tenantIcon: tenantConfig?.icon,
        tenantTheme: tenantConfig?.theme,
        tenantLanguage: tenantConfig?.language,
        tenantPrimaryColor: tenantConfig?.primaryColor,
        tenantAccentColor: tenantConfig?.accentColor,
        tenantSidebarBackground: tenantConfig?.sidebarBackground,
        tenantSidebarForeground: tenantConfig?.sidebarForeground,
        roles,
        permissions: Array.from(permissions),
      },
    };
  }

  /**
   * Revoke the refresh token for a user (used on logout).
   */
  async revokeRefreshToken(userId: string, tenantSlug: string): Promise<void> {
    const tenantClient = this.prisma.getTenantClient(tenantSlug);
    await tenantClient.user.update({
      where: { id: userId },
      data: {
        refreshTokenHash: null,
        refreshTokenExpiresAt: null,
      },
    });

    this.pluginEventService.emit(SystemEvents.USER_LOGGED_OUT, {
      tenantSlug,
      userId,
      timestamp: new Date(),
    });
  }

  /**
   * Revoke a refresh token by its raw value (used on logout, which has no
   * authenticated user). Returns false when no user in the tenant holds it.
   */
  async revokeRefreshTokenByValue(rawToken: string, tenantSlug: string): Promise<boolean> {
    // tenantSlug may come from the request body — never open a tenant client for
    // a schema that doesn't exist (getTenantClient creates and pools one per slug).
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
    });
    if (!tenant) {
      return false;
    }

    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const tenantClient = this.prisma.getTenantClient(tenantSlug);
    const user = await tenantClient.user.findFirst({
      where: { refreshTokenHash: hash },
      select: { id: true },
    });
    if (!user) {
      return false;
    }

    await this.revokeRefreshToken(user.id, tenantSlug);
    return true;
  }

  /**
   * bcrypt-compare a submitted password with a stored hash. Only when that fails
   * and the password contains a character the old SanitizePipe HTML-encoded, try
   * the legacy encoded form too (see legacy-password.ts).
   */
  private async matchPassword(plain: string, hash: string): Promise<'raw' | 'legacy' | null> {
    if (await bcrypt.compare(plain, hash)) return 'raw';
    if (hasLegacyEncodableChars(plain) && await bcrypt.compare(legacyHtmlEncode(plain), hash)) {
      return 'legacy';
    }
    return null;
  }

  /**
   * Replace a legacy (HTML-encoded) hash with a hash of the raw password so the
   * fallback is needed only once. Best-effort — never fail the login over it.
   */
  private async upgradeLegacyPasswordHash(userId: string, tenantSlug: string, plain: string): Promise<void> {
    try {
      const tenantClient = this.prisma.getTenantClient(tenantSlug);
      await tenantClient.user.update({
        where: { id: userId },
        data: { password: await this.hashPassword(plain) },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to upgrade legacy password hash for user=${userId} tenant=${tenantSlug}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private hashPassword(plain: string): Promise<string> {
    const saltRounds = this.configService.get<number>('BCRYPT_SALT_ROUNDS', 10);
    return bcrypt.hash(plain, saltRounds);
  }

  /**
   * Parse a duration string (e.g. '15m', '7d', '24h') to milliseconds.
   */
  private parseExpiresInMs(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)(s|m|h|d)$/);
    if (!match) return 86400000; // default 24h
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 3600 * 1000;
      case 'd': return value * 86400 * 1000;
      default: return 86400000;
    }
  }

  async getProfile(userId: string, tenantSlug: string) {
    const tenantClient = await this.prisma.getTenantClient(tenantSlug);
    const user = await tenantClient.user.findUnique({
      where: { id: userId },
      include: {
        roles: {
          include: { permissions: true },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const { password, ...result } = user;

    const permissions = new Set<string>();
    user.roles.forEach(role => {
      role.permissions.forEach(perm => {
        permissions.add(perm.name);
      });
    });

    // Include tenant onboarding status
    const tenant = await tenantClient.tenant.findFirst();

    return {
      ...result,
      roles: user.roles.map(r => r.name),
      permissions: Array.from(permissions),
      onboardingCompleted: tenant?.onboardingCompleted ?? true,
    };
  }

  async updateProfile(userId: string, tenantSlug: string, data: { name?: string; email?: string; avatar?: string | null }) {
    const tenantClient = await this.prisma.getTenantClient(tenantSlug);

    // Verify user exists first
    const existingUserById = await tenantClient.user.findUnique({
      where: { id: userId },
    });

    if (!existingUserById) {
      throw new UnauthorizedException('User not found');
    }

    if (data.email) {
      const existingUser = await tenantClient.user.findUnique({
        where: { email: data.email },
      });
      if (existingUser && existingUser.id !== userId) {
        throw new BadRequestException('Email already in use');
      }
    }

    const user = await tenantClient.user.update({
      where: { id: userId },
      data,
    });

    const { password, ...result } = user;
    return result;
  }

  async removeAvatar(userId: string, tenantSlug: string) {
    const tenantClient = await this.prisma.getTenantClient(tenantSlug);
    const user = await tenantClient.user.findUnique({ where: { id: userId } });

    if (user && user.avatar) {
      // Remove leading slash to make it relative
      const relativePath = user.avatar.startsWith('/') ? user.avatar.substring(1) : user.avatar;
      // Assuming uploads folder is in the root of the running process (apps/api)
      const filePathToDelete = path.join(process.cwd(), relativePath);

      try {
        if (fs.existsSync(filePathToDelete)) {
          fs.unlinkSync(filePathToDelete);
        }
      } catch (err) {
        this.logger.warn(`Failed to delete avatar file at ${filePathToDelete}: ${err}`);
      }
    }

    return this.updateProfile(userId, tenantSlug, { avatar: null });
  }

  async changePassword(userId: string, tenantSlug: string, currentPass: string, newPass: string) {
    // 1. Get Tenant Client
    const tenantClient = await this.prisma.getTenantClient(tenantSlug);

    // 2. Find User
    const user = await tenantClient.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // 3. Verify current password (a legacy hash is replaced by step 5 anyway)
    const isMatch = await this.matchPassword(currentPass, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid current password');
    }

    // 4. Hash new password
    const hashedPassword = await this.hashPassword(newPass);

    // 5. Update password
    await tenantClient.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return { message: 'Password updated successfully' };
  }

  async forgotPassword(email: string, tenantSlug: string) {
    // 1. Find Tenant
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
    });

    if (!tenant) {
      // Don't reveal if tenant exists or not for security
      return { message: 'If the email exists in our system, you will receive a password reset link shortly.' };
    }

    // 2. Get Tenant Client
    const tenantClient = await this.prisma.getTenantClient(tenant.slug);

    // 3. Find User by email
    const user = await tenantClient.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Don't reveal if user exists or not for security
      return { message: 'If the email exists in our system, you will receive a password reset link shortly.' };
    }

    // 4. Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    // 5. Set expiry
    const resetExpiresMs = this.configService.get<number>('PASSWORD_RESET_EXPIRES_MS', 3600000);
    const resetPasswordExpires = new Date(Date.now() + resetExpiresMs);

    // 6. Save hashed token to database
    await tenantClient.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: hashedToken,
        resetPasswordExpires,
      },
    });

    // 7. Send email with original token (not hashed); the email log shows it as [hidden]
    try {
      const frontendUrl = this.configService.get<string>('FRONTEND_URL');
      const resetUrl = `${frontendUrl}/reset-password?${new URLSearchParams({ token: resetToken, tenant: tenant.slug })}`;
      await this.email.send({
        template: 'core.password-reset',
        tenantSlug: tenant.slug,
        to: user.email,
        data: { resetUrl, expiresInMinutes: Math.round(resetExpiresMs / 60_000) },
      });
    } catch (error) {
      this.logger.error('Failed to send password reset email', error instanceof Error ? error.stack : error);
      throw new BadRequestException('Failed to send password reset email. Please try again later.');
    }

    return { message: 'If the email exists in our system, you will receive a password reset link shortly.' };
  }

  async resetPassword(token: string, tenantSlug: string, newPassword: string) {
    // 1. Find Tenant
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
    });

    if (!tenant) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // 2. Hash the provided token to compare with database
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    // 3. Get Tenant Client
    const tenantClient = await this.prisma.getTenantClient(tenant.slug);

    // 4. Find user with valid token
    const user = await tenantClient.user.findFirst({
      where: {
        resetPasswordToken: hashedToken,
        resetPasswordExpires: {
          gt: new Date(), // Token must not be expired
        },
      },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // 5. Hash new password
    const hashedPassword = await this.hashPassword(newPassword);

    // 6. Update password and clear reset token
    await tenantClient.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    });

    return { message: 'Password has been reset successfully. You can now login with your new password.' };
  }

  async contactSales(data: ContactSalesDto) {
    const salesEmail = this.configService.get<string>('SALES_EMAIL');
    if (!salesEmail) {
      this.logger.error('SALES_EMAIL is not set: Contact Sales requests cannot be delivered');
      throw new ServiceUnavailableException('The contact form is not available right now. Please try again later.');
    }
    await this.email.send({ template: 'core.contact-sales', to: salesEmail, replyTo: data.email, data });
    return { message: 'Your request has been submitted successfully. Our sales team will contact you soon.' };
  }
}
