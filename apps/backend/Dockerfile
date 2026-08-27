# Build context is the repo root (see docker-compose.yml) because this is a
# bun workspace - apps/backend depends on the root lockfile and on
# packages/typescript-config / packages/eslint-config.
FROM oven/bun:1

# pdftotext (poppler-utils) is required by src/ingestion/extract.ts - PDF
# parsing shells out to it rather than using a JS PDF library, because its
# `-layout` output is what every regex-based chunker in this project was
# designed against (validated during architecture research, see
# plan/02-ingestion.md).
RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

COPY package.json bun.lock turbo.json ./
COPY packages/typescript-config ./packages/typescript-config
COPY packages/eslint-config ./packages/eslint-config
COPY apps/backend ./apps/backend

RUN bun install --frozen-lockfile

WORKDIR /repo/apps/backend
# Pinned to the Prisma 6.x line (see prisma/schema.prisma and package.json)
# - Prisma 7 requires a mandatory driver adapter and moves datasource.url
#   out of schema.prisma into prisma.config.ts, which is more moving parts
#   than this project needs. PRISMA_HIDE_UPDATE_MESSAGE silences the
#   "newer version available" nag in build logs.
ENV PRISMA_HIDE_UPDATE_MESSAGE=true
RUN bunx prisma generate

EXPOSE 3001

# docker-compose.yml overrides `command:` for the worker service; this is
# the default (api) process.
CMD ["bun", "run", "start"]
