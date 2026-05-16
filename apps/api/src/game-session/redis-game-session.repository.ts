import { Inject, Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import type {
  GameSession,
  GameSessionPlayer,
  GameSessionRepository,
} from './game-session';

type SerializedGameSessionPlayer = Omit<GameSessionPlayer, 'lastSeenAt'> & {
  lastSeenAt: string;
};

type SerializedGameSession = Omit<
  GameSession,
  'players' | 'createdAt' | 'updatedAt' | 'phaseEndsAt'
> & {
  players: SerializedGameSessionPlayer[];
  createdAt: string;
  updatedAt: string;
  phaseEndsAt: string | null;
};

function serializeGameSession(session: GameSession): SerializedGameSession {
  const cloned = structuredClone(session);

  return {
    ...cloned,
    createdAt: cloned.createdAt.toISOString(),
    updatedAt: cloned.updatedAt.toISOString(),
    phaseEndsAt: cloned.phaseEndsAt ? cloned.phaseEndsAt.toISOString() : null,
    players: cloned.players.map((player) => ({
      ...player,
      lastSeenAt: player.lastSeenAt.toISOString(),
    })),
  };
}

function deserializeGameSession(session: SerializedGameSession): GameSession {
  return {
    ...session,
    createdAt: new Date(session.createdAt),
    updatedAt: new Date(session.updatedAt),
    phaseEndsAt: session.phaseEndsAt ? new Date(session.phaseEndsAt) : null,
    players: session.players.map((player) => ({
      ...player,
      lastSeenAt: new Date(player.lastSeenAt),
    })),
  };
}

@Injectable()
export class RedisGameSessionRepository implements GameSessionRepository {
  constructor(@Inject(RedisService) private readonly redisService: RedisService) {}

  async save(session: GameSession): Promise<GameSession> {
    const payload = serializeGameSession(session);
    await this.redisService.set(this.key(session.gameId), JSON.stringify(payload));
    return deserializeGameSession(payload);
  }

  async findByGameId(gameId: string): Promise<GameSession | null> {
    const raw = await this.redisService.get(this.key(gameId));

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as SerializedGameSession;
    return deserializeGameSession(parsed);
  }

  private key(gameId: string) {
    return `game-session:${gameId}`;
  }
}
