import { Module } from '@nestjs/common';
import { GameEventsModule } from '../game-events/game-events.module';
import { GameSessionModule } from '../game-session/game-session.module';
import { RoomsModule } from '../rooms/rooms.module';
import { GameCommandService } from './game-command.service';

@Module({
  imports: [RoomsModule, GameSessionModule, GameEventsModule],
  providers: [GameCommandService],
  exports: [GameCommandService],
})
export class GameCommandModule {}
