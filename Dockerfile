FROM oven/bun:1 AS base

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json profile.md ./
COPY config ./config
COPY src ./src
COPY web ./web

RUN bun run web:build

ENV HOST=0.0.0.0 PORT=3000 DB_PATH=/app/data/jobs.db HTTP_CACHE_DIR=/app/data/http-cache
EXPOSE 3000

CMD ["bun", "run", "web"]
