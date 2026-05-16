import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { EventVisibility, GameEventLog } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface RecordEventInput {
  gameId: string;
  type: string;
  turn: number;
  phase: string;
  actorUserId?: string | null;
  payload: unknown;
  visibilityDuringGame: EventVisibility;
  visibilityAfterGame: EventVisibility;
  requestId?: string | null;
}

@Injectable()
export class GameEventRecorderService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async recordEvent(input: RecordEventInput): Promise<GameEventLog> {
    return this.prisma.$transaction(async (tx) => {
      const aggregate = await tx.gameEventLog.aggregate({
        where: {
          gameId: input.gameId,
        },
        _max: {
          seq: true,
        },
      });

      const seq = (aggregate._max.seq ?? 0) + 1;

      return tx.gameEventLog.create({
        data: {
          gameId: input.gameId,
          seq,
          type: input.type,
          turn: input.turn,
          phase: input.phase,
          actorUserId: input.actorUserId ?? null,
          payload: input.payload as Prisma.InputJsonValue,
          visibilityDuringGame: input.visibilityDuringGame,
          visibilityAfterGame: input.visibilityAfterGame,
          requestId: input.requestId ?? null,
        },
      });
    });
  }

  async getTimeline(gameId: string): Promise<GameEventLog[]> {
    return this.prisma.gameEventLog.findMany({
      where: {
        gameId,
      },
      orderBy: {
        seq: 'asc',
      },
    });
  }
}
