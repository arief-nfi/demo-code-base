# Stage 1: Build
FROM node:24-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

ENV DOCKER_BUILD=1

# Copy workspace config
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./

# Copy package.json files for all workspaces
COPY apps/web/package.json apps/web/
COPY packages/ui/package.json packages/ui/
COPY packages/database/package.json packages/database/
COPY packages/backend/package.json packages/backend/
COPY plugins/audit-log/package.json plugins/audit-log/
COPY plugins/sample-plugin/package.json plugins/sample-plugin/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/ packages/
COPY plugins/ plugins/
COPY apps/web/ apps/web/
COPY patches/ patches/

# Build
RUN pnpm --filter web run build

# Stage 2: Production
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy standalone output
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static apps/web/.next/static
COPY --from=builder /app/apps/web/public apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
