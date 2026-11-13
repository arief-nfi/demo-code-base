import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '@saas/backend';
import { CheckoutService, type FakeCheckoutView } from './checkout.service';
import type { CallbackHeaders } from './providers/payment-provider';
import { simulateSchema, type SimulateDto } from './billing.schemas';

/**
 * No login: payment providers call the callback route, and the fake payment page is
 * opened by URL like a hosted checkout (the checkout id is the secret). Callbacks are
 * authenticated by the provider's token; the fake routes 404 unless the fake provider is active.
 */
@ApiTags('Billing (public)')
@Controller('billing')
export class BillingPublicController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post('callbacks/:provider')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @ApiOperation({ summary: 'Payment provider callback' })
  callback(@Param('provider') provider: string, @Headers() headers: CallbackHeaders, @Body() body: unknown): Promise<{ handled: boolean }> {
    return this.checkout.handleCallback(provider, headers, body);
  }

  @Get('fake/checkouts/:id')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Fake payment page data (test mode only)' })
  getFakeCheckout(@Param('id', ParseUUIDPipe) id: string): Promise<FakeCheckoutView> {
    return this.checkout.getFakeCheckout(id);
  }

  @Post('fake/checkouts/:id/simulate')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Simulate a payment outcome (test mode only)' })
  simulate(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(simulateSchema)) body: SimulateDto): Promise<{ redirectUrl: string }> {
    return this.checkout.simulateFake(id, body.outcome);
  }
}
