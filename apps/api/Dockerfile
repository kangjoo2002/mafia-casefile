FROM node:22-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

FROM deps AS build

COPY apps/api apps/api
COPY packages/shared packages/shared

WORKDIR /app/apps/api

RUN pnpm prisma:generate

WORKDIR /app

RUN pnpm --filter @mafia-casefile/shared build
RUN pnpm --filter api build

WORKDIR /app

RUN pnpm --filter api deploy --prod --legacy /prod/api
RUN cp -R /app/apps/api/prisma /prod/api/
RUN cp -R /app/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma \
  /prod/api/node_modules/.pnpm/@prisma+client@*/node_modules/
RUN rm -rf /prod/api/src \
  /prod/api/Dockerfile \
  /prod/api/tsconfig.json \
  /prod/api/tsconfig.build.json

FROM base AS runner

ENV NODE_ENV=production

WORKDIR /app/apps/api

COPY --from=build /prod/api ./

EXPOSE 3001

CMD ["node", "dist/main.js"]
