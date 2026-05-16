import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GameCommandModule } from '../game-commands/game-command.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [AuthModule, GameCommandModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
