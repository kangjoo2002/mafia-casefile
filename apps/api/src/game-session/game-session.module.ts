import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { GAME_SESSION_REPOSITORY } from './game-session';
import { GameSessionService } from './game-session.service';
import { RedisGameSessionRepository } from './redis-game-session.repository';

@Module({
  imports: [RedisModule],
  providers: [
    RedisGameSessionRepository,
    {
      provide: GAME_SESSION_REPOSITORY,
      useExisting: RedisGameSessionRepository,
    },
    GameSessionService,
  ],
  exports: [GameSessionService],
})
export class GameSessionModule {}
