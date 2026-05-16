import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GameEventsController } from './game-events.controller';
import { GameEventRecorderService } from './game-event-recorder.service';

@Module({
  imports: [PrismaModule],
  controllers: [GameEventsController],
  providers: [GameEventRecorderService],
  exports: [GameEventRecorderService],
})
export class GameEventsModule {}
