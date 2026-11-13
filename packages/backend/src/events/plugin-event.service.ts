import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { BaseEventPayload, SystemEventName } from './system-events';

@Injectable()
export class PluginEventService {
  private readonly logger = new Logger(PluginEventService.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * Emit a system event (fire-and-forget).
   * All registered listeners receive it asynchronously.
   */
  emit<T extends BaseEventPayload>(event: SystemEventName | string, payload: T): void {
    this.logger.debug(`Emitting event: ${event} [tenant: ${payload.tenantSlug}]`);
    this.eventEmitter.emit(event, {
      ...payload,
      timestamp: payload.timestamp ?? new Date(),
    });
  }

  /**
   * Emit and wait for all listeners to complete.
   * Use for events where listener results matter.
   */
  async emitAsync<T extends BaseEventPayload>(event: SystemEventName | string, payload: T): Promise<void> {
    this.logger.debug(`Emitting async event: ${event} [tenant: ${payload.tenantSlug}]`);
    await this.eventEmitter.emitAsync(event, {
      ...payload,
      timestamp: payload.timestamp ?? new Date(),
    });
  }
}
