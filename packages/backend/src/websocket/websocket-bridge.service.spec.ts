import { Test } from '@nestjs/testing';
import { EventsModule } from '../events/events.module';
import { PluginEventService } from '../events/plugin-event.service';
import { WebSocketBridgeService } from './websocket-bridge.service';
import { WebSocketGatewayService } from './websocket.gateway';

describe('WebSocketBridgeService', () => {
  async function setup() {
    const gateway = { broadcastToTenant: jest.fn(), broadcastToUser: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      imports: [EventsModule],
      providers: [WebSocketBridgeService, { provide: WebSocketGatewayService, useValue: gateway }],
    }).compile();
    // Runs Nest's @OnEvent loader, as in the app
    await moduleRef.init();
    return { moduleRef, gateway, bridge: moduleRef.get(WebSocketBridgeService), events: moduleRef.get(PluginEventService) };
  }

  it("doesn't forward in-process events to the tenant's browsers", async () => {
    const { moduleRef, gateway, events } = await setup();

    // Every signed-in user of the tenant would receive it, whatever their permissions
    events.emit('user.created', { tenantSlug: 'acme', userId: 'u2', username: 'new', email: 'new@acme.test', roles: ['ADMIN'], timestamp: new Date() });
    await new Promise((resolve) => setImmediate(resolve));

    expect(gateway.broadcastToTenant).not.toHaveBeenCalled();
    expect(gateway.broadcastToUser).not.toHaveBeenCalled();
    await moduleRef.close();
  });

  it('broadcasts what a caller sends, to the tenant or to one user', async () => {
    const { moduleRef, gateway, bridge } = await setup();

    bridge.broadcastToTenant('acme', 'notification:new', { id: 'n1' });
    bridge.broadcastToUser('acme', 'u1', 'export.ready', { id: 'e1' });

    expect(gateway.broadcastToTenant).toHaveBeenCalledWith('acme', 'notification:new', { id: 'n1' });
    expect(gateway.broadcastToUser).toHaveBeenCalledWith('acme', 'u1', 'export.ready', { id: 'e1' });
    await moduleRef.close();
  });
});
