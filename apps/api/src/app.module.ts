import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { GameEventsModule } from './game-events/game-events.module';
import { RoomsModule } from './rooms/rooms.module';
import { RedisModule } from './redis/redis.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    AuthModule,
    GameEventsModule,
    RedisModule,
    RealtimeModule,
    RoomsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
