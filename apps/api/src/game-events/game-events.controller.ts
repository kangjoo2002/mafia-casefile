import { BadRequestException, Controller, Get, Inject, Param } from '@nestjs/common';
import { EventVisibility } from '@prisma/client';
import { GameEventRecorderService } from './game-event-recorder.service';

type GameEventTimelineResponse = {
  gameId: string;
  events: Array<{
    id: string;
    gameId: string;
    seq: number;
    type: string;
    turn: number;
    phase: string;
    actorUserId: string | null;
    payload: unknown;
    visibilityDuringGame: EventVisibility;
    visibilityAfterGame: EventVisibility;
    requestId: string | null;
    createdAt: string;
  }>;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

@Controller('games')
export class GameEventsController {
  constructor(
    @Inject(GameEventRecorderService)
    private readonly gameEventRecorder: GameEventRecorderService,
  ) {}

  @Get(':gameId/timeline')
  async timeline(@Param('gameId') gameId: string): Promise<GameEventTimelineResponse> {
    if (!isNonEmptyString(gameId)) {
      throw new BadRequestException('gameId is required');
    }

    const events = await this.gameEventRecorder.getTimeline(gameId);

    return {
      gameId,
      events: events
        .filter((event) => event.visibilityAfterGame === EventVisibility.PUBLIC)
        .map((event) => ({
          id: event.id,
          gameId: event.gameId,
          seq: event.seq,
          type: event.type,
          turn: event.turn,
          phase: event.phase,
          actorUserId: event.actorUserId,
          payload: event.payload,
          visibilityDuringGame: event.visibilityDuringGame,
          visibilityAfterGame: event.visibilityAfterGame,
          requestId: event.requestId,
          createdAt: event.createdAt.toISOString(),
        })),
    };
  }
}
