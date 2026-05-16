-- CreateEnum
CREATE TYPE "EventVisibility" AS ENUM ('PUBLIC', 'PRIVATE', 'MAFIA_ONLY', 'GHOST_ONLY', 'SYSTEM_ONLY');

-- CreateTable
CREATE TABLE "game_event_logs" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "actorUserId" TEXT,
    "payload" JSONB NOT NULL,
    "visibilityDuringGame" "EventVisibility" NOT NULL,
    "visibilityAfterGame" "EventVisibility" NOT NULL,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "game_event_logs_gameId_seq_key" ON "game_event_logs"("gameId", "seq");

-- CreateIndex
CREATE INDEX "game_event_logs_gameId_requestId_idx" ON "game_event_logs"("gameId", "requestId");

-- CreateIndex
CREATE INDEX "game_event_logs_gameId_type_idx" ON "game_event_logs"("gameId", "type");

-- CreateIndex
CREATE INDEX "game_event_logs_gameId_createdAt_idx" ON "game_event_logs"("gameId", "createdAt");
