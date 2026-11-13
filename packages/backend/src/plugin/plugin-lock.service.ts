import { Injectable } from '@nestjs/common';

/**
 * In-process mutex for serializing plugin toggle operations.
 * Prevents race conditions when concurrent requests toggle the same plugin.
 *
 * Each key is a FIFO queue: every caller chains onto the previous caller's tail, so
 * operations on the same key run one at a time in arrival order. Not re-entrant —
 * calling withLock for a key from inside that key's operation deadlocks.
 */
@Injectable()
export class PluginLockService {
  /** Per-key queue tail: settles (never rejects) once the last queued operation finishes. */
  private readonly locks = new Map<string, Promise<void>>();

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();

    // Run after the previous holder settles, whatever its outcome
    const run = previous.then(() => fn());

    // The tail swallows errors so one failed operation can't break the chain
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(key, tail);

    try {
      return await run;
    } finally {
      // Nobody queued behind us: drop the key so the map doesn't grow
      if (this.locks.get(key) === tail) {
        this.locks.delete(key);
      }
    }
  }
}
