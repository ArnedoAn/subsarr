FROM node:24-alpine AS builder
WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# ffsubsync powers subtitle synchronization; build-base covers wheels missing for the arch.
FROM node:24-alpine AS ffsubsync
RUN apk add --no-cache python3 python3-dev build-base \
  && python3 -m venv /opt/ffsubsync \
  && /opt/ffsubsync/bin/pip install --no-cache-dir ffsubsync==0.5.1

FROM node:24-alpine AS runner
WORKDIR /app

RUN apk add --no-cache ffmpeg su-exec python3
COPY --from=ffsubsync /opt/ffsubsync /opt/ffsubsync
ENV SUBSYNC_SYNC_PYTHON=/opt/ffsubsync/bin/python

ENV NODE_ENV=production
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/benchmarks ./benchmarks

# Entrypoint migrates app-data ownership when PUID/PGID are supplied, then drops root.
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data && chown node:node /data

EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 CMD wget -q --spider http://127.0.0.1:3001/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main"]
