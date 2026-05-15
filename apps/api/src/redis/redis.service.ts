import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly client: Redis;
  private readonly keyPrefix: string;

  constructor() {
    this.keyPrefix = process.env.REDIS_KEY_PREFIX ?? 'mafia-casefile';
    this.client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  }

  async onModuleInit() {
    await this.ping();
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  ping() {
    return this.client.ping();
  }

  get(key: string) {
    return this.client.get(this.buildKey(key));
  }

  async set(key: string, value: string, ttlSeconds?: number) {
    const namespacedKey = this.buildKey(key);

    if (typeof ttlSeconds === 'number') {
      return this.client.set(namespacedKey, value, 'EX', ttlSeconds);
    }

    return this.client.set(namespacedKey, value);
  }

  del(key: string) {
    return this.client.del(this.buildKey(key));
  }

  buildKey(...parts: string[]) {
    return [this.keyPrefix, ...parts].join(':');
  }

  getClient() {
    return this.client;
  }
}
