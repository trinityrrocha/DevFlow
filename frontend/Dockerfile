FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY frontend/package.json ./frontend/package.json
RUN pnpm install --filter @devflow/frontend --frozen-lockfile
COPY frontend ./frontend
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @devflow/frontend build

FROM nginx:1.27-alpine
ARG DEVFLOW_BUILD_VERSION=unknown
ARG DEVFLOW_BUILD_COMMIT=unknown
LABEL org.opencontainers.image.version="$DEVFLOW_BUILD_VERSION" \
      org.opencontainers.image.revision="$DEVFLOW_BUILD_COMMIT"
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
