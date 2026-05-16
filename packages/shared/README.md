# @mafia-casefile/shared

Shared TypeScript types used by the API and web apps.

Included today:

- `GamePhase`, `Role`, `PlayerStatus`, `ConnectionStatus`
- `SocketUser`, `PongEvent`, `WhoamiEvent`
- `CommandEnvelope`, `EventEnvelope`, `CommandAcceptedEvent`, `CommandRejectedEvent`, `EventVisibility`

Examples:

```ts
import type { GamePhase } from "@mafia-casefile/shared";
import type { SocketUser } from "@mafia-casefile/shared";
import type { CommandEnvelope } from "@mafia-casefile/shared";
```
