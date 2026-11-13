import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { seedAdminPassword } from './config/env.config';
import { TenantsService } from './tenants/tenants.service';
import { PrismaService } from '@saas/backend';

const logger = new Logger('Seed');

async function bootstrap() {
  const args = process.argv.slice(2);
  logger.log(`Starting seed with args: ${args.join(' ')}`);
  const isReset = args.includes('--reset');
  const withSampleData = args.includes('--with-sample-data');

  if (isReset && process.env.NODE_ENV === 'production') {
    logger.error('Cannot use --reset in production');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const tenantsService = app.get(TenantsService);
  const prisma = app.get(PrismaService);

  try {
    if (isReset) {
      logger.warn('Reset mode: deleting existing system tenant...');
      const existing = await prisma.tenant.findUnique({ where: { slug: 'system' } });
      if (existing) {
        // Deactivate first (required for deletion)
        await prisma.tenant.update({ where: { id: existing.id }, data: { status: 'INACTIVE' } });
        try {
          await tenantsService.delete(existing.id);
          logger.log('Deleted existing system tenant');
        } catch {
          logger.warn('Could not delete tenant schema, continuing...');
          await prisma.tenant.delete({ where: { id: existing.id } });
        }
      }
    }

    // Check if system tenant already exists (idempotent)
    const existing = await prisma.tenant.findUnique({ where: { slug: 'system' } });
    if (existing) {
      logger.log('System tenant already exists, skipping creation');
    } else {
      logger.log('Creating system tenant...');
      const adminPassword = seedAdminPassword(app.get(ConfigService).getOrThrow<string>('DEFAULT_ADMIN_PASSWORD'), process.env.NODE_ENV);
      const tenant = await tenantsService.create({ name: 'System', slug: 'system', adminUsername: 'admin' }, adminPassword);
      logger.log(`Created system tenant: sign in as admin@${tenant.slug} with the password in DEFAULT_ADMIN_PASSWORD`);
    }

    if (withSampleData) {
      await seedSampleData(prisma);
    }

    logger.log('Seed completed successfully');
  } catch (error) {
    logger.error('Failed to seed', error instanceof Error ? error.stack : String(error));
    process.exit(1);
  } finally {
    await app.close();
  }
}

async function seedSampleData(prisma: PrismaService) {
  logger.log('Seeding sample data...');
  const tenantClient = prisma.getTenantClient('system');

  // Create sample users if they don't exist
  const sampleUsers = [
    { email: 'user@system.com', username: 'user', name: 'Sample User' },
    { email: 'manager@system.com', username: 'manager', name: 'Sample Manager' },
  ];

  for (const userData of sampleUsers) {
    const exists = await tenantClient.user.findUnique({ where: { email: userData.email } });
    if (!exists) {
      // Use a hashed placeholder password (user must reset via forgot-password flow)
      const bcrypt = await import('bcrypt');
      const hashedPassword = await bcrypt.hash('ChangeMe123!', 10);
      const userRole = await tenantClient.role.findUnique({ where: { name: 'USER' } });
      await tenantClient.user.create({
        data: {
          ...userData,
          password: hashedPassword,
          ...(userRole ? { roles: { connect: { id: userRole.id } } } : {}),
        },
      });
      logger.log(`Created sample user: ${userData.email}`);
    } else {
      logger.log(`Sample user ${userData.email} already exists, skipping`);
    }
  }

  logger.log('Sample data seeded');
}

bootstrap();
