#!/usr/bin/env node

/**
 * Migrate All Tenant Schemas
 *
 * Applies pending Prisma migrations to every tenant schema except TERMINATED
 * ones. TRIAL tenants are in use and SUSPENDED/INACTIVE/PENDING tenants can be
 * (re)activated, so their schemas must stay in step with the migrations too.
 * Run after generating a new migration with `pnpm db:migrate:dev`.
 *
 * Usage:
 *   pnpm db:migrate:tenants              # Apply migrations to all non-terminated tenants
 *   pnpm db:migrate:tenants --dry-run    # Preview which tenants would be migrated
 *   pnpm db:migrate:tenants --verbose    # Show detailed output per tenant
 */

const { execSync } = require('child_process');
const path = require('path');

// Load .env from project root
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set. Please configure your .env file.');
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose');
const schemaPath = path.resolve(__dirname, '..', 'packages', 'database', 'prisma', 'schema.prisma');
// Use the Prisma CLI from packages/database to match the schema's Prisma version
const prismaBin = path.resolve(__dirname, '..', 'packages', 'database', 'node_modules', '.bin', 'prisma');

async function main() {
  // Use a temporary PrismaClient to query tenants from the public schema
  const { PrismaClient } = require('../packages/database/generated/client');
  const prisma = new PrismaClient({
    datasources: { db: { url: DATABASE_URL } },
  });

  try {
    const tenants = await prisma.tenant.findMany({
      where: { status: { not: 'TERMINATED' } },
      select: { id: true, slug: true, name: true, status: true },
      orderBy: { slug: 'asc' },
    });

    console.log(`\nFound ${tenants.length} non-terminated tenant(s).\n`);

    if (tenants.length === 0) {
      console.log('Nothing to do.');
      return;
    }

    if (dryRun) {
      console.log('[DRY RUN] Would migrate the following tenant schemas:\n');
      for (const tenant of tenants) {
        const schemaName = `tenant_${tenant.slug.replace(/-/g, '_')}`;
        console.log(`  - ${schemaName} (${tenant.name}) [${tenant.status}]`);
      }
      console.log('\nRe-run without --dry-run to apply migrations.');
      return;
    }

    const results = { success: 0, failed: 0, errors: [] };

    for (const tenant of tenants) {
      const schemaName = `tenant_${tenant.slug.replace(/-/g, '_')}`;
      const url = new URL(DATABASE_URL);
      url.searchParams.set('schema', schemaName);
      const tenantUrl = url.toString();

      process.stdout.write(`Migrating ${schemaName} (${tenant.name})... `);

      const envOpts = { encoding: 'utf-8', timeout: 60_000, stdio: verbose ? 'inherit' : 'pipe', env: { ...process.env, DATABASE_URL: tenantUrl } };
      try {
        const output = execSync(
          `"${prismaBin}" migrate deploy --schema "${schemaPath}"`,
          envOpts,
        );

        if (verbose && output) {
          console.log(output.trim());
        }

        console.log('OK');
        results.success++;
      } catch (error) {
        // Fallback to db push if migrate deploy fails (e.g., no migrations directory)
        try {
          execSync(
            `"${prismaBin}" db push --schema "${schemaPath}" --skip-generate`,
            envOpts,
          );
          console.log('OK (via db push)');
          results.success++;
        } catch (pushError) {
          const msg = pushError instanceof Error ? pushError.message : String(pushError);
          console.log('FAILED');
          results.failed++;
          results.errors.push({ slug: tenant.slug, name: tenant.name, error: msg });
        }
      }
    }

    console.log(`\n--- Summary ---`);
    console.log(`  Success: ${results.success}`);
    console.log(`  Failed:  ${results.failed}`);

    if (results.errors.length > 0) {
      console.log(`\nFailed tenants:`);
      for (const err of results.errors) {
        console.log(`  - ${err.slug} (${err.name}): ${err.error.split('\n')[0]}`);
      }
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
