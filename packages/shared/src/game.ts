export type GamePhase =
  | "WAITING"
  | "NIGHT"
  | "DAY_DISCUSSION"
  | "VOTING"
  | "RESULT"
  | "FINISHED";

export type Role = "MAFIA" | "CITIZEN" | "DOCTOR" | "POLICE";

export type PlayerStatus = "ALIVE" | "DEAD";

export type ConnectionStatus = "CONNECTED" | "DISCONNECTED";
