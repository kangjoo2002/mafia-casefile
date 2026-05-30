import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { ROOM_REPOSITORY } from './room.repository';
import { RedisRoomRepository } from './redis-room.repository';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

@Module({
  imports: [RedisModule],
  controllers: [RoomsController],
  providers: [
    RedisRoomRepository,
    {
      provide: ROOM_REPOSITORY,
      useExisting: RedisRoomRepository,
    },
    RoomsService,
  ],
  exports: [RoomsService],
})
export class RoomsModule {}
