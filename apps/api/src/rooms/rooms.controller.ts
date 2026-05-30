import {
  Body,
  Controller,
  Inject,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { RoomsService } from './rooms.service';

@Controller('rooms')
export class RoomsController {
  constructor(
    @Inject(RoomsService) private readonly roomsService: RoomsService,
  ) {}

  @Post()
  async create(@Body() body: { hostUserId?: string; name?: string; maxPlayers?: number }) {
    return {
      room: await this.roomsService.createRoom(body),
    };
  }

  @Get()
  async list() {
    return {
      rooms: await this.roomsService.listRooms(),
    };
  }

  @Get(':roomId')
  async detail(@Param('roomId') roomId: string) {
    const room = await this.roomsService.findRoomById(roomId);

    if (!room) {
      throw new NotFoundException('room not found');
    }

    return {
      room,
    };
  }
}
