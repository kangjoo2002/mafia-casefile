import type { GameSession, GameSessionRepository } from './game-session';

function cloneGameSession(session: GameSession): GameSession {
  return structuredClone(session);
}

export class InMemoryGameSessionRepository implements GameSessionRepository {
  private readonly sessions = new Map<string, GameSession>();

  async save(session: GameSession): Promise<GameSession> {
    const stored = cloneGameSession(session);
    this.sessions.set(session.gameId, stored);
    return cloneGameSession(stored);
  }

  async findByGameId(gameId: string): Promise<GameSession | null> {
    const session = this.sessions.get(gameId);
    return session ? cloneGameSession(session) : null;
  }
}
