# DB Schema

## 현재 DB 범위

현재 애플리케이션은 PostgreSQL에 `User` 테이블만 사용한다. 인증, 세션, 게임 기록, 기타 도메인 테이블은 아직 추가하지 않는다.

## User 테이블

- `id`: 문자열 기본키, `cuid()` 기본값
- `email`: 사용자 이메일, 고유값
- `nickname`: 표시 이름
- `passwordHash`: 비밀번호 해시
- `createdAt`: 생성 시각, `now()` 기본값
- `updatedAt`: 수정 시각, 변경 시 자동 갱신

## DATABASE_URL 예시

```bash
DATABASE_URL="postgresql://mafia:mafia_password@localhost:5432/mafia_casefile"
```

## Migration 실행 명령

```bash
pnpm --filter api prisma:migrate:dev -- --name init_user
```

## Seed 실행 명령

```bash
pnpm --filter api prisma:seed
```
