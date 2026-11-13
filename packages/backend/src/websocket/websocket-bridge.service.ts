import { Injectable } from '@nestjs/common';
import { WebSocketGatewayService } from './websocket.gateway';

/**
 * The way services send realtime messages to browsers. Only what a caller sends
 * explicitly goes out: in-process events are never forwarded, because everyone signed
 * in to the tenant (or the user) receives a message, whatever their permissions.
 */
@Injectable()
export class WebSocketBridgeService {
  constructor(private readonly gateway: WebSocketGatewayService) {}

  broadcastToTenant(tenantSlug: string, event: string, data: unknown) {
    this.gateway.broadcastToTenant(tenantSlug, event, data);
  }

  broadcastToUser(tenantSlug: string, userId: string, event: string, data: unknown) {
    this.gateway.broadcastToUser(tenantSlug, userId, event, data);
  }
}
