# Multi-stage production Dockerfile for PhishTank-NS API, Worker & React SOC Dashboard
FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci

COPY tsconfig.json ./
COPY src/ ./src/
COPY frontend/ ./frontend/
COPY public/ ./public/
COPY test-samples/ ./test-samples/

RUN npm run build && cd frontend && npm run build

FROM node:22-alpine AS runner

WORKDIR /app
RUN apk add --no-cache curl

ENV NODE_ENV=production
ENV PORT=3000
ENV UPLOAD_DIR=/app/uploads
ENV QUEUE_CONCURRENCY=5

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/test-samples ./test-samples
COPY benchmarks/hf_results.json benchmarks/results.json ./benchmarks/

RUN mkdir -p /app/data /app/uploads && chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/v1/health || exit 1

CMD ["npm", "start"]
