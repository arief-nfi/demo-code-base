// ──────────────────────────────────────────────
// Event name constants
// ──────────────────────────────────────────────
export const SystemEvents = {
  // Auth events
  USER_LOGGED_IN: 'auth.user.loggedIn',
  USER_LOGGED_OUT: 'auth.user.loggedOut',
  TOKEN_REFRESHED: 'auth.token.refreshed',

  // User events
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DELETED: 'user.deleted',
  USER_STATUS_CHANGED: 'user.statusChanged',

  // Role & Permission events
  ROLE_CREATED: 'role.created',
  ROLE_UPDATED: 'role.updated',
  ROLE_DELETED: 'role.deleted',

  // Tenant events
  TENANT_CREATED: 'tenant.created',
  TENANT_UPDATED: 'tenant.updated',
  /** Emitted (and awaited) before a tenant's schema is dropped: last chance to clean up outside the app */
  TENANT_DELETING: 'tenant.deleting',
  TENANT_DELETED: 'tenant.deleted',
  TENANT_STATUS_CHANGED: 'tenant.statusChanged',
  TENANT_REGISTERED: 'tenant.registered',
  TENANT_SUSPENDED: 'tenant.suspended',
  TENANT_REACTIVATED: 'tenant.reactivated',
  TENANT_TERMINATED: 'tenant.terminated',

  // Plugin events
  PLUGIN_ENABLED_SYSTEM: 'plugin.enabled.system',
  PLUGIN_DISABLED_SYSTEM: 'plugin.disabled.system',
  PLUGIN_ENABLED_TENANT: 'plugin.enabled.tenant',
  PLUGIN_DISABLED_TENANT: 'plugin.disabled.tenant',
  PLUGIN_CONFIG_UPDATED: 'plugin.config.updated',

  // Subscription events
  PLUGIN_PRICING_UPDATED: 'plugin.pricing.updated',
  PLUGIN_SUBSCRIBED: 'plugin.subscribed',
  PLUGIN_SUBSCRIPTION_CANCELLED: 'plugin.subscription.cancelled',
  /** @deprecated Paid subscriptions are activated by payment (BILLING_INVOICE_PAID); nothing emits this any more. */
  PLUGIN_SUBSCRIPTION_APPROVED: 'plugin.subscription.approved',
  PLUGIN_SUBSCRIPTION_EXPIRED: 'plugin.subscription.expired',

  // Billing events (payload: BillingEventPayload)
  BILLING_INVOICE_ISSUED: 'billing.invoice.issued',
  BILLING_INVOICE_PAID: 'billing.invoice.paid',
  BILLING_SUBSCRIPTION_PAST_DUE: 'billing.subscription.pastDue',
  BILLING_SUBSCRIPTION_PAUSED: 'billing.subscription.paused',
  BILLING_ACTIVATION_FAILED: 'billing.activation.failed',
  /** A tenant's own plugin subscription was replaced by an app it paid for (payload: SubscriptionReplacedPayload). */
  BILLING_SUBSCRIPTION_REPLACED: 'billing.subscription.replaced',

  // App catalog events (payload: AppEventPayload, tenantSlug 'system')
  APP_PRICING_UPDATED: 'app.pricing.updated',
  APP_PLUGINS_ADDED: 'app.plugins.added',
  APP_PLUGINS_REMOVED: 'app.plugins.removed',

  // Workflow events
  WORKFLOW_ADVANCED: 'workflow.advanced',
  WORKFLOW_TRANSITIONED: 'workflow.transitioned',

  // Calendar integration (payload: CalendarConnectionEvent)
  INTEGRATION_CALENDAR_CONNECTED: 'integration.calendar.connected',
  /** A user's calendar connection stopped working (revoked access, deleted calendar) */
  INTEGRATION_CALENDAR_DISCONNECTED: 'integration.calendar.disconnected',

  // Meetings (payload: MeetingEvent)
  INTEGRATION_MEETING_CREATED: 'integration.meeting.created',
  INTEGRATION_MEETING_CANCELLED: 'integration.meeting.cancelled',
  /** The host can no longer be used (disconnected, left, switched accounts): the owner may create a new meeting */
  INTEGRATION_MEETING_ORPHANED: 'integration.meeting.orphaned',
} as const;

