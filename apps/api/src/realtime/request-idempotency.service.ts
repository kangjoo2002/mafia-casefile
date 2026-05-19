import { Inject, Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

export type RequestIdempotencyStatus = 'PROCESSING' | 'COMPLETED';

export interface RequestIdempotencyRecord {
  gameId: string;
  userId: string;
  requestId: string;
  commandType: string;
  status: RequestIdempotencyStatus;
  resultType?: 'COMMAND_ACCEPTED' | 'COMMAND_REJECTED';
  reason?: string;
  message?: string;
  receivedType?: string;
  createdAt: string;
  updatedAt: string;
}

export type RequestIdempotencyBeginResult =
  | { status: 'ACQUIRED'; record: RequestIdempotencyRecord }
  | { status: 'DUPLICATE_PROCESSING'; record: RequestIdempotencyRecord }
  | { status: 'DUPLICATE_COMPLETED'; record: RequestIdempotencyRecord };

@Injectable()
export class RequestIdempotencyService {
  constructor(@Inject(RedisService) private readonly redisService: RedisService) {}

  async begin(input: {
    gameId: string;
    userId: string;
    requestId: string;
    commandType: string;
  }): Promise<RequestIdempotencyBeginResult> {
    const now = new Date().toISOString();
    const record = this.createRecord(input, {
      status: 'PROCESSING',
      createdAt: now,
      updatedAt: now,
    });
    const key = this.redisService.buildKey(this.key(input));
    const ttlSeconds = this.resolveTtlSeconds();
    const result = await (this.redisService.getClient() as any).call(
      'SET',
      key,
      JSON.stringify(record),
      'NX',
      'EX',
      ttlSeconds,
    );

    if (result === 'OK') {
      return { status: 'ACQUIRED', record };
    }

    const current = await this.find(input);
    if (current?.status === 'COMPLETED') {
      return { status: 'DUPLICATE_COMPLETED', record: current };
    }

    if (current) {
      return { status: 'DUPLICATE_PROCESSING', record: current };
    }

    return { status: 'DUPLICATE_PROCESSING', record };
  }

  async completeAccepted(input: {
    gameId: string;
    userId: string;
    requestId: string;
    commandType: string;
    receivedType: string;
  }): Promise<RequestIdempotencyRecord> {
    return await this.complete(input, {
      resultType: 'COMMAND_ACCEPTED',
      receivedType: input.receivedType,
    });
  }

  async completeRejected(input: {
    gameId: string;
    userId: string;
    requestId: string;
    commandType: string;
    reason: string;
    message: string;
  }): Promise<RequestIdempotencyRecord> {
    return await this.complete(input, {
      resultType: 'COMMAND_REJECTED',
      reason: input.reason,
      message: input.message,
    });
  }

  async find(input: {
    gameId: string;
    userId: string;
    requestId: string;
  }): Promise<RequestIdempotencyRecord | null> {
    const raw = await this.redisService.get(this.key(input));
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as RequestIdempotencyRecord;

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof parsed.gameId !== 'string' ||
        typeof parsed.userId !== 'string' ||
        typeof parsed.requestId !== 'string' ||
        typeof parsed.commandType !== 'string' ||
        (parsed.status !== 'PROCESSING' && parsed.status !== 'COMPLETED') ||
        typeof parsed.createdAt !== 'string' ||
        typeof parsed.updatedAt !== 'string'
      ) {
        return null;
      }

      return structuredClone(parsed);
    } catch {
      return null;
    }
  }

  private async complete(
    input: {
      gameId: string;
      userId: string;
      requestId: string;
      commandType: string;
    },
    patch: Pick<
      RequestIdempotencyRecord,
      'resultType' | 'reason' | 'message' | 'receivedType'
    >,
  ): Promise<RequestIdempotencyRecord> {
    const current = await this.find(input);
    const now = new Date().toISOString();
    const record = this.createRecord(input, {
      status: 'COMPLETED',
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      ...patch,
    });

    await this.redisService
      .getClient()
      .set(
        this.redisService.buildKey(this.key(input)),
        JSON.stringify(record),
        'EX',
        this.resolveTtlSeconds(),
      );

    return record;
  }

  private createRecord(
    input: {
      gameId: string;
      userId: string;
      requestId: string;
      commandType: string;
    },
    fields: {
      status: RequestIdempotencyStatus;
      createdAt: string;
      updatedAt: string;
      resultType?: 'COMMAND_ACCEPTED' | 'COMMAND_REJECTED';
      reason?: string;
      message?: string;
      receivedType?: string;
    },
  ): RequestIdempotencyRecord {
    return {
      gameId: input.gameId,
      userId: input.userId,
      requestId: input.requestId,
      commandType: input.commandType,
      status: fields.status,
      resultType: fields.resultType,
      reason: fields.reason,
      message: fields.message,
      receivedType: fields.receivedType,
      createdAt: fields.createdAt,
      updatedAt: fields.updatedAt,
    };
  }

  private key(input: {
    gameId: string;
    userId: string;
    requestId: string;
  }) {
    return `idempotency:${input.gameId}:${input.userId}:${input.requestId}`;
  }

  private resolveTtlSeconds() {
    const raw = process.env.REQUEST_ID_TTL_SECONDS;

    if (!raw) {
      return 86400;
    }

    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : 86400;
  }
}
