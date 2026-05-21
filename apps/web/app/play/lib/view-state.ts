export type PlayViewState =
  | "ENTRY"
  | "ROOM_SETUP"
  | "LOBBY"
  | "GAME_NIGHT"
  | "GAME_DAY"
  | "GAME_VOTING"
  | "GAME_RESULT";

export function deriveViewState(input: {
  connected: boolean;
  inRoom: boolean;
  isGameStarted: boolean;
  phase: string;
}): PlayViewState {
  if (!input.connected) {
    return "ENTRY";
  }

  if (!input.inRoom) {
    return "ROOM_SETUP";
  }

  if (!input.isGameStarted) {
    return "LOBBY";
  }

  switch (input.phase) {
    case "NIGHT":
      return "GAME_NIGHT";
    case "DAY_DISCUSSION":
      return "GAME_DAY";
    case "VOTING":
      return "GAME_VOTING";
    case "RESULT":
    case "FINISHED":
      return "GAME_RESULT";
    default:
      return "GAME_RESULT";
  }
}
