import type { Room } from './rooms.service';

export interface RoomRepository {
  save(room: Room): Promise<Room>;
  findById(roomId: string): Promise<Room | null>;
  list(): Promise<Room[]>;
}

export const ROOM_REPOSITORY = 'ROOM_REPOSITORY';
