import { PluginLockService } from '../plugin-lock.service';

describe('PluginLockService', () => {
  let service: PluginLockService;

  beforeEach(() => {
    service = new PluginLockService();
  });

  it('should execute function and return result', async () => {
    const result = await service.withLock('key1', async () => 'hello');
    expect(result).toBe('hello');
  });

  it('should serialize concurrent calls with the same key', async () => {
    const order: string[] = [];

    const op1 = service.withLock('key1', async () => {
      order.push('op1-start');
      await new Promise((r) => setTimeout(r, 50));
      order.push('op1-end');
      return 1;
    });

    const op2 = service.withLock('key1', async () => {
      order.push('op2-start');
      await new Promise((r) => setTimeout(r, 10));
      order.push('op2-end');
      return 2;
    });

    const [r1, r2] = await Promise.all([op1, op2]);

    expect(r1).toBe(1);
    expect(r2).toBe(2);
    // op2 should start after op1 ends
    expect(order.indexOf('op1-end')).toBeLessThan(order.indexOf('op2-start'));
  });

  describe('per-key FIFO queue (3+ concurrent callers)', () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    /** Queues an op that records start/end and tracks how many ops on the key run at once. */
    function trackedOps(count: number, opts: { failing?: number[] } = {}) {
      const order: string[] = [];
      let running = 0;
      let maxRunning = 0;
      const ops = Array.from({ length: count }, (_, i) =>
        service.withLock('key1', async () => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          order.push(`op${i}-start`);
          // Earlier callers take longer, so any overlap would reorder the log
          await sleep((count - i) * 10);
          order.push(`op${i}-end`);
          running--;
          if (opts.failing?.includes(i)) throw new Error(`op${i} failed`);
          return i;
        }),
      );
      return { ops, order, maxRunning: () => maxRunning };
    }

    it('should run every caller alone, in arrival order', async () => {
      const { ops, order, maxRunning } = trackedOps(4);

      const results = await Promise.all(ops);

      expect(results).toEqual([0, 1, 2, 3]);
      expect(maxRunning()).toBe(1);
      expect(order).toEqual([
        'op0-start', 'op0-end',
        'op1-start', 'op1-end',
        'op2-start', 'op2-end',
        'op3-start', 'op3-end',
      ]);
    });

    it('should propagate each caller\'s own error without breaking the chain', async () => {
      const { ops, order, maxRunning } = trackedOps(5, { failing: [1, 3] });

      const settled = await Promise.allSettled(ops);

      expect(settled.map((s) => s.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'rejected', 'fulfilled']);
      expect((settled[1] as PromiseRejectedResult).reason.message).toBe('op1 failed');
      expect((settled[3] as PromiseRejectedResult).reason.message).toBe('op3 failed');
      expect((settled[4] as PromiseFulfilledResult<number>).value).toBe(4);
      expect(maxRunning()).toBe(1);
      expect(order.filter((e) => e.endsWith('-start'))).toEqual(['op0-start', 'op1-start', 'op2-start', 'op3-start', 'op4-start']);
    });

    it('should drop the key once its queue drains, even when the last op failed', async () => {
      const { ops } = trackedOps(3, { failing: [2] });

      await Promise.allSettled(ops);

      expect((service as any).locks.size).toBe(0);
    });
  });

  it('should allow concurrent calls with different keys', async () => {
    const order: string[] = [];

    const op1 = service.withLock('key1', async () => {
      order.push('op1-start');
      await new Promise((r) => setTimeout(r, 50));
      order.push('op1-end');
    });

    const op2 = service.withLock('key2', async () => {
      order.push('op2-start');
      await new Promise((r) => setTimeout(r, 50));
      order.push('op2-end');
    });

    await Promise.all([op1, op2]);

    // Both should start before either ends (parallel)
    expect(order.indexOf('op1-start')).toBeLessThan(order.indexOf('op1-end'));
    expect(order.indexOf('op2-start')).toBeLessThan(order.indexOf('op2-end'));
    // op2 should start before op1 ends (running in parallel)
    expect(order.indexOf('op2-start')).toBeLessThan(order.indexOf('op1-end'));
  });

  it('should release lock after error', async () => {
    await expect(
      service.withLock('key1', async () => {
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');

    // Should be able to acquire lock again immediately
    const result = await service.withLock('key1', async () => 'recovered');
    expect(result).toBe('recovered');
  });

  it('should not block next caller when prior operation fails', async () => {
    const op1 = service.withLock('key1', async () => {
      await new Promise((r) => setTimeout(r, 20));
      throw new Error('op1 failed');
    });

    const op2 = service.withLock('key1', async () => {
      return 'op2 success';
    });

    await expect(op1).rejects.toThrow('op1 failed');
    const result = await op2;
    expect(result).toBe('op2 success');
  });
});
