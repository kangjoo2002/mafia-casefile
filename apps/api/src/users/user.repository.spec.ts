import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { PrismaService } from '../prisma/prisma.service';
import { UserRepository } from './user.repository';

const prisma = new PrismaService();
const userRepository = new UserRepository(prisma);

const email = `integration-${randomUUID()}@example.com`;
const createInput = {
  email,
  nickname: 'integration-user',
  passwordHash: 'integration-password-hash',
};

let createdUserId = '';

before(async () => {
  await prisma.$connect();
});

after(async () => {
  if (createdUserId) {
    await prisma.user
      .delete({
        where: {
          id: createdUserId,
        },
      })
      .catch(() => undefined);
  }

  await prisma.$disconnect();
});

test('creates a user', async () => {
  const user = await userRepository.create(createInput);
  createdUserId = user.id;

  assert.equal(user.email, createInput.email);
  assert.equal(user.nickname, createInput.nickname);
  assert.equal(user.passwordHash, createInput.passwordHash);
  assert.ok(user.createdAt instanceof Date);
  assert.ok(user.updatedAt instanceof Date);
});

test('finds a user by email', async () => {
  const user = await userRepository.findByEmail(email);

  assert.ok(user);
  assert.equal(user?.id, createdUserId);
  assert.equal(user?.email, email);
  assert.equal(user?.nickname, createInput.nickname);
});

test('finds a user by id', async () => {
  const user = await userRepository.findById(createdUserId);

  assert.ok(user);
  assert.equal(user?.id, createdUserId);
  assert.equal(user?.email, email);
  assert.equal(user?.nickname, createInput.nickname);
});
