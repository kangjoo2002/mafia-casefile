import { Inject, Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

export type RealtimeConnectionStatus = 'CONNECTED' | 'DISCONNECTED';

export interface RealtimeConnectionState {
  userId: string;
  socketId: string;
  roomId: string | null;
  status: RealtimeConnectionStatus;
  connectedAt: string;
  lastSeenAt: string;
  disconnectedAt: string | null;
}

@Injectable()
export class ConnectionStateService {
  constructor(@Inject(RedisService) private readonly redisService: RedisService) {}

  async markConnected(input: { userId: string; socketId: string }): Promise<RealtimeConnectionState> {
    const now = new Date().toISOString();
    const state: RealtimeConnectionState = {
      userId: input.userId,
      socketId: input.socketId,
      roomId: null,
      status: 'CONNECTED',
      connectedAt: now,
      lastSeenAt: now,
      disconnectedAt: null,
    };

    return await this.saveState(state);
  }

  async markDisconnected(input: { userId: string; socketId: string }): Promise<RealtimeConnectionState> {
    const current = (await this.findByUserId(input.userId)) ?? this.createBaseState(input);
    const now = new Date().toISOString();
    const state: RealtimeConnectionState = {
      ...current,
      userId: input.userId,
      socketId: input.socketId,
      status: 'DISCONNECTED',
      lastSeenAt: now,
      disconnectedAt: now,
    };

    return await this.saveState(state);
  }

  async setRoom(input: { userId: string; socketId: string; roomId: string }): Promise<RealtimeConnectionState> {
    const current = (await this.findByUserId(input.userId)) ?? this.createBaseState(input);
    const now = new Date().toISOString();
    const state: RealtimeConnectionState = {
      ...current,
      userId: input.userId,
      socketId: input.socketId,
      roomId: input.roomId,
      status: 'CONNECTED',
      lastSeenAt: now,
      disconnectedAt: null,
    };

    return await this.saveState(state);
  }

  async clearRoom(input: { userId: string; socketId: string; roomId: string }): Promise<RealtimeConnectionState> {
    const current = await this.findByUserId(input.userId);

    if (!current) {
      return await this.saveState(this.createBaseState(input));
    }

    if (current.roomId !== input.roomId) {
      return current;
    }

    const now = new Date().toISOString();
    const state: RealtimeConnectionState = {
      ...current,
      userId: input.userId,
      socketId: input.socketId,
      roomId: null,
      status: 'CONNECTED',
      lastSeenAt: now,
      disconnectedAt: null,
    };

    return await this.saveState(state);
  }

  async findByUserId(userId: string): Promise<RealtimeConnectionState | null> {
    const raw = await this.redisService.get(this.userKey(userId));
    const parsed = this.parseState(raw);
    return parsed ? structuredClone(parsed) : null;
  }

  async findUserIdBySocketId(socketId: string): Promise<string | null> {
    const raw = await this.redisService.get(this.socketKey(socketId));
    const parsed = this.parseState(raw);
    return parsed?.userId ?? null;
  }

  private async saveState(state: RealtimeConnectionState): Promise<RealtimeConnectionState> {
    const payload = JSON.stringify(state);
    const ttlSeconds = this.resolveTtlSeconds();

    await Promise.all([
      this.redisService.set(this.userKey(state.userId), payload, ttlSeconds),
      this.redisService.set(this.socketKey(state.socketId), payload, ttlSeconds),
    ]);

    return structuredClone(state);
  }

  private parseState(raw: string | null): RealtimeConnectionState | null {
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as RealtimeConnectionState;

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof parsed.userId !== 'string' ||
        typeof parsed.socketId !== 'string'
      ) {
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  private createBaseState(input: { userId: string; socketId: string }): RealtimeConnectionState {
    const now = new Date().toISOString();

    return {
      userId: input.userId,
      socketId: input.socketId,
      roomId: null,
      status: 'CONNECTED',
      connectedAt: now,
      lastSeenAt: now,
      disconnectedAt: null,
    };
  }

  private userKey(userId: string) {
    return `connection:user:${userId}`;
  }

  private socketKey(socketId: string) {
    return `connection:socket:${socketId}`;
  }

  private resolveTtlSeconds() {
    const raw = process.env.CONNECTION_STATE_TTL_SECONDS;

    if (!raw) {
      return 86400;
    }

    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : 86400;
  }
}
