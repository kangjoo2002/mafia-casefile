import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { UserRepository } from './users/user.repository';

@Module({
  imports: [PrismaModule],
  controllers: [AppController],
  providers: [UserRepository],
})
export class AppModule {}
