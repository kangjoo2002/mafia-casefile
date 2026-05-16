import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GameEventsModule } from '../game-events/game-events.module';
import { RoomsModule } from '../rooms/rooms.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [AuthModule, GameEventsModule, RoomsModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
