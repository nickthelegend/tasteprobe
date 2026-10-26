# syntax=docker/dockerfile:1
# TasteProbe production image: Next.js standalone output on Node 22 (alpine), runs as the
# unprivileged "node" user. No secrets are baked in: every key is a runtime env var, set by
# name on the host (see docs/hosting.md). Audits and raw provider payloads live in
# TASTEPROBE_DATA_DIR (/data), which must be a private persistent volume.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:${NODE_VERSION}-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    TASTEPROBE_DATA_DIR=/data
# su-exec is only used when the platform starts the container as root (Railway with
# RAILWAY_RUN_UID=0, so the root-owned volume can be chowned); the server itself always runs as "node".
RUN apk add --no-cache su-exec \
 && mkdir -p /data .next \
 && chown node:node /data .next \
 && chmod 700 /data
# App files stay root-owned and read-only to the server; only .next (runtime cache) and /data are writable.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --chmod=755 scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
