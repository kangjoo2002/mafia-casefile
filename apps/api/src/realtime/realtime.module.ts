import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GameCommandModule } from '../game-commands/game-command.module';
import { RedisModule } from '../redis/redis.module';
import { ConnectionStateService } from './connection-state.service';
import { ChatMessageCacheService } from './chat-message-cache.service';
import { GameCommandLockService } from './game-command-lock.service';
import { RequestIdempotencyService } from './request-idempotency.service';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [AuthModule, GameCommandModule, RedisModule],
  providers: [
    ConnectionStateService,
    ChatMessageCacheService,
    GameCommandLockService,
    RequestIdempotencyService,
    RealtimeGateway,
  ],
})
export class RealtimeModule {}
