import {
  Logger,
} from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`connected ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`disconnected ${client.id}`);
  }

  @SubscribeMessage('ping')
  handlePing(
    @MessageBody() _body: unknown,
    @ConnectedSocket() client: Socket,
  ) {
    client.emit('pong', {
      type: 'pong',
      timestamp: new Date().toISOString(),
    });
  }
}
