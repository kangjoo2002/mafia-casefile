export interface SocketUser {
  id: string;
  email: string;
}

export interface PongEvent {
  type: "pong";
  timestamp: string;
}

export interface WhoamiEvent {
  id: string;
  email: string;
}
