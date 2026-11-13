import { Injectable, Logger } from '@nestjs/common';
import { OnEvent, SystemEvents, type TenantEventPayload, type UserDeletedEvent, type UserStatusChangedEvent } from '@saas/backend';
import { ConnectionsService } from './connections.service';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Offboarding: a deleted or deactivated user's Google account stops receiving the
 * tenant's events. Plain @OnEvent, so it runs even while the plugin is switched off.
 */
@Injectable()
export class GoogleCalendarListener {
  private readonly logger = new Logger(GoogleCalendarListener.name);

  constructor(private readonly connections: ConnectionsService) {}

  @OnEvent(SystemEvents.USER_DELETED)
  async onUserDeleted(event: UserDeletedEvent): Promise<void> {
    await this.offboard(event.tenantSlug, event.userId);
  }

  @OnEvent(SystemEvents.USER_STATUS_CHANGED)
  async onUserStatusChanged(event: UserStatusChangedEvent): Promise<void> {
    if (event.status !== 'ACTIVE') await this.offboard(event.tenantSlug, event.userId);
  }

  /** Awaited before the tenant's schema is dropped */
  @OnEvent(SystemEvents.TENANT_DELETING)
  async onTenantDeleting(event: TenantEventPayload): Promise<void> {
    try {
      await this.connections.offboardTenant(event.tenantSlug);
    } catch (error) {
      this.logger.warn(`Google Calendar offboarding of tenant ${event.tenantSlug} failed: ${errorText(error)}`);
    }
  }

  /** Backstop: whatever offboarding missed must not count as "shared" when revoking later */
  @OnEvent(SystemEvents.TENANT_DELETED)
  async onTenantDeleted(event: TenantEventPayload): Promise<void> {
    try {
      await this.connections.forgetTenant(event.tenantSlug);
    } catch (error) {
      this.logger.warn(`Could not clear the Google account index of tenant ${event.tenantSlug}: ${errorText(error)}`);
    }
  }

  private async offboard(tenantSlug: string, userId: string): Promise<void> {
    try {
      await this.connections.offboard(tenantSlug, userId);
    } catch (error) {
      this.logger.warn(`Google Calendar offboarding of user ${userId} in ${tenantSlug} failed: ${errorText(error)}`);
    }
  }
}
