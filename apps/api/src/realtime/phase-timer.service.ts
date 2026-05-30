import { Inject, Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

export interface PhaseTimerEntry {
  gameId: string;
  phaseEndsAt: string;
}

@Injectable()
export class PhaseTimerService {
  constructor(@Inject(RedisService) private readonly redisService: RedisService) {}

  async schedule(entry: PhaseTimerEntry): Promise<void> {
    const score = Date.parse(entry.phaseEndsAt);

    if (!Number.isFinite(score)) {
      await this.clearGame(entry.gameId);
      return;
    }

    const client = this.redisService.getClient();
    const key = this.redisService.buildKey(this.key());

    await this.clearGame(entry.gameId);
    await client.zadd(key, score, this.serialize(entry));
  }

  async clearGame(gameId: string): Promise<void> {
    const client = this.redisService.getClient();
    const key = this.redisService.buildKey(this.key());
    const members = await client.zrange(key, 0, -1);
    const staleMembers = members.filter((member) => {
      const entry = this.deserialize(member);
      return entry?.gameId === gameId;
    });

    if (staleMembers.length > 0) {
      await client.zrem(key, ...staleMembers);
    }
  }

  async listDue(nowMs = Date.now(), limit = 20): Promise<PhaseTimerEntry[]> {
    const client = this.redisService.getClient();
    const key = this.redisService.buildKey(this.key());
    const members = await client.zrangebyscore(key, '-inf', nowMs, 'LIMIT', 0, limit);
    const entries: PhaseTimerEntry[] = [];
    const invalidMembers: string[] = [];

    for (const member of members) {
      const entry = this.deserialize(member);

      if (!entry) {
        invalidMembers.push(member);
        continue;
      }

      entries.push(entry);
    }

    if (invalidMembers.length > 0) {
      await client.zrem(key, ...invalidMembers);
    }

    return entries;
  }

  async complete(entry: PhaseTimerEntry): Promise<void> {
    await this.redisService
      .getClient()
      .zrem(this.redisService.buildKey(this.key()), this.serialize(entry));
  }

  private key() {
    return 'phase-timers';
  }

  private serialize(entry: PhaseTimerEntry) {
    return JSON.stringify(entry);
  }

  private deserialize(value: string): PhaseTimerEntry | null {
    try {
      const parsed = JSON.parse(value) as {
        gameId?: unknown;
        phaseEndsAt?: unknown;
      };

      if (
        typeof parsed.gameId !== 'string' ||
        parsed.gameId.length === 0 ||
        typeof parsed.phaseEndsAt !== 'string' ||
        parsed.phaseEndsAt.length === 0
      ) {
        return null;
      }

      return {
        gameId: parsed.gameId,
        phaseEndsAt: parsed.phaseEndsAt,
      };
    } catch {
      return null;
    }
  }
}
