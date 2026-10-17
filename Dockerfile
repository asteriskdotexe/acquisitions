# syntax=docker/dockerfile:1

#############################################
# Base: shared setup for every stage
#############################################
FROM node:22-alpine AS base

WORKDIR /app

# Needed for bcrypt's native bindings to build cleanly on alpine
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./


#############################################
# deps-dev: full dependency set (incl. devDependencies)
# Used by the "development" stage for `npm run dev` (eslint, drizzle-kit, etc.)
#############################################
FROM base AS deps-dev
RUN npm ci


#############################################
# deps-prod: production-only dependencies
# Used by the "production" stage to keep the final image small
#############################################
FROM base AS deps-prod
RUN npm ci --omit=dev


#############################################
# development: hot-reloading dev server
# This is the target docker-compose.dev.yml builds and runs.
#############################################
FROM base AS development

ENV NODE_ENV=development

COPY --from=deps-dev /app/node_modules ./node_modules
COPY . .

RUN mkdir -p logs

EXPOSE 3000

# `node --watch` restarts the process on file changes; combined with a bind
# mount in docker-compose.dev.yml, this gives you live reload in the container.
CMD ["npm", "run", "dev"]


#############################################
# production: minimal, non-root runtime image
# This is the target docker-compose.prod.yml builds and runs.
#############################################
FROM base AS production

ENV NODE_ENV=production

COPY --from=deps-prod /app/node_modules ./node_modules
COPY . .

RUN mkdir -p logs \
  && addgroup -S appgroup \
  && adduser -S appuser -G appgroup \
  && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["npm", "start"]
