import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export type RoomStatus = 'WAITING' | 'IN_PROGRESS' | 'FINISHED';

export interface Room {
  roomId: string;
  name: string;
  hostUserId: string;
  status: RoomStatus;
  playerCount: number;
  maxPlayers: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRoomInput {
  hostUserId?: string;
  name?: string;
  maxPlayers?: number;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function cloneRoom(room: Room): Room {
  return structuredClone(room);
}

@Injectable()
export class RoomsService {
  private readonly rooms = new Map<string, Room>();

  createRoom(input: CreateRoomInput): Room {
    if (!isNonEmptyString(input?.hostUserId)) {
      throw new BadRequestException('hostUserId is required');
    }

    if (typeof input?.maxPlayers !== 'undefined') {
      if (typeof input.maxPlayers !== 'number') {
        throw new BadRequestException('maxPlayers must be a number');
      }

      if (!Number.isInteger(input.maxPlayers) || input.maxPlayers < 2) {
        throw new BadRequestException('maxPlayers must be an integer of at least 2');
      }
    }

    const maxPlayers = input.maxPlayers ?? 8;

    if (!Number.isInteger(maxPlayers) || maxPlayers < 2) {
      throw new BadRequestException('maxPlayers must be an integer of at least 2');
    }

    const now = new Date();
    const room: Room = {
      roomId: randomUUID(),
      name: isNonEmptyString(input.name) ? input.name.trim() : '새 방',
      hostUserId: input.hostUserId.trim(),
      status: 'WAITING',
      playerCount: 1,
      maxPlayers,
      createdAt: now,
      updatedAt: now,
    };

    this.rooms.set(room.roomId, cloneRoom(room));
    return cloneRoom(room);
  }

  listRooms(): Room[] {
    return [...this.rooms.values()]
      .reverse()
      .map((room) => cloneRoom(room));
  }

  findRoomById(roomId: string): Room | null {
    if (!isNonEmptyString(roomId)) {
      return null;
    }

    const room = this.rooms.get(roomId);
    return room ? cloneRoom(room) : null;
  }
}
