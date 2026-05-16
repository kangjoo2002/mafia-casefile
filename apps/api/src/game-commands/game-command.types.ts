export interface GameCommandUser {
  id: string;
  email: string;
}

export interface GameCommandEnvelope {
  requestId: string;
  gameId: string;
  type: string;
  payload: unknown;
}

export interface GameCommandRoomJoinEffect {
  kind: 'join';
  roomId: string;
}

export interface GameCommandRoomLeaveEffect {
  kind: 'leave';
  roomId: string;
}

export interface GameCommandBroadcastEffect {
  kind: 'broadcast';
  roomId: string;
  eventName: string;
  payload: unknown;
}

export interface GameCommandPrivateEventEffect {
  kind: 'private';
  userId: string;
  eventName: string;
  payload: unknown;
}

export type GameCommandEffect =
  | GameCommandRoomJoinEffect
  | GameCommandRoomLeaveEffect
  | GameCommandBroadcastEffect
  | GameCommandPrivateEventEffect;

export interface GameCommandAcceptedResult {
  type: 'COMMAND_ACCEPTED';
  requestId: string;
  receivedType: string;
  effects: GameCommandEffect[];
}

export interface GameCommandRejectedResult {
  type: 'COMMAND_REJECTED';
  requestId: string;
  reason: string;
  message: string;
}

export type GameCommandResult =
  | GameCommandAcceptedResult
  | GameCommandRejectedResult;
