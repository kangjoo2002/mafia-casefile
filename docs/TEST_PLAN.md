## Game rules coverage

- phase transition rules
  - `pnpm --filter api test:game-rules`
- night action phase/role/alive/target rules
  - `pnpm --filter api test:game-rules`
- voting phase/alive/target/duplicate request rules
  - `pnpm --filter api test:game-rules`
  - `pnpm --filter api test:socket`
- night outcome rules
  - `pnpm --filter api test:game-rules`
- voting outcome rules
  - `pnpm --filter api test:game-rules`
- command rejected reason mapping
  - `pnpm --filter api test:socket`
