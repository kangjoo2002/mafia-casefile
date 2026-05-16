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
  create(@Body() body: { hostUserId?: string; name?: string; maxPlayers?: number }) {
    return {
      room: this.roomsService.createRoom(body),
    };
  }

  @Get()
  list() {
    return {
      rooms: this.roomsService.listRooms(),
    };
  }

  @Get(':roomId')
  detail(@Param('roomId') roomId: string) {
    const room = this.roomsService.findRoomById(roomId);

    if (!room) {
      throw new NotFoundException('room not found');
    }

    return {
      room,
    };
  }
}
