import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { RedisModule } from './redis/redis.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [AuthModule, RedisModule, RealtimeModule],
  controllers: [AppController],
})
export class AppModule {}
