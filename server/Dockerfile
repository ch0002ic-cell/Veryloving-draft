FROM node:22-alpine AS build

WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --ignore-scripts
COPY server/tsconfig.adapters.json ./
COPY server/tsconfig.ai-native.json ./
COPY server/src ./src
RUN npm run build

FROM node:22-alpine

WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server/*.cjs ./
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/dist-ai-native ./dist-ai-native

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O - "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

CMD ["node", "clm-server.cjs"]
