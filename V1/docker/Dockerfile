# syntax=docker/dockerfile:1
FROM node:22-slim AS base
WORKDIR /app

# --- deps: full install (incl. devDependencies) so `prisma` CLI is available for generate ---
FROM base AS deps
COPY package.json package-lock.json* ./
COPY prisma ./prisma
COPY scripts ./scripts
RUN npm ci

# --- build: generate the canonical (Postgres) Prisma client + compile TypeScript ---
FROM deps AS build
COPY . .
RUN npm run build

# --- production image: prod deps only, no prisma CLI needed at runtime ---
# (--ignore-scripts skips postinstall, which would otherwise try to run the
# devDependency-only `prisma` CLI to regenerate a SQLite client we don't want here;
# the already-generated Postgres client is copied in from the build stage instead)
FROM base AS production
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build /app/prisma ./prisma

EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
