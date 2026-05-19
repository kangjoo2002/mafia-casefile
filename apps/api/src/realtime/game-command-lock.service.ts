import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../redis/redis.service';

export interface GameCommandLock {
  gameId: string;
  token: string;
}

export type GameCommandLockResult =
  | { status: 'ACQUIRED'; value: unknown }
  | { status: 'BUSY' };

@Injectable()
export class GameCommandLockService {
  constructor(@Inject(RedisService) private readonly redisService: RedisService) {}

  async acquire(input: { gameId: string }): Promise<GameCommandLock | null> {
    const ttlMs = this.resolveTtlMs();
    const waitMs = this.resolveWaitMs();
    const retryMs = this.resolveRetryMs();
    const startedAt = Date.now();

    while (Date.now() - startedAt <= waitMs) {
      const token = randomUUID();
      const result = await (this.redisService.getClient() as any).call(
        'SET',
        this.redisService.buildKey(this.key(input.gameId)),
        token,
        'NX',
        'PX',
        ttlMs,
      );

      if (result === 'OK') {
        return {
          gameId: input.gameId,
          token,
        };
      }

      const elapsed = Date.now() - startedAt;
      const remaining = waitMs - elapsed;

      if (remaining <= 0) {
        break;
      }

      await this.sleep(Math.min(retryMs, remaining));
    }

    return null;
  }

  async release(lock: GameCommandLock): Promise<boolean> {
    const result = await (this.redisService.getClient() as any).eval(
      'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0',
      1,
      this.redisService.buildKey(this.key(lock.gameId)),
      lock.token,
    );

    return result === 1 || result === '1';
  }

  async withLock<T>(
    input: { gameId: string },
    callback: () => Promise<T>,
  ): Promise<
    | {
        status: 'ACQUIRED';
        value: T;
      }
    | { status: 'BUSY' }
  > {
    const lock = await this.acquire(input);

    if (!lock) {
      return { status: 'BUSY' };
    }

    try {
      const value = await callback();
      return {
        status: 'ACQUIRED',
        value,
      };
    } finally {
      try {
        await this.release(lock);
      } catch {
        // Best-effort release; TTL protects against leaked locks.
      }
    }
  }

  private key(gameId: string) {
    return `lock:game:${gameId}`;
  }

  private resolveTtlMs() {
    const raw = process.env.GAME_COMMAND_LOCK_TTL_MS;

    if (!raw) {
      return 5000;
    }

    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : 5000;
  }

  private resolveWaitMs() {
    const raw = process.env.GAME_COMMAND_LOCK_WAIT_MS;

    if (!raw) {
      return 1000;
    }

    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : 1000;
  }

  private resolveRetryMs() {
    const raw = process.env.GAME_COMMAND_LOCK_RETRY_MS;

    if (!raw) {
      return 50;
    }

    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : 50;
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
