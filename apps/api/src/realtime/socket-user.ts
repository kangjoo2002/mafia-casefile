import { Socket } from 'socket.io';
import type { SocketUser } from '@mafia-casefile/shared';

export interface AuthenticatedSocketData {
  user?: SocketUser;
}

export type AuthenticatedSocket = Socket & {
  data: AuthenticatedSocketData;
};
