# Multi-stage production build for AimoGate Procurement Engine
FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .

# Pull catalog during Docker build if not already bundled
RUN if [ ! -f data/valio_catalog_17546.json ]; then \
      echo "Pulling catalog during Docker build from Valio Aimo API..." && \
      apk add --no-cache curl && \
      mkdir -p data && \
      curl -s -L "https://junction26.valioaimo.fi/api/products/download" \
        -H "X-API-Key: junct_tDnQn4VI_nfhELGCOEkY4vbuxm324MmYmILuokYG03Y" \
        -o /tmp/raw_catalog.json && \
      npx tsx scripts/ingest_catalog_json.ts /tmp/raw_catalog.json data/valio_catalog_17546.json && \
      rm -f /tmp/raw_catalog.json; \
    fi

RUN npm run build

# Runner stage
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

# Copy built frontend assets, data, and server sources
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/firebase-applet-config.json ./
COPY --from=builder /app/firestore.rules ./
COPY --from=builder /app/data ./data

# Install tsx globally or run via npx
RUN npm install -g tsx

EXPOSE 8080

CMD ["tsx", "server.ts"]
