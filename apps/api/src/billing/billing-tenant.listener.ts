import { Injectable, Logger } from '@nestjs/common';
import { OnEvent, SystemEvents } from '@saas/backend';
import type { TenantEventPayload, TenantStatusChangedEvent } from '@saas/backend';
import { SubscriptionsService } from './subscriptions.service';

/** Billing side effects of tenant lifecycle changes. Never throws. */
@Injectable()
export class BillingTenantListener {
  private readonly logger = new Logger(BillingTenantListener.name);

  constructor(private readonly subscriptions: SubscriptionsService) {}

  @OnEvent(SystemEvents.TENANT_REACTIVATED)
  onReactivated(payload: TenantEventPayload): Promise<void> {
    return this.restartGrace(payload.tenantSlug);
  }

  /** A sysadmin setting an INACTIVE tenant back to ACTIVE is a reactivation too. */
  @OnEvent(SystemEvents.TENANT_STATUS_CHANGED)
  async onStatusChanged(payload: TenantStatusChangedEvent): Promise<void> {
    if (payload.status === 'ACTIVE') await this.restartGrace(payload.tenantSlug);
  }

  private async restartGrace(tenantSlug: string): Promise<void> {
    try {
      await this.subscriptions.restartGraceAfterReactivation(tenantSlug);
    } catch (error) {
      this.logger.error(`Restarting grace periods for ${tenantSlug} failed`, error instanceof Error ? error.stack : error);
    }
  }
}
