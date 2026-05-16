import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GameEventsModule } from '../game-events/game-events.module';
import { GameSessionModule } from '../game-session/game-session.module';
import { RoomsModule } from '../rooms/rooms.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [AuthModule, GameEventsModule, GameSessionModule, RoomsModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
