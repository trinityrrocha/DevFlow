FROM node:22-alpine AS dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json ./backend/package.json
RUN pnpm install --filter @devflow/backend --prod --frozen-lockfile

FROM node:22-alpine
ARG DEVFLOW_BUILD_VERSION=unknown
ARG DEVFLOW_BUILD_COMMIT=unknown
LABEL org.opencontainers.image.version="$DEVFLOW_BUILD_VERSION" \
      org.opencontainers.image.revision="$DEVFLOW_BUILD_COMMIT"
RUN apk add --no-cache tini
WORKDIR /app/backend
ENV NODE_ENV=production
ENV MIGRATIONS_DIR=/database/migrations
COPY --from=dependencies /app/node_modules /app/node_modules
COPY --from=dependencies /app/backend/node_modules /app/backend/node_modules
COPY backend/package.json ./package.json
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY database /database
RUN node scripts/migration-image-contract.js normalize /database
RUN addgroup -S devflow && adduser -S -G devflow devflow \
    && mkdir -p /var/lib/devflow/uploads \
    && chown -R devflow:devflow /app /var/lib/devflow
USER devflow
RUN set -eu; \
    latest_path="$(find /database/migrations -maxdepth 1 -type f -name '*.sql' -print | sort | tail -n1)"; \
    test -n "$latest_path"; \
    latest_name="${latest_path##*/}"; \
    latest_sha256="$(sha256sum "$latest_path" | awk '{print $1}')"; \
    node scripts/migration-image-contract.js probe /database "$latest_name" "$latest_sha256"
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "node scripts/migrate.js && node src/server.js"]
