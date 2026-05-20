import { Injectable } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';

@Injectable()
export class PersonalEventChannelService {
  userRoom(userId: string): string {
    return `user:${userId}`;
  }

  async joinUserRoom(client: Socket, userId: string): Promise<void> {
    await client.join(this.userRoom(userId));
  }

  emitToUser(
    server: Server,
    userId: string,
    eventName: string,
    payload: unknown,
  ): void {
    server.to(this.userRoom(userId)).emit(eventName, payload);
  }

  emitToSocket(
    client: Socket,
    eventName: string,
    payload: unknown,
  ): void {
    client.emit(eventName, payload);
  }
}
