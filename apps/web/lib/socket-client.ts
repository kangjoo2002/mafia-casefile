import { io, type Socket } from "socket.io-client";

const DEFAULT_SOCKET_URL = "http://localhost:3001";

export function getSocketUrl() {
  return normalizeBaseUrl(
    process.env.NEXT_PUBLIC_SOCKET_URL ?? DEFAULT_SOCKET_URL,
  );
}

export function createSocket(token: string): Socket {
  return io(getSocketUrl(), {
    transports: ["websocket"],
    autoConnect: false,
    auth: {
      token,
    },
  });
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}
