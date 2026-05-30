import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ROOM_REPOSITORY, type RoomRepository } from './room.repository';

export type RoomStatus = 'WAITING' | 'IN_PROGRESS' | 'FINISHED';

export interface RoomParticipant {
  userId: string;
  nickname: string;
  isReady: boolean;
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
  constructor(
    @Inject(ROOM_REPOSITORY) private readonly repository: RoomRepository,
  ) {}

  async createRoom(input: CreateRoomInput): Promise<Room> {
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
          isReady: false,
          joinedAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    const snapshot = normalizeRoom(room);
    return await this.repository.save(snapshot);
  }

  async listRooms(): Promise<Room[]> {
    return await this.repository.list();
  }

  async findRoomById(roomId: string): Promise<Room | null> {
    if (!isNonEmptyString(roomId)) {
      return null;
    }

    const room = await this.repository.findById(roomId);
    return room ? cloneRoom(normalizeRoom(room)) : null;
  }

  async joinRoom(
    roomId: string,
    participant: { userId: string; nickname: string },
  ): Promise<Room> {
    if (!isNonEmptyString(roomId)) {
      throw new BadRequestException('roomId is required');
    }

    if (!isNonEmptyString(participant?.userId)) {
      throw new BadRequestException('userId is required');
    }

    if (!isNonEmptyString(participant?.nickname)) {
      throw new BadRequestException('nickname is required');
    }

    const room = await this.repository.findById(roomId);
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
        isReady: false,
        joinedAt: now,
      });
    }

    room.updatedAt = now;
    const snapshot = normalizeRoom(room);
    return await this.repository.save(snapshot);
  }

  async startGame(roomId: string, userId: string): Promise<Room> {
    if (!isNonEmptyString(roomId)) {
      throw new BadRequestException('roomId is required');
    }

    if (!isNonEmptyString(userId)) {
      throw new BadRequestException('userId is required');
    }

    const room = await this.repository.findById(roomId);
    if (!room) {
      throw new BadRequestException('room not found');
    }

    if (room.status !== 'WAITING') {
      throw new BadRequestException('room is not startable');
    }

    if (room.hostUserId !== userId.trim()) {
      throw new BadRequestException('only host can start game');
    }

    if (room.participants.length < 4) {
      throw new BadRequestException('room needs at least 4 players');
    }

    if (room.participants.some((participant) => !participant.isReady)) {
      throw new BadRequestException('not all participants are ready');
    }

    room.status = 'IN_PROGRESS';
    room.updatedAt = new Date();

    const snapshot = normalizeRoom(room);
    return await this.repository.save(snapshot);
  }

  async assertCanAdvancePhase(roomId: string, userId: string): Promise<Room> {
    if (!isNonEmptyString(roomId)) {
      throw new BadRequestException('roomId is required');
    }

    if (!isNonEmptyString(userId)) {
      throw new BadRequestException('userId is required');
    }

    const room = await this.repository.findById(roomId);
    if (!room) {
      throw new BadRequestException('room not found');
    }

    if (room.hostUserId !== userId.trim()) {
      throw new BadRequestException('not room host');
    }

    if (room.status !== 'IN_PROGRESS') {
      throw new BadRequestException('room is not in progress');
    }

    return cloneRoom(normalizeRoom(room));
  }

  async changeReady(roomId: string, userId: string, isReady: boolean): Promise<Room> {
    if (!isNonEmptyString(roomId)) {
      throw new BadRequestException('roomId is required');
    }

    if (!isNonEmptyString(userId)) {
      throw new BadRequestException('userId is required');
    }

    if (typeof isReady !== 'boolean') {
      throw new BadRequestException('isReady must be a boolean');
    }

    const room = await this.repository.findById(roomId);
    if (!room) {
      throw new BadRequestException('room not found');
    }

    if (room.status !== 'WAITING') {
      throw new BadRequestException('room is not joinable');
    }

    const participant = room.participants.find(
      (current) => current.userId === userId.trim(),
    );

    if (!participant) {
      throw new BadRequestException('participant not found');
    }

    participant.isReady = isReady;
    room.updatedAt = new Date();

    const snapshot = normalizeRoom(room);
    return await this.repository.save(snapshot);
  }

  async leaveRoom(roomId: string, userId: string): Promise<Room> {
    if (!isNonEmptyString(roomId)) {
      throw new BadRequestException('roomId is required');
    }

    if (!isNonEmptyString(userId)) {
      throw new BadRequestException('userId is required');
    }

    const room = await this.repository.findById(roomId);
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
    return await this.repository.save(snapshot);
  }
}
