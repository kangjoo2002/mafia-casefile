import type { AvailableAction } from "@mafia-casefile/shared";
import type { RoomView } from "../../../lib/play-types";

export const DEFAULT_CHAT_CHANNELS = ["LOBBY", "DAY", "MAFIA", "GHOST"] as const;

export type PlayChatChannel = (typeof DEFAULT_CHAT_CHANNELS)[number];

export function isChannelAllowed(
  channel: PlayChatChannel,
  room: RoomView | null,
  availableActions: AvailableAction[],
) {
  if (channel === "LOBBY") {
    return room?.status === "WAITING";
  }

  return availableActions.some(
    (action) =>
      action.type === "SEND_CHAT_MESSAGE" && action.channel === channel,
  );
}

export function getAllowedChatChannels(
  room: RoomView | null,
  availableActions: AvailableAction[],
) {
  return DEFAULT_CHAT_CHANNELS.filter((channel) =>
    isChannelAllowed(channel, room, availableActions),
  );
}
