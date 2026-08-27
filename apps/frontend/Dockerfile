# Build context is the repo root (see docker-compose.yml) - same reason as
# apps/backend/Dockerfile: this is a bun workspace, and the frontend depends
# on the root lockfile and packages/typescript-config + packages/eslint-config.
FROM oven/bun:1 AS build

WORKDIR /repo
COPY package.json bun.lock turbo.json ./
COPY packages/typescript-config ./packages/typescript-config
COPY packages/eslint-config ./packages/eslint-config
COPY apps/frontend ./apps/frontend

RUN bun install --frozen-lockfile

# VITE_API_URL is baked in at build time (Vite env vars are compile-time,
# not runtime) - defaults to how the browser reaches the api service
# through docker-compose's published port (see .env.example).
ARG VITE_API_URL=http://localhost:3001
ENV VITE_API_URL=$VITE_API_URL

WORKDIR /repo/apps/frontend
RUN bun run build

FROM nginx:1-alpine
COPY --from=build /repo/apps/frontend/dist /usr/share/nginx/html
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
