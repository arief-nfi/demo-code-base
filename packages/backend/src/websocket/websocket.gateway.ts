import {
  WebSocketGateway as WsGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';

interface JwtPayload {
  sub: string;
  username: string;
  tenantId: string;
  tenantSlug: string;
}

@WsGateway({
  cors: { origin: '*', credentials: true },
  transports: ['websocket', 'polling'],
})
export class WebSocketGatewayService implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(WebSocketGatewayService.name);
  private connectedUsers = new Map<string, { userId: string; tenantSlug: string; username: string }>();

  afterInit() {
    this.logger.log('WebSocket gateway initialized');
  }

  handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.query?.token;
      if (!token) {
        this.logger.warn(`Client ${client.id} disconnected: no token`);
        client.disconnect();
        return;
      }

      const secret = process.env.JWT_SECRET;
      if (!secret) {
        client.disconnect();
        return;
      }

      const decoded = jwt.verify(token as string, secret) as JwtPayload;
      const { sub: userId, username, tenantSlug } = decoded;

      // Store user info
      this.connectedUsers.set(client.id, { userId, tenantSlug, username });

      // Join tenant room
      client.join(`tenant:${tenantSlug}`);
      // Join personal room for user-specific messages
      client.join(`user:${tenantSlug}:${userId}`);

      this.logger.log(`Client ${client.id} connected: user=${username}, tenant=${tenantSlug}`);

      // Notify tenant room of presence
      this.server.to(`tenant:${tenantSlug}`).emit('presence:join', { userId, username });
    } catch (error) {
      this.logger.warn(`Client ${client.id} disconnected: invalid token`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const user = this.connectedUsers.get(client.id);
    if (user) {
      this.server.to(`tenant:${user.tenantSlug}`).emit('presence:leave', {
        userId: user.userId,
        username: user.username,
      });
      this.connectedUsers.delete(client.id);
      this.logger.log(`Client ${client.id} disconnected: user=${user.username}`);
    }
  }

  broadcastToTenant(tenantSlug: string, event: string, data: unknown) {
    this.server.to(`tenant:${tenantSlug}`).emit(event, data);
  }

  broadcastToUser(tenantSlug: string, userId: string, event: string, data: unknown) {
    this.server.to(`user:${tenantSlug}:${userId}`).emit(event, data);
  }

  getOnlineUsers(tenantSlug: string): Array<{ userId: string; username: string }> {
    const users: Array<{ userId: string; username: string }> = [];
    for (const [, user] of this.connectedUsers) {
      if (user.tenantSlug === tenantSlug) {
        users.push({ userId: user.userId, username: user.username });
      }
    }
    return users;
  }
}
