import { Test } from '@nestjs/testing';
import { ExecutionContext, INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import * as request from 'supertest';
import { JwtAuthGuard, RbacGuard } from '@saas/backend';
import type { TenantContext } from '@saas/backend';
import { BillingController } from './billing.controller';
import { BillingSettingsService } from './billing-settings.service';
import { InvoiceService } from './invoice.service';
import { CheckoutService } from './checkout.service';
import { SubscriptionsService } from './subscriptions.service';
import { CreditService } from './credit.service';

describe('BillingController (routes)', () => {
  let app: INestApplication;
  const subscriptions = {
    subscribe: jest.fn(async () => ({ subscription: { status: 'PENDING_PAYMENT' }, invoiceId: 'inv-1', failedPlugins: [] })),
    cancel: jest.fn(async () => ({ status: 'ENDED' })),
    resume: jest.fn(async () => ({ status: 'ACTIVE' })),
  };
  const invoices = { getForTenant: jest.fn(async () => ({ id: 'inv-1', total: '200000', currency: 'IDR' })) };
  const checkout = { createCheckout: jest.fn(async () => ({ checkoutUrl: 'http://web.test/pay/c-1' })) };
  const credits = { balances: jest.fn(async () => [{ currency: 'IDR', amount: '75000' }]) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [
        { provide: BillingSettingsService, useValue: {} },
        { provide: InvoiceService, useValue: invoices },
        { provide: CheckoutService, useValue: checkout },
        { provide: SubscriptionsService, useValue: subscriptions },
        { provide: CreditService, useValue: credits },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().user = { userId: 'user-1', tenantSlug: 'acme' };
          return true;
        },
      })
      .overrideGuard(RbacGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.tenant = { id: 't1', slug: 'acme' } as TenantContext;
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('routes an encoded app key to the subscription service', async () => {
    const res = await request(app.getHttpServer()).post('/billing/subscriptions/app%3Awarehouse').expect(201);

    expect(subscriptions.subscribe).toHaveBeenCalledWith('acme', 't1', 'app:warehouse', 'user-1');
    expect(res.body.checkoutUrl).toBe('http://web.test/pay/c-1');
    expect(res.body.failedPlugins).toEqual([]);
  });

  it('cancel and resume receive the decoded app key too', async () => {
    await request(app.getHttpServer()).post('/billing/subscriptions/app%3Awarehouse/cancel').expect(200);
    await request(app.getHttpServer()).post('/billing/subscriptions/app%3Awarehouse/resume').expect(200);

    expect(subscriptions.cancel).toHaveBeenCalledWith('acme', 't1', 'app:warehouse', 'user-1');
    expect(subscriptions.resume).toHaveBeenCalledWith('acme', 'app:warehouse');
  });

  it('a first invoice fully covered by credit needs no payment link', async () => {
    invoices.getForTenant.mockResolvedValueOnce({ id: 'inv-1', total: '0', currency: 'IDR' });

    const res = await request(app.getHttpServer()).post('/billing/subscriptions/app%3Awarehouse').expect(201);

    expect(res.body.checkoutUrl).toBeNull();
    expect(checkout.createCheckout).not.toHaveBeenCalled();
  });

  it('GET /billing/credit returns the tenant\'s balances', async () => {
    const res = await request(app.getHttpServer()).get('/billing/credit').expect(200);
    expect(res.body).toEqual([{ currency: 'IDR', amount: '75000' }]);
    expect(credits.balances).toHaveBeenCalledWith('t1');
  });
});
