# Multi-stage production build for AimoGate Procurement Engine
FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

# Runner stage
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

# Copy built frontend assets and server sources
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
