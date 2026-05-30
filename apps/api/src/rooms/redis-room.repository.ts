import { Inject, Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import type { RoomRepository } from './room.repository';
import type { Room, RoomParticipant } from './rooms.service';

type SerializedRoomParticipant = Omit<RoomParticipant, 'joinedAt'> & {
  joinedAt: string;
};

type SerializedRoom = Omit<
  Room,
  'participants' | 'createdAt' | 'updatedAt'
> & {
  participants: SerializedRoomParticipant[];
  createdAt: string;
  updatedAt: string;
};

function serializeRoom(room: Room): SerializedRoom {
  const cloned = structuredClone(room);

  return {
    ...cloned,
    createdAt: cloned.createdAt.toISOString(),
    updatedAt: cloned.updatedAt.toISOString(),
    participants: cloned.participants.map((participant) => ({
      ...participant,
      joinedAt: participant.joinedAt.toISOString(),
    })),
  };
}

function deserializeRoom(room: SerializedRoom): Room {
  return {
    ...room,
    createdAt: new Date(room.createdAt),
    updatedAt: new Date(room.updatedAt),
    participants: room.participants.map((participant) => ({
      ...participant,
      joinedAt: new Date(participant.joinedAt),
    })),
  };
}

@Injectable()
export class RedisRoomRepository implements RoomRepository {
  constructor(@Inject(RedisService) private readonly redisService: RedisService) {}

  async save(room: Room): Promise<Room> {
    const payload = serializeRoom(room);
    const client = this.redisService.getClient();
    const key = this.key(room.roomId);
    const indexKey = this.indexKey();
    const score = room.createdAt.getTime();

    await client
      .multi()
      .set(
        this.redisService.buildKey(key),
        JSON.stringify(payload),
        'EX',
        this.resolveTtlSeconds(),
      )
      .zadd(this.redisService.buildKey(indexKey), score, room.roomId)
      .expire(this.redisService.buildKey(indexKey), this.resolveTtlSeconds())
      .exec();

    return deserializeRoom(payload);
  }

  async findById(roomId: string): Promise<Room | null> {
    const raw = await this.redisService.get(this.key(roomId));

    if (!raw) {
      return null;
    }

    return deserializeRoom(JSON.parse(raw) as SerializedRoom);
  }

  async list(): Promise<Room[]> {
    const client = this.redisService.getClient();
    const roomIds = await client.zrevrange(
      this.redisService.buildKey(this.indexKey()),
      0,
      -1,
    );
    const rooms: Room[] = [];

    for (const roomId of roomIds) {
      const room = await this.findById(roomId);

      if (room) {
        rooms.push(room);
      }
    }

    return rooms;
  }

  private key(roomId: string) {
    return `room:${roomId}`;
  }

  private indexKey() {
    return 'rooms:index';
  }

  private resolveTtlSeconds() {
    const raw = process.env.ROOM_TTL_SECONDS;
    if (!raw) {
      return 86400;
    }

    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : 86400;
  }
}