export type SystemEventName = (typeof SystemEvents)[keyof typeof SystemEvents];

// ──────────────────────────────────────────────
// Event payload interfaces
// ──────────────────────────────────────────────
export interface BaseEventPayload {
  tenantSlug: string;
  timestamp: Date;
  userId?: string;
}

export interface AuthEventPayload extends BaseEventPayload {
  userId: string;
  username: string;
  ip?: string;
  userAgent?: string;
}

export interface UserCreatedEvent extends BaseEventPayload {
  userId: string;
  username: string;
  email: string;
  roles: string[];
}

export interface UserUpdatedEvent extends BaseEventPayload {
  userId: string;
  username: string;
  email: string;
  changes: Record<string, unknown>;
}

/** Emitted after a user is deleted (one event per user, also for bulk deletes) */
export interface UserDeletedEvent extends BaseEventPayload {
  userId: string;
  username: string;
  email: string;
}

/** Emitted when a user's status changes, e.g. ACTIVE → INACTIVE */
export interface UserStatusChangedEvent extends BaseEventPayload {
  userId: string;
  status: string;
  previousStatus: string;
}

export interface TenantEventPayload extends BaseEventPayload {
  tenantId: string;
  tenantName: string;
}

export interface TenantStatusChangedEvent extends TenantEventPayload {
  status: string;
}

export interface PluginEventPayload extends BaseEventPayload {
  pluginKey: string;
}

/** PLUGIN_SUBSCRIBED: `pluginKey` is the product key (a plugin, or `app:<appKey>`), `pluginName` its name. */
export interface PluginSubscribedPayload extends PluginEventPayload {
  pluginName?: string;
}

/** `pluginKey` is the product key: a plugin key, or `app:<appKey>` for an app. */
export interface BillingEventPayload extends PluginEventPayload {
  invoiceId?: string;
  invoiceNumber?: string;
  total?: string;
  currency?: string;
  /** An app paused: the plugins it switched off (keys). */
  switchedOff?: string[];
}

/** A sysadmin changed an app: its pricing, or the plugins added to / removed from it. */
export interface AppEventPayload extends BaseEventPayload {
  appKey: string;
  pluginKeys: string[];
}

/** `pluginKey` is the replaced plugin; `credit` is its unused time added to the tenant's credit (null when none). */
export interface SubscriptionReplacedPayload extends PluginEventPayload {
  pluginName: string;
  appKey: string;
  appName: string;
  outcome: 'end-with-credit' | 'stop-renewing' | 'end';
  credit: string | null;
  currency: string;
}

export interface PluginConfigUpdatedEvent extends PluginEventPayload {
  previousConfig: Record<string, unknown>;
  newConfig: Record<string, unknown>;
}

export interface RoleEventPayload extends BaseEventPayload {
  roleId: string;
  roleName: string;
}

export interface WorkflowAdvancedEvent extends BaseEventPayload {
  processKey: string;
  entityType: string;
  entityId: string;
  fromState: string;
  toState: string;
}

export interface WorkflowTransitionedEvent extends WorkflowAdvancedEvent {
  action: string;
  comment?: string;
}

export interface CalendarConnectionEvent extends BaseEventPayload {
  userId: string;
  /** Why the connection stopped working (disconnect events) */
  reason?: string;
  /** What stopped working with it (disconnect events): calendar sync, meetings, or both */
  features?: Array<'calendar' | 'meetings'>;
}

export interface MeetingEvent extends BaseEventPayload {
  source: string;
  key: string;
  hostUserId: string;
  /** Why the meeting was orphaned or cancelled */
  reason?: string;
  /**
   * CANCELLED only: true when the item got a new meeting with another host, so it still
   * has an active one; false when the item's meeting was cancelled
   */
  replaced?: boolean;
}
