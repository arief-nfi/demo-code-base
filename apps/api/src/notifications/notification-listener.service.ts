import { Injectable, Logger } from '@nestjs/common';
import { OnEvent, SystemEvents, WebSocketBridgeService, appKeyOf } from '@saas/backend';
import type { CalendarConnectionEvent, UserCreatedEvent, PluginEventPayload, PluginSubscribedPayload, TenantEventPayload } from '@saas/backend';
import { NotificationService } from './notification.service';

/** "calendar was deleted" → "Calendar was deleted." */
const asSentence = (text: string) => {
  const trimmed = text.trim().replace(/\.+$/, '');
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
};

@Injectable()
export class NotificationListenerService {
  private readonly logger = new Logger(NotificationListenerService.name);

  constructor(
    private notificationService: NotificationService,
    private wsBridge: WebSocketBridgeService,
  ) {}

  private broadcastNotification(tenantSlug: string) {
    try {
      this.wsBridge.broadcastToTenant(tenantSlug, 'notification:new', { timestamp: new Date() });
    } catch {
      // WebSocket may not be connected — non-critical
    }
  }

  @OnEvent(SystemEvents.USER_CREATED)
  async onUserCreated(payload: UserCreatedEvent) {
    try {
      await this.notificationService.notifyAdmins(payload.tenantSlug, {
        title: 'New user joined',
        body: `User "${payload.username}" has been added to the system.`,
        type: 'INFO',
        category: 'system',
        link: '/systems/users',
        sourceEvent: SystemEvents.USER_CREATED,
      });
      this.broadcastNotification(payload.tenantSlug);
    } catch (e) {
      this.logger.warn('Failed to create notification for USER_CREATED', e);
    }
  }

  @OnEvent(SystemEvents.PLUGIN_SUBSCRIBED)
  async onPluginSubscribed(payload: PluginSubscribedPayload) {
    const kind = appKeyOf(payload.pluginKey) !== null ? 'app' : 'plugin';
    try {
      await this.notificationService.notifyAdmins(payload.tenantSlug, {
        title: kind === 'app' ? 'App subscribed' : 'Plugin subscribed',
        body: `Subscribed to ${kind} "${payload.pluginName ?? payload.pluginKey}".`,
        type: 'SUCCESS',
        category: 'plugins',
        link: '/plugins/tenant',
        sourceEvent: SystemEvents.PLUGIN_SUBSCRIBED,
      });
      this.broadcastNotification(payload.tenantSlug);
    } catch (e) {
      this.logger.warn('Failed to create notification for PLUGIN_SUBSCRIBED', e);
    }
  }

  @OnEvent(SystemEvents.PLUGIN_SUBSCRIPTION_EXPIRED)
  async onSubscriptionExpired(payload: PluginEventPayload) {
    try {
      await this.notificationService.notifyAdmins(payload.tenantSlug, {
        title: 'Trial expired',
        body: `Your trial for "${payload.pluginKey}" has expired. Subscribe to continue using it.`,
        type: 'WARNING',
        category: 'plugins',
        link: '/plugins/tenant',
        sourceEvent: SystemEvents.PLUGIN_SUBSCRIPTION_EXPIRED,
      });
      this.broadcastNotification(payload.tenantSlug);
    } catch (e) {
      this.logger.warn('Failed to create notification for PLUGIN_SUBSCRIPTION_EXPIRED', e);
    }
  }

  @OnEvent(SystemEvents.ROLE_UPDATED)
  async onRoleUpdated(payload: any) {
    try {
      await this.notificationService.notifyAdmins(payload.tenantSlug, {
        title: 'Role updated',
        body: `Role "${payload.roleName}" has been modified.`,
        type: 'INFO',
        category: 'security',
        link: '/systems/roles',
        sourceEvent: SystemEvents.ROLE_UPDATED,
      });
      this.broadcastNotification(payload.tenantSlug);
    } catch (e) {
      this.logger.warn('Failed to create notification for ROLE_UPDATED', e);
    }
  }

  @OnEvent(SystemEvents.TENANT_SUSPENDED)
  async onTenantSuspended(payload: TenantEventPayload & { reason?: string }) {
    try {
      await this.notificationService.notifyAdmins(payload.tenantSlug, {
        title: 'Tenant suspended',
        body: `Tenant has been suspended. Reason: ${payload.reason || 'manual'}.`,
        type: 'ERROR',
        category: 'security',
        sourceEvent: SystemEvents.TENANT_SUSPENDED,
      });
      this.broadcastNotification(payload.tenantSlug);
    } catch (e) {
      this.logger.warn('Failed to create notification for TENANT_SUSPENDED', e);
    }
  }

  @OnEvent(SystemEvents.INTEGRATION_CALENDAR_DISCONNECTED)
  async onCalendarDisconnected(payload: CalendarConnectionEvent) {
    try {
      const meetings = payload.features?.includes('meetings') ?? false;
      const calendar = payload.features?.includes('calendar') ?? false;
      const [title, action] = !meetings
        ? ['Calendar sync stopped', 'Reconnect your calendar to resume syncing.']
        : calendar
          ? ['Calendar sync and meetings stopped', 'Reconnect your account to resume calendar syncing and host meetings again.']
          : ['Meetings stopped working', 'Reconnect your account to host meetings again.'];
      await this.notificationService.create(payload.tenantSlug, {
        userId: payload.userId,
        title,
        body: `${asSentence(payload.reason || 'Your connected account stopped working')} ${action}`,
        type: 'WARNING',
        category: 'integration',
        link: '/plugins/integration/google-calendar',
        sourceEvent: SystemEvents.INTEGRATION_CALENDAR_DISCONNECTED,
      });
      this.broadcastNotification(payload.tenantSlug);
    } catch (e) {
      this.logger.warn('Failed to create notification for INTEGRATION_CALENDAR_DISCONNECTED', e);
    }
  }
}
