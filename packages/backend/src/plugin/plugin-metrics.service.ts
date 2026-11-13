import { Injectable, Logger } from '@nestjs/common';

export interface MetricEntry {
  count: number;
  totalDurationMs: number;
  errorCount: number;
  lastError?: string;
  lastErrorAt?: Date;
  durations: number[];
}

export interface MetricSummary {
  count: number;
  avgDurationMs: number;
  p95DurationMs: number;
  errorCount: number;
  errorRate: number;
  lastError?: string;
  lastErrorAt?: Date;
}

export const PLUGIN_PERFORMANCE_BUDGETS = {
  requestDurationMs: 500,
  lifecycleInstallMs: 30_000,
  lifecycleActivateMs: 5_000,
  healthCheckMs: 3_000,
};

const MAX_ROLLING_WINDOW = 100;
const WARN_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class PluginMetricsService {
  private readonly logger = new Logger(PluginMetricsService.name);
  private readonly metrics = new Map<string, Map<string, MetricEntry>>();
  private readonly lastWarned = new Map<string, number>();

  record(pluginKey: string, operation: string, durationMs: number, error?: Error | string): void {
    let pluginMetrics = this.metrics.get(pluginKey);
    if (!pluginMetrics) {
      pluginMetrics = new Map<string, MetricEntry>();
      this.metrics.set(pluginKey, pluginMetrics);
    }

    let entry = pluginMetrics.get(operation);
    if (!entry) {
      entry = { count: 0, totalDurationMs: 0, errorCount: 0, durations: [] };
      pluginMetrics.set(operation, entry);
    }

    entry.count++;
    entry.totalDurationMs += durationMs;
    entry.durations.push(durationMs);

    if (entry.durations.length > MAX_ROLLING_WINDOW) {
      entry.durations.shift();
    }

    if (error) {
      entry.errorCount++;
      entry.lastError = error instanceof Error ? error.message : String(error);
      entry.lastErrorAt = new Date();
    }

    this.checkBudget(pluginKey, operation, entry);
  }

  getAll(): Record<string, Record<string, MetricSummary>> {
    const result: Record<string, Record<string, MetricSummary>> = {};
    for (const [pluginKey, pluginMetrics] of this.metrics) {
      result[pluginKey] = {};
      for (const [operation, entry] of pluginMetrics) {
        result[pluginKey][operation] = this.summarize(entry);
      }
    }
    return result;
  }

  getForPlugin(pluginKey: string): Record<string, MetricSummary> | undefined {
    const pluginMetrics = this.metrics.get(pluginKey);
    if (!pluginMetrics) return undefined;

    const result: Record<string, MetricSummary> = {};
    for (const [operation, entry] of pluginMetrics) {
      result[operation] = this.summarize(entry);
    }
    return result;
  }

  reset(): void {
    this.metrics.clear();
    this.lastWarned.clear();
  }

  private summarize(entry: MetricEntry): MetricSummary {
    return {
      count: entry.count,
      avgDurationMs: entry.count > 0 ? Math.round(entry.totalDurationMs / entry.count) : 0,
      p95DurationMs: this.percentile(entry.durations, 95),
      errorCount: entry.errorCount,
      errorRate: entry.count > 0 ? Number((entry.errorCount / entry.count).toFixed(4)) : 0,
      ...(entry.lastError ? { lastError: entry.lastError } : {}),
      ...(entry.lastErrorAt ? { lastErrorAt: entry.lastErrorAt } : {}),
    };
  }

  private percentile(durations: number[], p: number): number {
    if (durations.length === 0) return 0;
    const sorted = [...durations].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private checkBudget(pluginKey: string, operation: string, entry: MetricEntry): void {
    if (entry.durations.length < 10) return; // Need enough data

    const p95 = this.percentile(entry.durations, 95);
    let budget: number | undefined;

    if (operation.startsWith('lifecycle.onInstall')) {
      budget = PLUGIN_PERFORMANCE_BUDGETS.lifecycleInstallMs;
    } else if (operation.startsWith('lifecycle.onActivate')) {
      budget = PLUGIN_PERFORMANCE_BUDGETS.lifecycleActivateMs;
    } else if (operation.startsWith('lifecycle.healthCheck')) {
      budget = PLUGIN_PERFORMANCE_BUDGETS.healthCheckMs;
    } else if (!operation.startsWith('lifecycle.')) {
      budget = PLUGIN_PERFORMANCE_BUDGETS.requestDurationMs;
    }

    if (!budget || p95 <= budget) return;

    const warnKey = `${pluginKey}:${operation}`;
    const now = Date.now();
    const lastWarn = this.lastWarned.get(warnKey) ?? 0;
    if (now - lastWarn < WARN_THROTTLE_MS) return;

    this.lastWarned.set(warnKey, now);
    this.logger.warn(
      `Performance budget exceeded for plugin "${pluginKey}" operation "${operation}": p95=${p95}ms > budget=${budget}ms`,
    );
  }
}
