import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const defaultDatabaseUrl =
  'postgresql://mafia:mafia_password@localhost:5432/mafia_casefile';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? defaultDatabaseUrl,
  },
});
