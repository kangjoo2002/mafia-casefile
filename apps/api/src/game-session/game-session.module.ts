import { Module } from '@nestjs/common';
import { InMemoryGameSessionRepository } from './in-memory-game-session.repository';
import { GameSessionService } from './game-session.service';

@Module({
  providers: [InMemoryGameSessionRepository, GameSessionService],
  exports: [GameSessionService],
})
export class GameSessionModule {}
