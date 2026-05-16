import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GameEventRecorderService } from './game-event-recorder.service';

@Module({
  imports: [PrismaModule],
  providers: [GameEventRecorderService],
  exports: [GameEventRecorderService],
})
export class GameEventsModule {}
