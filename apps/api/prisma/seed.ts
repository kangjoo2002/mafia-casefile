import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://mafia:mafia_password@localhost:5432/mafia_casefile';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString,
  }),
});

async function main() {
  await prisma.user.upsert({
    where: {
      email: 'dev@example.com',
    },
    update: {
      nickname: 'dev',
      passwordHash: 'dev-password-hash',
    },
    create: {
      email: 'dev@example.com',
      nickname: 'dev',
      passwordHash: 'dev-password-hash',
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
