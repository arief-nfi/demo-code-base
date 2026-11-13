import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PrismaService, CacheService, PluginMetricsService } from '@saas/backend';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly pluginMetrics: PluginMetricsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  async check() {
    const checks: Record<string, unknown> = {};

    // Database check
    const dbStart = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = { status: 'ok', responseTime: Date.now() - dbStart };
    } catch {
      checks.database = { status: 'error', responseTime: Date.now() - dbStart };
    }

    // Memory check
    const mem = process.memoryUsage();
    const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    const heapPercent = Math.round((mem.heapUsed / mem.heapTotal) * 100);

    checks.memory = {
      status: heapPercent > 80 ? 'warn' : 'ok',
      heapUsed: `${heapUsedMB}MB`,
      heapTotal: `${heapTotalMB}MB`,
      rss: `${rssMB}MB`,
    };

    // Tenant connections & cache
    checks.tenants = {
      status: 'ok',
      activeClients: this.prisma.getActiveTenantCount(),
    };

    const cacheStats = this.cache.getStats();
    checks.cache = {
      status: cacheStats.connected === false ? 'warn' : 'ok',
      ...cacheStats,
    };

    // Plugin metrics summary
    const allMetrics = this.pluginMetrics.getAll();
    const pluginKeys = Object.keys(allMetrics);
    const pluginsSummary: Record<string, unknown> = {};

    for (const pluginKey of pluginKeys) {
      const ops = allMetrics[pluginKey];
      let totalCount = 0;
      let totalErrors = 0;
      let maxP95 = 0;

      for (const summary of Object.values(ops)) {
        totalCount += summary.count;
        totalErrors += summary.errorCount;
        if (summary.p95DurationMs > maxP95) maxP95 = summary.p95DurationMs;
      }

      pluginsSummary[pluginKey] = {
        totalRequests: totalCount,
        totalErrors,
        errorRate: totalCount > 0 ? Number((totalErrors / totalCount).toFixed(4)) : 0,
        maxP95DurationMs: maxP95,
      };
    }

    checks.plugins = {
      status: 'ok',
      metricsTracked: pluginKeys.length,
      ...(pluginKeys.length > 0 ? { summary: pluginsSummary } : {}),
    };

    const allOk = Object.values(checks).every(
      (c) => (c as { status: string }).status !== 'error',
    );

    return {
      status: allOk ? 'ok' : 'error',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}
