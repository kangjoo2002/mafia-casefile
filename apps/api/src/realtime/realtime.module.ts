import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GameCommandModule } from '../game-commands/game-command.module';
import { RedisModule } from '../redis/redis.module';
import { ConnectionStateService } from './connection-state.service';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [AuthModule, GameCommandModule, RedisModule],
  providers: [ConnectionStateService, RealtimeGateway],
})
export class RealtimeModule {}
