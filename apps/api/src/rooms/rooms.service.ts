import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export type RoomStatus = 'WAITING' | 'IN_PROGRESS' | 'FINISHED';

export interface RoomParticipant {
  userId: string;
  nickname: string;
  joinedAt: Date;
}

export interface Room {
  roomId: string;
  name: string;
  hostUserId: string;
  status: RoomStatus;
  playerCount: number;
  maxPlayers: number;
  participants: RoomParticipant[];
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

function normalizeRoom(room: Room): Room {
  return {
    ...cloneRoom(room),
    playerCount: room.participants.length,
  };
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
      participants: [
        {
          userId: input.hostUserId.trim(),
          nickname: input.hostUserId.trim(),
          joinedAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    const snapshot = normalizeRoom(room);
    this.rooms.set(room.roomId, snapshot);
    return cloneRoom(snapshot);
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
    return room ? cloneRoom(normalizeRoom(room)) : null;
  }

  joinRoom(
    roomId: string,
    participant: { userId: string; nickname: string },
  ): Room {
    if (!isNonEmptyString(roomId)) {
      throw new BadRequestException('roomId is required');
    }

    if (!isNonEmptyString(participant?.userId)) {
      throw new BadRequestException('userId is required');
    }

    if (!isNonEmptyString(participant?.nickname)) {
      throw new BadRequestException('nickname is required');
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      throw new BadRequestException('room not found');
    }

    if (room.status !== 'WAITING') {
      throw new BadRequestException('room is not joinable');
    }

    const now = new Date();
    const existingIndex = room.participants.findIndex(
      (current) => current.userId === participant.userId.trim(),
    );

    if (existingIndex >= 0) {
      room.participants[existingIndex] = {
        ...room.participants[existingIndex],
        nickname: participant.nickname.trim(),
      };
    } else {
      if (room.participants.length >= room.maxPlayers) {
        throw new BadRequestException('room is full');
      }

      room.participants.push({
        userId: participant.userId.trim(),
        nickname: participant.nickname.trim(),
        joinedAt: now,
      });
    }

    room.updatedAt = now;
    const snapshot = normalizeRoom(room);
    this.rooms.set(roomId, snapshot);
    return cloneRoom(snapshot);
  }

  leaveRoom(roomId: string, userId: string): Room {
    if (!isNonEmptyString(roomId)) {
      throw new BadRequestException('roomId is required');
    }

    if (!isNonEmptyString(userId)) {
      throw new BadRequestException('userId is required');
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      throw new BadRequestException('room not found');
    }

    const participantIndex = room.participants.findIndex(
      (participant) => participant.userId === userId.trim(),
    );

    if (participantIndex < 0) {
      throw new BadRequestException('participant not found');
    }

    room.participants.splice(participantIndex, 1);
    room.updatedAt = new Date();

    const snapshot = normalizeRoom(room);
    this.rooms.set(roomId, snapshot);
    return cloneRoom(snapshot);
  }
}
