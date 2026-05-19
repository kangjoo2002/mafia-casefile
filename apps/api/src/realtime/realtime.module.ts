import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GameCommandModule } from '../game-commands/game-command.module';
import { GameSessionModule } from '../game-session/game-session.module';
import { RedisModule } from '../redis/redis.module';
import { ConnectionStateService } from './connection-state.service';
import { ChatMessageCacheService } from './chat-message-cache.service';
import { GameCommandLockService } from './game-command-lock.service';
import { RequestIdempotencyService } from './request-idempotency.service';
import { ReconnectStateService } from './reconnect-state.service';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [AuthModule, GameCommandModule, GameSessionModule, RedisModule],
  providers: [
    ConnectionStateService,
    ChatMessageCacheService,
    GameCommandLockService,
    RequestIdempotencyService,
    ReconnectStateService,
    RealtimeGateway,
  ],
})
export class RealtimeModule {}
