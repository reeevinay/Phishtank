# Multi-stage production Dockerfile for PhishTank
FROM node:22-alpine AS builder

WORKDIR /app

# Install build tools for native C++ addons (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code and config
COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY test-samples/ ./test-samples/

# Production runner stage
FROM node:22-alpine AS runner

WORKDIR /app

# Runtime dependencies
RUN apk add --no-cache curl

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/phishtank.db
ENV UPLOAD_DIR=/app/uploads
ENV QUEUE_CONCURRENCY=5

# Copy built application and modules from builder
COPY --from=builder /app ./

# Create data and uploads mount points
RUN mkdir -p /app/data /app/uploads && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/v1/health || exit 1

CMD ["npm", "start"]
