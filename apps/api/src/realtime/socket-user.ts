import { Socket } from 'socket.io';

export interface SocketUser {
  id: string;
  email: string;
}

export interface AuthenticatedSocketData {
  user?: SocketUser;
}

export type AuthenticatedSocket = Socket & {
  data: AuthenticatedSocketData;
};
