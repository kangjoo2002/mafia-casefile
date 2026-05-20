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

## Game event coverage

- room lifecycle event 기록
  - `pnpm --filter api test:game-event-flow`
- start/role assignment event 기록
  - `pnpm --filter api test:game-event-flow`
- night action visibility
  - `pnpm --filter api test:game-event-flow`
- chat visibility
  - `pnpm --filter api test:game-event-flow`
- phase resolution event order
  - `pnpm --filter api test:game-event-flow`
- voting resolution event order
  - `pnpm --filter api test:game-event-flow`
- timeline public-after-game filter
  - `pnpm --filter api test:game-event-timeline`
  - `pnpm --filter api test:game-event-recorder`
