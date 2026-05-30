import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;

  async connectToRedis() {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.pubClient = new Redis(redisUrl);
    this.subClient = this.pubClient.duplicate();

    await Promise.all([this.pubClient.ping(), this.subClient.ping()]);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options) as Server;

    if (!this.pubClient || !this.subClient) {
      throw new Error('RedisIoAdapter must connect to Redis before creating server');
    }

    server.adapter(
      createAdapter(this.pubClient, this.subClient, {
        key: this.resolveAdapterKey(),
      }),
    );

    return server;
  }

  async close(server: Server) {
    await super.close(server);
    await Promise.all([
      this.pubClient?.quit(),
      this.subClient?.quit(),
    ]);
    this.pubClient = null;
    this.subClient = null;
  }

  private resolveAdapterKey() {
    return (
      process.env.SOCKET_IO_REDIS_KEY ??
      `${process.env.REDIS_KEY_PREFIX ?? 'mafia-casefile'}:socket.io`
    );
  }
}
