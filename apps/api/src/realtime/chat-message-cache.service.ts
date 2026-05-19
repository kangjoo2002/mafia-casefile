import { Inject, Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import type { ChatChannel, ChatMessageEvent } from '@mafia-casefile/shared';

export interface CachedChatMessage extends ChatMessageEvent {}

@Injectable()
export class ChatMessageCacheService {
  constructor(@Inject(RedisService) private readonly redisService: RedisService) {}

  async append(message: CachedChatMessage): Promise<void> {
    const limit = this.resolveLimit();
    const ttlSeconds = this.resolveTtlSeconds();
    const key = this.key(message.gameId, message.channel);
    const payload = JSON.stringify(message);
    const client = this.redisService.getClient() as any;

    await client.rpush(this.redisService.buildKey(key), payload);
    await client.ltrim(this.redisService.buildKey(key), -limit, -1);
    await client.expire(this.redisService.buildKey(key), ttlSeconds);
  }

  async getRecent(input: {
    gameId: string;
    channel: CachedChatMessage['channel'];
    limit?: number;
  }): Promise<CachedChatMessage[]> {
    const key = this.redisService.buildKey(this.key(input.gameId, input.channel));
    const effectiveLimit = this.resolveLimit(input.limit);
    const client = this.redisService.getClient() as any;
    const values = (await client.lrange(
      key,
      effectiveLimit > 0 ? -effectiveLimit : 0,
      -1,
    )) as string[];

    const messages: CachedChatMessage[] = [];

    for (const value of values) {
      const parsed = this.parseMessage(value);
      if (!parsed) {
        continue;
      }

      if (parsed.channel !== input.channel) {
        continue;
      }

      messages.push(parsed);
    }

    return messages;
  }

  async clear(input: {
    gameId: string;
    channel: CachedChatMessage['channel'];
  }): Promise<void> {
    await this.redisService.del(this.key(input.gameId, input.channel));
  }

  private key(gameId: string, channel: ChatChannel) {
    return `chat:recent:${gameId}:${channel}`;
  }

  private parseMessage(raw: string): CachedChatMessage | null {
    try {
      const parsed = JSON.parse(raw) as CachedChatMessage;

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        parsed.type !== 'chat:message' ||
        typeof parsed.gameId !== 'string' ||
        typeof parsed.channel !== 'string' ||
        typeof parsed.message !== 'string' ||
        (typeof parsed.senderUserId !== 'string' && parsed.senderUserId !== null) ||
        typeof parsed.sentAt !== 'string'
      ) {
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  private resolveLimit(
    raw: string | number | undefined = process.env.CHAT_CACHE_LIMIT,
  ): number {
    if (!raw) {
      return 50;
    }

    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : 50;
  }

  private resolveTtlSeconds(
    raw: string | number | undefined = process.env.CHAT_CACHE_TTL_SECONDS,
  ): number {
    if (!raw) {
      return 86400;
    }

    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : 86400;
  }
}
