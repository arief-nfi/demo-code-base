# Stage 1: Build
FROM node:24-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

# Copy workspace config
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./

# Copy package.json files for all workspaces
COPY apps/api/package.json apps/api/
COPY packages/backend/package.json packages/backend/
COPY packages/database/package.json packages/database/
COPY packages/ui/package.json packages/ui/
COPY plugins/audit-log/package.json plugins/audit-log/
COPY plugins/sample-plugin/package.json plugins/sample-plugin/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/ packages/
COPY plugins/ plugins/
COPY apps/api/ apps/api/
COPY patches/ patches/

# Generate Prisma client and build
RUN pnpm --filter @saas/database run db:generate
RUN pnpm --filter api run build

# Stage 2: Production
FROM node:24-alpine AS runner
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

ENV NODE_ENV=production

# Copy workspace config
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

# Copy package.json files
COPY apps/api/package.json apps/api/
COPY packages/backend/package.json packages/backend/
COPY packages/database/package.json packages/database/
COPY packages/ui/package.json packages/ui/
COPY plugins/audit-log/package.json plugins/audit-log/
COPY plugins/sample-plugin/package.json plugins/sample-plugin/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /app/apps/api/dist apps/api/dist
COPY --from=builder /app/packages/backend/dist packages/backend/dist
COPY --from=builder /app/packages/database/dist packages/database/dist
COPY --from=builder /app/packages/database/generated packages/database/generated
COPY --from=builder /app/plugins/audit-log/dist plugins/audit-log/dist
COPY --from=builder /app/plugins/sample-plugin/dist plugins/sample-plugin/dist

# Copy Prisma schema for migrations
COPY packages/database/prisma packages/database/prisma

# Create uploads directory
RUN mkdir -p uploads

EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
