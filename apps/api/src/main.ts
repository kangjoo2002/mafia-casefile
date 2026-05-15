import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.enableShutdownHooks();

  const port = Number(process.env.API_PORT ?? 3001);
  const safePort = Number.isFinite(port) && port > 0 ? port : 3001;

  await app.listen(safePort, '0.0.0.0');
}

void bootstrap();
