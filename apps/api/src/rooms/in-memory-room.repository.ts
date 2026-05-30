import { Injectable } from '@nestjs/common';
import type { RoomRepository } from './room.repository';
import type { Room } from './rooms.service';

function cloneRoom(room: Room): Room {
  return structuredClone(room);
}

@Injectable()
export class InMemoryRoomRepository implements RoomRepository {
  private readonly rooms = new Map<string, Room>();

  async save(room: Room): Promise<Room> {
    const snapshot = cloneRoom(room);
    this.rooms.set(snapshot.roomId, snapshot);
    return cloneRoom(snapshot);
  }

  async findById(roomId: string): Promise<Room | null> {
    const room = this.rooms.get(roomId);
    return room ? cloneRoom(room) : null;
  }

  async list(): Promise<Room[]> {
    return [...this.rooms.values()].reverse().map((room) => cloneRoom(room));
  }
}
