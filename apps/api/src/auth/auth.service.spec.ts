import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { PrismaService } from '../prisma/prisma.service';
import { UserRepository } from '../users/user.repository';
import { AuthService } from './auth.service';
import { JwtService } from './jwt.service';
import { PasswordService } from './password.service';

const prisma = new PrismaService();
const userRepository = new UserRepository(prisma);
const passwordService = new PasswordService();
const jwtService = new JwtService();
const authService = new AuthService(userRepository, passwordService, jwtService);

const email = `auth-${randomUUID()}@example.com`;
const password = 'password1234';
const nickname = 'auth-user';

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

test('signup succeeds', async () => {
  const result = await authService.signup({
    email,
    nickname,
    password,
  });

  createdUserId = result.user.id;

  assert.equal(result.user.email, email);
  assert.equal(result.user.nickname, nickname);
  assert.ok(result.accessToken.length > 0);
  assert.equal('passwordHash' in result.user, false);

  const storedUser = await userRepository.findByEmail(email);
  assert.ok(storedUser);
  assert.notEqual(storedUser?.passwordHash, password);
  assert.ok((storedUser?.passwordHash ?? '').length > 0);

  const payload = jwtService.verifyAccessToken(result.accessToken);
  assert.equal(payload.sub, result.user.id);
  assert.equal(payload.email, email);
});

test('duplicate signup fails', async () => {
  await assert.rejects(
    authService.signup({
      email,
      nickname: 'duplicate-user',
      password,
    }),
    (error) => error instanceof Error && error.name === 'ConflictException',
  );
});

test('login succeeds', async () => {
  const result = await authService.login({
    email,
    password,
  });

  assert.equal(result.user.id, createdUserId);
  assert.equal(result.user.email, email);
  assert.equal('passwordHash' in result.user, false);
  assert.ok(result.accessToken.length > 0);

  const payload = jwtService.verifyAccessToken(result.accessToken);
  assert.equal(payload.sub, createdUserId);
  assert.equal(payload.email, email);
});

test('login fails for missing email', async () => {
  await assert.rejects(
    authService.login({
      email: `missing-${randomUUID()}@example.com`,
      password,
    }),
    (error) => error instanceof Error && error.name === 'UnauthorizedException',
  );
});

test('login fails for wrong password', async () => {
  await assert.rejects(
    authService.login({
      email,
      password: 'wrong-password',
    }),
    (error) => error instanceof Error && error.name === 'UnauthorizedException',
  );
});
