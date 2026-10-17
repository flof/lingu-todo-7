# Build the client, then run the server on a bare Node image: the app needs no
# dependencies at runtime beyond Hono, because SQLite is built into Node 24.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.server.json ./
COPY shared ./shared
COPY server ./server
COPY client ./client
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0
ENV DATA_DIR=/data BACKUP_DIR=/data/backups STATIC_DIR=/app/client/dist
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY shared ./shared
COPY server ./server
COPY --from=build /app/client/dist ./client/dist
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/src/index.ts"]
