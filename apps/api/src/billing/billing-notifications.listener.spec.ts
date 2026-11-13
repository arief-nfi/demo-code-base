import { SystemEvents } from '@saas/backend';
import { BillingNotificationsListener } from './billing-notifications.listener';
import { BillingRecipientsService } from './billing-recipients.service';

const INVOICE = {
  id: 'inv-1', number: 'INV-2026-0042', tenantId: 't1', tenantSlug: 'acme', pluginKey: 'docs', pluginName: 'Document Templates',
  currency: 'IDR', total: '166500', dueAt: new Date('2026-10-21T00:00:00Z'),
};
const payload = { tenantSlug: 'acme', pluginKey: 'docs', invoiceId: 'inv-1', invoiceNumber: 'INV-2026-0042', total: '166500', currency: 'IDR', timestamp: new Date() };

function setup(opts: { billingEmail?: string | null; adminEmails?: string[]; complimentary?: boolean; invoice?: Record<string, unknown> } = {}) {
  const tenantClient = {
    user: { findMany: jest.fn(async () => (opts.adminEmails ?? ['boss@acme.test']).map((email) => ({ email }))) },
  };
  const prisma = {
    tenant: { findUnique: jest.fn(async () => ({ id: 't1', slug: 'acme', name: 'Acme' })) },
    invoice: { findUnique: jest.fn(async () => ({ ...INVOICE, complimentary: opts.complimentary ?? false, ...opts.invoice })) },
    plugin: {
      findMany: jest.fn(async () => [{ key: 'inventory', name: 'Inventory' }, { key: 'procurement', name: 'Procurement' }]),
    },
    getTenantClient: jest.fn(() => tenantClient),
  };
  const settings = {
    getProfile: jest.fn(async () => ({ companyName: null, billingEmail: opts.billingEmail ?? null, address: null, taxId: null })),
    getSettings: jest.fn(async () => ({ graceDays: 7 })),
  };
  const recipients = new BillingRecipientsService(prisma as any, settings as any);
  const notifications = { notifyAdmins: jest.fn(async () => []) };
  const email = { send: jest.fn(async () => ({ messageId: 'm1', status: 'QUEUED' })) };
  const ws = { broadcastToTenant: jest.fn() };
  const listener = new BillingNotificationsListener(notifications as any, email as any, recipients, prisma as any, settings as any, ws as any);
  jest.spyOn((listener as any).logger, 'warn').mockImplementation(() => undefined);
  return { listener, notifications, email, tenantClient, ws };
}

describe('BillingRecipientsService', () => {
  it('uses the billing email when the tenant set one', async () => {
    const { tenantClient } = setup({ billingEmail: 'finance@acme.test' });
    const recipients = new BillingRecipientsService(
      { tenant: { findUnique: async () => ({ id: 't1' }) }, getTenantClient: () => tenantClient } as any,
      { getProfile: async () => ({ billingEmail: 'finance@acme.test' }) } as any,
    );
    await expect(recipients.emailsFor('acme')).resolves.toEqual(['finance@acme.test']);
  });

  it('falls back to admin emails without a billing email', async () => {
    const { tenantClient } = setup({ adminEmails: ['a@acme.test', 'b@acme.test'] });
    const recipients = new BillingRecipientsService(
      { tenant: { findUnique: async () => ({ id: 't1' }) }, getTenantClient: () => tenantClient } as any,
      { getProfile: async () => ({ billingEmail: null }) } as any,
    );
    await expect(recipients.emailsFor('acme')).resolves.toEqual(['a@acme.test', 'b@acme.test']);
    expect(tenantClient.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'ACTIVE', roles: { some: { name: 'ADMIN' } } },
    }));
  });
});

