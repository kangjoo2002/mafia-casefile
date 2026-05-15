import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [AuthModule, RedisModule],
  controllers: [AppController],
})
export class AppModule {}
