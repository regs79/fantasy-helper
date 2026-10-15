# syntax=docker/dockerfile:1
# Always build with --platform linux/amd64: the server is x86_64, the Mac is arm64.

FROM node:24-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
ARG BUILD_TAG=dev
ENV BUILD_TAG=$BUILD_TAG
RUN npm run build
# Production dependencies only, for the runtime image.
RUN npm ci --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    LEAGUE_CONFIG=/app/config/league.json
WORKDIR /app
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist
COPY --from=build /src/package.json ./package.json
COPY config ./config
COPY samples ./samples
# The volume mount point must be writable by the unprivileged user; a named
# volume inherits this ownership on first use.
RUN mkdir -p /data && chown node:node /data
# `docker compose exec app fh <cmd>` runs the CLI inside the container.
RUN printf '#!/bin/sh\nexec node /app/dist/cli.js "$@"\n' > /usr/local/bin/fh && chmod +x /usr/local/bin/fh
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "dist/cli.js", "board"]
