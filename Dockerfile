# BitBudget — production image (Next.js standalone + Prisma)
# Build: docker build -t bitbudget:local .
# Run: see docker-compose.yml and docs/self-hosting.md

FROM node:22-bookworm-slim AS base
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    openssl \
    libcairo2 \
    libpango-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
  && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS builder
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Migrations run at container start (needs live Postgres), not at image build.
RUN pnpm exec prisma generate \
  && pnpm exec next build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY scripts/docker-entrypoint.sh /app/docker-entrypoint.sh

# Prisma CLI for `migrate deploy` at container start (client is bundled in standalone server).
USER root
RUN npm install prisma@5.22.0 --no-audit --no-fund \
  && chmod +x /app/docker-entrypoint.sh \
  && chown -R nextjs:nodejs /app/node_modules /app/docker-entrypoint.sh /app/prisma
USER nextjs
EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
