import { Global, Module } from '@nestjs/common';
import { WebSocketGatewayService } from './websocket.gateway';
import { WebSocketBridgeService } from './websocket-bridge.service';

@Global()
@Module({
  providers: [WebSocketGatewayService, WebSocketBridgeService],
  exports: [WebSocketGatewayService, WebSocketBridgeService],
})
export class WebSocketModule {}