describe('BillingNotificationsListener', () => {
  beforeEach(() => {
    process.env.FRONTEND_URL = 'http://web.test';
  });

  it('invoice issued notifies admins and emails the billing email', async () => {
    const { listener, notifications, email, ws } = setup({ billingEmail: 'finance@acme.test' });

    await listener.onInvoiceIssued(payload);

    expect(notifications.notifyAdmins).toHaveBeenCalledWith('acme', expect.objectContaining({
      type: 'INFO', category: 'billing', link: '/billing', sourceEvent: SystemEvents.BILLING_INVOICE_ISSUED,
      body: expect.stringContaining('INV-2026-0042'),
    }));
    expect(email.send).toHaveBeenCalledWith({
      template: 'core.billing-invoice-issued',
      tenantSlug: 'acme',
      to: ['finance@acme.test'],
      idempotencyKey: `${SystemEvents.BILLING_INVOICE_ISSUED}:inv-1`,
      data: { pluginName: 'Document Templates', number: 'INV-2026-0042', amount: 'Rp 166.500', due: '21 Oct 2026', billingUrl: 'http://web.test/billing' },
    });
    expect(ws.broadcastToTenant).toHaveBeenCalledWith('acme', 'notification:new', expect.anything());
  });

  it.each([
    ['onInvoicePaid', 'SUCCESS', SystemEvents.BILLING_INVOICE_PAID, 'core.billing-invoice-paid'],
    ['onPastDue', 'WARNING', SystemEvents.BILLING_SUBSCRIPTION_PAST_DUE, 'core.billing-past-due'],
    ['onPaused', 'ERROR', SystemEvents.BILLING_SUBSCRIPTION_PAUSED, 'core.billing-paused'],
  ] as const)('%s notifies with type %s and sends its email', async (method, type, sourceEvent, template) => {
    const { listener, notifications, email } = setup();
    await listener[method](payload);
    expect(notifications.notifyAdmins).toHaveBeenCalledWith('acme', expect.objectContaining({ type, sourceEvent }));
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({
      template, tenantSlug: 'acme', to: ['boss@acme.test'], idempotencyKey: `${sourceEvent}:inv-1`,
    }));
  });

  it('without an invoice id no idempotency key is used (unrelated emails must not merge)', async () => {
    const { listener, email } = setup();
    await listener.onPaused({ ...payload, invoiceId: undefined });
    expect((email.send.mock.calls[0] as any[])[0]).not.toHaveProperty('idempotencyKey');
  });

  it('past due tells the tenant the grace period', async () => {
    const { listener, email } = setup();
    await listener.onPastDue(payload);
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ graceDays: 7 }) }));
  });

  it("a plugin's past-due and pause emails are told it is not an app", async () => {
    const { listener, email } = setup();
    await listener.onPastDue(payload);
    await listener.onPaused(payload);
    expect((email.send.mock.calls[0] as any[])[0].data).toMatchObject({ isApp: false });
    expect((email.send.mock.calls[1] as any[])[0].data).toMatchObject({ isApp: false, switchedOff: '' });
  });

  it('a complimentary period is announced as an activation at no charge, not a payment', async () => {
    const { listener, notifications, email } = setup({ complimentary: true });

    await listener.onInvoicePaid(payload);

    const notice = (notifications.notifyAdmins.mock.calls[0] as any[])[1];
    expect(notice.title).not.toMatch(/payment/i);
    expect(notice.body).toMatch(/no charge/i);
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ template: 'core.billing-complimentary' }));
  });

  it('an invoice fully covered by credit is not announced as a new invoice (it is settled at once)', async () => {
    const { listener, notifications, email } = setup({ invoice: { total: '0', creditAmount: '150000' } });
    await listener.onInvoiceIssued({ ...payload, total: '0' });
    expect(notifications.notifyAdmins).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('an invoice paid from credit says so and sends a credit receipt, not a payment receipt', async () => {
    const { listener, notifications, email } = setup({ invoice: { total: '0', creditAmount: '150000', paymentProvider: 'credit' } });

    await listener.onInvoicePaid({ ...payload, total: '0' });

    expect(notifications.notifyAdmins).toHaveBeenCalledWith('acme', expect.objectContaining({
      title: 'Paid from your credit',
      body: 'Invoice INV-2026-0042 for "Document Templates" was paid from your credit (Rp 150.000).',
      type: 'SUCCESS',
    }));
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({
      template: 'core.billing-paid-with-credit',
      data: { pluginName: 'Document Templates', number: 'INV-2026-0042', credit: 'Rp 150.000', billingUrl: 'http://web.test/billing' },
    }));
  });

  it('activation failure notifies but sends no email', async () => {
    const { listener, notifications, email } = setup();
    await listener.onActivationFailed(payload);
    expect(notifications.notifyAdmins).toHaveBeenCalledWith('acme', expect.objectContaining({ type: 'WARNING' }));
    expect(email.send).not.toHaveBeenCalled();
  });

  it('an email failure is logged and does not throw', async () => {
    const { listener, email } = setup();
    email.send.mockRejectedValueOnce(new Error('db down'));
    await expect(listener.onInvoiceIssued(payload)).resolves.toBeUndefined();
  });

  it('a notification failure is logged and does not throw', async () => {
    const { listener, notifications } = setup();
    notifications.notifyAdmins.mockRejectedValueOnce(new Error('db down'));
    await expect(listener.onPaused(payload)).resolves.toBeUndefined();
  });

  describe('own subscription replaced by an app', () => {
    const replaced = (over: Record<string, unknown> = {}) => ({
      tenantSlug: 'acme', pluginKey: 'inventory', pluginName: 'Inventory', appKey: 'warehouse', appName: 'Warehouse',
      outcome: 'end-with-credit' as const, credit: '75000', currency: 'IDR', timestamp: new Date(), ...over,
    });

    it('credit for the unused time', async () => {
      const { listener, notifications, email } = setup();
      await listener.onReplaced(replaced());
      expect(notifications.notifyAdmins).toHaveBeenCalledWith('acme', expect.objectContaining({
        title: 'Now part of Warehouse',
        body: '"Inventory" is now included in Warehouse. Rp 75.000 for its unused time was added to your credit.',
        category: 'billing',
        link: '/billing',
        sourceEvent: SystemEvents.BILLING_SUBSCRIPTION_REPLACED,
      }));
      expect(email.send).not.toHaveBeenCalled();
    });

    it('no credit when nothing was left', async () => {
      const { listener, notifications } = setup();
      await listener.onReplaced(replaced({ credit: '0' }));
      expect(notifications.notifyAdmins).toHaveBeenCalledWith('acme', expect.objectContaining({ body: '"Inventory" is now included in Warehouse.' }));
    });

    it('another currency: it won\'t renew', async () => {
      const { listener, notifications } = setup();
      await listener.onReplaced(replaced({ outcome: 'stop-renewing', credit: null, currency: 'USD' }));
      expect(notifications.notifyAdmins).toHaveBeenCalledWith('acme', expect.objectContaining({
        body: '"Inventory" is now included in Warehouse. Its own subscription won\'t renew.',
      }));
    });

    it('trial or unpaid: it has ended', async () => {
      const { listener, notifications } = setup();
      await listener.onReplaced(replaced({ outcome: 'end', credit: null }));
      expect(notifications.notifyAdmins).toHaveBeenCalledWith('acme', expect.objectContaining({
        body: '"Inventory" is now included in Warehouse. Its own subscription has ended.',
      }));
    });
  });

  describe('app invoices', () => {
    const appInvoice = { pluginKey: 'app:warehouse', pluginName: 'Warehouse' };

    it('paused: the app and the plugins that were switched off', async () => {
      const { listener, notifications } = setup({ invoice: appInvoice });
      await listener.onPaused({ ...payload, pluginKey: 'app:warehouse', switchedOff: ['inventory', 'procurement'] });
      expect(notifications.notifyAdmins).toHaveBeenCalledWith('acme', expect.objectContaining({
        title: 'App paused',
        body: '"Warehouse" is paused because invoice INV-2026-0042 is unpaid. Pay it to switch Inventory, Procurement back on.',
      }));
    });

    it('paused: the email says app and names the plugins that were switched off', async () => {
      const { listener, email } = setup({ invoice: appInvoice });
      await listener.onPaused({ ...payload, pluginKey: 'app:warehouse', switchedOff: ['inventory', 'procurement'] });
      expect(email.send).toHaveBeenCalledWith(expect.objectContaining({
        template: 'core.billing-paused',
        data: expect.objectContaining({ pluginName: 'Warehouse', isApp: true, switchedOff: 'Inventory, Procurement' }),
      }));
    });

    it('past due: the email says app', async () => {
      const { listener, email } = setup({ invoice: appInvoice });
      await listener.onPastDue({ ...payload, pluginKey: 'app:warehouse' });
      expect(email.send).toHaveBeenCalledWith(expect.objectContaining({
        template: 'core.billing-past-due',
        data: expect.objectContaining({ pluginName: 'Warehouse', isApp: true }),
      }));
    });

    it('paused with nothing switched off (each plugin is had another way)', async () => {
      const { listener, notifications } = setup({ invoice: appInvoice });
      await listener.onPaused({ ...payload, pluginKey: 'app:warehouse', switchedOff: [] });
      expect(notifications.notifyAdmins).toHaveBeenCalledWith('acme', expect.objectContaining({
        body: '"Warehouse" is paused because invoice INV-2026-0042 is unpaid. Its plugins stay on because you have them another way.',
      }));
    });

    it('complimentary: the app is activated, not a plugin', async () => {
      const { listener, notifications } = setup({ invoice: appInvoice, complimentary: true });
      await listener.onInvoicePaid({ ...payload, pluginKey: 'app:warehouse' });
      expect(notifications.notifyAdmins).toHaveBeenCalledWith('acme', expect.objectContaining({
        title: 'App activated',
        body: '"Warehouse" is active at no charge (complimentary).',
      }));
    });

    it('activation failed: some of its plugins', async () => {
      const { listener, notifications } = setup({ invoice: appInvoice });
      await listener.onActivationFailed({ ...payload, pluginKey: 'app:warehouse' });
      expect(notifications.notifyAdmins).toHaveBeenCalledWith('acme', expect.objectContaining({
        body: 'Invoice INV-2026-0042 is paid, but some of "Warehouse"\'s plugins couldn\'t be switched on. Try enabling them from Tenant Plugins.',
      }));
    });
  });
});
