import {
  BeforeApplicationShutdown,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy, BeforeApplicationShutdown
{
  constructor() {
    const connectionString =
      process.env.DATABASE_URL ??
      'postgresql://mafia:mafia_password@localhost:5432/mafia_casefile';

    super({
      adapter: new PrismaPg({
        connectionString,
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async beforeApplicationShutdown() {
    await this.$disconnect();
  }
}
