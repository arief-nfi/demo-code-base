import { PluginMetricsService } from '../plugin-metrics.service';

describe('PluginMetricsService', () => {
  let service: PluginMetricsService;

  beforeEach(() => {
    service = new PluginMetricsService();
  });

  describe('record', () => {
    it('should store metrics for a plugin operation', () => {
      service.record('audit-log', 'GET /plugins/audit-log', 45);

      const metrics = service.getForPlugin('audit-log');
      expect(metrics).toBeDefined();
      expect(metrics!['GET /plugins/audit-log']).toEqual(
        expect.objectContaining({
          count: 1,
          avgDurationMs: 45,
          p95DurationMs: 45,
          errorCount: 0,
          errorRate: 0,
        }),
      );
    });

    it('should accumulate multiple recordings', () => {
      service.record('audit-log', 'GET /plugins/audit-log', 40);
      service.record('audit-log', 'GET /plugins/audit-log', 60);

      const metrics = service.getForPlugin('audit-log');
      expect(metrics!['GET /plugins/audit-log'].count).toBe(2);
      expect(metrics!['GET /plugins/audit-log'].avgDurationMs).toBe(50);
    });

    it('should track errors', () => {
      service.record('audit-log', 'GET /plugins/audit-log', 100, new Error('DB timeout'));

      const metrics = service.getForPlugin('audit-log');
      expect(metrics!['GET /plugins/audit-log'].errorCount).toBe(1);
      expect(metrics!['GET /plugins/audit-log'].errorRate).toBe(1);
      expect(metrics!['GET /plugins/audit-log'].lastError).toBe('DB timeout');
      expect(metrics!['GET /plugins/audit-log'].lastErrorAt).toBeInstanceOf(Date);
    });

    it('should accept string errors', () => {
      service.record('audit-log', 'GET /plugins/audit-log', 100, 'Something went wrong');

      const metrics = service.getForPlugin('audit-log');
      expect(metrics!['GET /plugins/audit-log'].lastError).toBe('Something went wrong');
    });

    it('should track multiple operations per plugin', () => {
      service.record('audit-log', 'GET /plugins/audit-log', 30);
      service.record('audit-log', 'POST /plugins/audit-log', 50);

      const metrics = service.getForPlugin('audit-log');
      expect(Object.keys(metrics!)).toHaveLength(2);
    });
  });

  describe('rolling window', () => {
    it('should maintain a maximum of 100 entries', () => {
      for (let i = 0; i < 110; i++) {
        service.record('test', 'op', i);
      }

      const metrics = service.getForPlugin('test');
      // Count should reflect all recordings
      expect(metrics!['op'].count).toBe(110);
      // p95 should be calculated from the last 100 entries (10-109)
      // Sorted: 10, 11, ..., 109. p95 index = ceil(95/100 * 100) - 1 = 94
      // Value at index 94 in sorted [10..109] = 10 + 94 = 104
      expect(metrics!['op'].p95DurationMs).toBe(104);
    });
  });

  describe('p95 calculation', () => {
    it('should calculate p95 correctly', () => {
      // Record 100 values: 1, 2, 3, ..., 100
      for (let i = 1; i <= 100; i++) {
        service.record('test', 'op', i);
      }

      const metrics = service.getForPlugin('test');
      // p95 of [1..100]: index = ceil(95/100 * 100) - 1 = 94
      // sorted[94] = 95
      expect(metrics!['op'].p95DurationMs).toBe(95);
    });

    it('should handle single value', () => {
      service.record('test', 'op', 42);

      const metrics = service.getForPlugin('test');
      expect(metrics!['op'].p95DurationMs).toBe(42);
    });

    it('should handle empty durations', () => {
      const all = service.getAll();
      expect(Object.keys(all)).toHaveLength(0);
    });
  });

  describe('getAll', () => {
    it('should return metrics for all plugins', () => {
      service.record('audit-log', 'GET /plugins/audit-log', 30);
      service.record('sample-plugin', 'GET /plugins/sample-plugin/items', 20);

      const all = service.getAll();
      expect(Object.keys(all)).toHaveLength(2);
      expect(all['audit-log']).toBeDefined();
      expect(all['sample-plugin']).toBeDefined();
    });

    it('should return empty object when no metrics', () => {
      const all = service.getAll();
      expect(all).toEqual({});
    });
  });

  describe('getForPlugin', () => {
    it('should return undefined for unknown plugin', () => {
      expect(service.getForPlugin('nonexistent')).toBeUndefined();
    });

    it('should return metrics for a specific plugin', () => {
      service.record('audit-log', 'op1', 30);
      service.record('sample-plugin', 'op2', 20);

      const metrics = service.getForPlugin('audit-log');
      expect(metrics).toBeDefined();
      expect(Object.keys(metrics!)).toHaveLength(1);
      expect(metrics!['op1']).toBeDefined();
    });
  });

  describe('reset', () => {
    it('should clear all metrics', () => {
      service.record('audit-log', 'op', 30);
      service.record('sample-plugin', 'op', 20);

      service.reset();

      expect(service.getAll()).toEqual({});
      expect(service.getForPlugin('audit-log')).toBeUndefined();
    });
  });

  describe('error rate calculation', () => {
    it('should calculate error rate correctly', () => {
      service.record('test', 'op', 10);
      service.record('test', 'op', 20);
      service.record('test', 'op', 30, new Error('fail'));
      service.record('test', 'op', 40);

      const metrics = service.getForPlugin('test');
      expect(metrics!['op'].errorRate).toBe(0.25); // 1 error out of 4
    });

    it('should return 0 error rate when no errors', () => {
      service.record('test', 'op', 10);
      service.record('test', 'op', 20);

      const metrics = service.getForPlugin('test');
      expect(metrics!['op'].errorRate).toBe(0);
    });
  });
});
